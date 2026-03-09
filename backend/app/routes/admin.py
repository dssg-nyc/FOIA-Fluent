"""Admin endpoints — protected by ADMIN_SECRET header.

POST /api/v1/admin/refresh-agencies
    Re-fetches CFR text from the eCFR API for agencies where cfr_last_fetched
    is older than REFRESH_DAYS (default 30) or has never been fetched.
    Updates cfr_text and cfr_last_fetched in the agency_profiles table.

Not exposed publicly — call manually before major releases or via Railway cron.
"""
import asyncio
import logging
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timezone, timedelta
from typing import Optional

import httpx
from fastapi import APIRouter, Header, HTTPException

from app.config import settings
from app.services.agency_profiles import _get_supabase

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/admin", tags=["admin"])

ECFR_BASE = "https://www.ecfr.gov/api/versioner/v1"
REFRESH_DAYS = 30


def _parse_cfr_citation(citation: str) -> tuple[Optional[str], Optional[str]]:
    clean = re.split(r'\(', citation)[0].strip()
    match = re.search(r'(\d+)\s+C\.F\.R\.\s+Part\s+(\d+)', clean, re.IGNORECASE)
    if match:
        return match.group(1), match.group(2)
    return None, None


def _extract_text_from_xml(xml_content: str) -> str:
    try:
        root = ET.fromstring(xml_content)
        lines = []

        def _walk(element: ET.Element) -> None:
            tag = element.tag.split("}")[-1] if "}" in element.tag else element.tag
            if tag in ("HEAD", "SUBJECT"):
                if element.text and element.text.strip():
                    lines.append(f"\n{element.text.strip()}\n")
            elif tag in ("P", "FP"):
                text = "".join(element.itertext()).strip()
                if text:
                    lines.append(text)
            elif tag == "SECTION":
                lines.append("")
            for child in element:
                _walk(child)

        _walk(root)
        result = "\n".join(lines).strip()
        result = re.sub(r'\n{3,}', '\n\n', result)
        return result[:50000]
    except ET.ParseError:
        text = re.sub(r'<[^>]+>', ' ', xml_content)
        return re.sub(r'\s+', ' ', text).strip()[:50000]


@router.post("/refresh-agencies")
async def refresh_agency_cfr_text(
    x_admin_secret: str = Header(default="", alias="X-Admin-Secret"),
):
    """Re-fetch CFR text from eCFR API for stale agency profiles.

    Requires the X-Admin-Secret header to match the ADMIN_SECRET env var.
    """
    if not settings.admin_secret or x_admin_secret != settings.admin_secret:
        raise HTTPException(status_code=403, detail="Invalid or missing admin secret")

    supabase = _get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Supabase not configured")

    cutoff = (datetime.now(timezone.utc) - timedelta(days=REFRESH_DAYS)).isoformat()

    # Fetch agencies that are stale or have never been fetched
    result = (
        supabase.table("agency_profiles")
        .select("abbreviation, foia_regulation, cfr_last_fetched")
        .or_(f"cfr_last_fetched.is.null,cfr_last_fetched.lt.{cutoff}")
        .execute()
    )
    agencies = result.data or []

    if not agencies:
        return {"message": "All agency profiles are up to date.", "refreshed": 0}

    now = datetime.now(timezone.utc).isoformat()
    cfr_cache: dict[tuple[str, str], str] = {}
    refreshed = 0
    failed = []

    async with httpx.AsyncClient(
        headers={"User-Agent": "FOIA-Fluent/1.0"},
        follow_redirects=True,
    ) as client:
        for agency in agencies:
            abbr = agency["abbreviation"]
            citation = agency.get("foia_regulation", "")
            title, part = _parse_cfr_citation(citation)

            if not title or not part:
                continue

            cache_key = (title, part)
            if cache_key not in cfr_cache:
                try:
                    url = f"{ECFR_BASE}/full/current/title-{title}.xml"
                    response = await client.get(url, params={"part": part}, timeout=30.0)
                    cfr_cache[cache_key] = (
                        _extract_text_from_xml(response.text)
                        if response.status_code == 200
                        else ""
                    )
                except Exception as e:
                    logger.warning(f"eCFR fetch failed for {abbr}: {e}")
                    cfr_cache[cache_key] = ""
                await asyncio.sleep(0.5)

            cfr_text = cfr_cache[cache_key]
            if not cfr_text:
                failed.append(abbr)
                continue

            try:
                supabase.table("agency_profiles").update({
                    "cfr_text": cfr_text,
                    "cfr_last_fetched": now,
                    "updated_at": now,
                }).eq("abbreviation", abbr).execute()
                refreshed += 1
            except Exception as e:
                logger.error(f"Failed to update {abbr}: {e}")
                failed.append(abbr)

    return {
        "message": f"Refreshed {refreshed} agency profiles.",
        "refreshed": refreshed,
        "failed": failed,
        "stale_count": len(agencies),
    }
