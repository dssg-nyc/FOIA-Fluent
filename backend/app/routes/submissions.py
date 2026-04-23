"""Submission routes — auto-file orchestration endpoints.

POST   /api/v1/submissions/queue                  queue a filing (30-min QA hold)
DELETE /api/v1/submissions/{run_id}               cancel during QA hold
GET    /api/v1/submissions/{run_id}               fetch a single run
GET    /api/v1/submissions/{run_id}/stream        SSE stream of run status
GET    /api/v1/submissions/by-request/{req_id}    list runs for a request
POST   /api/v1/submissions/inbound                Resend inbound webhook
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse

from app.middleware.auth import get_current_user_id
from app.models.submissions import (
    CancelSubmissionPayload,
    QueueSubmissionPayload,
    QueueSubmissionResponse,
    SubmissionRun,
)
from app.services import submitter

router = APIRouter(prefix="/submissions", tags=["submissions"])

logger = logging.getLogger(__name__)


@router.post("/queue", response_model=QueueSubmissionResponse)
def queue_submission_route(
    payload: QueueSubmissionPayload,
    user_id: str = Depends(get_current_user_id),
):
    """Queue a new submission run with a 30-minute QA hold."""
    result = submitter.queue_submission(
        request_id=payload.request_id,
        user_id=user_id,
        channel_override=payload.channel_override,
        send_immediately=payload.send_immediately,
    )
    if not result:
        raise HTTPException(
            status_code=400,
            detail=(
                "Could not queue submission. Either the request does not exist, "
                "the agency has no supported filing channel, or Supabase is down."
            ),
        )
    return result


@router.delete("/{run_id}", response_model=SubmissionRun)
def cancel_submission_route(
    run_id: str,
    payload: Optional[CancelSubmissionPayload] = None,
    user_id: str = Depends(get_current_user_id),
):
    """Cancel a queued submission. Only works while status = 'queued'
    (i.e. the 30-min QA window hasn't expired yet)."""
    reason = (payload.reason if payload else "") or ""
    run = submitter.cancel_submission(
        run_id=run_id, user_id=user_id, reason=reason
    )
    if not run:
        raise HTTPException(
            status_code=409,
            detail="Run not found, not owned by you, or already being processed.",
        )
    return run


@router.get("/{run_id}", response_model=SubmissionRun)
def get_submission_route(
    run_id: str,
    user_id: str = Depends(get_current_user_id),
):
    run = submitter.get_run(run_id, user_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    return run


@router.get("/by-request/{request_id}", response_model=list[SubmissionRun])
def list_runs_for_request_route(
    request_id: str,
    user_id: str = Depends(get_current_user_id),
):
    return submitter.list_runs_for_request(request_id, user_id)


@router.get("/channel-preview/{request_id}")
def channel_preview_route(
    request_id: str,
    user_id: str = Depends(get_current_user_id),
):
    """Preview which filing channel (if any) would fire for this request.

    Used by the AutoFile card to show either the normal confirm flow
    (email channel available) or a portal-only fallback (no email;
    agency requires manual portal submission — Phase 2 scope).
    """
    preview = submitter.preview_channel(request_id, user_id)
    if not preview:
        raise HTTPException(status_code=404, detail="Request not found")
    return preview


@router.get("/{run_id}/stream")
async def stream_submission_route(
    run_id: str,
    request: Request,
    user_id: str = Depends(get_current_user_id),
):
    """Server-Sent Events stream of a run's state. Emits the full SubmissionRun
    JSON each poll tick (every ~1s) while the run is in a non-terminal state.
    Disconnects cleanly once the run reaches a terminal state."""

    async def event_generator():
        last_status: Optional[str] = None
        last_log_count = -1
        terminal_states = {"succeeded", "failed", "cancelled"}

        while True:
            if await request.is_disconnected():
                break
            run = submitter.get_run(run_id, user_id)
            if not run:
                yield f"event: error\ndata: {json.dumps({'detail': 'run not found'})}\n\n"
                break

            # Only emit when something changed, to keep the wire quiet
            log_count = len(run.log)
            if run.status != last_status or log_count != last_log_count:
                last_status = run.status
                last_log_count = log_count
                yield f"data: {run.model_dump_json()}\n\n"

            if run.status in terminal_states:
                break
            await asyncio.sleep(1)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── Inbound webhook (no auth; Resend signature verification) ────────────────

@router.post("/inbound")
async def inbound_email_route(request: Request):
    """Resend inbound webhook. Called when a reply lands at
    `reply-{request_id}@{domain}`. Payload shape documented at
    https://resend.com/docs/dashboard/webhooks.

    NOTE: signature verification is TODO (simple to add once RESEND_WEBHOOK_SECRET
    is configured — Resend uses HMAC-SHA256 over the raw body with the
    `resend-webhook-signature` header). For Phase 1, we accept any payload
    that matches our `reply-{id}` pattern and idempotently dedupe on
    message content.
    """
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    # Resend wraps the email in {"type": "email.received", "data": {...}}.
    # Extract the inner payload if present.
    data = payload.get("data") if isinstance(payload, dict) else None
    target = data if isinstance(data, dict) else payload

    result = submitter.handle_inbound_reply(target)
    if not result:
        # Log but return 200 so Resend doesn't retry indefinitely for
        # unmatched addresses (e.g. spam hitting our domain).
        logger.info("inbound: no matching request; acknowledging")
        return {"matched": False}

    return {"matched": True, **result}
