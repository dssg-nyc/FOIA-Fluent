"""Railway cron entrypoint — runs every hour, dispatches any source whose
cadence has elapsed.

One cron entry covers every source in the registry. Replaces the per-source
Railway cron jobs from the Phase 1 SIGNALS_CRON.md.

Schedule: `0 * * * *` (top of every hour)
Command:  `python -m app.scripts.run_due_sources`
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import sys

from app.services.ingest.runner import run_due_sources


def _parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser(
        description="Iterate the signals source registry and run any that are due."
    )
    ap.add_argument(
        "--force",
        action="store_true",
        help="Ignore cadence; run every enabled source.",
    )
    return ap.parse_args()


async def main() -> int:
    args = _parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    logger = logging.getLogger("run_due_sources")

    results = await run_due_sources(force=args.force)

    ran = sum(1 for r in results if r.status == "succeeded")
    failed = sum(1 for r in results if r.status == "failed")
    skipped_cadence = sum(1 for r in results if r.status == "skipped_cadence")
    skipped_disabled = sum(1 for r in results if r.status == "skipped_disabled")

    logger.info(
        f"dispatch summary: total={len(results)} ran={ran} failed={failed} "
        f"skipped_cadence={skipped_cadence} skipped_disabled={skipped_disabled}"
    )
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
