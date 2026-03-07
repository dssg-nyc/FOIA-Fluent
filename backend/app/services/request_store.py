"""JSON-backed persistence for tracked FOIA requests.

Follows the same atomic-write pattern as agency_intel.py.
Swappable for Supabase later — only this module touches the file.
"""
import json
import logging
import os
import tempfile
import uuid
from datetime import datetime, timezone
from typing import Optional

from app.models.tracking import (
    AddCommunicationPayload,
    Communication,
    ResponseAnalysis,
    TrackedRequest,
    TrackRequestPayload,
    UpdateRequestPayload,
)

logger = logging.getLogger(__name__)

STORE_FILE = os.path.join(
    os.path.dirname(os.path.dirname(__file__)), "data", "tracked_requests.json"
)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _load() -> dict:
    if not os.path.exists(STORE_FILE):
        return {"requests": {}, "communications": {}, "analyses": {}}
    try:
        with open(STORE_FILE, "r") as f:
            return json.load(f)
    except Exception:
        return {"requests": {}, "communications": {}, "analyses": {}}


def _save(data: dict) -> None:
    os.makedirs(os.path.dirname(STORE_FILE), exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(STORE_FILE))
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(data, f, indent=2)
        os.replace(tmp, STORE_FILE)
    except Exception:
        try:
            os.unlink(tmp)
        except Exception:
            pass
        raise


# ── Requests ──────────────────────────────────────────────────────────────────

def list_requests() -> list[TrackedRequest]:
    data = _load()
    return [TrackedRequest(**r) for r in data["requests"].values()]


def get_request(request_id: str) -> Optional[TrackedRequest]:
    data = _load()
    raw = data["requests"].get(request_id)
    return TrackedRequest(**raw) if raw else None


def create_request(payload: TrackRequestPayload) -> TrackedRequest:
    data = _load()
    now = _now()
    request_id = str(uuid.uuid4())

    req = TrackedRequest(
        id=request_id,
        title=payload.title,
        description=payload.description,
        agency=payload.agency,
        letter_text=payload.letter_text,
        requester_name=payload.requester_name,
        requester_organization=payload.requester_organization,
        status="draft" if not payload.filed_date else "awaiting_response",
        filed_date=payload.filed_date,
        created_at=now,
        updated_at=now,
        statute_cited=payload.statute_cited,
        key_elements=payload.key_elements,
        tips=payload.tips,
        submission_info=payload.submission_info,
        similar_requests=payload.similar_requests,
        drafting_strategy=payload.drafting_strategy,
        agency_intel=payload.agency_intel,
        discovery_results=payload.discovery_results,
    )

    data["requests"][request_id] = req.model_dump()
    _save(data)
    return req


def update_request(request_id: str, payload: UpdateRequestPayload) -> Optional[TrackedRequest]:
    data = _load()
    raw = data["requests"].get(request_id)
    if not raw:
        return None

    updates = payload.model_dump(exclude_none=True)
    raw.update(updates)
    raw["updated_at"] = _now()

    # Auto-advance status when filed_date is set
    if "filed_date" in updates and raw.get("status") == "draft":
        raw["status"] = "awaiting_response"

    data["requests"][request_id] = raw
    _save(data)
    return TrackedRequest(**raw)


def delete_request(request_id: str) -> bool:
    data = _load()
    if request_id not in data["requests"]:
        return False
    del data["requests"][request_id]
    data["communications"].pop(request_id, None)
    data["analyses"].pop(request_id, None)
    _save(data)
    return True


# ── Communications ────────────────────────────────────────────────────────────

def get_communications(request_id: str) -> list[Communication]:
    data = _load()
    comms = data["communications"].get(request_id, [])
    return [Communication(**c) for c in comms]


def add_communication(request_id: str, payload: AddCommunicationPayload) -> Optional[Communication]:
    data = _load()
    if request_id not in data["requests"]:
        return None

    comm = Communication(
        id=str(uuid.uuid4()),
        request_id=request_id,
        direction=payload.direction,
        comm_type=payload.comm_type,
        subject=payload.subject,
        body=payload.body,
        date=payload.date,
        created_at=_now(),
    )

    if request_id not in data["communications"]:
        data["communications"][request_id] = []
    data["communications"][request_id].append(comm.model_dump())

    # Update request's updated_at
    if request_id in data["requests"]:
        data["requests"][request_id]["updated_at"] = _now()

    _save(data)
    return comm


# ── Response analysis ─────────────────────────────────────────────────────────

def save_analysis(analysis: ResponseAnalysis) -> None:
    data = _load()
    data["analyses"][analysis.request_id] = analysis.model_dump()
    # Advance request status
    req = data["requests"].get(analysis.request_id)
    if req:
        if analysis.recommended_action == "accept":
            req["status"] = "fulfilled"
        elif analysis.recommended_action == "appeal":
            req["status"] = "denied"
        else:
            req["status"] = "responded"
        req["updated_at"] = _now()
    _save(data)


def get_analysis(request_id: str) -> Optional[ResponseAnalysis]:
    data = _load()
    raw = data["analyses"].get(request_id)
    return ResponseAnalysis(**raw) if raw else None
