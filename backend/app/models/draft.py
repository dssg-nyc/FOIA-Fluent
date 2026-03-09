from pydantic import BaseModel


class AgencyInfo(BaseModel):
    name: str
    abbreviation: str
    foia_website: str
    foia_email: str
    jurisdiction: str = "federal"
    description: str = ""
    foia_regulation: str = ""
    submission_notes: str = ""
    cfr_available: bool = True  # False when eCFR has no published regulation for this agency


class AgencyIdentifyRequest(BaseModel):
    description: str
    agencies_hint: list[str] = []


class AgencyIdentifyResponse(BaseModel):
    agency: AgencyInfo
    alternatives: list[AgencyInfo]
    reasoning: str


class DraftRequest(BaseModel):
    description: str
    agency: AgencyInfo
    requester_name: str
    requester_organization: str = ""
    fee_waiver: bool = False
    expedited_processing: bool = False
    preferred_format: str = "electronic"


class SimilarRequest(BaseModel):
    title: str
    status: str
    url: str
    description: str = ""


class DraftingStrategy(BaseModel):
    summary: str = ""
    learned_from_successes: str = ""
    avoided_from_denials: str = ""
    scope_decisions: str = ""
    exemption_awareness: str = ""


class AgencyIntel(BaseModel):
    agency_abbreviation: str = ""
    denial_patterns: list[SimilarRequest] = []
    success_patterns: list[SimilarRequest] = []
    exemption_patterns: list[SimilarRequest] = []
    cached_at: str = ""


class DraftResponse(BaseModel):
    letter_text: str
    agency: AgencyInfo
    statute_cited: str
    key_elements: list[str]
    tips: list[str]
    submission_info: str
    similar_requests: list[SimilarRequest] = []
    drafting_strategy: DraftingStrategy = DraftingStrategy()
    agency_intel: AgencyIntel = AgencyIntel()
