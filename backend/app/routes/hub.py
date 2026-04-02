"""Data Hub endpoints — public, no authentication required.

GET /api/v1/hub/stats
    Global transparency metrics (overall rates, top/bottom agencies).

GET /api/v1/hub/agencies
    Paginated, searchable, sortable agency directory.
    Query params: search, sort_by, min_requests, page, page_size

GET /api/v1/hub/agencies/{slug}
    Per-agency detail with exemption/denial/success patterns.
"""
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from app.models.hub import AgencyDetail, AgencyPageResponse, GlobalStats
from app.services import hub as hub_service

router = APIRouter(prefix="/hub", tags=["hub"])


@router.get("/stats", response_model=GlobalStats)
def get_global_stats():
    """Global FOIA transparency metrics across all agencies."""
    return hub_service.get_global_stats()


@router.get("/agencies", response_model=AgencyPageResponse)
def list_agencies(
    search: Optional[str] = Query(None, description="Filter by agency name"),
    sort_by: str = Query("transparency_score", description="Field to sort by"),
    min_requests: int = Query(5, ge=0, description="Minimum number of requests"),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
):
    """Paginated, filterable agency directory."""
    return hub_service.get_agencies(
        search=search,
        sort_by=sort_by,
        min_requests=min_requests,
        page=page,
        page_size=page_size,
    )


@router.get("/agencies/{slug}", response_model=AgencyDetail)
def get_agency_detail(slug: str, jurisdiction: Optional[str] = Query(None, description="Filter by jurisdiction name")):
    """Per-agency transparency detail with request patterns."""
    detail = hub_service.get_agency_detail(slug, jurisdiction=jurisdiction)
    if not detail:
        raise HTTPException(status_code=404, detail=f"Agency '{slug}' not found in hub cache")
    return detail
