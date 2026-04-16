"""Saved discoveries routes (Discover & Draft Phase 3).

All routes are auth-gated. RLS in Supabase enforces a second layer of isolation.
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from app.middleware.auth import get_current_user_id
from app.models.discoveries import (
    DiscoveredDocument,
    DiscoveryListResponse,
    SaveDiscoveryPayload,
    UpdateDiscoveryPayload,
)
from app.services import discoveries as service

router = APIRouter(prefix="/discoveries", tags=["discoveries"])


@router.post("", response_model=DiscoveredDocument)
def save_discovery_route(
    payload: SaveDiscoveryPayload,
    user_id: str = Depends(get_current_user_id),
):
    """Save a new discovery to the user's library, or return the existing
    record if (user_id, url) is already saved (no error)."""
    saved = service.save_discovery(user_id, payload)
    if not saved:
        raise HTTPException(status_code=500, detail="Could not save discovery")
    return saved


@router.get("", response_model=DiscoveryListResponse)
def list_discoveries_route(
    status: Optional[str] = Query(default=None),
    tag: Optional[str] = Query(default=None),
    tracked_request_id: Optional[str] = Query(default=None),
    query: Optional[str] = Query(default=None),
    limit: int = Query(default=200, ge=1, le=500),
    user_id: str = Depends(get_current_user_id),
):
    """List the user's saved discoveries with optional filters."""
    rows = service.list_discoveries(
        user_id=user_id,
        status=status,
        tag=tag,
        tracked_request_id=tracked_request_id,
        query=query,
        limit=limit,
    )
    return DiscoveryListResponse(discoveries=rows, count=len(rows))


@router.get("/{discovery_id}", response_model=DiscoveredDocument)
def get_discovery_route(
    discovery_id: str,
    user_id: str = Depends(get_current_user_id),
):
    row = service.get_discovery(user_id, discovery_id)
    if not row:
        raise HTTPException(status_code=404, detail="Discovery not found")
    return row


@router.patch("/{discovery_id}", response_model=DiscoveredDocument)
def update_discovery_route(
    discovery_id: str,
    payload: UpdateDiscoveryPayload,
    user_id: str = Depends(get_current_user_id),
):
    """Update mutable fields (status, note, tags, tracked_request_id)."""
    row = service.update_discovery(user_id, discovery_id, payload)
    if not row:
        raise HTTPException(status_code=404, detail="Discovery not found")
    return row


@router.delete("/{discovery_id}")
def delete_discovery_route(
    discovery_id: str,
    user_id: str = Depends(get_current_user_id),
):
    ok = service.delete_discovery(user_id, discovery_id)
    return {"deleted": ok}
