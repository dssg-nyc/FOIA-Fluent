"""Supabase-backed persistence for tracked FOIA requests.

Replaces request_store.py for deployed environments.
Same interface as request_store.py — all callers can swap by changing their import.

Falls back gracefully: if Supabase is not configured, all methods raise RuntimeError
with a clear message rather than silently failing.
"""
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from app.models.tracking import (
    AddCommunicationPayload,
    Communication,
    ResponseAnalysis,
    TrackedRequest,
    TrackRequestPayload,
    UpdateCommunicationPayload,
    UpdateRequestPayload,
)
from app.services.agency_profiles import _get_supabase

logger = logging.getLogger(__name__)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _require_supabase():
    sb = _get_supabase()
    if not sb:
        raise RuntimeError(
            "Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_KEY."
        )
    return sb


def _row_to_request(row: dict) -> TrackedRequest:
    """Convert a Supabase row dict to a TrackedRequest model."""
    return TrackedRequest(**row)


def _row_to_communication(row: dict) -> Communication:
    return Communication(**row)


def _row_to_analysis(row: dict) -> ResponseAnalysis:
    return ResponseAnalysis(**row)


# ── Requests ──────────────────────────────────────────────────────────────────

def list_requests(user_id: str) -> list[TrackedRequest]:
    sb = _require_supabase()
    result = (
        sb.table("tracked_requests")
        .select("*")
        .eq("user_id", user_id)
        .order("updated_at", desc=True)
        .execute()
    )
    return [_row_to_request(r) for r in (result.data or [])]


def get_request(request_id: str, user_id: str) -> Optional[TrackedRequest]:
    sb = _require_supabase()
    result = (
        sb.table("tracked_requests")
        .select("*")
        .eq("id", request_id)
        .eq("user_id", user_id)
        .single()
        .execute()
    )
    return _row_to_request(result.data) if result.data else None


def create_request(payload: TrackRequestPayload, user_id: str) -> TrackedRequest:
    sb = _require_supabase()
    now = _now()
    request_id = str(uuid.uuid4())

    row = {
        "id": request_id,
        "user_id": user_id,
        "title": payload.title,
        "description": payload.description,
        "agency": payload.agency.model_dump(),
        "letter_text": payload.letter_text,
        "requester_name": payload.requester_name,
        "requester_organization": payload.requester_organization or "",
        "status": "draft" if not payload.filed_date else "awaiting_response",
        "filed_date": payload.filed_date,
        "created_at": now,
        "updated_at": now,
        # Research context
        "statute_cited": payload.statute_cited,
        "key_elements": payload.key_elements,
        "tips": payload.tips,
        "submission_info": payload.submission_info,
        "similar_requests": [s.model_dump() for s in payload.similar_requests],
        "drafting_strategy": payload.drafting_strategy.model_dump(),
        "agency_intel": payload.agency_intel.model_dump(),
        "discovery_results": payload.discovery_results,
    }

    result = sb.table("tracked_requests").insert(row).execute()
    return _row_to_request(result.data[0])


def update_request(request_id: str, payload: UpdateRequestPayload, user_id: str) -> Optional[TrackedRequest]:
    sb = _require_supabase()
    updates = payload.model_dump(exclude_none=True)
    updates["updated_at"] = _now()

    # Auto-advance status when filed_date is set
    if "filed_date" in updates:
        # Check current status
        current = get_request(request_id, user_id)
        if current and current.status == "draft":
            updates["status"] = "awaiting_response"

    result = (
        sb.table("tracked_requests")
        .update(updates)
        .eq("id", request_id)
        .eq("user_id", user_id)
        .execute()
    )
    return _row_to_request(result.data[0]) if result.data else None


def delete_request(request_id: str, user_id: str) -> bool:
    sb = _require_supabase()
    result = (
        sb.table("tracked_requests")
        .delete()
        .eq("id", request_id)
        .eq("user_id", user_id)
        .execute()
    )
    return bool(result.data)


# ── Communications ─────────────────────────────────────────────────────────────

def get_communications(request_id: str, user_id: str) -> list[Communication]:
    sb = _require_supabase()
    # RLS ensures only the request owner's communications are returned
    result = (
        sb.table("communications")
        .select("*")
        .eq("request_id", request_id)
        .order("date", desc=False)
        .execute()
    )
    return [_row_to_communication(r) for r in (result.data or [])]


