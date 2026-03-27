from pydantic import BaseModel

from app.models.hub import AgencyStats


class JurisdictionSummary(BaseModel):
    id: int
    name: str
    slug: str
    abbrev: str = ""
    level: str = "state"
    transparency_score: float = 0
    total_agencies: int = 0
    total_requests: int = 0
    overall_success_rate: float = 0
    average_response_time: float = 0
    median_response_time: float = 0
    fee_rate: float = 0
    portal_coverage_pct: float = 0


class StateMapData(BaseModel):
    """All states with scores for choropleth map rendering."""
    states: list[JurisdictionSummary]
    national_avg_score: float = 0
    national_avg_success_rate: float = 0
    national_avg_response_time: float = 0
    total_state_agencies: int = 0
    total_requests: int = 0
    total_completed: int = 0
    total_rejected: int = 0
    total_no_docs: int = 0
    total_partial: int = 0
    total_appeal: int = 0
    total_withdrawn: int = 0
    total_in_progress: int = 0
    overall_success_rate: float = 0
    median_response_time: float = 0
    portal_coverage_pct: float = 0
    top_states: list[JurisdictionSummary] = []
    bottom_states: list[JurisdictionSummary] = []
    last_refreshed: str | None = None


class JurisdictionDetail(BaseModel):
    jurisdiction: JurisdictionSummary
    top_agencies: list[AgencyStats] = []
    bottom_agencies: list[AgencyStats] = []
    total_no_docs: int = 0
    total_partial: int = 0
    total_appeal: int = 0
    total_withdrawn: int = 0
    total_in_progress: int = 0
    percentile: float = 0
