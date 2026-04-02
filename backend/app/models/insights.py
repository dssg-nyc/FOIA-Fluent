from pydantic import BaseModel


class HeroStats(BaseModel):
    latest_year: int = 0
    total_received: int = 0
    total_processed: int = 0
    total_backlog: int = 0
    total_costs: float = 0
    total_staff_fte: float = 0
    yoy_received_pct: float = 0  # year-over-year change
    yoy_backlog_pct: float = 0


class VolumeTrend(BaseModel):
    year: int
    received: int = 0
    processed: int = 0
    backlog: int = 0


class TransparencyTrend(BaseModel):
    year: int
    full_grant_rate: float = 0
    partial_grant_rate: float = 0
    denial_rate: float = 0


class AgencyRequests(BaseModel):
    name: str
    requests_received: int = 0


class ExemptionItem(BaseModel):
    code: str
    name: str
    count: int = 0
    description: str = ""


class ProcessingTimeTrend(BaseModel):
    year: int
    median_simple: float = 0
    median_complex: float = 0


class CostStaffingTrend(BaseModel):
    year: int
    total_costs: float = 0
    staff_fte: float = 0
    cost_per_request: float = 0


class AppealsLitigationTrend(BaseModel):
    year: int
    appeals: int = 0
    litigation: int = 0
    overturn_rate: float = 0


class NewsDigestItem(BaseModel):
    title: str
    summary: str
    source_url: str = ""
    source_name: str = ""
    category: str = ""
    published_date: str | None = None


class InsightsOverview(BaseModel):
    hero_stats: HeroStats
    volume_trends: list[VolumeTrend] = []
    transparency_trends: list[TransparencyTrend] = []
    top_agencies: list[AgencyRequests] = []
    requester_types: dict = {}
    exemption_breakdown: list[ExemptionItem] = []
    processing_times: list[ProcessingTimeTrend] = []
    costs_staffing: list[CostStaffingTrend] = []
    appeals_litigation: list[AppealsLitigationTrend] = []
    news_digest: list[NewsDigestItem] = []
    last_refreshed: str | None = None
