"""Pydantic models for the Auto-File submission agent (Phase 1: email-only).

Every FOIA filing attempt is a SubmissionRun that transitions through a state
machine: queued → submitting → (succeeded | failed | cancelled). A 30-minute
QA window separates `queued_at` from `sends_at` so the user can cancel.
"""
from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


# ── Channel metadata on an agency profile ───────────────────────────────────

SubmissionChannelType = Literal[
    "foia_gov_api",     # standardized REST POST (Phase 1.5, opportunistic)
    "email",            # outbound via Resend, per-request reply-to
    "portal",           # browser automation required (Phase 2)
    "mail",             # physical mail (user prints and sends)
]


class SubmissionChannel(BaseModel):
    """One channel declared by an agency. Priority 1 = preferred."""
    type: SubmissionChannelType
    endpoint: str               # email address, API URL, or portal URL
    priority: int = 1
    notes: str = ""


# ── Submission run (filing attempt) ─────────────────────────────────────────

SubmissionStatus = Literal[
    "queued",           # awaiting 30-min QA hold; user can cancel
    "submitting",       # cron picked up, actively filing
    "awaiting_user",    # paused for CAPTCHA/notary/login (Phase 2+)
    "succeeded",        # confirmation received
    "failed",           # terminal failure
    "cancelled",        # user cancelled during QA window
]


class SubmissionLogEntry(BaseModel):
    """One step in the agent's audit trail."""
    ts: datetime
    level: Literal["info", "warn", "error"] = "info"
    action: str                 # e.g. "channel_selected", "email_sent", "confirmation_parsed"
    detail: dict[str, Any] = Field(default_factory=dict)


class SubmissionRun(BaseModel):
    id: str
    request_id: str
    user_id: str
    channel: SubmissionChannelType
    status: SubmissionStatus
    queued_at: datetime
    sends_at: Optional[datetime] = None
    submitted_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    agency_tracking_number: Optional[str] = None
    receipt: dict[str, Any] = Field(default_factory=dict)
    log: list[SubmissionLogEntry] = Field(default_factory=list)
    error: Optional[str] = None
    cancel_reason: Optional[str] = None


# ── Route payloads ──────────────────────────────────────────────────────────

class QueueSubmissionPayload(BaseModel):
    """POST /api/v1/submissions/queue body."""
    request_id: str
    # Optional channel override. If omitted, the submitter picks the
    # highest-priority channel the agency supports.
    channel_override: Optional[SubmissionChannelType] = None
    # If true, skip the 30-minute QA window. False by default (user must
    # explicitly opt in; we don't want accidental instant sends).
    send_immediately: bool = False


class CancelSubmissionPayload(BaseModel):
    reason: str = ""


class QueueSubmissionResponse(BaseModel):
    run: SubmissionRun
    # Helpful summary for the frontend: how long until send, what channel was
    # chosen, what agency contact we landed on.
    channel_summary: str        # e.g. "Email · foia@epa.gov"
    seconds_until_send: int
