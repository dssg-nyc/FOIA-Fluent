"""Generate AI-detected cross-source patterns from the recent signal corpus.

Runs daily via the in-app dispatcher in `app.services.ingest.runner`
(`maybe_run_pattern_detection()`), which calls `run_pattern_detection()`
below at the end of any tick that ingests new signals (subject to a 12h
debounce).

Manual invocation:
    cd backend
    python -m app.scripts.refresh_signal_patterns
"""
from __future__ import annotations

import asyncio
import logging
import sys
import time
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

from app.data.signal_categories import (
    CATEGORIES,
    derive_persona_tags,
    filter_categories,
)

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)

# Sonnet 4.6 — quality matters for the headline feature. One big call per
# run, ~$0.50/run with the wider corpus.
PATTERN_MODEL = "claude-sonnet-4-6"
PATTERN_MAX_TOKENS = 5000

# Phase 2.5: wider window, larger corpus, more patterns per run.
LOOKBACK_DAYS = 60
MAX_SIGNALS_PER_RUN = 400
MAX_PATTERNS_PER_RUN = 8

# How far back to scan for already-surfaced pattern titles (passed to Claude
# as "don't re-surface these unless meaningfully evolved" context).
DEDUP_LOOKBACK_DAYS = 7
DEDUP_MAX_TITLES = 30


# Pattern types — 4 original + 3 new for Phase 2.5's broader source mix.
PATTERN_TYPES = [
    # Original
    "compounding_risk",       # multi-agency exposure on one entity
    "coordinated_activity",   # multiple journalists/orgs filing on same topic
    "trend_shift",            # quantitative cluster (5+ similar enforcement actions)
    "convergence",            # different signal types pointing at same event

    # Phase 2.5
    "regulatory_cascade",     # one agency's action triggers a follow-on by another
                              # (e.g. FDA warning → SEC litigation → DOJ probe in 30d)
    "recall_to_litigation",   # product recall co-occurs with court / SEC action
                              # on same company (consumer-safety + hedge_fund signal)
    "oversight_to_action",    # IG report flags a program, enforcement hits it
                              # within ~60 days (oversight.gov → enforcement)
]


# Forced tool-use schema so the response is always parseable JSON.
EXTRACT_PATTERNS_TOOL = {
    "name": "extract_signal_patterns",
    "description": "Identify non-obvious cross-source patterns from a corpus of FOIA signals.",
    "input_schema": {
        "type": "object",
        "required": ["patterns"],
        "properties": {
            "patterns": {
                "type": "array",
                "description": (
                    f"Up to {MAX_PATTERNS_PER_RUN} non-obvious patterns. "
                    f"It is OK to return fewer than {MAX_PATTERNS_PER_RUN} if the "
                    "corpus does not support that many CONCRETE patterns. "
                    "Better to return 0 patterns than to invent speculative ones. "
                    "Skip patterns substantially overlapping with the RECENT_PATTERNS "
                    "list — re-surface only if there's meaningful new evidence."
                ),
                "items": {
                    "type": "object",
                    "required": ["title", "narrative", "pattern_type", "signal_ids", "non_obviousness_score"],
                    "properties": {
                        "title": {
                            "type": "string",
                            "description": "Short headline (under 100 chars). E.g. 'Compounding regulatory exposure on WH Group'.",
                        },
                        "narrative": {
                            "type": "string",
                            "description": (
                                "2-paragraph plain English explanation of the pattern. "
                                "First paragraph: what the pattern is and which signals join it. "
                                "Second paragraph: why a normal user would miss this if reading "
                                "the signals one at a time, and which content categories the "
                                "pattern spans."
                            ),
                        },
                        "pattern_type": {
                            "type": "string",
                            "enum": PATTERN_TYPES,
                        },
                        "signal_ids": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": (
                                "UUIDs of the source signals that anchor the pattern. "
                                "Must reference signal IDs that appear in the input corpus. "
                                "Minimum 2, prefer 3-6."
                            ),
                        },
                        "entity_slugs": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": (
                                "Shared entity slugs (format 'type:slug') that anchor the pattern. "
                                "Optional — leave empty if the pattern is not entity-anchored."
                            ),
                        },
                        "category_tags": {
                            "type": "array",
                            "items": {"type": "string", "enum": CATEGORIES},
                            "description": (
                                "Content categories this pattern spans. Pick from the same "
                                "20-category taxonomy used to tag individual signals."
                            ),
                        },
                        "non_obviousness_score": {
                            "type": "integer",
                            "minimum": 0,
                            "maximum": 10,
                            "description": (
                                "How non-obvious is this pattern? "
                                "0 = anyone reading the feed would notice immediately. "
                                "10 = required reading hundreds of signals across many "
                                "sources to spot."
                            ),
                        },
                    },
                },
            },
        },
    },
}


