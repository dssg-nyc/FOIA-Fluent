from datetime import date

from fastapi import APIRouter, HTTPException

from app.config import settings
from app.models.tracking import (
    AddCommunicationPayload,
    AnalyzeResponsePayload,
    GeneratedLetter,
    GenerateLetterPayload,
    TrackedRequest,
    TrackedRequestDetail,
    TrackRequestPayload,
    UpdateRequestPayload,
)
from app.services import request_store as store
from app.services.deadline_calculator import get_deadline_info
from app.services.letter_generator import LetterGenerator
from app.services.response_analyzer import ResponseAnalyzer

router = APIRouter(tags=["tracking"])


def _build_detail(request: TrackedRequest) -> TrackedRequestDetail:
    comms = store.get_communications(request.id)
    deadline = get_deadline_info(request)
    analysis = store.get_analysis(request.id)
    return TrackedRequestDetail(
        request=request,
        communications=comms,
        deadline=deadline,
        analysis=analysis,
    )


# ── Requests ──────────────────────────────────────────────────────────────────

@router.post("/tracking/requests", response_model=TrackedRequestDetail)
async def create_request(body: TrackRequestPayload):
    """Save a tracked FOIA request (called from the draft wizard)."""
    req = store.create_request(body)
    return _build_detail(req)


@router.get("/tracking/requests", response_model=list[TrackedRequestDetail])
async def list_requests():
    """List all tracked requests with deadline info."""
    requests = store.list_requests()
    return [_build_detail(r) for r in requests]


@router.get("/tracking/requests/{request_id}", response_model=TrackedRequestDetail)
async def get_request(request_id: str):
    req = store.get_request(request_id)
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")
    return _build_detail(req)


@router.put("/tracking/requests/{request_id}", response_model=TrackedRequestDetail)
async def update_request(request_id: str, body: UpdateRequestPayload):
    req = store.update_request(request_id, body)
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")
    return _build_detail(req)


@router.delete("/tracking/requests/{request_id}")
async def delete_request(request_id: str):
    success = store.delete_request(request_id)
    if not success:
        raise HTTPException(status_code=404, detail="Request not found")
    return {"deleted": True}


# ── Communications ────────────────────────────────────────────────────────────

@router.post("/tracking/requests/{request_id}/communications")
async def add_communication(request_id: str, body: AddCommunicationPayload):
    comm = store.add_communication(request_id, body)
    if not comm:
        raise HTTPException(status_code=404, detail="Request not found")
    return comm


# ── Response analysis ─────────────────────────────────────────────────────────

@router.post("/tracking/requests/{request_id}/analyze-response")
async def analyze_response(request_id: str, body: AnalyzeResponsePayload):
    req = store.get_request(request_id)
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")

    analyzer = ResponseAnalyzer(anthropic_api_key=settings.anthropic_api_key)
    try:
        analysis = await analyzer.analyze(req, body.response_text, body.response_date)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Analysis failed: {e}")

    store.save_analysis(analysis)

    # Log the incoming response as a communication
    store.add_communication(
        request_id,
        AddCommunicationPayload(
            direction="incoming",
            comm_type="response",
            subject=f"Agency response — {body.response_date}",
            body=body.response_text,
            date=body.response_date,
        ),
    )

    return analysis


# ── Letter generation ─────────────────────────────────────────────────────────

@router.post("/tracking/requests/{request_id}/generate-letter", response_model=GeneratedLetter)
async def generate_letter(request_id: str, body: GenerateLetterPayload):
    req = store.get_request(request_id)
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")

    generator = LetterGenerator(anthropic_api_key=settings.anthropic_api_key)

    if body.letter_type == "follow_up":
        deadline = get_deadline_info(req)
        if not deadline:
            raise HTTPException(status_code=400, detail="Request has no filed date — cannot generate follow-up")
        try:
            letter_text = await generator.generate_follow_up(req, deadline)
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Letter generation failed: {e}")

    elif body.letter_type == "appeal":
        analysis = store.get_analysis(request_id)
        if not analysis:
            raise HTTPException(status_code=400, detail="No response analysis found — analyze the response first")
        try:
            letter_text = await generator.generate_appeal(req, analysis, body.context)
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Letter generation failed: {e}")

    else:
        raise HTTPException(status_code=400, detail=f"Unknown letter_type: {body.letter_type}")

    # Auto-log the generated letter as an outgoing communication
    today = date.today().isoformat()
    comm = store.add_communication(
        request_id,
        AddCommunicationPayload(
            direction="outgoing",
            comm_type=body.letter_type,
            subject=f"{'Follow-up' if body.letter_type == 'follow_up' else 'Appeal'} letter — {today}",
            body=letter_text,
            date=today,
        ),
    )

    # Advance status for appeal
    if body.letter_type == "appeal":
        store.update_request(request_id, UpdateRequestPayload(status="appealed"))

    return GeneratedLetter(
        letter_type=body.letter_type,
        letter_text=letter_text,
        comm_id=comm.id if comm else "",
    )
