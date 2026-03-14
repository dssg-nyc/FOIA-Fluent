from pydantic import BaseModel


class AgencyStats(BaseModel):
    id: int
    name: str
    slug: str
    jurisdiction: str = ""
    absolute_url: str = ""
    average_response_time: float = 0
    fee_rate: float = 0
    success_rate: float = 0
    number_requests: int = 0
    number_requests_completed: int = 0
    number_requests_rejected: int = 0
    number_requests_no_docs: int = 0
    number_requests_ack: int = 0
    number_requests_resp: int = 0
    number_requests_fix: int = 0
    number_requests_appeal: int = 0
    number_requests_pay: int = 0
    number_requests_partial: int = 0
    number_requests_lawsuit: int = 0
    number_requests_withdrawn: int = 0
    has_portal: bool = False
    transparency_score: float = 0
    refreshed_at: str = ""


class GlobalStats(BaseModel):
    total_agencies: int
    total_requests: int
    total_completed: int
    total_rejected: int
    total_no_docs: int = 0
    total_partial: int = 0
    total_appeal: int = 0
    total_withdrawn: int = 0
    total_in_progress: int = 0
    overall_success_rate: float
    median_response_time: float
    portal_coverage_pct: float
    top_agencies: list[AgencyStats]
    bottom_agencies: list[AgencyStats]
    last_refreshed: str | None = None


class AgencyDetail(BaseModel):
    stats: AgencyStats
    percentile: float = 0       # "better than X% of agencies"
    denial_patterns: list[dict] = []
    success_patterns: list[dict] = []
    exemption_patterns: list[dict] = []


class AgencyPageResponse(BaseModel):
    agencies: list[AgencyStats]
    total: int
    page: int
    page_size: int
    last_refreshed: str | None = None
