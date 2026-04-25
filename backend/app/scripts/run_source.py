"""Dev / manual CLI — run one source from the registry on demand.

Usage:
    python -m app.scripts.run_source --source-id gao_protests
    python -m app.scripts.run_source --source-id gao_protests --force
    python -m app.scripts.run_source --source-id gao_protests --dry-run

The cron dispatcher at run_due_sources.py is what production uses.
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import sys

from app.data.signals_sources import SOURCES
from app.services.ingest.runner import run_source


def _parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser(description="Run one signals source by id.")
    ap.add_argument(
        "--source-id",
        required=True,
        help=f"One of: {', '.join(SOURCES.keys())}",
    )
    ap.add_argument(
        "--force",
        action="store_true",
        help="Ignore cadence + enabled flag; always run.",
    )
    ap.add_argument(
        "--dry-run",
        action="store_true",
        help="Fetch but do not write to Supabase / Claude. Useful for iterating strategies.",
    )
    return ap.parse_args()


async def main() -> int:
    args = _parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    if args.source_id not in SOURCES:
        print(f"ERROR: unknown source_id '{args.source_id}'", file=sys.stderr)
        print(f"       valid ids: {', '.join(SOURCES.keys())}", file=sys.stderr)
        return 2

    result = await run_source(args.source_id, force=args.force, dry_run=args.dry_run)
    return 0 if result.status in ("succeeded", "skipped_disabled", "skipped_cadence") else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
