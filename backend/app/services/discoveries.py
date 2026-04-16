"""Service layer for saved discoveries.

All operations are scoped by user_id (passed in from the auth middleware).
RLS is also enforced at the database layer as a defense-in-depth.
"""
import logging
from typing import Optional

from app.config import settings
from app.models.discoveries import (
    DiscoveredDocument,
    SaveDiscoveryPayload,
    UpdateDiscoveryPayload,
)

logger = logging.getLogger(__name__)


def _get_supabase():
    if not settings.supabase_url or not settings.supabase_service_key:
        return None
    from supabase import create_client
    return create_client(settings.supabase_url, settings.supabase_service_key)


def _row_to_model(row: dict) -> DiscoveredDocument:
    return DiscoveredDocument(**row)


# ── Save ────────────────────────────────────────────────────────────────────

def save_discovery(user_id: str, payload: SaveDiscoveryPayload) -> Optional[DiscoveredDocument]:
    """Save a new discovery, or return the existing row if (user_id, url) is a duplicate."""
    supabase = _get_supabase()
    if not supabase:
        return None

    row_in = {
        "user_id": user_id,
        "source": payload.source,
        "source_id": payload.source_id,
        "title": payload.title[:500],
        "description": (payload.description or "")[:5000],
        "url": payload.url,
        "document_date": payload.document_date.isoformat() if payload.document_date else None,
        "page_count": payload.page_count,
        "agency": (payload.agency or "")[:200],
        "discovered_via_query": (payload.discovered_via_query or "")[:1000],
        "tracked_request_id": payload.tracked_request_id,
        "tags": payload.tags or [],
        "note": (payload.note or "")[:2000],
    }

    try:
        # Try insert first; on UNIQUE conflict, fetch the existing row instead.
        result = supabase.table("discovered_documents").insert(row_in).execute()
        if result.data:
            return _row_to_model(result.data[0])
    except Exception as e:
        # Most likely a UNIQUE (user_id, url) collision — return the existing row.
        logger.info(f"insert failed for {payload.url}, fetching existing: {e}")
        try:
            existing = (
                supabase.table("discovered_documents")
                .select("*")
                .eq("user_id", user_id)
                .eq("url", payload.url)
                .single()
                .execute()
            )
            if existing.data:
                return _row_to_model(existing.data)
        except Exception as e2:
            logger.warning(f"fallback fetch failed: {e2}")

    return None


# ── List ────────────────────────────────────────────────────────────────────

def list_discoveries(
    user_id: str,
    status: Optional[str] = None,
    tag: Optional[str] = None,
    tracked_request_id: Optional[str] = None,
    query: Optional[str] = None,
    limit: int = 200,
) -> list[DiscoveredDocument]:
    """List the user's saved discoveries with optional filters."""
    supabase = _get_supabase()
    if not supabase:
        return []

    try:
        q = (
            supabase.table("discovered_documents")
            .select("*")
            .eq("user_id", user_id)
        )
        if status:
            q = q.eq("status", status)
        if tracked_request_id:
            q = q.eq("tracked_request_id", tracked_request_id)
        if tag:
            q = q.contains("tags", [tag])
        if query:
            q = q.or_(f"title.ilike.%{query}%,description.ilike.%{query}%,note.ilike.%{query}%")
        q = q.order("saved_at", desc=True).limit(limit)
        result = q.execute()
        return [_row_to_model(r) for r in (result.data or [])]
    except Exception as e:
        logger.warning(f"list_discoveries failed for {user_id}: {e}")
        return []


# ── Get one ─────────────────────────────────────────────────────────────────

def get_discovery(user_id: str, discovery_id: str) -> Optional[DiscoveredDocument]:
    supabase = _get_supabase()
    if not supabase:
        return None
    try:
        result = (
            supabase.table("discovered_documents")
            .select("*")
            .eq("id", discovery_id)
            .eq("user_id", user_id)
            .single()
            .execute()
        )
        return _row_to_model(result.data) if result.data else None
    except Exception as e:
        logger.warning(f"get_discovery failed for {discovery_id}: {e}")
        return None


# ── Update ──────────────────────────────────────────────────────────────────

def update_discovery(
    user_id: str, discovery_id: str, payload: UpdateDiscoveryPayload
) -> Optional[DiscoveredDocument]:
    supabase = _get_supabase()
    if not supabase:
        return None

    updates: dict = {}
    if payload.status is not None:
        updates["status"] = payload.status
    if payload.note is not None:
        updates["note"] = payload.note[:2000]
    if payload.tags is not None:
        updates["tags"] = payload.tags
    if payload.tracked_request_id is not None:
        updates["tracked_request_id"] = payload.tracked_request_id or None

    if not updates:
        return get_discovery(user_id, discovery_id)

    try:
        result = (
            supabase.table("discovered_documents")
            .update(updates)
            .eq("id", discovery_id)
            .eq("user_id", user_id)
            .execute()
        )
        if result.data:
            return _row_to_model(result.data[0])
    except Exception as e:
        logger.warning(f"update_discovery failed for {discovery_id}: {e}")
    return None


# ── Delete ──────────────────────────────────────────────────────────────────

