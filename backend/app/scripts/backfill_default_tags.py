"""Quick backfill: apply source-default category_tags + derived persona_tags
to any signal currently sitting with empty arrays.

Why this exists alongside backfill_category_tags.py:
    backfill_category_tags.py re-runs Claude per row to extract categories
    from title + body (~$0.001/row). This script does NO extraction — it
    only applies the source-natural defaults from SOURCE_DEFAULT_CATEGORIES.
    Faster, free, and correct for the common case where the runner skipped
    the categorization step entirely (the bug fixed in this commit).

Usage:
    cd backend
    python -m app.scripts.backfill_default_tags
"""
from __future__ import annotations

import logging

from app.config import settings
from app.data.signal_categories import SOURCE_DEFAULT_CATEGORIES, derive_persona_tags

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
logger = logging.getLogger(__name__)


def main() -> None:
    if not settings.supabase_url or not settings.supabase_service_key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set")
    from supabase import create_client

    sb = create_client(settings.supabase_url, settings.supabase_service_key)

    total = 0
    for source, default_cats in SOURCE_DEFAULT_CATEGORIES.items():
        if not default_cats:
            continue
        persona_tags = derive_persona_tags(default_cats)

        # Only touch rows where BOTH arrays are empty — never overwrite work
        # the live extraction has already done.
        result = (
            sb.table("foia_signals_feed")
            .select("id", count="exact")
            .eq("source", source)
            .eq("category_tags", "{}")
            .eq("persona_tags", "{}")
            .execute()
        )
        n = result.count or 0
        if n == 0:
            logger.info(f"{source:30s} 0 rows need backfill")
            continue

        update = (
            sb.table("foia_signals_feed")
            .update({"category_tags": default_cats, "persona_tags": persona_tags})
            .eq("source", source)
            .eq("category_tags", "{}")
            .eq("persona_tags", "{}")
            .execute()
        )
        updated = len(update.data or [])
        total += updated
        logger.info(
            f"{source:30s} updated {updated} rows  "
            f"categories={default_cats}  personas={persona_tags}"
        )

    logger.info(f"DONE — backfilled {total} rows total")


if __name__ == "__main__":
    main()
