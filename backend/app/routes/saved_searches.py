"""Saved searches routes (Discover & Draft Phase 4)."""
from fastapi import APIRouter, Depends, HTTPException, Query

from app.middleware.auth import get_current_user_id
from app.models.saved_searches import (
    SavedSearch,
    SavedSearchListResponse,
    SaveSearchPayload,
)
from app.services import saved_searches as service

router = APIRouter(prefix="/saved-searches", tags=["saved-searches"])


@router.post("", response_model=SavedSearch)
def save_search_route(
    payload: SaveSearchPayload,
    user_id: str = Depends(get_current_user_id),
):
    """Save a new search or touch an existing one (idempotent on query)."""
    row = service.save_search(user_id, payload)
    if not row:
        raise HTTPException(status_code=400, detail="Could not save search")
    return row


@router.get("", response_model=SavedSearchListResponse)
def list_saved_searches_route(
    limit: int = Query(default=20, ge=1, le=100),
    user_id: str = Depends(get_current_user_id),
):
    rows = service.list_saved_searches(user_id, limit=limit)
    return SavedSearchListResponse(searches=rows, count=len(rows))


@router.get("/{search_id}", response_model=SavedSearch)
def get_saved_search_route(
    search_id: str,
    user_id: str = Depends(get_current_user_id),
):
    """Fetch a single saved search including its cached result_snapshot."""
    row = service.get_saved_search(user_id, search_id)
    if not row:
        raise HTTPException(status_code=404, detail="Saved search not found")
    return row


@router.delete("/{search_id}")
def delete_saved_search_route(
    search_id: str,
    user_id: str = Depends(get_current_user_id),
):
    ok = service.delete_saved_search(user_id, search_id)
    return {"deleted": ok}
