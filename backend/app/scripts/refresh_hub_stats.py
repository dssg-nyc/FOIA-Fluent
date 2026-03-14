"""Refresh Data Hub agency stats from MuckRock public API.

Fetches agency stats from MuckRock's /agency/ endpoint (paginated),
computes a transparency score for each, and upserts into the
agency_stats_cache table in Supabase.

Run manually or on a weekly schedule:
    cd backend
    python -m app.scripts.refresh_hub_stats

Railway cron: set to run Sundays at 3am UTC.
"""
import asyncio
import logging
import sys
from datetime import datetime, timezone

import httpx

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)

MUCKROCK_BASE = "https://www.muckrock.com/api_v1"
FEDERAL_JURISDICTION_ID = 10   # MuckRock ID for "United States of America" (federal)
MAX_PAGES = 40       # 40 pages × 50 = up to 2,000 agencies (covers all ~1,693 federal)
PAGE_SIZE = 50


def compute_transparency_score(
    success_rate: float,
    avg_response_time: float,
    fee_rate: float,
    has_portal: bool,
) -> float:
    """Compute a 0–100 transparency score.

    Weights:
      40% — success rate (higher = better)
      30% — response speed (faster = better; normalized against 120-day max)
      15% — fee rate (lower = better)
      15% — electronic portal availability
    """
    # MuckRock returns rates as 0–100 percentages, normalize to 0–1 first
    success_component = (success_rate or 0) / 100 * 40
    # Response time: 0 days → full 30pts; 120+ days → 0pts
    rt_normalized = max(0.0, 1.0 - min((avg_response_time or 60) / 120.0, 1.0))
    speed_component = rt_normalized * 30
    fee_component = (1.0 - min((fee_rate or 0) / 100, 1.0)) * 15
    portal_component = 15.0 if has_portal else 0.0
    return round(success_component + speed_component + fee_component + portal_component, 2)


async def fetch_all_agencies(client: httpx.AsyncClient) -> list[dict]:
    """Fetch all federal agencies from MuckRock (jurisdiction=10), paginated."""
    agencies = []
    page = 1
    while page <= MAX_PAGES:
        try:
            resp = await client.get(
                f"{MUCKROCK_BASE}/agency/",
                params={
                    "jurisdiction": FEDERAL_JURISDICTION_ID,
                    "page": page,
                    "page_size": PAGE_SIZE,
                    "format": "json",
                },
                timeout=30.0,
            )
            resp.raise_for_status()
            data = resp.json()
        except Exception as e:
            logger.error(f"MuckRock API error on page {page}: {e}")
            break

        results = data.get("results", [])
        if not results:
            break

        agencies.extend(results)
        logger.info(f"  Page {page}: fetched {len(results)} agencies (total so far: {len(agencies)})")

        if not data.get("next"):
            break
        page += 1
        await asyncio.sleep(0.3)   # be polite to MuckRock's API

    return agencies


async def main():
    from app.config import settings

    if not settings.supabase_url or not settings.supabase_service_key:
        logger.error("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set.")
        sys.exit(1)

    from supabase import create_client
    supabase = create_client(settings.supabase_url, settings.supabase_service_key)

    logger.info("Fetching agencies from MuckRock...")
    async with httpx.AsyncClient(
        headers={"Accept": "application/json", "User-Agent": "FOIA-Fluent/1.0"},
        follow_redirects=True,
    ) as client:
        raw_agencies = await fetch_all_agencies(client)

    logger.info(f"Fetched {len(raw_agencies)} total agencies from MuckRock.")

    now = datetime.now(timezone.utc).isoformat()
    upserted = 0
    skipped = 0

    for item in raw_agencies:
        if not item.get("id") or not item.get("name"):
            skipped += 1
            continue

        success_rate = item.get("success_rate") or 0
        avg_rt = item.get("average_response_time") or 0
        fee_rate = item.get("fee_rate") or 0
        has_portal = bool(item.get("has_portal", False))

        score = compute_transparency_score(success_rate, avg_rt, fee_rate, has_portal)

        jurisdiction = "Federal"

        row = {
            "id": item["id"],
            "name": item["name"],
            "slug": item.get("slug", ""),
            "jurisdiction": jurisdiction,
            "absolute_url": item.get("absolute_url", ""),
            "average_response_time": avg_rt,
            "fee_rate": fee_rate,
            "success_rate": success_rate,
            "number_requests": item.get("number_requests") or 0,
            "number_requests_completed": item.get("number_requests_completed") or 0,
            "number_requests_rejected": item.get("number_requests_rejected") or 0,
            "number_requests_no_docs": item.get("number_requests_no_docs") or 0,
            "number_requests_ack": item.get("number_requests_ack") or 0,
            "number_requests_resp": item.get("number_requests_resp") or 0,
            "number_requests_fix": item.get("number_requests_fix") or 0,
            "number_requests_appeal": item.get("number_requests_appeal") or 0,
            "number_requests_pay": item.get("number_requests_pay") or 0,
            "number_requests_partial": item.get("number_requests_partial") or 0,
            "number_requests_lawsuit": item.get("number_requests_lawsuit") or 0,
            "number_requests_withdrawn": item.get("number_requests_withdrawn") or 0,
            "has_portal": has_portal,
            "transparency_score": score,
            "refreshed_at": now,
        }

        try:
            supabase.table("agency_stats_cache").upsert(row, on_conflict="id").execute()
            upserted += 1
        except Exception as e:
            logger.warning(f"Failed to upsert agency {item['id']} ({item['name']}): {e}")
            skipped += 1

    logger.info(f"Done. Upserted: {upserted}, Skipped: {skipped}")


if __name__ == "__main__":
    asyncio.run(main())
