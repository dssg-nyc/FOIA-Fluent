"""Seed the personas catalog with the 4 pilot personas (Phase 1).

Idempotent — safe to re-run. Run after applying the schema additions:
    cd backend
    python -m app.scripts.seed_personas
"""
import logging
import sys

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)

PILOT_PERSONAS = [
    {
        "id": "journalist",
        "name": "Investigative Journalist",
        "description": "Accountability reporting, IG reports, peer-FOIA awareness, named officials, agency mismanagement.",
        "icon": "newspaper",
        "display_order": 1,
    },
    {
        "id": "pharma_analyst",
        "name": "Pharma Analyst",
        "description": "FDA enforcement, GMP/CMO findings, AdComm signals, drug substance and device watchlists.",
        "icon": "pill",
        "display_order": 2,
    },
    {
        "id": "hedge_fund",
        "name": "Hedge Fund / Equity Research",
        "description": "Material federal actions on publicly traded companies — FDA approvals, contract awards, enforcement, customs.",
        "icon": "trending-up",
        "display_order": 3,
    },
    {
        "id": "environmental",
        "name": "Environmental Advocate",
        "description": "EPA enforcement, NEPA, ESA consultations, pollution, land use, climate-related agency actions.",
        "icon": "leaf",
        "display_order": 4,
    },
]


def main():
    from app.config import settings

    if not settings.supabase_url or not settings.supabase_service_key:
        logger.error("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set")
        sys.exit(1)

    from supabase import create_client
    supabase = create_client(settings.supabase_url, settings.supabase_service_key)

    upserted = 0
    for persona in PILOT_PERSONAS:
        try:
            supabase.table("personas").upsert(persona, on_conflict="id").execute()
            upserted += 1
            logger.info(f"  ✓ {persona['id']}")
        except Exception as e:
            logger.warning(f"failed to seed {persona['id']}: {e}")

    logger.info(f"Done. Upserted {upserted}/{len(PILOT_PERSONAS)} personas.")


if __name__ == "__main__":
    main()
