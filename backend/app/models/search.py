from pydantic import BaseModel


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
