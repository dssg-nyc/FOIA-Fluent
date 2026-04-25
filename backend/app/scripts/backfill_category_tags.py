"""One-time (Phase 2.5) backfill: tag existing signals with category_tags.

Existing signals were extracted with the old 4-persona model. After Phase 2.5,
new signals get `category_tags` extracted by Claude and `persona_tags` derived
from those. This script catches up the historical corpus so all signals have
the new field populated.

Idempotent: only processes rows where `category_tags` is empty or null.
Re-running picks up where it left off (e.g., after a transient failure or
when adding more historical sources).

Cost: ~$0.001 per signal on Haiku 4.5.
  600 existing signals = ~$0.60.
  5,000 signals = ~$5 (don't accidentally re-run the whole corpus — query
                       gates by empty category_tags so unchanged rows skip).

Run:
    cd backend
    python -m app.scripts.backfill_category_tags
    # optional: --limit 100 to throttle, --dry-run to preview, --batch 25 to tune
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import sys
import time
from typing import Any

from app.config import settings
from app.data.signal_categories import categories_for_signal, derive_persona_tags
from app.scripts._signals_common import extract_with_claude

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)

DEFAULT_BATCH_SIZE = 25
PER_ITEM_DELAY_S = 0.15  # be polite to Claude


def _parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser(description="Backfill category_tags on historical signals.")
    ap.add_argument("--limit", type=int, default=0,
                    help="Max signals to process (0 = no cap).")
    ap.add_argument("--batch", type=int, default=DEFAULT_BATCH_SIZE,
                    help=f"Page size (default {DEFAULT_BATCH_SIZE}).")
    ap.add_argument("--dry-run", action="store_true",
                    help="Print what would change but don't write.")
    return ap.parse_args()


def _fetch_pending(supabase, batch_size: int, before_signal_id: str | None) -> list[dict]:
    """Fetch a page of signals that don't yet have category_tags.

    Pagination via id-after-id (stable, doesn't drift if rows are inserted
    behind us). Returns at most `batch_size` rows.
    """
    q = (
        supabase.table("foia_signals_feed")
        .select("id, source, title, body_excerpt, category_tags")
        .or_("category_tags.is.null,category_tags.eq.{}")
        .order("id", desc=False)
        .limit(batch_size)
    )
    if before_signal_id:
        q = q.gt("id", before_signal_id)
    return q.execute().data or []


async def _backfill_one(
    supabase, api_key: str, row: dict, dry_run: bool
) -> tuple[str, list[str], list[str]]:
    """Re-extract one signal. Returns (status, categories, personas).
    status ∈ {'updated', 'skipped_no_categories', 'failed'}.
    """
    extract = await extract_with_claude(
        api_key,
        f"backfill source={row.get('source')}",
        row.get("title") or "",
        row.get("body_excerpt") or "",
    ) or {}
    # Union Claude's tags with the source's default categories — every
    # signal ends up with at least its source-natural tag.
    cats = categories_for_signal(
        row.get("source") or "",
        extract.get("category_tags", []),
    )
    if not cats:
        # Source has no default + Claude returned nothing — true edge case.
        return "skipped_no_categories", [], []

    personas = derive_persona_tags(cats)

    if dry_run:
        return "updated", cats, personas

    try:
        supabase.table("foia_signals_feed").update({
            "category_tags": cats,
            "persona_tags": personas,
        }).eq("id", row["id"]).execute()
    except Exception as e:
        logger.warning(f"  update failed for {row['id']}: {e}")
        return "failed", cats, personas

    return "updated", cats, personas


async def main() -> int:
    args = _parse_args()

    if not settings.anthropic_api_key:
        logger.error("ANTHROPIC_API_KEY must be set")
        return 1
    if not settings.supabase_url or not settings.supabase_service_key:
        logger.error("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set")
        return 1

    from supabase import create_client
    supabase = create_client(settings.supabase_url, settings.supabase_service_key)

    started = time.monotonic()
    processed = updated = skipped = failed = 0
    cap = args.limit if args.limit else None
    last_id: str | None = None

    while True:
        rows = _fetch_pending(supabase, args.batch, last_id)
        if not rows:
            break

        for row in rows:
            if cap and processed >= cap:
                break
            status, cats, personas = await _backfill_one(
                supabase, settings.anthropic_api_key, row, args.dry_run
            )
            processed += 1
            if status == "updated":
                updated += 1
                logger.info(
                    f"  ✓ {row['source']:24}  {row['id'][:8]}  "
                    f"cats={cats}  personas={personas}"
                )
            elif status == "skipped_no_categories":
                skipped += 1
                logger.info(f"  · {row['source']:24}  {row['id'][:8]}  no categories")
            else:
                failed += 1
            await asyncio.sleep(PER_ITEM_DELAY_S)

        last_id = rows[-1]["id"]
        if cap and processed >= cap:
            break

    runtime = time.monotonic() - started
    logger.info(
        f"\nBackfill {'(dry-run) ' if args.dry_run else ''}done. "
        f"processed={processed} updated={updated} "
        f"skipped={skipped} failed={failed} runtime={runtime:.1f}s"
    )
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
