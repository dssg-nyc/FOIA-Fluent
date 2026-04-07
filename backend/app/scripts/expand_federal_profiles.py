"""Expand federal agency profiles using verified data sources only.

Sources (zero hallucination):
  1. FOIA.gov API — agency name, abbreviation, email, website, description
  2. eCFR API — verbatim CFR regulation text
  3. Tavily — fetch agency FOIA webpage for submission/routing guidance
  4. foia_annual_reports table — real exemption citation data
  5. Claude — ONLY used to extract/summarize from fetched real content

Run:
    cd backend
    python -m app.scripts.expand_federal_profiles
"""
import asyncio
import json
import logging
import re
import sys
from datetime import datetime, timezone

import httpx

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)

ECFR_BASE = "https://www.ecfr.gov/api/renderer/v1/content/enhanced/current"
FOIA_GOV_BASE = "https://api.foia.gov/api"


def _parse_cfr_citation(citation: str) -> tuple[str | None, str | None]:
    """Parse '6 C.F.R. Part 5' into (title, part)."""
    clean = re.split(r'\(', citation)[0].strip()
    match = re.search(r'(\d+)\s+C\.F\.R\.\s+Part\s+(\d+)', clean, re.IGNORECASE)
    if match:
        return match.group(1), match.group(2)
    return None, None


def _extract_text_from_html(html_content: str) -> str:
    """Extract plain text from eCFR HTML."""
    text = re.sub(r'<[^>]+>', ' ', html_content)
    text = text.replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>')
    text = text.replace('&nbsp;', ' ').replace('&#39;', "'").replace('&quot;', '"')
    text = re.sub(r'\s+', ' ', text).strip()
    return text[:50000]


async def fetch_all_foia_gov_agencies(api_key: str) -> list[dict]:
    """Fetch all agency components from FOIA.gov API."""
    headers = {"X-API-Key": api_key}
    all_components = []
    page = 0

    async with httpx.AsyncClient(follow_redirects=True, timeout=15.0) as client:
        while True:
            resp = await client.get(
                f"{FOIA_GOV_BASE}/agency_components",
                headers=headers,
                params={"page[limit]": 50, "page[offset]": page * 50},
            )
            data = resp.json()
            batch = data.get("data", [])
            if not batch:
                break

            for item in batch:
                attrs = item.get("attributes", {})
                desc = attrs.get("description", {})
                desc_text = ""
                if isinstance(desc, dict):
                    desc_text = re.sub(r'<[^>]+>', '', desc.get("value", ""))[:500]

                website = attrs.get("website", {})
                website_url = ""
                if isinstance(website, dict):
                    website_url = website.get("uri", "")

                emails = attrs.get("email", [])
                email = emails[0] if emails else ""

                all_components.append({
                    "abbreviation": attrs.get("abbreviation", "").strip(),
                    "name": attrs.get("title", ""),
                    "description": desc_text,
                    "foia_website": website_url,
                    "foia_email": email,
                    "is_centralized": attrs.get("is_centralized", False),
                    "portal_format": attrs.get("portal_submission_format", ""),
                })

            page += 1
            await asyncio.sleep(0.3)

    return all_components


async def fetch_cfr_text(title: str, part: str, client: httpx.AsyncClient) -> str:
    """Fetch verbatim CFR text from eCFR API."""
    url = f"{ECFR_BASE}/title-{title}"
    try:
        response = await client.get(url, params={"part": part}, timeout=30.0)
        if response.status_code == 200:
            text = _extract_text_from_html(response.text)
            return text
    except Exception as e:
        logger.warning(f"  eCFR fetch failed for {title} CFR Part {part}: {e}")
    return ""


async def fetch_foia_page_content(website_url: str, tavily_key: str) -> str:
    """Use Tavily to fetch and extract content from an agency's FOIA page."""
    if not website_url or not tavily_key:
        return ""

    try:
        from tavily import AsyncTavilyClient
        client = AsyncTavilyClient(api_key=tavily_key)
        response = await client.search(
            query=f"FOIA request submission {website_url}",
            max_results=1,
            include_domains=[website_url.split("/")[2]] if "/" in website_url else [],
            search_depth="basic",
        )
        results = response.get("results", [])
        if results:
            return results[0].get("content", "")[:2000]
    except Exception as e:
        logger.warning(f"  Tavily fetch failed for {website_url}: {e}")
    return ""