SYSTEM_PROMPT = """You are an intelligence analyst for a FOIA transparency platform.

Your job: read a corpus of recent FOIA-derived signals (enforcement actions,
warning letters, recalls, court filings, IG reports, congressional bills,
regulatory dockets, FOIA logs) and identify CONCRETE non-obvious patterns
that join 2+ signals from different sources or time periods.

CONSERVATIVE RULES — NON-NEGOTIABLE:
- Only identify patterns where the connection is verifiable from the signal text.
- A "concrete connection" means one of:
  (a) Two or more signals share a NAMED ENTITY (company, person, agency, statute)
  (b) Two or more signals describe the same event/contract/incident from
      different angles (e.g. recall + SEC litigation + DOJ press)
  (c) A temporal cascade: agency A's action → agency B's follow-on within
      a clear window (regulatory_cascade, oversight_to_action)
  (d) Five or more signals reflect a clear quantitative cluster
- REJECT any speculative connection. If you cannot find {max_patterns} patterns
  that meet this bar, return fewer. Returning 0 patterns is acceptable.
- A pattern must reference at least 2 signal IDs from the input corpus. Use
  the EXACT UUIDs given.
- Do NOT invent facts. Every claim in your narrative must be grounded in
  the input signals.

DEDUP RULE:
- The RECENT_PATTERNS section lists pattern titles surfaced in the last
  {dedup_days} days. SKIP patterns that substantially overlap with these
  unless you have NEW evidence signals that materially change the story.
  Better to return 0 new patterns than to clutter the dashboard with
  near-duplicates.

A good pattern is something a normal user reading one signal at a time
would MISS. A bad pattern is something obvious from a single card.

Return your analysis via the extract_signal_patterns tool."""


def fetch_recent_signals(supabase) -> list[dict]:
    """Pull the most recent N signals from the feed for analysis."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=LOOKBACK_DAYS)).isoformat()
    try:
        result = (
            supabase.table("foia_signals_feed")
            .select(
                "id,source,source_id,title,summary,signal_date,entity_slugs,"
                "category_tags,persona_tags,requester"
            )
            .gte("signal_date", cutoff)
            .order("signal_date", desc=True)
            .limit(MAX_SIGNALS_PER_RUN)
            .execute()
        )
        return result.data or []
    except Exception as e:
        logger.error("fetch_recent_signals failed: %s", e)
        return []


def fetch_recent_pattern_titles(supabase) -> list[str]:
    """Titles of patterns generated in the last N days, passed to Claude as
    'already surfaced — skip unless new evidence'."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=DEDUP_LOOKBACK_DAYS)).isoformat()
    try:
        result = (
            supabase.table("signal_patterns")
            .select("title")
            .gte("generated_at", cutoff)
            .order("generated_at", desc=True)
            .limit(DEDUP_MAX_TITLES)
            .execute()
        )
        return [r["title"] for r in (result.data or []) if r.get("title")]
    except Exception as e:
        logger.warning("fetch_recent_pattern_titles failed: %s", e)
        return []


def build_corpus_text(signals: list[dict]) -> str:
    """Format the signal corpus as one bullet list, one signal per line group."""
    lines = []
    for s in signals:
        line = (
            f"- id={s['id']} | source={s['source']} | date={s.get('signal_date','')[:10]}\n"
            f"  title: {s.get('title','')[:160]}\n"
            f"  summary: {s.get('summary','')[:240]}\n"
        )
        if s.get("requester"):
            line += f"  requester: {s['requester']}\n"
        if s.get("entity_slugs"):
            line += f"  entities: {', '.join(s['entity_slugs'][:8])}\n"
        if s.get("category_tags"):
            line += f"  categories: {', '.join(s['category_tags'])}\n"
        lines.append(line)
    return "\n".join(lines)


async def extract_patterns_via_claude(
    api_key: str,
    corpus_text: str,
    recent_titles: list[str],
) -> list[dict]:
    """One Claude Sonnet call with forced tool-use. Returns the list of patterns."""
    if not api_key:
        return []

    dedup_block = ""
    if recent_titles:
        bullets = "\n".join(f"  - {t}" for t in recent_titles[:DEDUP_MAX_TITLES])
        dedup_block = (
            f"\n\nRECENT_PATTERNS (already surfaced in the last {DEDUP_LOOKBACK_DAYS} days "
            f"— skip unless new evidence):\n{bullets}\n"
        )

    user_message = (
        f"Here are {corpus_text.count('- id=')} recent FOIA signals from the past "
        f"{LOOKBACK_DAYS} days. Identify up to {MAX_PATTERNS_PER_RUN} non-obvious "
        f"cross-source patterns. Apply the conservative rules strictly."
        f"{dedup_block}\n\n"
        f"=== CORPUS ===\n{corpus_text}\n=== END CORPUS ===\n\n"
        f"Use the extract_signal_patterns tool to return your analysis."
    )

    payload = {
        "model": PATTERN_MODEL,
        "max_tokens": PATTERN_MAX_TOKENS,
        "system": SYSTEM_PROMPT.format(
            max_patterns=MAX_PATTERNS_PER_RUN,
            dedup_days=DEDUP_LOOKBACK_DAYS,
        ),
        "tools": [EXTRACT_PATTERNS_TOOL],
        "tool_choice": {"type": "tool", "name": "extract_signal_patterns"},
        "messages": [{"role": "user", "content": user_message}],
    }

    async with httpx.AsyncClient(timeout=httpx.Timeout(180.0)) as client:
        try:
            resp = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json=payload,
            )
            resp.raise_for_status()
            data = resp.json()
        except Exception as e:
            logger.error("Claude pattern extraction failed: %s", e)
            return []

    for block in data.get("content", []):
        if block.get("type") == "tool_use" and block.get("name") == "extract_signal_patterns":
            return (block.get("input") or {}).get("patterns", []) or []

    logger.warning("Claude returned no tool_use block")
    return []


