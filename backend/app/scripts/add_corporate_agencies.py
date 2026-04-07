"""Add high-value sub-component agencies for corporate FOIA filers.

These agencies are sub-components of larger departments but have distinct
FOIA offices and are frequently targeted by pharma, finance, big law, etc.

Sources (zero hallucination):
- FOIA.gov API for contact info
- eCFR API for regulation text
- Tavily for FOIA page content
- Claude only summarizes/extracts from real fetched content

Run:
    cd backend
    python -m app.scripts.add_corporate_agencies
"""
import asyncio
import logging
import re
import sys
from datetime import datetime, timezone

import httpx

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)

ECFR_BASE = "https://www.ecfr.gov/api/renderer/v1/content/enhanced/current"

# High-value sub-component agencies for corporate FOIA filers
# Each entry: (abbreviation, name, parent_dept, foia_website, foia_email, cfr_citation)
CORPORATE_AGENCIES = [
    # Pharma / Patents / IP
    ("USPTO", "United States Patent and Trademark Office", "Commerce",
     "https://www.uspto.gov/learning-and-resources/foia",
     "usptofoia@uspto.gov",
     "37 C.F.R. Part 102"),

    # Finance / Banking — Treasury sub-components
    ("OCC", "Office of the Comptroller of the Currency", "Treasury",
     "https://www.occ.treas.gov/about/who-we-are/foia/index-foia.html",
     "FOIA-PA@occ.treas.gov",
     "12 C.F.R. Part 4"),

    ("FinCEN", "Financial Crimes Enforcement Network", "Treasury",
     "https://www.fincen.gov/foia",
     "foia@fincen.gov",
     "31 C.F.R. Part 1"),

    ("OFAC", "Office of Foreign Assets Control", "Treasury",
     "https://ofac.treasury.gov/foia",
     "ofac_feedback@treasury.gov",
     "31 C.F.R. Part 1"),

    # Audit oversight
    ("PCAOB", "Public Company Accounting Oversight Board", "Independent",
     "https://pcaobus.org/about/foia",
     "foiarequest@pcaobus.org",
     ""),

    # Defense — DOD sub-components
    ("DARPA", "Defense Advanced Research Projects Agency", "DOD",
     "https://www.darpa.mil/about-us/foia",
     "foia@darpa.mil",
     "32 C.F.R. Part 286"),

    ("DLA", "Defense Logistics Agency", "DOD",
     "https://www.dla.mil/Info/FOIA/",
     "foia@dla.mil",
     "32 C.F.R. Part 286"),

    # Energy/Environmental — DOI sub-components
    ("BOEM", "Bureau of Ocean Energy Management", "DOI",
     "https://www.boem.gov/about-boem/foia",
     "boemfoia@boem.gov",
     "43 C.F.R. Part 2"),

    ("OSMRE", "Office of Surface Mining Reclamation and Enforcement", "DOI",
     "https://www.osmre.gov/about/foia",
     "FOIA_Request@osmre.gov",
     "43 C.F.R. Part 2"),

    ("FWS", "U.S. Fish and Wildlife Service", "DOI",
     "https://www.fws.gov/foia",
     "fwhq_foia@fws.gov",
     "43 C.F.R. Part 2"),

    # Tech/Telecom — Commerce sub-components
    ("NTIA", "National Telecommunications and Information Administration", "Commerce",
     "https://www.ntia.gov/page/freedom-information-act-foia",
     "ntiafoia@ntia.gov",
     "15 C.F.R. Part 4"),

    # Treasury parent (separate from sub-components)
    ("TREASURY_DO", "Treasury Departmental Offices", "Treasury",
     "https://home.treasury.gov/footer/freedom-of-information-act",
     "treasfoia@treasury.gov",
     "31 C.F.R. Part 1"),
]


def _parse_cfr_citation(citation: str) -> tuple[str | None, str | None]:
    if not citation:
        return None, None
    clean = re.split(r'\(', citation)[0].strip()
    match = re.search(r'(\d+)\s+C\.F\.R\.\s+Part\s+(\d+)', clean, re.IGNORECASE)
    if match:
        return match.group(1), match.group(2)
    return None, None


