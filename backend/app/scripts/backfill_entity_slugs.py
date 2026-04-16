"""One-time backfill: populate `entity_slugs` for foia_signals_feed rows
ingested before Phase 1.5 added the column.

Reads each row's existing `entities` JSONB + `requester` field, runs the same
normalization the live ingestion path uses (build_entity_slugs from
_signals_common), and writes the resulting flat array back to entity_slugs.

Idempotent — safe to re-run. Skips rows that already have non-empty entity_slugs.

Run manually:
    cd backend
    python -m app.scripts.backfill_entity_slugs
"""
import logging
import sys

from app.scripts._signals_common import build_entity_slugs

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)


def main() -> None:
    from app.config import settings

    if not settings.supabase_url or not settings.supabase_service_key:
        logger.error("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set")
        sys.exit(1)

    from supabase import create_client
    supabase = create_client(settings.supabase_url, settings.supabase_service_key)

    # Pull all rows that don't have entity_slugs populated yet
    res = (
        supabase.table("foia_signals_feed")
        .select("id,entities,requester,entity_slugs")
        .execute()
    )
    rows = res.data or []
    logger.info("Loaded %d total signal rows", len(rows))

    updated = skipped = failed = 0
    for row in rows:
        existing = row.get("entity_slugs") or []
        if existing:
            skipped += 1
            continue

        slugs = build_entity_slugs(
            row.get("entities") or {},
            (row.get("requester") or "").strip(),
        )
        if not slugs:
            skipped += 1
            continue

        try:
            (
                supabase.table("foia_signals_feed")
                .update({"entity_slugs": slugs})
                .eq("id", row["id"])
                .execute()
            )
            updated += 1
        except Exception as e:
            failed += 1
            logger.warning("update failed for %s: %s", row.get("id"), e)

    logger.info("Backfill complete: updated=%d skipped=%d failed=%d", updated, skipped, failed)


if __name__ == "__main__":
    main()
