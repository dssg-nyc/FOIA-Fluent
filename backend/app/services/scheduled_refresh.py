"""Lightweight in-app scheduler for non-signal refresh jobs.

Why this exists:
  - Federal + state hub stats need to refresh weekly. Insights data is
    yearly. Pattern detection is debounced and lives in the ingest runner.
  - Rather than configure separate Railway crons for each, we piggyback
    on the hourly signals dispatcher. After it finishes its source loop,
    it asks this module: "anything else due?" and we run jobs whose
    cadence has elapsed since their last successful run.

Tracking:
  - Each run records a row in `signals_source_runs` using a synthetic
    `source_id` (e.g. `hub_federal_stats`). The admin health page already
    reads that table, so scheduled jobs show up next to ingest sources
    automatically.
  - "Due" is decided from the most recent succeeded row for a job_id.
    No extra schema, no separate config.

To register a new scheduled job: add an entry to SCHEDULED_JOBS. The
runner imports this module at the end of `run_due_sources`.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Awaitable, Callable

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ScheduledJob:
    """A periodic non-signal refresh.

    `runner` returns a counter dict shaped like `signals_source_runs`
    columns: items_fetched / items_inserted / items_failed. Anything else
    in the dict is ignored (forward-compatible).
    """
    job_id: str
    label: str
    cadence_days: int
    runner: Callable[[], Awaitable[dict[str, int]]]
    description: str = ""
    family: str = "scheduled"


def _last_succeeded_run_at(supabase, job_id: str) -> datetime | None:
    """Most-recent `succeeded` row for a synthetic job_id, or None."""
    try:
        rows = (
            supabase.table("signals_source_runs")
            .select("started_at, completed_at, status")
            .eq("source_id", job_id)
            .eq("status", "succeeded")
            .order("started_at", desc=True)
            .limit(1)
            .execute()
        ).data or []
        if not rows:
            return None
        ts = rows[0].get("completed_at") or rows[0].get("started_at")
        if not ts:
            return None
        return datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except Exception as e:
        logger.warning("scheduled_refresh: last-run fetch for %s failed: %s", job_id, e)
        return None


def _record(supabase, job_id: str, started: datetime, *,
            status: str,
            counters: dict[str, int] | None = None,
            error: str | None = None) -> None:
    """Insert a row into signals_source_runs for an admin-visible audit trail."""
    counters = counters or {}
    try:
        supabase.table("signals_source_runs").insert({
            "source_id":          job_id,
            "started_at":         started.isoformat(),
            "completed_at":       datetime.now(timezone.utc).isoformat(),
            "status":             status,
            "items_fetched":      int(counters.get("items_fetched") or 0),
            "items_inserted":     int(counters.get("items_inserted") or 0),
            "items_skipped_dup":  int(counters.get("items_skipped_dup") or 0),
            "items_failed":       int(counters.get("items_failed") or 0),
            "error_message":      (error or "")[:500] if error else None,
        }).execute()
    except Exception as e:
        logger.warning("scheduled_refresh: record for %s failed: %s", job_id, e)


async def run_if_due(supabase, job: ScheduledJob, *, force: bool = False) -> str:
    """Run `job.runner` if cadence has elapsed (or force=True). Returns
    the run status string ("succeeded" | "failed" | "skipped_cadence")
    so the caller can summarize a multi-job round."""
    last = _last_succeeded_run_at(supabase, job.job_id)
    now = datetime.now(timezone.utc)
    if last and not force:
        elapsed = now - last
        if elapsed < timedelta(days=job.cadence_days):
            logger.info(
                "scheduled_refresh[%s]: %.1fd since last success "
                "(< %dd cadence) — skipping",
                job.job_id, elapsed.total_seconds() / 86400, job.cadence_days,
            )
            return "skipped_cadence"

    logger.info("scheduled_refresh[%s]: starting", job.job_id)
    started = now
    try:
        counters = await job.runner()
        _record(supabase, job.job_id, started, status="succeeded", counters=counters)
        logger.info(
            "scheduled_refresh[%s]: succeeded — %s",
            job.job_id, counters,
        )
        return "succeeded"
    except Exception as e:
        logger.exception("scheduled_refresh[%s]: failed", job.job_id)
        _record(supabase, job.job_id, started, status="failed", error=str(e))
        return "failed"


# ── Job registry ───────────────────────────────────────────────────────────
#
# Importing the runners lazily avoids pulling in httpx + supabase at module
# load when the runner is in a path (e.g. unit tests) that doesn't want
# them. Each lambda matches the `Callable[[], Awaitable[dict[str, int]]]`
# signature `runner` expects.

async def _run_federal_hub_stats() -> dict[str, int]:
    from app.scripts.refresh_hub_stats import run_federal_refresh
    return await run_federal_refresh()


async def _run_jurisdiction_stats() -> dict[str, int]:
    from app.scripts.refresh_jurisdiction_stats import run_jurisdiction_refresh
    return await run_jurisdiction_refresh()


SCHEDULED_JOBS: list[ScheduledJob] = [
    ScheduledJob(
        job_id="hub_federal_stats",
        label="Federal hub stats",
        cadence_days=7,
        runner=_run_federal_hub_stats,
        description="MuckRock federal agency transparency stats, refreshed weekly.",
        family="hub",
    ),
    ScheduledJob(
        job_id="hub_jurisdiction_stats",
        label="State & local hub stats",
        cadence_days=7,
        runner=_run_jurisdiction_stats,
        description="MuckRock state agency stats + jurisdiction aggregates, weekly.",
        family="hub",
    ),
]

SCHEDULED_JOB_IDS: set[str] = {j.job_id for j in SCHEDULED_JOBS}


async def run_due_scheduled_jobs(supabase, *, force: bool = False) -> list[dict]:
    """Iterate `SCHEDULED_JOBS` and run each due. Caller is responsible
    for catching its own outer exceptions; this function logs and absorbs
    per-job errors so one broken job doesn't block others.

    Returns a slim summary list for the caller to log."""
    out: list[dict] = []
    for job in SCHEDULED_JOBS:
        status = await run_if_due(supabase, job, force=force)
        out.append({"job_id": job.job_id, "status": status})
    return out
