from pydantic import BaseModel

from app.models.draft import AgencyInfo, AgencyIntel, SimilarRequest


# ── MuckRock API response models ───────────────────────────────────────────────

class FOIARequestResult(BaseModel):
    id: int
    title: str
    slug: str
    status: str = ""
    agency: int | None = None
    datetime_submitted: str | None = None
    date_due: str | None = None
    datetime_done: str | None = None
    tracking_id: str = ""
    username: str = ""
    absolute_url: str = ""


class PaginatedResponse(BaseModel):
    count: int
    next: str | None = None
    previous: str | None = None
    results: list[FOIARequestResult]
    query: str = ""


class AgencyResult(BaseModel):
    id: int
    name: str
    slug: str
    status: str = ""
    jurisdiction: int | None = None
    average_response_time: float = 0
    fee_rate: float = 0
    success_rate: float = 0
    number_requests: int = 0
    number_requests_completed: int = 0
    number_requests_rejected: int = 0
    absolute_url: str = ""
    has_portal: bool = False


class AgencyListResponse(BaseModel):
    count: int
    next: str | None = None
    previous: str | None = None
    results: list[AgencyResult]


# ── App search/discovery models ────────────────────────────────────────────────

class SearchRequest(BaseModel):
    query: str


class SearchResult(BaseModel):
    """A unified search result from any source."""

    id: str
    title: str
    status: str = ""  # foia_request, document, public_record
    source: str  # muckrock, documentcloud, web
    url: str
    date: str | None = None
    description: str = ""
    agency: str = ""
    filed_by: str = ""
    page_count: int | None = None


class DiscoveryStep(BaseModel):
    """One step in the discovery pipeline."""

    step: int
    title: str
    description: str
    results: list[SearchResult]
    found: bool  # did this step find relevant results?


class DiscoveryResponse(BaseModel):
    """Full discovery pipeline response."""

    query: str
    intent: str  # Claude's interpretation of what user wants
    agencies: list[str]  # relevant agencies identified
    record_types: list[str]  # types of records to look for
    steps: list[DiscoveryStep]
    recommendation: str  # what the user should do next
    # Auto-identified agency and research (populated during discovery)
    agency: AgencyInfo | None = None
    alternatives: list[AgencyInfo] = []
    agency_reasoning: str = ""
    similar_requests: list[SimilarRequest] = []
    agency_intel: AgencyIntel | None = None