async def extract_with_claude(
    content: str, agency_name: str, field: str, anthropic_key: str
) -> str:
    """Use Claude to extract specific info from fetched real content.

    Claude ONLY summarizes/extracts from the provided content — never from training data.
    """
    if not content or not anthropic_key:
        return ""

    prompts = {
        "submission_notes": f"From the following content about {agency_name}'s FOIA office, extract ONLY the submission instructions (how to submit a FOIA request, accepted formats, portal info, mailing address). If the content doesn't contain submission instructions, respond with just 'N/A'. Do not add information that is not in the provided text.\n\nContent:\n{content[:3000]}",
        "routing_notes": f"From the following content about {agency_name}'s FOIA office, extract ONLY routing guidance (which office or component to send requests to, any special routing for specific record types). If no routing info is present, respond with just 'N/A'. Do not add information not in the text.\n\nContent:\n{content[:3000]}",
        "cfr_summary": f"Summarize the following CFR regulation text for {agency_name} in 2-3 plain-English sentences focusing on: how to submit requests, response deadlines, fee policies, and any notable provisions. Only summarize what's in the text.\n\nRegulation text:\n{content[:5000]}",
    }

    prompt = prompts.get(field, "")
    if not prompt:
        return ""

    async with httpx.AsyncClient() as client:
        try:
            resp = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": anthropic_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json={
                    "model": "claude-haiku-4-5-20251001",
                    "max_tokens": 500,
                    "messages": [{"role": "user", "content": prompt}],
                },
                timeout=30.0,
            )
            resp.raise_for_status()
            text = resp.json()["content"][0]["text"].strip()
            if text == "N/A" or text == "n/a":
                return ""
            return text[:1000]
        except Exception as e:
            logger.warning(f"  Claude extraction failed for {agency_name}/{field}: {e}")
            return ""


def build_exemption_tendencies(supabase, abbreviation: str) -> str:
    """Build exemption tendencies from real foia_annual_reports data."""
    try:
        result = (
            supabase.table("foia_annual_reports")
            .select("exemption_1,exemption_2,exemption_3,exemption_4,exemption_5,exemption_6,exemption_7a,exemption_7b,exemption_7c,exemption_7d,exemption_7e,exemption_7f,exemption_8,exemption_9")
            .eq("agency_abbreviation", abbreviation)
            .execute()
        )
        if not result.data:
            return ""

        # Sum across all years
        totals = {}
        exemption_names = {
            "exemption_1": "Exemption 1 (National Security)",
            "exemption_2": "Exemption 2 (Internal Rules)",
            "exemption_3": "Exemption 3 (Statutory)",
            "exemption_4": "Exemption 4 (Trade Secrets)",
            "exemption_5": "Exemption 5 (Deliberative Process)",
            "exemption_6": "Exemption 6 (Personal Privacy)",
            "exemption_7a": "Exemption 7(A) (Law Enforcement - Proceedings)",
            "exemption_7b": "Exemption 7(B) (Law Enforcement - Fair Trial)",
            "exemption_7c": "Exemption 7(C) (Law Enforcement - Privacy)",
            "exemption_7d": "Exemption 7(D) (Law Enforcement - Sources)",
            "exemption_7e": "Exemption 7(E) (Law Enforcement - Techniques)",
            "exemption_7f": "Exemption 7(F) (Law Enforcement - Safety)",
            "exemption_8": "Exemption 8 (Financial Institutions)",
            "exemption_9": "Exemption 9 (Geological Data)",
        }

        for row in result.data:
            for key in exemption_names:
                totals[key] = totals.get(key, 0) + (row.get(key) or 0)

        # Sort by frequency, take top cited
        sorted_ex = sorted(totals.items(), key=lambda x: x[1], reverse=True)
        top = [(exemption_names[k], v) for k, v in sorted_ex if v > 0][:5]

        if not top:
            return ""

        lines = [f"Based on FOIA.gov annual report data, {abbreviation}'s most frequently cited exemptions are:"]
        for name, count in top:
            lines.append(f"- {name}: cited {count:,} times across all reporting years")
        return " ".join(lines)

    except Exception as e:
        logger.warning(f"  Exemption data lookup failed for {abbreviation}: {e}")
        return ""


