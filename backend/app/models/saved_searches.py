"""Pydantic models for saved searches (Discover & Draft Phase 4)."""
from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field


class SavedSearch(BaseModel):
    id: str
    user_id: str
    query: str
    interpretation: dict[str, Any] = Field(default_factory=dict)
    name: str = ""
    last_run_at: Optional[datetime] = None
    last_result_count: int = 0
    created_at: datetime
    # Cached discovery result for instant re-open from the sidebar. Only the
    # single-row GET returns this; the list endpoint strips it to stay light.
    result_snapshot: Optional[dict[str, Any]] = None
    snapshot_at: Optional[datetime] = None


class SaveSearchPayload(BaseModel):
    """Payload to POST /api/v1/saved-searches — save or touch a query."""
    query: str
    interpretation: Optional[dict[str, Any]] = None
    name: Optional[str] = None
    result_count: Optional[int] = None
    # Full DiscoveryResponse to snapshot. Optional — server will just store {}
    # when absent (older clients, or "save without results" flows).
    result_snapshot: Optional[dict[str, Any]] = None


class SavedSearchListResponse(BaseModel):
    searches: list[SavedSearch]
    count: int
