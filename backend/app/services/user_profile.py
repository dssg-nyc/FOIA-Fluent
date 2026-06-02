"""Service layer for per-user profile flags.

Currently this backs the onboarding tour completion flag. Reads and writes go
through the Supabase service-role client (RLS is bypassed), matching the pattern
in saved_searches.py. The user_profiles row is normally created by the
handle_new_user trigger on signup, but users created before that trigger existed
may have no row, so reads treat a missing row as "not completed" and writes upsert.
"""
import logging
from datetime import datetime, timezone
from typing import Optional

from app.config import settings

logger = logging.getLogger(__name__)


def _get_supabase():
    if not settings.supabase_url or not settings.supabase_service_key:
        return None
    from supabase import create_client

    return create_client(settings.supabase_url, settings.supabase_service_key)


def get_tour_completed_at(user_id: str) -> Optional[str]:
    """Return the user's tour_completed_at ISO timestamp, or None.

    None means the tour has not been completed (or the profile row is missing,
    or Supabase is not configured in local dev).
    """
    supabase = _get_supabase()
    if not supabase:
        return None
    try:
        # Not .single(): a missing row must return None, not raise.
        result = (
            supabase.table("user_profiles")
            .select("tour_completed_at")
            .eq("user_id", user_id)
            .execute()
        )
        rows = result.data or []
        if not rows:
            return None
        return rows[0].get("tour_completed_at")
    except Exception as e:
        logger.warning(f"get_tour_completed_at failed for {user_id}: {e}")
        return None


def mark_tour_completed(user_id: str) -> Optional[str]:
    """Mark the onboarding tour complete for this user (idempotent upsert).

    Upserts on user_id so it works even if the profile row does not exist yet.
    Returns the timestamp written, or None if Supabase is not configured.
    """
    supabase = _get_supabase()
    if not supabase:
        return None
    now_iso = datetime.now(timezone.utc).isoformat()
    try:
        supabase.table("user_profiles").upsert(
            {"user_id": user_id, "tour_completed_at": now_iso},
            on_conflict="user_id",
        ).execute()
        return now_iso
    except Exception as e:
        logger.warning(f"mark_tour_completed failed for {user_id}: {e}")
        return None
