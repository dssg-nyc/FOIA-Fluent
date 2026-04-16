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


# ── Phase 1.5 — Entity Resolution Layer ─────────────────────────────────────

@router.get("/{signal_id}/related")
def get_related_signals(signal_id: str):
    """Return signals that share at least one entity with the given signal.
    Public — no auth required so the marketing landing page can use it."""
    related = signals_service.find_related_signals(signal_id, limit=10)
    return {"signals": related, "count": len(related)}


@router.get("/entity/{entity_type}/{entity_slug}")
def get_entity(entity_type: str, entity_slug: str):
    """Get the cached entity bio + signal count.
    Generates the bio with Claude on first hit, caches forever after."""
    bio = signals_service.get_or_create_entity_bio(entity_type, entity_slug)
    return bio


@router.get("/entity/{entity_type}/{entity_slug}/signals")
def get_entity_signals_route(entity_type: str, entity_slug: str, limit: int = 100):
    """All signals across all sources that mention the given entity."""
    signals = signals_service.get_entity_signals(entity_type, entity_slug, limit=limit)
    return {"signals": signals, "count": len(signals)}


# ── Phase 3.5 — Patterns Feed ───────────────────────────────────────────────

@router.get("/patterns")
def get_patterns_route(personas: Optional[str] = Query(default=None), limit: int = 50):
    """Public AI-detected cross-source patterns. No auth required so the marketing
    landing page can show them."""
    persona_list: list[str] = []
    if personas:
        persona_list = [p.strip() for p in personas.split(",") if p.strip()]
    patterns = signals_service.get_patterns(personas=persona_list or None, limit=limit)
    return {"patterns": patterns, "count": len(patterns)}


@router.get("/patterns/{pattern_id}")
def get_pattern_detail(pattern_id: str):
    """Pattern detail with all referenced signals fully expanded."""
    return signals_service.get_pattern_with_signals(pattern_id)


# ── Phase 2 — Public marketing landing page sample ──────────────────────────

@router.get("/sample")
def get_public_sample():
    """PUBLIC (no auth). Returns a small curated sample for the marketing
    landing page: top signal per persona, top patterns, and source coverage."""
    return signals_service.get_public_sample(per_persona=1, max_patterns=3)