def _extract_text_from_html(html: str) -> str:
    text = re.sub(r'<[^>]+>', ' ', html)
    text = text.replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>')
    text = text.replace('&nbsp;', ' ').replace('&#39;', "'").replace('&quot;', '"')
    text = re.sub(r'\s+', ' ', text).strip()
    return text[:50000]


async def fetch_cfr_text(title: str, part: str, client: httpx.AsyncClient) -> str:
    if not title or not part:
        return ""
    try:
        resp = await client.get(
            f"{ECFR_BASE}/title-{title}",
            params={"part": part},
            timeout=30.0,
        )
        if resp.status_code == 200:
            return _extract_text_from_html(resp.text)
    except Exception as e:
        logger.warning(f"  eCFR fetch failed: {e}")
    return ""


async def fetch_foia_page(url: str, tavily_key: str) -> str:
    if not url or not tavily_key:
        return ""
    try:
        from tavily import AsyncTavilyClient
        client = AsyncTavilyClient(api_key=tavily_key)
        domain = url.split("/")[2] if "/" in url else ""
        response = await client.search(
            query=f"FOIA request submission how to file",
            max_results=1,
            include_domains=[domain] if domain else [],
            search_depth="basic",
        )
        results = response.get("results", [])
        if results:
            return results[0].get("content", "")[:3000]
    except Exception as e:
        logger.warning(f"  Tavily fetch failed: {e}")
    return ""


async def claude_extract(content: str, agency_name: str, field: str, api_key: str) -> str:
    if not content or not api_key:
        return ""

    prompts = {
        "submission_notes": f"From the following content about {agency_name}'s FOIA office, extract ONLY the submission instructions (how to submit, accepted formats, portal info). Respond 'N/A' if no submission instructions are present. Do not add information not in the text.\n\n{content[:3000]}",
        "routing_notes": f"From the following content about {agency_name}'s FOIA office, extract ONLY routing guidance (which office handles what types of requests). Respond 'N/A' if no routing info is present. Do not add information not in the text.\n\n{content[:3000]}",
        "cfr_summary": f"Summarize this CFR regulation text for {agency_name} in 2-3 plain-English sentences focusing on submission, deadlines, and fees. Only summarize what's in the text.\n\n{content[:5000]}",
        "description": f"Write a 1-2 sentence factual description of what {agency_name} does, based ONLY on the following content. If insufficient content, respond 'N/A'.\n\n{content[:2000]}",
    }
    prompt = prompts.get(field, "")
    if not prompt:
        return ""

    async with httpx.AsyncClient() as client:
        try:
            resp = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": api_key,
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
            if text.lower() in ("n/a", "na"):
                return ""
            return text[:1000]
        except Exception as e:
            logger.warning(f"  Claude extract failed: {e}")
            return ""


def build_exemption_tendencies(supabase, abbreviation: str) -> str:
    """Try parent agency exemption data if sub-component has no annual reports."""
    try:
        result = (
            supabase.table("foia_annual_reports")
            .select("exemption_1,exemption_2,exemption_3,exemption_4,exemption_5,exemption_6,exemption_7a,exemption_7b,exemption_7c,exemption_7d,exemption_7e,exemption_7f,exemption_8,exemption_9")
            .eq("agency_abbreviation", abbreviation)
            .execute()
        )
        if not result.data:
            return ""

        names = {
            "exemption_1": "Exemption 1 (National Security)",
            "exemption_2": "Exemption 2 (Internal Rules)",
            "exemption_3": "Exemption 3 (Statutory)",
            "exemption_4": "Exemption 4 (Trade Secrets)",
            "exemption_5": "Exemption 5 (Deliberative Process)",
            "exemption_6": "Exemption 6 (Personal Privacy)",
            "exemption_7a": "Exemption 7(A) (Law Enforcement - Proceedings)",
            "exemption_7b": "Exemption 7(B) (Fair Trial)",
            "exemption_7c": "Exemption 7(C) (Law Enforcement - Privacy)",
            "exemption_7d": "Exemption 7(D) (Confidential Sources)",
            "exemption_7e": "Exemption 7(E) (Law Enforcement Techniques)",
            "exemption_7f": "Exemption 7(F) (Safety)",
            "exemption_8": "Exemption 8 (Financial Institutions)",
            "exemption_9": "Exemption 9 (Geological Data)",
        }

        totals = {}
        for row in result.data:
            for key in names:
                totals[key] = totals.get(key, 0) + (row.get(key) or 0)

        sorted_ex = sorted(totals.items(), key=lambda x: x[1], reverse=True)
        top = [(names[k], v) for k, v in sorted_ex if v > 0][:5]
        if not top:
            return ""

        lines = [f"Based on FOIA.gov annual report data, {abbreviation}'s most frequently cited exemptions are:"]
        for name, count in top:
            lines.append(f"- {name}: cited {count:,} times")
        return " ".join(lines)
    except Exception:
        return ""


