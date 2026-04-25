"""Signals source health aggregator.

Reads `signals_source_runs` and projects per-source status, volumes, and
Claude cost over the last 7 days. Fed to the admin dashboard at
/api/v1/admin/signals-health so we can spot a broken source without SSH-ing
into the container.

Cost model (Haiku 4.5 prices, approximate):
    input_price  = $1.00 per 1M tokens
    output_price = $5.00 per 1M tokens
Change these constants when Anthropic adjusts pricing.
"""
from __future__ import annotations

import logging
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from app.data.signals_sources import SOURCES
from app.services.agency_profiles import _get_supabase

logger = logging.getLogger(__name__)

# Haiku 4.5 pricing as of Apr 2026 — adjust if Anthropic changes rates
HAIKU_INPUT_USD_PER_MTOK = 1.00
HAIKU_OUTPUT_USD_PER_MTOK = 5.00


def _cost_usd(input_tokens: int, output_tokens: int) -> float:
    """Project $ cost from Haiku token counts."""
    return (
        (input_tokens / 1_000_000) * HAIKU_INPUT_USD_PER_MTOK
        + (output_tokens / 1_000_000) * HAIKU_OUTPUT_USD_PER_MTOK
    )


def _project_monthly(usd_7d: float) -> float:
    """Extrapolate 7-day spend to an approximate monthly projection."""
    return round(usd_7d * (30 / 7), 2)


