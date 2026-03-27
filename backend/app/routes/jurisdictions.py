"""Jurisdiction endpoints — public, no authentication required.

GET /api/v1/hub/jurisdictions/map
    All states with transparency scores for choropleth map.

GET /api/v1/hub/jurisdictions/{slug}
    Per-state detail with top/bottom agencies and outcome breakdown.

GET /api/v1/hub/jurisdictions/{slug}/agencies
    Paginated, searchable, sortable agency directory for a state.
"""
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from app.models.hub import AgencyPageResponse
from app.models.jurisdictions import StateMapData, JurisdictionDetail
from app.services import jurisdictions as jurisdiction_service

router = APIRouter(prefix="/hub/jurisdictions", tags=["jurisdictions"])


@router.get("/map", response_model=StateMapData)
def get_state_map():
    """All states with transparency scores for the choropleth map."""
    return jurisdiction_service.get_map_data()


@router.get("/{slug}", response_model=JurisdictionDetail)
def get_jurisdiction_detail(slug: str):
    """Per-state transparency detail with top/bottom agencies."""
    detail = jurisdiction_service.get_jurisdiction_detail(slug)
    if not detail:
        raise HTTPException(status_code=404, detail=f"Jurisdiction '{slug}' not found")
    return detail


@router.get("/{slug}/agencies", response_model=AgencyPageResponse)
def list_jurisdiction_agencies(
    slug: str,
    search: Optional[str] = Query(None, description="Filter by agency name"),
    sort_by: str = Query("transparency_score", description="Field to sort by"),
    min_requests: int = Query(5, ge=0),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
):
    """Paginated agency directory for a specific state."""
    return jurisdiction_service.get_jurisdiction_agencies(
        slug=slug,
        search=search,
        sort_by=sort_by,
        min_requests=min_requests,
        page=page,
        page_size=page_size,
    )