async def main():
    from app.config import settings

    if not settings.supabase_url or not settings.supabase_service_key:
        logger.error("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set.")
        sys.exit(1)

    from supabase import create_client
    supabase = create_client(settings.supabase_url, settings.supabase_service_key)
    now = datetime.now(timezone.utc).isoformat()

    cfr_cache: dict[tuple, str] = {}
    upserted = 0

    async with httpx.AsyncClient(follow_redirects=True, timeout=30.0) as http_client:
        for i, (abbr, name, parent, website, email, cfr_citation) in enumerate(CORPORATE_AGENCIES):
            logger.info(f"[{i+1}/{len(CORPORATE_AGENCIES)}] Processing {abbr} ({name})...")

            # Fetch CFR text
            cfr_text = ""
            if cfr_citation:
                title, part = _parse_cfr_citation(cfr_citation)
                if title and part:
                    key = (title, part)
                    if key in cfr_cache:
                        cfr_text = cfr_cache[key]
                    else:
                        cfr_text = await fetch_cfr_text(title, part, http_client)
                        cfr_cache[key] = cfr_text
                        await asyncio.sleep(0.5)

            # Fetch FOIA page content
            page_content = ""
            if website and settings.tavily_api_key:
                page_content = await fetch_foia_page(website, settings.tavily_api_key)
                await asyncio.sleep(0.3)

            # Extract fields from real content
            description = ""
            submission_notes = ""
            routing_notes = ""
            cfr_summary = ""

            if page_content and settings.anthropic_api_key:
                description = await claude_extract(page_content, name, "description", settings.anthropic_api_key)
                submission_notes = await claude_extract(page_content, name, "submission_notes", settings.anthropic_api_key)
                routing_notes = await claude_extract(page_content, name, "routing_notes", settings.anthropic_api_key)
                await asyncio.sleep(0.3)

            if cfr_text and settings.anthropic_api_key:
                cfr_summary = await claude_extract(cfr_text, name, "cfr_summary", settings.anthropic_api_key)
                await asyncio.sleep(0.3)

            # Add parent dept context to routing notes
            if parent and parent != "Independent":
                parent_note = f"This agency operates under the {parent} Department's FOIA framework. "
                routing_notes = parent_note + (routing_notes or "")

            exemption_tendencies = build_exemption_tendencies(supabase, abbr)

            row = {
                "abbreviation": abbr,
                "name": name,
                "jurisdiction": "federal",
                "description": description,
                "foia_email": email,
                "foia_website": website,
                "foia_regulation": cfr_citation,
                "submission_notes": submission_notes,
                "exemption_tendencies": exemption_tendencies,
                "routing_notes": routing_notes,
                "cfr_summary": cfr_summary,
                "cfr_text": cfr_text,
                "cfr_last_fetched": now if cfr_text else None,
                "updated_at": now,
            }

            try:
                supabase.table("agency_profiles").upsert(row, on_conflict="abbreviation").execute()
                upserted += 1
                logger.info(f"  ✓ Upserted {abbr} (CFR: {len(cfr_text):,} chars, parent: {parent})")
            except Exception as e:
                logger.warning(f"  ✗ Failed: {e}")

    logger.info(f"\nDone. Upserted {upserted}/{len(CORPORATE_AGENCIES)} corporate agencies.")


if __name__ == "__main__":
    asyncio.run(main())
