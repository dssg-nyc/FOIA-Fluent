"""Pydantic models for the saved discoveries library (Discover & Draft Phase 3)."""
from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, Field


class DiscoveredDocument(BaseModel):
    id: str
    user_id: str
    source: str
    source_id: Optional[str] = None
    title: str
    description: str = ""
    url: str
    document_date: Optional[date] = None
    page_count: Optional[int] = None
    agency: str = ""
    status: str = "saved"          # "saved" | "reviewed" | "useful" | "not_useful"
    note: str = ""
    tags: list[str] = Field(default_factory=list)
    tracked_request_id: Optional[str] = None
    discovered_via_query: Optional[str] = None
    saved_at: datetime


class SaveDiscoveryPayload(BaseModel):
    """Payload to POST /api/v1/discoveries — saves a discovery from a search result."""
    source: str
    source_id: Optional[str] = None
    title: str
    description: str = ""
    url: str
    document_date: Optional[date] = None
    page_count: Optional[int] = None
    agency: str = ""
    discovered_via_query: Optional[str] = None
    tracked_request_id: Optional[str] = None
    tags: list[str] = Field(default_factory=list)
    note: str = ""


class UpdateDiscoveryPayload(BaseModel):
    """Payload to PATCH /api/v1/discoveries/{id} — partial update of mutable fields."""
    status: Optional[str] = None
    note: Optional[str] = None
    tags: Optional[list[str]] = None
    tracked_request_id: Optional[str] = None


class DiscoveryListResponse(BaseModel):
    discoveries: list[DiscoveredDocument]
    count: int