def get_signals_health() -> dict[str, Any]:
    """Return the full health snapshot for every source in the registry."""
    supabase = _get_supabase()
    if not supabase:
        return {"error": "supabase unavailable", "sources": [], "totals": {}}

    now = datetime.now(timezone.utc)
    week_ago = (now - timedelta(days=7)).isoformat()

    # Pull last 7d of runs in one shot; reduce in Python (Supabase client
    # doesn't support GROUP BY).
    try:
        result = (
            supabase.table("signals_source_runs")
            .select(
                "source_id, started_at, completed_at, status, items_fetched, "
                "items_inserted, items_skipped_dup, items_failed, "
                "claude_input_tokens, claude_output_tokens, error_message"
            )
            .gte("started_at", week_ago)
            .order("started_at", desc=True)
            .limit(5000)
            .execute()
        )
        runs = result.data or []
    except Exception as e:
        logger.warning(f"signals_health fetch failed: {e}")
        runs = []

    # All-time per-source totals from the actual signals feed (not the run log,
    # which only goes back as far as we've been tracking runs).
    items_total_by_source: dict[str, int] = {}
    items_total_all = 0
    try:
        from app.data.signals_sources import source_ids as _registered_source_ids
        for sid in _registered_source_ids():
            r = (
                supabase.table("foia_signals_feed")
                .select("id", count="exact")
                .eq("source", sid)
                .limit(1)
                .execute()
            )
            items_total_by_source[sid] = r.count or 0
        # Grand total — single count, regardless of registry membership
        total_r = (
            supabase.table("foia_signals_feed")
            .select("id", count="exact")
            .limit(1)
            .execute()
        )
        items_total_all = total_r.count or 0
    except Exception as e:
        logger.warning(f"signals_health total counts fetch failed: {e}")

    # Reduce: per source_id, keep last-run + 7d aggregates
    by_source: dict[str, dict] = defaultdict(lambda: {
        "last_run_at": None,
        "last_run_status": None,
        "last_run_error": None,
        "runs_succeeded_7d": 0,
        "runs_failed_7d": 0,
        "items_inserted_7d": 0,
        "items_fetched_7d": 0,
        "items_skipped_dup_7d": 0,
        "items_failed_7d": 0,
        "claude_input_tokens_7d": 0,
        "claude_output_tokens_7d": 0,
    })

    for r in runs:
        sid = r["source_id"]
        agg = by_source[sid]
        # First-seen (rows are DESC-ordered) → last run
        if agg["last_run_at"] is None:
            agg["last_run_at"] = r["started_at"]
            agg["last_run_status"] = r["status"]
            agg["last_run_error"] = r.get("error_message")

        status = r.get("status")
        if status == "succeeded":
            agg["runs_succeeded_7d"] += 1
        elif status == "failed":
            agg["runs_failed_7d"] += 1

        agg["items_fetched_7d"] += int(r.get("items_fetched") or 0)
        agg["items_inserted_7d"] += int(r.get("items_inserted") or 0)
        agg["items_skipped_dup_7d"] += int(r.get("items_skipped_dup") or 0)
        agg["items_failed_7d"] += int(r.get("items_failed") or 0)
        agg["claude_input_tokens_7d"] += int(r.get("claude_input_tokens") or 0)
        agg["claude_output_tokens_7d"] += int(r.get("claude_output_tokens") or 0)

    # Merge registry definitions in (so sources with zero runs still show up)
    sources_out: list[dict] = []
    total_cost_7d = 0.0
    for cfg in SOURCES.values():
        agg = by_source.get(cfg.source_id, by_source[cfg.source_id])
        cost_7d = _cost_usd(agg["claude_input_tokens_7d"], agg["claude_output_tokens_7d"])
        total_cost_7d += cost_7d
        sources_out.append({
            "source_id": cfg.source_id,
            "label": cfg.label,
            "family": cfg.family,
            "fetch_strategy": cfg.fetch_strategy,
            "cadence_minutes": cfg.cadence_minutes,
            "enabled": cfg.enabled,
            "max_items_per_run": cfg.max_items_per_run,
            "max_claude_calls_per_day": cfg.max_claude_calls_per_day,
            "last_run_at": agg["last_run_at"],
            "last_run_status": agg["last_run_status"],
            "last_run_error": agg["last_run_error"],
            "runs_succeeded_7d": agg["runs_succeeded_7d"],
            "runs_failed_7d": agg["runs_failed_7d"],
            "items_fetched_7d": agg["items_fetched_7d"],
            "items_inserted_7d": agg["items_inserted_7d"],
            "items_skipped_dup_7d": agg["items_skipped_dup_7d"],
            "items_failed_7d": agg["items_failed_7d"],
            "items_total": items_total_by_source.get(cfg.source_id, 0),
            "claude_input_tokens_7d": agg["claude_input_tokens_7d"],
            "claude_output_tokens_7d": agg["claude_output_tokens_7d"],
            "cost_usd_7d": round(cost_7d, 4),
            "projected_monthly_cost_usd": _project_monthly(cost_7d),
        })

    # Sort: failing first (so they're obvious), then by items_inserted_7d desc
    sources_out.sort(key=lambda s: (
        0 if s["last_run_status"] == "failed" else 1,
        -s["items_inserted_7d"],
    ))

    enabled_count = sum(1 for s in sources_out if s["enabled"])

    # Pattern engine status (last run time + total patterns ever generated)
    last_pattern_run_at: Optional[str] = None
    patterns_count_total: int = 0
    try:
        pat_count = (
            supabase.table("signal_patterns")
            .select("id", count="exact")
            .limit(1)
            .execute()
        )
        patterns_count_total = pat_count.count or 0
        pat_recent = (
            supabase.table("signal_patterns")
            .select("generated_at")
            .order("generated_at", desc=True)
            .limit(1)
            .execute()
        )
        if pat_recent.data:
            last_pattern_run_at = pat_recent.data[0].get("generated_at")
    except Exception as e:
        logger.warning(f"pattern engine status fetch failed: {e}")

    return {
        "generated_at": now.isoformat(),
        "sources": sources_out,
        "totals": {
            "sources_registered": len(sources_out),
            "sources_enabled": enabled_count,
            "runs_7d": len(runs),
            "items_inserted_7d": sum(s["items_inserted_7d"] for s in sources_out),
            "items_total_all_time": items_total_all,
            "claude_input_tokens_7d": sum(s["claude_input_tokens_7d"] for s in sources_out),
            "claude_output_tokens_7d": sum(s["claude_output_tokens_7d"] for s in sources_out),
            "cost_usd_7d": round(total_cost_7d, 4),
            "projected_monthly_cost_usd": _project_monthly(total_cost_7d),
            "last_pattern_run_at": last_pattern_run_at,
            "patterns_count_total": patterns_count_total,
        },
    }


def get_recent_runs(source_id: Optional[str] = None, limit: int = 50) -> list[dict]:
    """Raw run rows for debugging a specific source or just browsing recency."""
    supabase = _get_supabase()
    if not supabase:
        return []
    try:
        q = (
            supabase.table("signals_source_runs")
            .select("*")
            .order("started_at", desc=True)
            .limit(limit)
        )
        if source_id:
            q = q.eq("source_id", source_id)
        return (q.execute().data or [])
    except Exception as e:
        logger.warning(f"get_recent_runs failed: {e}")
        return []