def add_communication(request_id: str, payload: AddCommunicationPayload, user_id: str) -> Optional[Communication]:
    sb = _require_supabase()

    # Verify the request belongs to this user
    if not get_request(request_id, user_id):
        return None

    comm_id = str(uuid.uuid4())
    now = _now()

    row = {
        "id": comm_id,
        "request_id": request_id,
        "direction": payload.direction,
        "comm_type": payload.comm_type,
        "subject": payload.subject or "",
        "body": payload.body,
        "date": payload.date,
        "created_at": now,
    }

    result = sb.table("communications").insert(row).execute()

    # Touch updated_at on the request
    sb.table("tracked_requests").update({"updated_at": now}).eq("id", request_id).execute()

    return _row_to_communication(result.data[0]) if result.data else None


def update_communication(comm_id: str, request_id: str, payload: UpdateCommunicationPayload, user_id: str) -> Optional[Communication]:
    sb = _require_supabase()
    if not get_request(request_id, user_id):
        return None
    updates = payload.model_dump(exclude_none=True)
    if not updates:
        return None
    result = (
        sb.table("communications")
        .update(updates)
        .eq("id", comm_id)
        .eq("request_id", request_id)
        .execute()
    )
    if result.data:
        sb.table("tracked_requests").update({"updated_at": _now()}).eq("id", request_id).execute()
        return _row_to_communication(result.data[0])
    return None


def delete_communication(comm_id: str, request_id: str, user_id: str) -> bool:
    sb = _require_supabase()
    req = get_request(request_id, user_id)
    if not req:
        return False

    # Delete any linked analysis first (before FK sets it to NULL)
    sb.table("response_analyses").delete().eq("communication_id", comm_id).execute()

    result = (
        sb.table("communications")
        .delete()
        .eq("id", comm_id)
        .eq("request_id", request_id)
        .execute()
    )
    if result.data:
        # Recalculate request status from remaining analyses
        remaining = get_all_analyses(request_id, user_id)
        if remaining:
            latest = remaining[-1]
            if latest.recommended_action == "accept":
                new_status = "fulfilled"
            elif latest.recommended_action == "appeal":
                new_status = "denied"
            else:
                new_status = "responded"
        else:
            # No analyses left — revert based on whether request was filed
            new_status = "awaiting_response" if req.filed_date else "draft"

        sb.table("tracked_requests").update({
            "status": new_status,
            "updated_at": _now(),
        }).eq("id", request_id).eq("user_id", user_id).execute()
    return bool(result.data)


# ── Response analyses ──────────────────────────────────────────────────────────

def save_analysis(analysis: ResponseAnalysis, user_id: str) -> None:
    sb = _require_supabase()

    # Determine new request status from recommended_action
    if analysis.recommended_action == "accept":
        new_status = "fulfilled"
    elif analysis.recommended_action == "appeal":
        new_status = "denied"
    else:
        new_status = "responded"

    row = {
        "request_id": analysis.request_id,
        "communication_id": analysis.communication_id,
        "response_complete": analysis.response_complete,
        "exemptions_cited": analysis.exemptions_cited,
        "exemptions_valid": analysis.exemptions_valid,
        "missing_records": analysis.missing_records,
        "grounds_for_appeal": analysis.grounds_for_appeal,
        "recommended_action": analysis.recommended_action,
        "summary": analysis.summary,
        "analyzed_at": analysis.analyzed_at,
    }

    sb.table("response_analyses").insert(row).execute()

    # Advance request status
    now = _now()
    sb.table("tracked_requests").update({
        "status": new_status,
        "updated_at": now,
    }).eq("id", analysis.request_id).eq("user_id", user_id).execute()


def get_analysis(request_id: str, user_id: str) -> Optional[ResponseAnalysis]:
    sb = _require_supabase()
    result = (
        sb.table("response_analyses")
        .select("*")
        .eq("request_id", request_id)
        .order("analyzed_at", desc=True)
        .limit(1)
        .execute()
    )
    return _row_to_analysis(result.data[0]) if result.data else None


def get_all_analyses(request_id: str, user_id: str) -> list[ResponseAnalysis]:
    """Return all analyses for a request, oldest first."""
    sb = _require_supabase()
    result = (
        sb.table("response_analyses")
        .select("*")
        .eq("request_id", request_id)
        .order("analyzed_at", desc=False)
        .execute()
    )
    return [_row_to_analysis(r) for r in (result.data or [])]