# Map common agency abbreviations to their CFR citations
# Many agencies share regulations with parent departments
KNOWN_CFR_CITATIONS = {
    "ABMC": "36 C.F.R. Part 404",
    "ACHP": "36 C.F.R. Part 805",
    "ACUS": "1 C.F.R. Part 304",
    "AFRH": "5 C.F.R. Part 2103",
    "CEQ": "40 C.F.R. Part 1515",
    "CFPB": "12 C.F.R. Part 1070",
    "CFTC": "17 C.F.R. Part 145",
    "CIA": "32 C.F.R. Part 1900",
    "CIGIE": "5 C.F.R. Part 9801",
    "CNCS": "45 C.F.R. Part 2507",
    "CPSC": "16 C.F.R. Part 1015",
    "CSB": "40 C.F.R. Part 1601",
    "CSOSA": "28 C.F.R. Part 802",
    "DFC": "22 C.F.R. Part 706",
    "DHS": "6 C.F.R. Part 5",
    "DNFSB": "10 C.F.R. Part 1703",
    "DOC": "15 C.F.R. Part 4",
    "DOD": "32 C.F.R. Part 286",
    "DOE": "10 C.F.R. Part 1004",
    "DOI": "43 C.F.R. Part 2",
    "DOJ": "28 C.F.R. Part 16",
    "DOL": "29 C.F.R. Part 70",
    "DOT": "49 C.F.R. Part 7",
    "EAC": "11 C.F.R. Part 9405",
    "ED": "34 C.F.R. Part 5b",
    "EEOC": "29 C.F.R. Part 1610",
    "EPA": "40 C.F.R. Part 2",
    "EXIM": "12 C.F.R. Part 404",
    "FCA": "12 C.F.R. Part 602",
    "FCC": "47 C.F.R. Part 0",
    "FDIC": "12 C.F.R. Part 309",
    "FEC": "11 C.F.R. Part 4",
    "FERC": "18 C.F.R. Part 388",
    "FFIEC": "12 C.F.R. Part 1101",
    "FHFA": "12 C.F.R. Part 1202",
    "FLRA": "5 C.F.R. Part 2411",
    "FMC": "46 C.F.R. Part 503",
    "FMCS": "29 C.F.R. Part 1401",
    "FMSHRC": "29 C.F.R. Part 2702",
    "FRB": "12 C.F.R. Part 261",
    "FRTIB": "5 C.F.R. Part 1631",
    "FTC": "16 C.F.R. Part 4",
    "GSA": "41 C.F.R. Part 105-60",
    "HHS": "45 C.F.R. Part 5",
    "HUD": "24 C.F.R. Part 15",
    "IAF": "22 C.F.R. Part 1003",
    "IMLS": "2 C.F.R. Part 3187",
    "LSC": "45 C.F.R. Part 1602",
    "MCC": "22 C.F.R. Part 1304",
    "MMC": "50 C.F.R. Part 501",
    "MSPB": "5 C.F.R. Part 1204",
    "NARA": "36 C.F.R. Part 1250",
    "NASA": "14 C.F.R. Part 1206",
    "NCPC": "1 C.F.R. Part 456",
    "NCUA": "12 C.F.R. Part 792",
    "NEA": "45 C.F.R. Part 1100",
    "NEH": "45 C.F.R. Part 1171",
    "NIGC": "25 C.F.R. Part 517",
    "NLRB": "29 C.F.R. Part 102",
    "NMB": "29 C.F.R. Part 1208",
    "NRC": "10 C.F.R. Part 9",
    "NSF": "45 C.F.R. Part 612",
    "NTSB": "49 C.F.R. Part 801",
    "NWTRB": "10 C.F.R. Part 1304",
    "ODNI": "32 C.F.R. Part 1700",
    "OGE": "5 C.F.R. Part 2604",
    "OMB": "5 C.F.R. Part 1303",
    "ONDCP": "21 C.F.R. Part 1401",
    "OPM": "5 C.F.R. Part 294",
    "OSC": "5 C.F.R. Part 1820",
    "OSHRC": "29 C.F.R. Part 2201",
    "OSTP": "32 C.F.R. Part 2402",
    "PBGC": "29 C.F.R. Part 4901",
    "PCLOB": "6 C.F.R. Part 1001",
    "PRC": "39 C.F.R. Part 3006",
    "SBA": "13 C.F.R. Part 102",
    "SEC": "17 C.F.R. Part 200",
    "SIGAR": "5 C.F.R. Part 9301",
    "SSA": "20 C.F.R. Part 402",
    "State": "22 C.F.R. Part 171",
    "STB": "49 C.F.R. Part 1001",
    "Treasury": "31 C.F.R. Part 1",
    "TVA": "18 C.F.R. Part 1301",
    "USAB": "36 C.F.R. Part 1120",
    "USADF": "22 C.F.R. Part 1502",
    "USAGM": "22 C.F.R. Part 504",
    "USAID": "22 C.F.R. Part 212",
    "USCCR": "45 C.F.R. Part 704",
    "USDA": "7 C.F.R. Part 1",
    "USIBWC": "22 C.F.R. Part 1102",
    "USIP": "22 C.F.R. Part 1002",
    "USITC": "19 C.F.R. Part 201",
    "USPS": "39 C.F.R. Part 265",
    "USTDA": "22 C.F.R. Part 1403",
    "USTR": "15 C.F.R. Part 2004",
    "VA": "38 C.F.R. Part 1",
}


