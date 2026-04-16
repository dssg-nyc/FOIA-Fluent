"""Service layer for saved searches (Discover & Draft Phase 4).

Idempotent on (user_id, normalized_query) — repeated saves of the same query
update last_run_at + last_result_count rather than creating duplicates.
"""
import logging
from datetime import datetime, timezone
from typing import Optional

from app.config import settings
from app.models.saved_searches import SavedSearch, SaveSearchPayload

logger = logging.getLogger(__name__)


def _get_supabase():
    if not settings.supabase_url or not settings.supabase_service_key:
        return None
    from supabase import create_client
    return create_client(settings.supabase_url, settings.supabase_service_key)


def _row_to_model(row: dict) -> SavedSearch:
    return SavedSearch(**row)


def _normalize(q: str) -> str:
    return (q or "").strip().lower()


def save_search(user_id: str, payload: SaveSearchPayload) -> Optional[SavedSearch]:
    """Save a new search or update the existing row if the same query already
    exists for this user (case-insensitive, trimmed match)."""
    supabase = _get_supabase()
    if not supabase:
        return None

    query = (payload.query or "").strip()
    if not query:
        return None

    normalized = _normalize(query)
    now_iso = datetime.now(timezone.utc).isoformat()

    try:
        # Look for existing match first
        existing = (
            supabase.table("saved_searches")
            .select("*")
            .eq("user_id", user_id)
            .execute()
        )
        match = None
        for row in existing.data or []:
            if _normalize(row.get("query", "")) == normalized:
                match = row
                break

        if match:
            updates = {"last_run_at": now_iso}
            if payload.result_count is not None:
                updates["last_result_count"] = payload.result_count
            if payload.interpretation is not None:
                updates["interpretation"] = payload.interpretation
            if payload.name is not None:
                updates["name"] = payload.name[:200]
            if payload.result_snapshot is not None:
                updates["result_snapshot"] = payload.result_snapshot
                updates["snapshot_at"] = now_iso

            result = (
                supabase.table("saved_searches")
                .update(updates)
                .eq("id", match["id"])
                .eq("user_id", user_id)
                .execute()
            )
            if result.data:
                return _row_to_model(result.data[0])
            return _row_to_model({**match, **updates})

        row_in = {
            "user_id": user_id,
            "query": query[:1000],
            "interpretation": payload.interpretation or {},
            "name": (payload.name or "")[:200],
            "last_run_at": now_iso,
            "last_result_count": payload.result_count or 0,
        }
        if payload.result_snapshot is not None:
            row_in["result_snapshot"] = payload.result_snapshot
            row_in["snapshot_at"] = now_iso
        result = supabase.table("saved_searches").insert(row_in).execute()
        if result.data:
            return _row_to_model(result.data[0])
    except Exception as e:
        logger.warning(f"save_search failed for {user_id}: {e}")

    return None


def list_saved_searches(user_id: str, limit: int = 20) -> list[SavedSearch]:
    """List the user's saved searches. Strips the heavy result_snapshot column
    so the list stays small — use get_saved_search(id) to retrieve the snapshot."""
    supabase = _get_supabase()
    if not supabase:
        return []
    try:
        result = (
            supabase.table("saved_searches")
            .select(
                "id,user_id,query,interpretation,name,last_run_at,"
                "last_result_count,created_at,snapshot_at"
            )
            .eq("user_id", user_id)
            .order("last_run_at", desc=True)
            .limit(limit)
            .execute()
        )
        return [_row_to_model(r) for r in (result.data or [])]
    except Exception as e:
        logger.warning(f"list_saved_searches failed for {user_id}: {e}")
        return []


def get_saved_search(user_id: str, search_id: str) -> Optional[SavedSearch]:
    """Fetch a single saved search including its cached result_snapshot."""
    supabase = _get_supabase()
    if not supabase:
        return None
    try:
        result = (
            supabase.table("saved_searches")
            .select("*")
            .eq("id", search_id)
            .eq("user_id", user_id)
            .single()
            .execute()
        )
        return _row_to_model(result.data) if result.data else None
    except Exception as e:
        logger.warning(f"get_saved_search failed for {search_id}: {e}")
        return None


def delete_saved_search(user_id: str, search_id: str) -> bool:
    supabase = _get_supabase()
    if not supabase:
        return False
    try:
        supabase.table("saved_searches").delete().eq("id", search_id).eq(
            "user_id", user_id
        ).execute()
        return True
    except Exception as e:
        logger.warning(f"delete_saved_search failed for {search_id}: {e}")
        return False
