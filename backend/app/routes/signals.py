"""Live FOIA Signals routes.

Phase 1 endpoints:
    GET  /api/v1/signals/personas              — Public persona catalog
    GET  /api/v1/signals/feed                  — Authenticated feed (filtered by personas query param)
    GET  /api/v1/signals/me/personas           — Current user's persona subscription
    POST /api/v1/signals/me/personas           — Replace current user's persona subscription

The /signals/sample endpoint for the public marketing landing page lands in Phase 2.
"""
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Query

from app.middleware.auth import get_current_user_id
from app.models.signals import (
    PersonaCatalogResponse,
    SetUserPersonasPayload,
    SignalFeedResponse,
    UserPersonasResponse,
)
from app.services import signals as signals_service

router = APIRouter(prefix="/signals", tags=["signals"])


@router.get("/personas", response_model=PersonaCatalogResponse)
def get_persona_catalog():
    """Public catalog of industry personas users can subscribe to."""
    personas = signals_service.list_personas()
    return PersonaCatalogResponse(personas=personas)


@router.get("/feed", response_model=SignalFeedResponse)
def get_signal_feed(
    personas: Optional[str] = Query(default=None, description="Comma-separated persona ids"),
    days: int = Query(default=30, ge=1, le=365),
    limit: int = Query(default=100, ge=1, le=200),
    user_id: str = Depends(get_current_user_id),
):
    """Authenticated feed of recent signals.

    If `personas` is omitted, falls back to the user's saved persona subscription.
    If the user has none saved either, returns all recent signals (dogfood mode).
    """
    persona_list: list[str] = []
    if personas:
        persona_list = [p.strip() for p in personas.split(",") if p.strip()]
    else:
        persona_list = signals_service.get_user_personas(user_id)

    since = datetime.now(timezone.utc) - timedelta(days=days)
    signals = signals_service.get_feed(personas=persona_list or None, since=since, limit=limit)

    return SignalFeedResponse(
        signals=signals,
        count=len(signals),
        personas_filter=persona_list,
    )


@router.get("/me/personas", response_model=UserPersonasResponse)
def get_my_personas(user_id: str = Depends(get_current_user_id)):
    """Return the current user's saved persona subscription."""
    return UserPersonasResponse(persona_ids=signals_service.get_user_personas(user_id))


@router.post("/me/personas", response_model=UserPersonasResponse)
def set_my_personas(
    payload: SetUserPersonasPayload,
    user_id: str = Depends(get_current_user_id),
):
    """Replace the current user's persona subscription set."""
    saved = signals_service.set_user_personas(user_id, payload.persona_ids)
    return UserPersonasResponse(persona_ids=saved)
