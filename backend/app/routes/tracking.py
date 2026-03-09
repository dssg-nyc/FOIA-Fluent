import logging
from datetime import date

from fastapi import APIRouter, Depends, HTTPException

logger = logging.getLogger(__name__)

from app.config import settings
from app.middleware.auth import get_current_user_id
from app.models.tracking import (
    AddCommunicationPayload,
    AnalyzeResponsePayload,
    Communication,
    GeneratedLetter,
    GenerateLetterPayload,
    ImportRequestPayload,
    ResponseAnalysis,
    TrackedRequest,
    TrackedRequestDetail,
    TrackRequestPayload,
    UpdateRequestPayload,
)
from app.services.deadline_calculator import get_deadline_info
from app.services.letter_generator import LetterGenerator
from app.services.response_analyzer import ResponseAnalyzer

router = APIRouter(tags=["tracking"])


# ── Store dispatcher ──────────────────────────────────────────────────────────
# Routes to supabase_store when Supabase is configured, else request_store.
# request_store doesn't use user_id (all requests are in one file);
# supabase_store requires user_id for RLS isolation.

def _list_requests(user_id: str) -> list[TrackedRequest]:
    if settings.supabase_url:
        from app.services import supabase_store as s
        return s.list_requests(user_id)
    from app.services import request_store as s
    return s.list_requests()

def _get_request(request_id: str, user_id: str):
    if settings.supabase_url:
        from app.services import supabase_store as s
        return s.get_request(request_id, user_id)
    from app.services import request_store as s
    return s.get_request(request_id)

def _create_request(payload: TrackRequestPayload, user_id: str) -> TrackedRequest:
    if settings.supabase_url:
        from app.services import supabase_store as s
        return s.create_request(payload, user_id)
    from app.services import request_store as s
    return s.create_request(payload)

def _update_request(request_id: str, payload: UpdateRequestPayload, user_id: str):
    if settings.supabase_url:
        from app.services import supabase_store as s
        return s.update_request(request_id, payload, user_id)
    from app.services import request_store as s
    return s.update_request(request_id, payload)

def _delete_request(request_id: str, user_id: str) -> bool:
    if settings.supabase_url:
        from app.services import supabase_store as s
        return s.delete_request(request_id, user_id)
    from app.services import request_store as s
    return s.delete_request(request_id)

def _get_communications(request_id: str, user_id: str) -> list[Communication]:
    if settings.supabase_url:
        from app.services import supabase_store as s
        return s.get_communications(request_id, user_id)
    from app.services import request_store as s
    return s.get_communications(request_id)

def _add_communication(request_id: str, payload: AddCommunicationPayload, user_id: str):
    if settings.supabase_url:
        from app.services import supabase_store as s
        return s.add_communication(request_id, payload, user_id)
    from app.services import request_store as s
    return s.add_communication(request_id, payload)

def _save_analysis(analysis: ResponseAnalysis, user_id: str) -> None:
    if settings.supabase_url:
        from app.services import supabase_store as s
        s.save_analysis(analysis, user_id)
    else:
        from app.services import request_store as s
        s.save_analysis(analysis)

def _get_analysis(request_id: str, user_id: str):
    if settings.supabase_url:
        from app.services import supabase_store as s
        return s.get_analysis(request_id, user_id)
    from app.services import request_store as s
    return s.get_analysis(request_id)


# ── Detail builder ─────────────────────────────────────────────────────────────

def _build_detail(request: TrackedRequest, user_id: str) -> TrackedRequestDetail:
    comms = _get_communications(request.id, user_id)
    deadline = get_deadline_info(request)
    analysis = _get_analysis(request.id, user_id)
    return TrackedRequestDetail(
        request=request,
        communications=comms,
        deadline=deadline,
        analysis=analysis,
    )


# ── Requests ──────────────────────────────────────────────────────────────────

@router.post("/tracking/requests", response_model=TrackedRequestDetail)
async def create_request(
    body: TrackRequestPayload,
    user_id: str = Depends(get_current_user_id),
):
    """Save a tracked FOIA request (called from the draft wizard)."""
    req = _create_request(body, user_id)
    return _build_detail(req, user_id)


