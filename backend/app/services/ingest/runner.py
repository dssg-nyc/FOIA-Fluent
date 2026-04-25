"""Signals ingest runner — fetches, extracts, upserts, and records health.

Two entry points:
  run_source(source_id, *, force=False, dry_run=False)
  run_due_sources()

Both return a RunResult (or list thereof) and also write rows to
`signals_source_runs` for the health dashboard.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Callable

from app.config import settings
from app.data.signals_sources import SOURCES, SourceConfig, enabled_sources
from app.scripts._signals_common import (
    PILOT_PERSONAS,
    already_exists,
    extract_with_claude_instrumented,
    upsert_signal,
)
from app.services.ingest import csv_bulk, html, json_api, pdf_vision, rss
from app.services.ingest.types import RawItem, RunResult

logger = logging.getLogger(__name__)

# Strategy name → module exposing async fetch(cfg) -> list[RawItem]
STRATEGY_MAP: dict[str, Callable] = {
    "rss": rss.fetch,
    "html": html.fetch,
    "csv_bulk": csv_bulk.fetch,
    "pdf_vision": pdf_vision.fetch,
    "json_api": json_api.fetch,
    # Additional strategies (sitemap, courtlistener) wired in a later wave.
}


# ── Supabase bootstrap ──────────────────────────────────────────────────────

def _get_supabase():
    if not settings.supabase_url or not settings.supabase_service_key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set")
    from supabase import create_client
    return create_client(settings.supabase_url, settings.supabase_service_key)


# ── Health recording ────────────────────────────────────────────────────────

def _record_run(supabase, result: RunResult) -> None:
    """Persist a RunResult row to signals_source_runs. Best-effort."""
    try:
        supabase.table("signals_source_runs").insert({
            "source_id":           result.source_id,
            "started_at":          result.started_at.isoformat(),
            "completed_at":        (result.completed_at or datetime.now(timezone.utc)).isoformat(),
            "status":              result.status,
            "items_fetched":       result.items_fetched,
            "items_inserted":      result.items_inserted,
            "items_skipped_dup":   result.items_skipped_dup,
            "items_failed":        result.items_failed,
            "claude_input_tokens": result.claude_input_tokens,
            "claude_output_tokens": result.claude_output_tokens,
            "error_message":       result.error_message or None,
            "metadata":            result.metadata or {},
        }).execute()
    except Exception as e:
        logger.warning(f"[{result.source_id}] health record insert failed: {e}")


def _last_run_per_source(supabase) -> dict[str, datetime]:
    """Most recent non-skipped run timestamp per source_id. Used to decide
    which sources are due. Skipped runs don't count — we want the last time
    we actually attempted work."""
    try:
        # Supabase doesn't support GROUP BY directly via the client; pull recent
        # rows and reduce in Python. 7-day window is plenty for cadence decisions
        # since our longest cadence is weekly.
        cutoff = (datetime.now(timezone.utc) - timedelta(days=14)).isoformat()
        rows = (
            supabase.table("signals_source_runs")
            .select("source_id, started_at, status")
            .gte("started_at", cutoff)
            .in_("status", ["succeeded", "failed"])
            .order("started_at", desc=True)
            .limit(2000)
            .execute()
        )
    except Exception as e:
        logger.warning(f"last_run fetch failed: {e}")
        return {}

    seen: dict[str, datetime] = {}
    for row in rows.data or []:
        sid = row["source_id"]
        if sid in seen:
            continue
        try:
            seen[sid] = datetime.fromisoformat(row["started_at"].replace("Z", "+00:00"))
        except Exception:
            continue
    return seen


# ── Per-item processing ─────────────────────────────────────────────────────

async def _process_one(supabase, cfg: SourceConfig, item: RawItem, result: RunResult) -> None:
    """Dedup → (extract if needed) → upsert. Mutates result counters."""
    # Cheap dedup before spending on Claude
    if already_exists(supabase, cfg.source_id, item.source_id):
        result.items_skipped_dup += 1
        return

    # pdf_vision (and future pre-extracted strategies) hand us everything already
    if item.pre_extracted is not None:
        ex = item.pre_extracted
        # Token stamps the strategy left on the FIRST item of a Claude batch
        in_toks = int(item.extra_metadata.pop("_claude_input_tokens", 0))
        out_toks = int(item.extra_metadata.pop("_claude_output_tokens", 0))
        result.claude_input_tokens += in_toks
        result.claude_output_tokens += out_toks

        ok = upsert_signal(
            supabase,
            source=cfg.source_id,
            source_id=item.source_id,
            title=item.title,
            summary=ex.summary,
            body_excerpt=item.body_excerpt,
            source_url=item.source_url,
            signal_date=item.signal_date,
            agency_codes=item.default_agency_codes,
            entities=ex.entities,
            persona_tags=[p for p in ex.persona_tags if p in PILOT_PERSONAS],
            priority=ex.priority,
            metadata=item.extra_metadata,
            requester=item.requester,
        )
        if ok:
            result.items_inserted += 1
        else:
            result.items_failed += 1
        return

    # Default path — per-item Claude extraction
    extract, in_toks, out_toks = await extract_with_claude_instrumented(
        settings.anthropic_api_key, cfg.label, item.title, item.body_excerpt
    )
    result.claude_input_tokens += in_toks
    result.claude_output_tokens += out_toks

    extract = extract or {}
    summary = extract.get("summary", "") or ""
    entities = extract.get("entities", {}) or {}
    persona_tags = [
        p for p in (extract.get("persona_tags") or []) if p in PILOT_PERSONAS
    ]
    priority = extract.get("priority", 0) or 0
    claude_requester = (extract.get("requester") or "").strip()

    requester = item.requester or claude_requester

    ok = upsert_signal(
        supabase,
        source=cfg.source_id,
        source_id=item.source_id,
        title=item.title,
        summary=summary,
        body_excerpt=item.body_excerpt,
        source_url=item.source_url,
        signal_date=item.signal_date,
        agency_codes=item.default_agency_codes,
        entities=entities,
        persona_tags=persona_tags,
        priority=priority,
        metadata=item.extra_metadata,
        requester=requester,
    )
    if ok:
        result.items_inserted += 1
    else:
        result.items_failed += 1


# ── Public API ──────────────────────────────────────────────────────────────

async def run_source(
    source_id: str,
    *,
    force: bool = False,
    dry_run: bool = False,
) -> RunResult:
    """Run one source end-to-end: fetch → extract → upsert → record health."""
    cfg = SOURCES.get(source_id)
    if not cfg:
        raise KeyError(f"Unknown source_id: {source_id}")

    started = datetime.now(timezone.utc)
    result = RunResult(source_id=cfg.source_id, status="running", started_at=started)

    if not cfg.enabled and not force:
        logger.info(f"[{cfg.source_id}] disabled — skipping (pass --force to override)")
        result.status = "skipped_disabled"
        result.completed_at = datetime.now(timezone.utc)
        if not dry_run:
            _record_run(_get_supabase(), result)
        return result

    fetch_fn = STRATEGY_MAP.get(cfg.fetch_strategy)
    if not fetch_fn:
        result.status = "failed"
        result.error_message = f"unknown fetch_strategy: {cfg.fetch_strategy}"
        result.completed_at = datetime.now(timezone.utc)
        logger.error(f"[{cfg.source_id}] {result.error_message}")
        if not dry_run:
            _record_run(_get_supabase(), result)
        return result

    try:
        # `result` is passed so strategies can stash run-level metadata
        # (e.g. pdf_vision tracks processed PDF URLs for next-run dedup).
        # Strategies that don't need it accept and ignore the kwarg.
        try:
            items: list[RawItem] = await fetch_fn(cfg, result=result)
        except TypeError:
            # Older strategy signatures without `result` kwarg — fall back.
            items = await fetch_fn(cfg)
    except Exception as e:
        logger.exception(f"[{cfg.source_id}] fetch failed: {e}")
        result.status = "failed"
        result.error_message = str(e)[:500]
        result.completed_at = datetime.now(timezone.utc)
        if not dry_run:
            _record_run(_get_supabase(), result)
        return result

    result.items_fetched = len(items)

    if dry_run:
        logger.info(f"[{cfg.source_id}] dry-run: fetched {len(items)} items, skipping write")
        result.status = "succeeded"
        result.completed_at = datetime.now(timezone.utc)
        return result

    supabase = _get_supabase()

    # Apply per-run cap at the fetch layer but double-guard here in case the
    # strategy returned extras
    items = items[: cfg.max_items_per_run]

    for item in items:
        try:
            await _process_one(supabase, cfg, item, result)
        except Exception as e:
            result.items_failed += 1
            logger.warning(f"[{cfg.source_id}] item {item.source_id} failed: {e}")
        # Polite pacing — keep Claude / Supabase happy under concurrency
        await asyncio.sleep(0.15)

    result.status = "succeeded"
    result.completed_at = datetime.now(timezone.utc)

    logger.info(
        f"[{cfg.source_id}] fetched={result.items_fetched} "
        f"inserted={result.items_inserted} skipped={result.items_skipped_dup} "
        f"failed={result.items_failed} "
        f"tokens(in/out)={result.claude_input_tokens}/{result.claude_output_tokens} "
        f"runtime={(result.completed_at - result.started_at).total_seconds():.1f}s"
    )

    _record_run(supabase, result)
    return result


async def run_due_sources(*, force: bool = False) -> list[RunResult]:
    """Iterate the registry, run every enabled source whose cadence has elapsed.

    After the per-source loop completes, if any source actually inserted new
    signals this round, also kick off pattern detection (subject to a 12h
    debounce). This keeps pattern generation aligned to ingestion cycles
    without spawning a separate scheduling primitive.
    """
    supabase = _get_supabase()
    last_runs = _last_run_per_source(supabase) if not force else {}
    now = datetime.now(timezone.utc)

    results: list[RunResult] = []
    for cfg in enabled_sources():
        last = last_runs.get(cfg.source_id)
        if last and not force:
            elapsed = now - last
            if elapsed < timedelta(minutes=cfg.cadence_minutes):
                logger.info(
                    f"[{cfg.source_id}] cadence not elapsed "
                    f"({elapsed.total_seconds() / 60:.0f}min / {cfg.cadence_minutes}min) — skipping"
                )
                result = RunResult(
                    source_id=cfg.source_id,
                    status="skipped_cadence",
                    started_at=now,
                    completed_at=now,
                )
                results.append(result)
                continue

        try:
            r = await run_source(cfg.source_id, force=force)
            results.append(r)
        except Exception as e:
            logger.exception(f"[{cfg.source_id}] run_source raised: {e}")
            results.append(RunResult(
                source_id=cfg.source_id,
                status="failed",
                started_at=now,
                completed_at=datetime.now(timezone.utc),
                error_message=str(e)[:500],
            ))

    # If this round actually produced new signals, trigger pattern detection.
    # Bypassed when nothing was inserted (no new corpus to find patterns in).
    total_inserted = sum(
        r.items_inserted for r in results if r.status == "succeeded"
    )
    if total_inserted > 0:
        try:
            await maybe_run_pattern_detection()
        except Exception as e:
            logger.exception(f"pattern detection trigger raised: {e}")

    return results


# ── Pattern detection trigger (called from run_due_sources + admin route) ───

PATTERN_DEBOUNCE_HOURS = 12


def _last_pattern_run_at(supabase) -> datetime | None:
    """Most recent `signal_patterns.generated_at`, or None if no rows."""
    try:
        rows = (
            supabase.table("signal_patterns")
            .select("generated_at")
            .order("generated_at", desc=True)
            .limit(1)
            .execute()
        ).data or []
        if not rows:
            return None
        ts = rows[0].get("generated_at")
        if not ts:
            return None
        return datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except Exception as e:
        logger.warning(f"_last_pattern_run_at failed: {e}")
        return None


async def maybe_run_pattern_detection() -> dict | None:
    """Run pattern detection if the last run was > PATTERN_DEBOUNCE_HOURS ago.

    Designed to be called at the end of an ingest cycle that produced new
    signals. Returns the run summary dict, or None if skipped (debounce).
    """
    from app.scripts.refresh_signal_patterns import run_pattern_detection

    supabase = _get_supabase()
    last = _last_pattern_run_at(supabase)
    now = datetime.now(timezone.utc)
    if last and (now - last) < timedelta(hours=PATTERN_DEBOUNCE_HOURS):
        elapsed_h = (now - last).total_seconds() / 3600
        logger.info(
            f"pattern detection: {elapsed_h:.1f}h since last run "
            f"(< {PATTERN_DEBOUNCE_HOURS}h debounce) — skipping"
        )
        return None
    logger.info("pattern detection: starting (post-ingest trigger)")
    return await run_pattern_detection()


async def force_run_pattern_detection() -> dict:
    """Bypass the debounce and run pattern detection immediately. Used by
    the admin 'Run now' button."""
    from app.scripts.refresh_signal_patterns import run_pattern_detection
    logger.info("pattern detection: forced (admin trigger)")
    return await run_pattern_detection()
