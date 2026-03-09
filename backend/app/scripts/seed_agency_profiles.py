"""Seed the Supabase `agency_profiles` table from federal_agencies.py + eCFR API.

Run once before first deployment:
    cd backend
    python -m app.scripts.seed_agency_profiles

What it does:
  1. Iterates all agencies in federal_agencies.py
  2. For each agency that has a CFR citation, fetches the verbatim regulation
     text from the eCFR public API (ecfr.gov)
  3. Upserts all fields (including cfr_text) into the Supabase agency_profiles table

Prerequisites:
  - SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env
  - The agency_profiles table must exist (run supabase_schema.sql first)

eCFR API used:
  GET https://www.ecfr.gov/api/versioner/v1/full/current/title-{title}.xml?part={part}
  Returns XML for the specified CFR title and part.
"""
import asyncio
import logging
import re
import sys
from datetime import datetime, timezone

import httpx

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

# eCFR API base URL (renderer endpoint — versioner /full endpoint returns 404 as of 2025)
ECFR_BASE = "https://www.ecfr.gov/api/renderer/v1/content/enhanced/current"


def _parse_cfr_citation(citation: str) -> tuple[str | None, str | None]:
    """Parse a CFR citation like '6 C.F.R. Part 5' into (title, part).

    Returns (None, None) if the citation cannot be parsed.
    Examples:
        '6 C.F.R. Part 5'         → ('6', '5')
        '28 C.F.R. Part 16'       → ('28', '16')
        '6 C.F.R. Part 5 (DHS…)'  → ('6', '5')
    """
    # Strip parenthetical qualifiers
    clean = re.split(r'\(', citation)[0].strip()
    # Match pattern: NUMBER C.F.R. Part NUMBER
    match = re.search(r'(\d+)\s+C\.F\.R\.\s+Part\s+(\d+)', clean, re.IGNORECASE)
    if match:
        return match.group(1), match.group(2)
    return None, None


def _extract_text_from_html(html_content: str) -> str:
    """Extract readable plain text from eCFR HTML renderer response.

    Strips HTML tags and returns the textual content of the regulation.
    """
    # Strip all HTML tags
    text = re.sub(r'<[^>]+>', ' ', html_content)
    # Decode common HTML entities
    text = text.replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>').replace('&nbsp;', ' ').replace('&#39;', "'").replace('&quot;', '"')
    # Collapse whitespace
    text = re.sub(r'\s+', ' ', text).strip()
    return text[:50000]  # Cap at 50k chars to avoid oversized DB values


async def fetch_cfr_text(title: str, part: str, client: httpx.AsyncClient) -> str:
    """Fetch verbatim CFR text for a given title and part from the eCFR API.

    Returns the regulation text as a string, or an empty string on failure.
    """
    url = f"{ECFR_BASE}/title-{title}"
    params = {"part": part}
    try:
        logger.info(f"  Fetching {title} C.F.R. Part {part} from eCFR...")
        response = await client.get(url, params=params, timeout=30.0)
        if response.status_code == 200:
            text = _extract_text_from_html(response.text)
            logger.info(f"  ✓ Got {len(text):,} chars")
            return text
        elif response.status_code == 404:
            logger.warning(f"  ✗ Part not found (404): {title} C.F.R. Part {part}")
            return ""
        else:
            logger.warning(f"  ✗ HTTP {response.status_code} for title {title} part {part}")
            return ""
    except Exception as e:
        logger.warning(f"  ✗ Error fetching CFR text: {e}")
        return ""


async def seed_agency_profiles() -> None:
    """Main seeding routine: fetch CFR text and upsert all agencies into Supabase."""
    # Import here to allow script to be invoked without Supabase configured
    # (will error at upsert time with a clear message)
    from app.config import settings
    from app.data.federal_agencies import FEDERAL_AGENCIES

    if not settings.supabase_url or not settings.supabase_service_key:
        logger.error(
            "SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env. "
            "Copy .env.example to .env and fill in your Supabase credentials."
        )
        sys.exit(1)

    from supabase import create_client
    supabase = create_client(settings.supabase_url, settings.supabase_service_key)

    now = datetime.now(timezone.utc).isoformat()

    # Track which CFR citations we've already fetched to avoid duplicate API calls
    # (e.g., many DHS sub-agencies share 6 C.F.R. Part 5)
    cfr_cache: dict[tuple[str, str], str] = {}

    async with httpx.AsyncClient(
        headers={"User-Agent": "FOIA-Fluent/1.0 (contact: foia-fluent@dssg.io)"},
        follow_redirects=True,
    ) as client:
        agencies = list(FEDERAL_AGENCIES.items())
        logger.info(f"Seeding {len(agencies)} agencies into Supabase agency_profiles...\n")

        for i, (abbr, data) in enumerate(agencies, 1):
            logger.info(f"[{i}/{len(agencies)}] {abbr} — {data['name']}")

            # Parse CFR citation
            cfr_text = ""
            citation = data.get("foia_regulation", "")
            title, part = _parse_cfr_citation(citation)

            if title and part:
                cache_key = (title, part)
                if cache_key in cfr_cache:
                    cfr_text = cfr_cache[cache_key]
                    logger.info(f"  Using cached CFR text for title {title} part {part}")
                else:
                    cfr_text = await fetch_cfr_text(title, part, client)
                    cfr_cache[cache_key] = cfr_text
                    # Rate limit: be polite to the eCFR API
                    await asyncio.sleep(0.5)
            else:
                logger.info(f"  Skipping CFR fetch (could not parse citation: '{citation}')")

            profile = {
                "abbreviation": abbr,
                "name": data.get("name", ""),
                "jurisdiction": data.get("jurisdiction", "federal"),
                "description": data.get("description", ""),
                "foia_email": data.get("foia_email", ""),
                "foia_website": data.get("foia_website", ""),
                "foia_regulation": citation,
                "submission_notes": data.get("submission_notes", ""),
                "exemption_tendencies": data.get("exemption_tendencies", ""),
                "routing_notes": data.get("routing_notes", ""),
                "cfr_summary": data.get("cfr_summary", ""),
                "cfr_text": cfr_text,
                "cfr_last_fetched": now if cfr_text else None,
                "updated_at": now,
            }

            try:
                supabase.table("agency_profiles").upsert(profile).execute()
                logger.info(f"  ✓ Upserted {abbr}")
            except Exception as e:
                logger.error(f"  ✗ Failed to upsert {abbr}: {e}")

    logger.info(f"\nDone. {len(agencies)} agencies processed.")
    logger.info("Verify in Supabase: SELECT abbreviation, length(cfr_text) FROM agency_profiles ORDER BY abbreviation;")


if __name__ == "__main__":
    asyncio.run(seed_agency_profiles())
