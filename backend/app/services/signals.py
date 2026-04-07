"""Service layer for Live FOIA Signals.

Reads from Supabase tables `personas`, `foia_signals_feed`, `user_personas`.
Auth-scoped queries (per-user persona subscriptions) require user_id; the public
persona catalog and signal feed reads are user-agnostic in Phase 1 (the feed is
filtered by personas, not by who owns it).
"""
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from app.config import settings
from app.models.signals import Persona, Signal

logger = logging.getLogger(__name__)


def _get_supabase():
    if not settings.supabase_url or not settings.supabase_service_key:
        return None
    from supabase import create_client
    return create_client(settings.supabase_url, settings.supabase_service_key)


# ── Persona catalog ─────────────────────────────────────────────────────────

def list_personas() -> list[Persona]:
    """Return the static persona catalog ordered by display_order."""
    supabase = _get_supabase()
    if not supabase:
        return []
    try:
        result = (
            supabase.table("personas")
            .select("id,name,description,icon,display_order")
            .order("display_order")
            .execute()
        )
        return [Persona(**row) for row in (result.data or [])]
    except Exception as e:
        logger.warning(f"list_personas failed: {e}")
        return []


# ── User persona subscriptions ──────────────────────────────────────────────

def get_user_personas(user_id: str) -> list[str]:
    """Return persona ids the user has subscribed to. Empty list if none."""
    supabase = _get_supabase()
    if not supabase or not user_id:
        return []
    try:
        result = (
            supabase.table("user_personas")
            .select("persona_id")
            .eq("user_id", user_id)
            .execute()
        )
        return [row["persona_id"] for row in (result.data or [])]
    except Exception as e:
        logger.warning(f"get_user_personas failed for {user_id}: {e}")
        return []


def set_user_personas(user_id: str, persona_ids: list[str]) -> list[str]:
    """Replace the user's persona subscription set with the given ids."""
    supabase = _get_supabase()
    if not supabase or not user_id:
        return []
    try:
        # Delete existing
        supabase.table("user_personas").delete().eq("user_id", user_id).execute()
        # Insert new
        if persona_ids:
            rows = [{"user_id": user_id, "persona_id": pid} for pid in persona_ids]
            supabase.table("user_personas").insert(rows).execute()
        return persona_ids
    except Exception as e:
        logger.warning(f"set_user_personas failed for {user_id}: {e}")
        return []


# ── Signal feed ─────────────────────────────────────────────────────────────

def get_feed(
    personas: Optional[list[str]] = None,
    since: Optional[datetime] = None,
    limit: int = 100,
) -> list[Signal]:
    """Return recent signals filtered by persona and date.

    If personas is None or empty, returns ALL recent signals (used for the
    landing-page sample feed in Phase 2 and the dogfood feed view in Phase 1
    when the user hasn't picked a persona yet).
    """
    supabase = _get_supabase()
    if not supabase:
        return []

    try:
        q = supabase.table("foia_signals_feed").select("*")

        if personas:
            # Persona overlap filter — at least one persona tag matches.
            q = q.overlaps("persona_tags", personas)

        if since:
            q = q.gte("signal_date", since.isoformat())

        q = q.order("signal_date", desc=True).limit(limit)
        result = q.execute()

        return [Signal(**row) for row in (result.data or [])]
    except Exception as e:
        logger.warning(f"get_feed failed: {e}")
        return []


def get_recent_signals_for_chat(
    persona: str = "",
    query: str = "",
    days: int = 7,
    limit: int = 10,
) -> list[dict]:
    """Plain-dict variant for the chat tool. Filtered by optional persona,
    optional keyword (matched in title or summary), and a recency window."""
    supabase = _get_supabase()
    if not supabase:
        return []
    try:
        q = supabase.table("foia_signals_feed").select(
            "id,source,title,summary,source_url,signal_date,agency_codes,persona_tags,priority"
        )
        if persona:
            q = q.contains("persona_tags", [persona])
        if query:
            q = q.or_(f"title.ilike.%{query}%,summary.ilike.%{query}%")
        since = datetime.now(timezone.utc) - timedelta(days=max(1, days))
        q = q.gte("signal_date", since.isoformat())
        q = q.order("priority", desc=True).order("signal_date", desc=True).limit(limit)
        result = q.execute()
        return result.data or []
    except Exception as e:
        logger.warning(f"get_recent_signals_for_chat failed: {e}")
        return []
