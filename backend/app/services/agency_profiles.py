"""Agency profiles service — provides regulatory content for each federal agency.

Read order:
  1. Supabase `agency_profiles` table (primary — used in deployment)
  2. `federal_agencies.py` dict (fallback — used in local dev / if Supabase unavailable)

All Claude calls (drafter, response_analyzer, letter_generator) should call
`get_agency_profile()` instead of importing FEDERAL_AGENCIES directly,
so they always get the richest available data including cfr_text.
"""
import logging
from typing import Optional

from app.config import settings
from app.data.federal_agencies import FEDERAL_AGENCIES

logger = logging.getLogger(__name__)

# Lazy-loaded Supabase client
_supabase = None


def _get_supabase():
    """Return a Supabase client, or None if not configured."""
    global _supabase
    if _supabase is not None:
        return _supabase
    if not settings.supabase_url or not settings.supabase_service_key:
        return None
    try:
        from supabase import create_client
        _supabase = create_client(settings.supabase_url, settings.supabase_service_key)
        return _supabase
    except Exception as e:
        logger.warning(f"Supabase client init failed: {e}")
        return None


def get_agency_profile(abbreviation: str) -> Optional[dict]:
    """Return the full agency profile for the given abbreviation.

    Tries Supabase first, falls back to the static Python dict.
    Returns None if the agency is not found in either source.
    """
    abbr = abbreviation.upper()

    # Try Supabase
    supabase = _get_supabase()
    if supabase:
        try:
            result = (
                supabase.table("agency_profiles")
                .select("*")
                .eq("abbreviation", abbr)
                .single()
                .execute()
            )
            if result.data:
                return result.data
        except Exception as e:
            logger.warning(f"Supabase agency lookup failed for {abbr}: {e}")

    # Fallback to static Python dict
    return FEDERAL_AGENCIES.get(abbr)


def get_all_agency_profiles() -> list[dict]:
    """Return all agency profiles.

    Tries Supabase first, falls back to the static Python dict.
    """
    supabase = _get_supabase()
    if supabase:
        try:
            result = (
                supabase.table("agency_profiles")
                .select("*")
                .order("name")
                .execute()
            )
            if result.data:
                return result.data
        except Exception as e:
            logger.warning(f"Supabase agency list failed: {e}")

    return list(FEDERAL_AGENCIES.values())


def get_agency_summary() -> str:
    """Return a formatted summary of all agencies for use in Claude prompts."""
    profiles = get_all_agency_profiles()
    lines = []
    for agency in profiles:
        lines.append(
            f"- {agency['abbreviation']} ({agency['name']}): {agency.get('description', '')}"
        )
    return "\n".join(lines)


def upsert_agency_profile(profile: dict) -> bool:
    """Upsert a single agency profile into Supabase.

    Used by the seeding script and the admin refresh endpoint.
    Returns True on success, False on failure.
    """
    supabase = _get_supabase()
    if not supabase:
        logger.error("Cannot upsert agency profile: Supabase not configured")
        return False
    try:
        supabase.table("agency_profiles").upsert(profile).execute()
        return True
    except Exception as e:
        logger.error(f"Failed to upsert agency profile {profile.get('abbreviation')}: {e}")
        return False