async def main():
    from app.config import settings

    if not settings.supabase_url or not settings.supabase_service_key:
        logger.error("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set.")
        sys.exit(1)
    if not settings.foia_gov_api_key:
        logger.error("FOIA_GOV_API_KEY must be set.")
        sys.exit(1)

    from supabase import create_client
    supabase = create_client(settings.supabase_url, settings.supabase_service_key)
    now = datetime.now(timezone.utc).isoformat()

    # Get existing profiles to avoid overwriting hand-curated ones
    existing = set()
    try:
        result = supabase.table("agency_profiles").select("abbreviation").execute()
        existing = {r["abbreviation"] for r in (result.data or [])}
    except Exception:
        pass
    logger.info(f"Existing profiles: {len(existing)}")

    # Step 1: Fetch all agencies from FOIA.gov
    logger.info("Fetching agencies from FOIA.gov...")
    components = await fetch_all_foia_gov_agencies(settings.foia_gov_api_key)
    logger.info(f"Found {len(components)} components")

    # Filter to centralized agencies (parent-level, not sub-components)
    # Also include any component whose abbreviation is in our CFR mapping
    agencies_to_process = []
    seen_abbrevs = set()
    for c in components:
        abbr = c["abbreviation"]
        if not abbr or abbr in seen_abbrevs:
            continue
        if abbr in existing:
            logger.info(f"  Skipping {abbr} — already has hand-curated profile")
            seen_abbrevs.add(abbr)
            continue
        if c["is_centralized"] or abbr in KNOWN_CFR_CITATIONS:
            agencies_to_process.append(c)
            seen_abbrevs.add(abbr)

    logger.info(f"Agencies to expand: {len(agencies_to_process)}")

    cfr_cache: dict[tuple, str] = {}
    upserted = 0

    async with httpx.AsyncClient(follow_redirects=True, timeout=30.0) as http_client:
        for i, agency in enumerate(agencies_to_process):
            abbr = agency["abbreviation"]
            name = agency["name"]
            logger.info(f"[{i+1}/{len(agencies_to_process)}] Processing {abbr} ({name})...")

            # Step 2: Fetch CFR text
            cfr_citation = KNOWN_CFR_CITATIONS.get(abbr, "")
            cfr_text = ""
            if cfr_citation:
                title, part = _parse_cfr_citation(cfr_citation)
                if title and part:
                    cache_key = (title, part)
                    if cache_key in cfr_cache:
                        cfr_text = cfr_cache[cache_key]
                    else:
                        cfr_text = await fetch_cfr_text(title, part, http_client)
                        cfr_cache[cache_key] = cfr_text
                        await asyncio.sleep(0.5)

            # Step 3: Fetch FOIA page content via Tavily
            page_content = ""
            if agency["foia_website"] and settings.tavily_api_key:
                page_content = await fetch_foia_page_content(
                    agency["foia_website"], settings.tavily_api_key
                )
                await asyncio.sleep(0.3)

            # Step 3b: Extract submission_notes and routing_notes from real page content
            submission_notes = ""
            routing_notes = ""
            cfr_summary = ""

            if page_content and settings.anthropic_api_key:
                submission_notes = await extract_with_claude(
                    page_content, name, "submission_notes", settings.anthropic_api_key
                )
                routing_notes = await extract_with_claude(
                    page_content, name, "routing_notes", settings.anthropic_api_key
                )
                await asyncio.sleep(0.3)

            # Step 5: Claude summarizes CFR text
            if cfr_text and settings.anthropic_api_key:
                cfr_summary = await extract_with_claude(
                    cfr_text, name, "cfr_summary", settings.anthropic_api_key
                )
                await asyncio.sleep(0.3)

            # Step 4: Build exemption tendencies from real data
            exemption_tendencies = build_exemption_tendencies(supabase, abbr)

            # Build profile row
            row = {
                "abbreviation": abbr,
                "name": name,
                "jurisdiction": "federal",
                "description": agency["description"],
                "foia_email": agency["foia_email"],
                "foia_website": agency["foia_website"],
                "foia_regulation": cfr_citation,
                "submission_notes": submission_notes,
                "exemption_tendencies": exemption_tendencies,
                "routing_notes": routing_notes,
                "cfr_summary": cfr_summary,
                "cfr_text": cfr_text,
                "cfr_last_fetched": now if cfr_text else None,
                "updated_at": now,
            }

            # Step 6: Upsert
            try:
                supabase.table("agency_profiles").upsert(
                    row, on_conflict="abbreviation"
                ).execute()
                upserted += 1
                logger.info(f"  ✓ Upserted {abbr} (CFR: {len(cfr_text):,} chars, exemptions: {'yes' if exemption_tendencies else 'no'})")
            except Exception as e:
                logger.warning(f"  ✗ Failed to upsert {abbr}: {e}")

    logger.info(f"\nDone. Upserted {upserted} new agency profiles. Total profiles: {len(existing) + upserted}")


if __name__ == "__main__":
    asyncio.run(main())
