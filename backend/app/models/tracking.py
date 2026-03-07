from typing import Optional
from pydantic import BaseModel

from app.models.draft import AgencyInfo, AgencyIntel, DraftingStrategy, SimilarRequest


# ── Core entities ─────────────────────────────────────────────────────────────

class Communication(BaseModel):
    id: str
    request_id: str
    direction: str          # "outgoing" | "incoming"
    comm_type: str          # "initial_request" | "follow_up" | "response" | "appeal" | "acknowledgment" | "other"
    subject: str = ""
    body: str
    date: str               # ISO date (YYYY-MM-DD)
    created_at: str


class TrackedRequest(BaseModel):
    id: str
    title: str
    description: str
    agency: AgencyInfo
    letter_text: str
    requester_name: str
    requester_organization: str = ""
    status: str = "draft"   # draft | submitted | awaiting_response | responded | partial | denied | appealed | fulfilled
    filed_date: Optional[str] = None    # ISO date
    due_date: Optional[str] = None      # ISO date (computed)
    created_at: str
    updated_at: str
    # Research context (Phase 1 + 2 intelligence, preserved for reference)
    statute_cited: str = ""
    key_elements: list[str] = []
    tips: list[str] = []
    submission_info: str = ""
    similar_requests: list[SimilarRequest] = []
    drafting_strategy: DraftingStrategy = DraftingStrategy()
    agency_intel: AgencyIntel = AgencyIntel()
    discovery_results: list[dict] = []


class ResponseAnalysis(BaseModel):
    request_id: str
    response_complete: bool
    exemptions_cited: list[str] = []
    exemptions_valid: list[dict] = []   # [{exemption, assessment, reasoning}]
    missing_records: list[str] = []
    grounds_for_appeal: list[str] = []
    recommended_action: str             # "accept" | "follow_up" | "appeal" | "negotiate_scope"
    summary: str
    analyzed_at: str


class DeadlineInfo(BaseModel):
    request_id: str
    filed_date: str
    due_date: str
    business_days_elapsed: int
    business_days_remaining: int
    is_overdue: bool
    status_label: str       # e.g. "Day 14 of 20", "OVERDUE by 5 business days"


# ── Request payloads ──────────────────────────────────────────────────────────

class TrackRequestPayload(BaseModel):
    title: str
    description: str
    agency: AgencyInfo
    letter_text: str
    requester_name: str
    requester_organization: str = ""
    filed_date: Optional[str] = None
    # Research context (Phase 1 + 2 intelligence)
    statute_cited: str = ""
    key_elements: list[str] = []
    tips: list[str] = []
    submission_info: str = ""
    similar_requests: list[SimilarRequest] = []
    drafting_strategy: DraftingStrategy = DraftingStrategy()
    agency_intel: AgencyIntel = AgencyIntel()
    discovery_results: list[dict] = []


class UpdateRequestPayload(BaseModel):
    title: Optional[str] = None
    status: Optional[str] = None
    filed_date: Optional[str] = None
    description: Optional[str] = None


class AddCommunicationPayload(BaseModel):
    direction: str
    comm_type: str
    subject: str = ""
    body: str
    date: str


class AnalyzeResponsePayload(BaseModel):
    response_text: str
    response_date: str


class GenerateLetterPayload(BaseModel):
    letter_type: str        # "follow_up" | "appeal"
    context: str = ""


# ── Response shapes ────────────────────────────────────────────────────────────

class TrackedRequestDetail(BaseModel):
    """Full request with communications and deadline info."""
    request: TrackedRequest
    communications: list[Communication] = []
    deadline: Optional[DeadlineInfo] = None
    analysis: Optional[ResponseAnalysis] = None


class GeneratedLetter(BaseModel):
    letter_type: str
    letter_text: str
    comm_id: str            # The communication log entry that was auto-created
