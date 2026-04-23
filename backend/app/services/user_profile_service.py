"""CRUD for user_profiles. Supabase-backed with a graceful local-dev fallback
(in-memory dict keyed by user_id)."""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

from app.config import settings
from app.models.profile import UpdateUserProfilePayload, UserProfile
from app.services.agency_profiles import _get_supabase

logger = logging.getLogger(__name__)

_PROFILE_FIELDS = (
    "full_name",
    "organization",
    "email",
    "phone",
    "mailing_address",
    "requester_category",
)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row_to_profile(row: dict) -> UserProfile:
    return UserProfile(**{f: (row.get(f) or "") for f in _PROFILE_FIELDS})


# Local dev in-memory store (when Supabase is not configured)
_dev_store: dict[str, dict] = {}


def get_profile(user_id: str) -> UserProfile:
    """Return the user's profile. Never raises — an empty UserProfile is
    returned if the user has no row yet, so callers can render a blank form."""
    if not settings.supabase_url:
        row = _dev_store.get(user_id, {})
        return _row_to_profile(row)

    sb = _get_supabase()
    if not sb:
        return UserProfile()
    try:
        result = (
            sb.table("user_profiles")
            .select("*")
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
        data = (result.data or [None])[0]
        return _row_to_profile(data) if data else UserProfile()
    except Exception as e:
        logger.warning(f"user_profiles fetch failed: {e}")
        return UserProfile()


def upsert_profile(user_id: str, payload: UpdateUserProfilePayload) -> UserProfile:
    """Upsert only the non-None fields in the payload. Returns the full
    resulting profile."""
    updates = payload.model_dump(exclude_none=True)
    if not updates:
        return get_profile(user_id)

    if not settings.supabase_url:
        existing = _dev_store.get(user_id, {})
        existing.update(updates)
        existing["user_id"] = user_id
        existing["updated_at"] = _now()
        _dev_store[user_id] = existing
        return _row_to_profile(existing)

    sb = _get_supabase()
    if not sb:
        raise RuntimeError("Supabase not configured")

    row: dict = {"user_id": user_id, "updated_at": _now()}
    row.update(updates)
    sb.table("user_profiles").upsert(row, on_conflict="user_id").execute()

    # Return the freshest row after upsert
    return get_profile(user_id)