def delete_discovery(user_id: str, discovery_id: str) -> bool:
    supabase = _get_supabase()
    if not supabase:
        return False
    try:
        supabase.table("discovered_documents").delete().eq("id", discovery_id).eq(
            "user_id", user_id
        ).execute()
        return True
    except Exception as e:
        logger.warning(f"delete_discovery failed for {discovery_id}: {e}")
        return False


# ── Chat tool helper ────────────────────────────────────────────────────────

def search_my_discoveries_for_chat(
    user_id: str,
    query: str = "",
    status: str = "",
    tag: str = "",
    days: int = 30,
    limit: int = 10,
) -> list[dict]:
    """Compact dict variant of list_discoveries used by the chat tool.

    Includes the AI-generated description (the summary captured at save time)
    so Claude can answer questions about what's in a saved document without
    a separate fetch.
    """
    rows = list_discoveries(
        user_id=user_id,
        status=status or None,
        tag=tag or None,
        query=query or None,
        limit=limit,
    )
    out: list[dict] = []
    for r in rows:
        out.append(
            {
                "id": r.id,
                "title": r.title,
                "source": r.source,
                "url": r.url,
                "agency": r.agency,
                "description": r.description,           # AI summary captured at save time
                "document_date": r.document_date.isoformat() if r.document_date else None,
                "status": r.status,
                "tags": r.tags,
                "note": r.note,                          # full note, not truncated
                "saved_at": r.saved_at.isoformat() if r.saved_at else None,
            }
        )
    # Lightweight client-side recency filter (the table doesn't index by `days`)
    if days and days > 0:
        from datetime import datetime, timedelta, timezone
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)
        out = [d for d in out if d.get("saved_at") and d["saved_at"] >= cutoff.isoformat()]
    return out


# ── Read-saved-document chat tool helper ────────────────────────────────────

async def read_saved_document_for_chat(
    user_id: str,
    title_or_url: str = "",
    document_id: str = "",
) -> dict:
    """Fetch a single saved document by ID (exact, preferred), URL (exact),
    or title (fuzzy match), then attempt to extract full text content from
    the source URL via Tavily.

    Returns: title, source, url, description (AI summary), user_note, status,
    extracted_content (the full text of the document if Tavily extract succeeded),
    or an error message.
    """
    if not user_id:
        return {"error": "Missing user_id"}
    if not document_id and not title_or_url:
        return {"error": "Need either a document ID or a title/URL to look up."}

    supabase = _get_supabase()
    if not supabase:
        return {"error": "Database unavailable"}

    # Look up in priority order: exact ID → exact URL → fuzzy title
    doc = None
    try:
        # 1. Exact ID match (guaranteed hit if the ID came from search_my_discoveries)
        if document_id:
            r = (
                supabase.table("discovered_documents")
                .select("*")
                .eq("id", document_id)
                .eq("user_id", user_id)
                .limit(1)
                .execute()
            )
            if r.data:
                doc = _row_to_model(r.data[0])

        # 2. Exact URL match
        if not doc and title_or_url and title_or_url.startswith("http"):
            r = (
                supabase.table("discovered_documents")
                .select("*")
                .eq("user_id", user_id)
                .eq("url", title_or_url)
                .limit(1)
                .execute()
            )
            if r.data:
                doc = _row_to_model(r.data[0])

        # 3. Fuzzy title match (fallback)
        if not doc and title_or_url:
            r = (
                supabase.table("discovered_documents")
                .select("*")
                .eq("user_id", user_id)
                .ilike("title", f"%{title_or_url}%")
                .limit(1)
                .execute()
            )
            if r.data:
                doc = _row_to_model(r.data[0])
    except Exception as e:
        logger.warning(f"read_saved_document lookup failed: {e}")
        return {"error": f"Lookup failed: {e}"}

    if not doc:
        return {
            "error": "No saved document matched.",
            "hint": "Try a more specific title or paste the exact URL.",
        }

    # Try to fetch full content via Tavily extract
    extracted_content = None
    extract_error = None
    try:
        from app.config import settings
        if settings.tavily_api_key:
            from tavily import AsyncTavilyClient
            client = AsyncTavilyClient(api_key=settings.tavily_api_key)
            try:
                resp = await client.extract(urls=[doc.url])
                results = resp.get("results", []) if isinstance(resp, dict) else []
                if results:
                    raw = results[0].get("raw_content", "")
                    if raw:
                        # Cap at ~12k chars so we don't blow Claude's context
                        extracted_content = raw[:12000]
            except Exception as e:
                extract_error = str(e)[:200]
    except Exception as e:
        extract_error = str(e)[:200]

    return {
        "title": doc.title,
        "source": doc.source,
        "url": doc.url,
        "agency": doc.agency,
        "document_date": doc.document_date.isoformat() if doc.document_date else None,
        "ai_summary": doc.description,         # the AI-generated summary captured at save time
        "user_note": doc.note,
        "status": doc.status,
        "tags": doc.tags,
        "extracted_content": extracted_content,
        "extract_error": extract_error,
        "extract_note": (
            "extracted_content is the full text of the document fetched live from the source URL."
            if extracted_content
            else "Full document text could not be fetched. Use ai_summary + user_note to answer."
        ),
    }
