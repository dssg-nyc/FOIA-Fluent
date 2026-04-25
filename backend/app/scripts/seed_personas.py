"""Seed the personas catalog (Phase 2.5 — 7 personas, each as a category bundle).

Each persona row carries a `category_ids` array sourced from
`app.data.signal_categories.PERSONA_BUNDLES`. Re-running the script overwrites
existing rows, so updating PERSONA_BUNDLES + re-seeding is the canonical way
to evolve the bundles.

Idempotent — safe to re-run. Run after applying the schema additions:
    cd backend
    python -m app.scripts.seed_personas
"""
import logging
import sys

from app.data.signal_categories import PERSONA_BUNDLES

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)

# Static metadata per persona — id is the key in PERSONA_BUNDLES.
# `category_ids` is sourced from PERSONA_BUNDLES at seed time.
PERSONA_METADATA = [
    {
        "id": "journalist",
        "name": "Investigative Journalist",
        "description": (
            "Accountability reporting: IG findings, agency enforcement, FOIA logs, "
            "DOJ press releases, campaign finance + lobbying, tax enforcement."
        ),
        "icon": "newspaper",
        "display_order": 1,
    },
    {
        "id": "pharma_analyst",
        "name": "Pharma Analyst",
        "description": (
            "FDA warning letters and recalls (drug + device), plus securities "
            "litigation involving pharma companies."
        ),
        "icon": "pill",
        "display_order": 2,
    },
    {
        "id": "hedge_fund",
        "name": "Hedge Fund / Equity Research",
        "description": (
            "Material federal actions on public companies: SEC litigation, agency "
            "enforcement, federal contracts, court opinions, drug + device recalls."
        ),
        "icon": "trending-up",
        "display_order": 3,
    },
    {
        "id": "environmental",
        "name": "Environmental Advocate",
        "description": (
            "EPA + agency enforcement, IG findings on environmental programs, and "
            "rulemaking dockets affecting air/water/land/climate."
        ),
        "icon": "leaf",
        "display_order": 4,
    },
    {
        "id": "policy_researcher",
        "name": "Policy Researcher",
        "description": (
            "Congressional bills, regulations.gov dockets, IG reports, executive "
            "actions, and lobbying / ethics filings."
        ),
        "icon": "library",
        "display_order": 5,
    },
    {
        "id": "legal_analyst",
        "name": "Legal Analyst / Litigator",
        "description": (
            "Federal court opinions, SEC + DOJ litigation, agency adjudications, "
            "FOIA logs, campaign finance enforcement, and tax cases."
        ),
        "icon": "scale",
        "display_order": 6,
    },
    {
        "id": "consumer_safety",
        "name": "Consumer Safety Advocate",
        "description": (
            "Recalls across drug / food / device / vehicle / consumer products, "
            "OSHA workplace safety actions, and FDA warning letters."
        ),
        "icon": "shield",
        "display_order": 7,
    },
]


def main():
    from app.config import settings

    if not settings.supabase_url or not settings.supabase_service_key:
        logger.error("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set")
        sys.exit(1)

    # Sanity check — every persona has a bundle in PERSONA_BUNDLES
    missing = [p["id"] for p in PERSONA_METADATA if p["id"] not in PERSONA_BUNDLES]
    if missing:
        logger.error(f"PERSONA_BUNDLES missing entries for: {missing}")
        sys.exit(1)

    from supabase import create_client
    supabase = create_client(settings.supabase_url, settings.supabase_service_key)

    upserted = 0
    for meta in PERSONA_METADATA:
        row = {
            **meta,
            "category_ids": list(PERSONA_BUNDLES[meta["id"]]),
        }
        try:
            supabase.table("personas").upsert(row, on_conflict="id").execute()
            upserted += 1
            logger.info(
                f"  ✓ {meta['id']:18}  ({len(row['category_ids'])} categories)"
            )
        except Exception as e:
            logger.warning(f"failed to seed {meta['id']}: {e}")

    logger.info(f"Done. Upserted {upserted}/{len(PERSONA_METADATA)} personas.")


if __name__ == "__main__":
    main()
