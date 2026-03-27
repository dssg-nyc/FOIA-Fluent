"""Refresh jurisdiction (state) stats from MuckRock public API.

Fetches all state-level jurisdictions under the federal jurisdiction (id=10),
then fetches agencies within each state, computes aggregate transparency stats,
and upserts into jurisdiction_cache + jurisdiction_stats_cache tables.

Run manually or on a weekly schedule:
    cd backend
    python -m app.scripts.refresh_jurisdiction_stats
"""
import asyncio
import logging
import statistics
import sys
from datetime import datetime, timezone

import httpx

from app.scripts.scoring import compute_transparency_score

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)

MUCKROCK_BASE = "https://www.muckrock.com/api_v1"
FEDERAL_JURISDICTION_ID = 10
PAGE_SIZE = 50
MAX_AGENCY_PAGES = 20  # up to 1,000 agencies per state (more than enough)

# State abbreviations for display
STATE_ABBREVS = {
    "alabama": "AL", "alaska": "AK", "arizona": "AZ", "arkansas": "AR",
    "california": "CA", "colorado": "CO", "connecticut": "CT", "delaware": "DE",
    "florida": "FL", "georgia": "GA", "hawaii": "HI", "idaho": "ID",
    "illinois": "IL", "indiana": "IN", "iowa": "IA", "kansas": "KS",
    "kentucky": "KY", "louisiana": "LA", "maine": "ME", "maryland": "MD",
    "massachusetts": "MA", "michigan": "MI", "minnesota": "MN", "mississippi": "MS",
    "missouri": "MO", "montana": "MT", "nebraska": "NE", "nevada": "NV",
    "new-hampshire": "NH", "new-jersey": "NJ", "new-mexico": "NM", "new-york": "NY",
    "north-carolina": "NC", "north-dakota": "ND", "ohio": "OH", "oklahoma": "OK",
    "oregon": "OR", "pennsylvania": "PA", "rhode-island": "RI", "south-carolina": "SC",
    "south-dakota": "SD", "tennessee": "TN", "texas": "TX", "utah": "UT",
    "vermont": "VT", "virginia": "VA", "washington": "WA", "west-virginia": "WV",
    "wisconsin": "WI", "wyoming": "WY", "district-of-columbia": "DC",
}


async def fetch_state_jurisdictions(client: httpx.AsyncClient) -> list[dict]:
    """Fetch all state-level jurisdictions (children of federal jurisdiction)."""
    jurisdictions = []
    page = 1
    while True:
        try:
            resp = await client.get(
                f"{MUCKROCK_BASE}/jurisdiction/",
                params={
                    "parent": FEDERAL_JURISDICTION_ID,
                    "level": "s",  # state level
                    "page": page,
                    "page_size": PAGE_SIZE,
                    "format": "json",
                },
                timeout=30.0,
            )
            resp.raise_for_status()
            data = resp.json()
        except Exception as e:
            logger.error(f"MuckRock jurisdiction API error on page {page}: {e}")
            break

        results = data.get("results", [])
        if not results:
            break

        jurisdictions.extend(results)
        logger.info(f"  Jurisdictions page {page}: fetched {len(results)} (total: {len(jurisdictions)})")

        if not data.get("next"):
            break
        page += 1
        await asyncio.sleep(0.3)

    return jurisdictions


async def fetch_agencies_for_jurisdiction(
    client: httpx.AsyncClient, jurisdiction_id: int
) -> list[dict]:
    """Fetch all agencies within a specific jurisdiction."""
    agencies = []
    page = 1
    while page <= MAX_AGENCY_PAGES:
        try:
            resp = await client.get(
                f"{MUCKROCK_BASE}/agency/",
                params={
                    "jurisdiction": jurisdiction_id,
                    "page": page,
                    "page_size": PAGE_SIZE,
                    "format": "json",
                },
                timeout=30.0,
            )
            resp.raise_for_status()
            data = resp.json()
        except Exception as e:
            logger.error(f"MuckRock agency API error (jurisdiction={jurisdiction_id}, page={page}): {e}")
            break

        results = data.get("results", [])
        if not results:
            break

        agencies.extend(results)

        if not data.get("next"):
            break
        page += 1
        await asyncio.sleep(0.3)

    return agencies


def compute_jurisdiction_stats(agencies: list[dict]) -> dict:
    """Aggregate agency-level data into jurisdiction-level stats."""
    if not agencies:
        return {
            "total_agencies": 0,
            "total_requests": 0,
            "total_completed": 0,
            "total_rejected": 0,
            "overall_success_rate": 0,
            "average_response_time": 0,
            "median_response_time": 0,
            "fee_rate": 0,
            "portal_coverage_pct": 0,
            "transparency_score": 0,
        }

    total_requests = sum(a.get("number_requests") or 0 for a in agencies)
    total_completed = sum(a.get("number_requests_completed") or 0 for a in agencies)
    total_rejected = sum(a.get("number_requests_rejected") or 0 for a in agencies)

    success_rate = (total_completed / total_requests * 100) if total_requests > 0 else 0

    response_times = [a.get("average_response_time") or 0 for a in agencies if (a.get("average_response_time") or 0) > 0]
    avg_rt = statistics.mean(response_times) if response_times else 0
    median_rt = statistics.median(response_times) if response_times else 0

    fee_rates = [a.get("fee_rate") or 0 for a in agencies]
    avg_fee = statistics.mean(fee_rates) if fee_rates else 0

    portal_count = sum(1 for a in agencies if a.get("has_portal"))
    portal_pct = (portal_count / len(agencies) * 100) if agencies else 0

    score = compute_transparency_score(success_rate, avg_rt, avg_fee, portal_pct > 50)

    return {
        "total_agencies": len(agencies),
        "total_requests": total_requests,
        "total_completed": total_completed,
        "total_rejected": total_rejected,
        "overall_success_rate": round(success_rate, 2),
        "average_response_time": round(avg_rt, 1),
        "median_response_time": round(median_rt, 1),
        "fee_rate": round(avg_fee, 2),
        "portal_coverage_pct": round(portal_pct, 1),
        "transparency_score": score,
    }