def insert_patterns(
    supabase, patterns: list[dict], valid_signal_ids: set[str]
) -> int:
    """Insert patterns into signal_patterns. Defensive against Claude
    hallucinating signal IDs not in the input corpus."""
    inserted = 0
    for p in patterns:
        try:
            sig_ids = [sid for sid in (p.get("signal_ids") or []) if sid in valid_signal_ids]
            if len(sig_ids) < 2:
                logger.warning(
                    "  skipping pattern %r — fewer than 2 valid signal IDs",
                    p.get("title", "")[:60],
                )
                continue

            # Categories on the pattern; derive persona_tags from them so the
            # legacy persona-filter UI keeps working.
            cats = filter_categories(p.get("category_tags") or [])
            personas = derive_persona_tags(cats)

            row = {
                "title": (p.get("title") or "")[:300],
                "narrative": (p.get("narrative") or "").strip(),
                "pattern_type": (p.get("pattern_type") or "").strip(),
                "signal_ids": sig_ids,
                "entity_slugs": p.get("entity_slugs") or [],
                "persona_tags": personas,
                "non_obviousness_score": int(p.get("non_obviousness_score", 0) or 0),
                "visible": True,
            }
            supabase.table("signal_patterns").insert(row).execute()
            inserted += 1
            logger.info(
                "  + [%d/10] %s (%d signals, cats=%s)",
                row["non_obviousness_score"],
                row["title"][:80],
                len(sig_ids),
                cats,
            )
        except Exception as e:
            logger.warning(
                "  insert failed for pattern %r: %s",
                (p.get("title") or "?")[:60],
                e,
            )
    return inserted


# ── Public entry point — used by both the CLI wrapper and the in-app
#    dispatcher (app.services.ingest.runner.maybe_run_pattern_detection).

async def run_pattern_detection() -> dict[str, Any]:
    """Run one full pattern-detection cycle. Idempotent. Returns a status
    dict suitable for logging or returning from an admin endpoint."""
    from app.config import settings

    if not settings.anthropic_api_key:
        return {"status": "error", "error": "ANTHROPIC_API_KEY not set"}
    if not settings.supabase_url or not settings.supabase_service_key:
        return {"status": "error", "error": "SUPABASE_URL / SUPABASE_SERVICE_KEY not set"}

    from supabase import create_client
    supabase = create_client(settings.supabase_url, settings.supabase_service_key)

    started = time.monotonic()

    logger.info(
        "Pattern detection: lookback=%dd cap=%d signals max=%d patterns",
        LOOKBACK_DAYS, MAX_SIGNALS_PER_RUN, MAX_PATTERNS_PER_RUN,
    )

    signals = fetch_recent_signals(supabase)
    logger.info("Loaded %d signals for analysis", len(signals))

    if len(signals) < 5:
        runtime = time.monotonic() - started
        logger.warning(
            "Corpus too small (%d < 5). Skipping pattern detection.", len(signals)
        )
        return {
            "status": "skipped_small_corpus",
            "signals": len(signals),
            "patterns_inserted": 0,
            "runtime_seconds": round(runtime, 1),
        }

    recent_titles = fetch_recent_pattern_titles(supabase)
    if recent_titles:
        logger.info("Dedup context: %d recent pattern titles", len(recent_titles))

    corpus_text = build_corpus_text(signals)
    logger.info("Calling Claude with %d chars of corpus", len(corpus_text))

    patterns = await extract_patterns_via_claude(
        settings.anthropic_api_key, corpus_text, recent_titles
    )
    logger.info("Claude returned %d pattern candidates", len(patterns))

    valid_ids = {s["id"] for s in signals}
    inserted = insert_patterns(supabase, patterns, valid_ids)

    runtime = time.monotonic() - started
    logger.info(
        "[signal_patterns] inserted=%d candidates=%d runtime=%.1fs",
        inserted, len(patterns), runtime,
    )
    return {
        "status": "succeeded",
        "signals": len(signals),
        "candidates": len(patterns),
        "patterns_inserted": inserted,
        "runtime_seconds": round(runtime, 1),
    }


# ── CLI wrapper for manual invocation ──────────────────────────────────────

async def main():
    result = await run_pattern_detection()
    if result.get("status") == "error":
        logger.error("pattern detection error: %s", result.get("error"))
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