@router.get("/tracking/requests", response_model=list[TrackedRequestDetail])
async def list_requests(user_id: str = Depends(get_current_user_id)):
    """List all tracked requests for the current user with deadline info."""
    requests = _list_requests(user_id)
    return [_build_detail(r, user_id) for r in requests]


@router.get("/tracking/requests/{request_id}", response_model=TrackedRequestDetail)
async def get_request(
    request_id: str,
    user_id: str = Depends(get_current_user_id),
):
    req = _get_request(request_id, user_id)
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")
    return _build_detail(req, user_id)


@router.put("/tracking/requests/{request_id}", response_model=TrackedRequestDetail)
async def update_request(
    request_id: str,
    body: UpdateRequestPayload,
    user_id: str = Depends(get_current_user_id),
):
    req = _update_request(request_id, body, user_id)
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")
    return _build_detail(req, user_id)


@router.delete("/tracking/requests/{request_id}")
async def delete_request(
    request_id: str,
    user_id: str = Depends(get_current_user_id),
):
    success = _delete_request(request_id, user_id)
    if not success:
        raise HTTPException(status_code=404, detail="Request not found")
    return {"deleted": True}


# ── Communications ─────────────────────────────────────────────────────────────

@router.post("/tracking/requests/{request_id}/communications")
async def add_communication(
    request_id: str,
    body: AddCommunicationPayload,
    user_id: str = Depends(get_current_user_id),
):
    comm = _add_communication(request_id, body, user_id)
    if not comm:
        raise HTTPException(status_code=404, detail="Request not found")
    return comm


# ── Response analysis ──────────────────────────────────────────────────────────

@router.post("/tracking/requests/{request_id}/analyze-response")
async def analyze_response(
    request_id: str,
    body: AnalyzeResponsePayload,
    user_id: str = Depends(get_current_user_id),
):
    req = _get_request(request_id, user_id)
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")

    analyzer = ResponseAnalyzer(anthropic_api_key=settings.anthropic_api_key)
    try:
        analysis = await analyzer.analyze(req, body.response_text, body.response_date)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Analysis failed: {e}")

    _save_analysis(analysis, user_id)

    # Log the incoming response as a communication
    _add_communication(
        request_id,
        AddCommunicationPayload(
            direction="incoming",
            comm_type="response",
            subject=f"Agency response — {body.response_date}",
            body=body.response_text,
            date=body.response_date,
        ),
        user_id,
    )

    return analysis


# ── Letter generation ──────────────────────────────────────────────────────────

@router.post("/tracking/requests/{request_id}/generate-letter", response_model=GeneratedLetter)
async def generate_letter(
    request_id: str,
    body: GenerateLetterPayload,
    user_id: str = Depends(get_current_user_id),
):
    req = _get_request(request_id, user_id)
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")

    generator = LetterGenerator(anthropic_api_key=settings.anthropic_api_key)

    if body.letter_type == "follow_up":
        deadline = get_deadline_info(req)
        if not deadline:
            raise HTTPException(
                status_code=400,
                detail="Request has no filed date — cannot generate follow-up",
            )
        try:
            letter_text = await generator.generate_follow_up(req, deadline)
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Letter generation failed: {e}")

    elif body.letter_type == "appeal":
        analysis = _get_analysis(request_id, user_id)
        if not analysis:
            raise HTTPException(
                status_code=400,
                detail="No response analysis found — analyze the response first",
            )
        try:
            letter_text = await generator.generate_appeal(req, analysis, body.context)
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Letter generation failed: {e}")

    else:
        raise HTTPException(status_code=400, detail=f"Unknown letter_type: {body.letter_type}")

    # Auto-log the generated letter as an outgoing communication
    today = date.today().isoformat()
    comm = _add_communication(
        request_id,
        AddCommunicationPayload(
            direction="outgoing",
            comm_type=body.letter_type,
            subject=f"{'Follow-up' if body.letter_type == 'follow_up' else 'Appeal'} letter — {today}",
            body=letter_text,
            date=today,
        ),
        user_id,
    )

    # Advance status for appeal
    if body.letter_type == "appeal":
        _update_request(request_id, UpdateRequestPayload(status="appealed"), user_id)

    return GeneratedLetter(
        letter_type=body.letter_type,
        letter_text=letter_text,
        comm_id=comm.id if comm else "",
    )


