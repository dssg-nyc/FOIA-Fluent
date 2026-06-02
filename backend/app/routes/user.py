"""User profile routes.

Exposes the per-user flags the frontend needs. Currently just the onboarding
tour completion flag, read on app load and written when the tour ends. All
routes are auth-gated; in local dev (no Supabase) get_current_user_id returns
the fixed dev user and the service returns None, so the tour always shows.
"""
from fastapi import APIRouter, Depends

from app.middleware.auth import get_current_user_id
from app.services import user_profile as service

router = APIRouter(prefix="/user", tags=["user"])


@router.get("/profile")
def get_profile(user_id: str = Depends(get_current_user_id)):
    """Return profile flags for the current user (tour completion)."""
    return {"tour_completed_at": service.get_tour_completed_at(user_id)}


@router.post("/tour-complete")
def complete_tour(user_id: str = Depends(get_current_user_id)):
    """Mark the onboarding tour as completed for the current user (idempotent)."""
    return {"tour_completed_at": service.mark_tour_completed(user_id)}