async def main():
    from app.config import settings

    if not settings.supabase_url or not settings.supabase_service_key:
        logger.error("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set.")
        sys.exit(1)

    # Use the Supabase Python SDK — same pattern as refresh_hub_stats.py
    from supabase import create_client
    supabase = create_client(settings.supabase_url, settings.supabase_service_key)

    now = datetime.now(timezone.utc).isoformat()

    async with httpx.AsyncClient(
        headers={"Accept": "application/json", "User-Agent": "FOIA-Fluent/1.0"},
        follow_redirects=True,
    ) as client:
        # Step 1: Fetch all state jurisdictions from MuckRock
        logger.info("Fetching state jurisdictions from MuckRock...")
        jurisdictions = await fetch_state_jurisdictions(client)
        logger.info(f"Found {len(jurisdictions)} state jurisdictions.")

        # Step 2: Upsert jurisdictions one at a time (same pattern as federal script)
        j_upserted = 0
        for j in jurisdictions:
            slug = j.get("slug", "")
            row = {
                "id": j["id"],
                "name": j.get("name", ""),
                "slug": slug,
                "abbrev": STATE_ABBREVS.get(slug, ""),
                "level": "state",
                "parent_id": FEDERAL_JURISDICTION_ID,
                "absolute_url": j.get("absolute_url", ""),
                "refreshed_at": now,
            }
            try:
                supabase.table("jurisdiction_cache").upsert(row, on_conflict="id").execute()
                j_upserted += 1
            except Exception as e:
                logger.warning(f"Failed to upsert jurisdiction {j['id']} ({j.get('name')}): {e}")

        logger.info(f"Upserted {j_upserted}/{len(jurisdictions)} jurisdictions.")

        # Step 3: For each state, fetch agencies and upsert one at a time
        for i, j in enumerate(jurisdictions):
            jid = j["id"]
            jname = j.get("name", "Unknown")
            logger.info(f"[{i+1}/{len(jurisdictions)}] Fetching agencies for {jname}...")

            agencies = await fetch_agencies_for_jurisdiction(client, jid)
            logger.info(f"  Found {len(agencies)} agencies in {jname}")

            # Upsert each agency individually (matches working federal pattern)
            a_upserted = 0
            for item in agencies:
                if not item.get("id") or not item.get("name"):
                    continue

                success_rate = item.get("success_rate") or 0
                avg_rt = item.get("average_response_time") or 0
                fee_rate = item.get("fee_rate") or 0
                has_portal = bool(item.get("has_portal", False))
                score = compute_transparency_score(success_rate, avg_rt, fee_rate, has_portal)

                row = {
                    "id": item["id"],
                    "name": item["name"],
                    "slug": item.get("slug", ""),
                    "jurisdiction": jname,
                    "jurisdiction_id": jid,
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
                    a_upserted += 1
                except Exception as e:
                    logger.warning(f"  Failed agency {item['id']} ({item['name']}): {e}")

            logger.info(f"  Upserted {a_upserted}/{len(agencies)} agencies for {jname}")

            # Compute and upsert jurisdiction aggregate stats
            agg = compute_jurisdiction_stats(agencies)

            top_agency_id = None
            top_agency_name = ""
            if agencies:
                best = max(agencies, key=lambda a: compute_transparency_score(
                    a.get("success_rate") or 0,
                    a.get("average_response_time") or 0,
                    a.get("fee_rate") or 0,
                    bool(a.get("has_portal")),
                ))
                top_agency_id = best.get("id")
                top_agency_name = best.get("name", "")

            stats_row = {
                "jurisdiction_id": jid,
                "total_agencies": agg["total_agencies"],
                "total_requests": agg["total_requests"],
                "total_completed": agg["total_completed"],
                "total_rejected": agg["total_rejected"],
                "overall_success_rate": agg["overall_success_rate"],
                "average_response_time": agg["average_response_time"],
                "median_response_time": agg["median_response_time"],
                "fee_rate": agg["fee_rate"],
                "portal_coverage_pct": agg["portal_coverage_pct"],
                "transparency_score": agg["transparency_score"],
                "top_agency_id": top_agency_id,
                "top_agency_name": top_agency_name,
                "refreshed_at": now,
            }
            try:
                supabase.table("jurisdiction_stats_cache").upsert(
                    stats_row, on_conflict="jurisdiction_id"
                ).execute()
            except Exception as e:
                logger.warning(f"  Failed jurisdiction stats for {jname}: {e}")

    logger.info("Done refreshing jurisdiction stats.")


if __name__ == "__main__":
    asyncio.run(main())