# ── Import existing request ─────────────────────────────────────────────────────

@router.post("/tracking/requests/import", response_model=TrackedRequestDetail)
async def import_request(
    body: ImportRequestPayload,
    user_id: str = Depends(get_current_user_id),
):
    """Import an existing FOIA request into the tracking system.

    Runs the full research pipeline (similar requests + agency intel) and analyzes
    the provided letter against that research context. If an existing agency response
    is provided, immediately runs response analysis as well.

    Returns TrackedRequestDetail — same shape as create_request — so the frontend
    can navigate directly to the request detail page.
    """
    from app.services.agency_profiles import get_agency_profile
    from app.models.draft import AgencyInfo
    from app.services.request_analyzer import RequestAnalyzer
    from app.services.response_analyzer import ResponseAnalyzer
    from datetime import datetime, timezone

    # Resolve agency from abbreviation
    agency_data = get_agency_profile(body.agency_abbreviation.upper())
    if not agency_data:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown agency abbreviation: {body.agency_abbreviation}. "
                   "Use /api/v1/draft/agencies to see available agencies.",
        )

    agency = AgencyInfo(
        name=agency_data.get("name", body.agency_abbreviation),
        abbreviation=body.agency_abbreviation.upper(),
        foia_website=agency_data.get("foia_website", ""),
        foia_email=agency_data.get("foia_email", ""),
        jurisdiction=agency_data.get("jurisdiction", "federal"),
        description=agency_data.get("description", ""),
        foia_regulation=agency_data.get("foia_regulation", ""),
        submission_notes=agency_data.get("submission_notes", ""),
        cfr_available=bool(agency_data.get("cfr_text", "")),
    )

    # Run research pipeline + letter analysis concurrently
    analyzer = RequestAnalyzer(
        anthropic_api_key=settings.anthropic_api_key,
        tavily_api_key=settings.tavily_api_key,
    )
    try:
        research = await analyzer.analyze_import(
            letter_text=body.letter_text,
            description=body.description,
            agency=agency,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Letter analysis failed: {e}")

    # Determine initial status
    status = "draft"
    if body.filed_date:
        status = "responded" if body.existing_response else "awaiting_response"

    track_payload = TrackRequestPayload(
        title=body.title,
        description=body.description,
        agency=agency,
        letter_text=body.letter_text,
        requester_name=body.requester_name,
        requester_organization=body.requester_organization,
        filed_date=body.filed_date,
        statute_cited=research["statute_cited"],
        key_elements=research["key_elements"],
        tips=research["tips"],
        submission_info=research["submission_info"],
        similar_requests=research["similar_requests"],
        drafting_strategy=research["drafting_strategy"],
        agency_intel=research["agency_intel"],
        discovery_results=[],
    )

    req = _create_request(track_payload, user_id)

    # Override status (create_request sets draft vs awaiting_response based on filed_date only)
    if req.status != status:
        req = _update_request(req.id, UpdateRequestPayload(status=status), user_id) or req

    # Log the original letter as an outgoing communication
    _add_communication(
        req.id,
        AddCommunicationPayload(
            direction="outgoing",
            comm_type="initial_request",
            subject=f"FOIA Request — {agency.name}",
            body=body.letter_text,
            date=body.filed_date or datetime.now(timezone.utc).date().isoformat(),
        ),
        user_id,
    )

    # If an existing response was provided, analyze it immediately
    if body.existing_response and body.filed_date:
        response_analyzer = ResponseAnalyzer(anthropic_api_key=settings.anthropic_api_key)
        try:
            analysis = await response_analyzer.analyze(
                req, body.existing_response, datetime.now(timezone.utc).date().isoformat()
            )
            _save_analysis(analysis, user_id)
            _add_communication(
                req.id,
                AddCommunicationPayload(
                    direction="incoming",
                    comm_type="response",
                    subject=f"Agency response — {agency.name}",
                    body=body.existing_response,
                    date=datetime.now(timezone.utc).date().isoformat(),
                ),
                user_id,
            )
        except Exception as e:
            logger.warning(f"Response analysis failed during import: {e}")

    return _build_detail(req, user_id)
