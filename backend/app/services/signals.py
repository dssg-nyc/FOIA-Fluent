"""Service layer for Live FOIA Signals.

Reads from Supabase tables `personas`, `foia_signals_feed`, `user_personas`.
Auth-scoped queries (per-user persona subscriptions) require user_id; the public
persona catalog and signal feed reads are user-agnostic in Phase 1 (the feed is
filtered by personas, not by who owns it).
"""
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from app.config import settings
from app.models.signals import Persona, Signal

logger = logging.getLogger(__name__)


def _get_supabase():
    if not settings.supabase_url or not settings.supabase_service_key:
        return None
    from supabase import create_client
    return create_client(settings.supabase_url, settings.supabase_service_key)


# ── Persona catalog ─────────────────────────────────────────────────────────

def list_personas() -> list[Persona]:
    """Return the static persona catalog ordered by display_order."""
    supabase = _get_supabase()
    if not supabase:
        return []
    try:
        result = (
            supabase.table("personas")
            .select("id,name,description,icon,display_order")
            .order("display_order")
            .execute()
        )
        return [Persona(**row) for row in (result.data or [])]
    except Exception as e:
        logger.warning(f"list_personas failed: {e}")
        return []


# ── User persona subscriptions ──────────────────────────────────────────────

def get_user_personas(user_id: str) -> list[str]:
    """Return persona ids the user has subscribed to. Empty list if none."""
    supabase = _get_supabase()
    if not supabase or not user_id:
        return []
    try:
        result = (
            supabase.table("user_personas")
            .select("persona_id")
            .eq("user_id", user_id)
            .execute()
        )
        return [row["persona_id"] for row in (result.data or [])]
    except Exception as e:
        logger.warning(f"get_user_personas failed for {user_id}: {e}")
        return []


def set_user_personas(user_id: str, persona_ids: list[str]) -> list[str]:
    """Replace the user's persona subscription set with the given ids."""
    supabase = _get_supabase()
    if not supabase or not user_id:
        return []
    try:
        # Delete existing
        supabase.table("user_personas").delete().eq("user_id", user_id).execute()
        # Insert new
        if persona_ids:
            rows = [{"user_id": user_id, "persona_id": pid} for pid in persona_ids]
            supabase.table("user_personas").insert(rows).execute()
        return persona_ids
    except Exception as e:
        logger.warning(f"set_user_personas failed for {user_id}: {e}")
        return []


# ── Signal feed ─────────────────────────────────────────────────────────────

def get_feed(
    personas: Optional[list[str]] = None,
    since: Optional[datetime] = None,
    limit: int = 100,
) -> list[Signal]:
    """Return recent signals filtered by persona and date.

    If personas is None or empty, returns ALL recent signals (used for the
    landing-page sample feed in Phase 2 and the dogfood feed view in Phase 1
    when the user hasn't picked a persona yet).
    """
    supabase = _get_supabase()
    if not supabase:
        return []

    try:
        q = supabase.table("foia_signals_feed").select("*")

        if personas:
            # Persona overlap filter — at least one persona tag matches.
            q = q.overlaps("persona_tags", personas)

        if since:
            q = q.gte("signal_date", since.isoformat())

        q = q.order("signal_date", desc=True).limit(limit)
        result = q.execute()

        return [Signal(**row) for row in (result.data or [])]
    except Exception as e:
        logger.warning(f"get_feed failed: {e}")
        return []


# ── Entity resolution layer (Phase 1.5) ────────────────────────────────────

def _entity_key(entity_type: str, entity_slug: str) -> str:
    return f"{entity_type}:{entity_slug}"


def find_related_signals(signal_id: str, limit: int = 10) -> list[Signal]:
    """Return signals that share at least one entity slug with the given signal,
    excluding the signal itself. Ordered most recent first."""
    supabase = _get_supabase()
    if not supabase:
        return []
    try:
        # Fetch the source signal's entity_slugs
        src = (
            supabase.table("foia_signals_feed")
            .select("entity_slugs")
            .eq("id", signal_id)
            .single()
            .execute()
        )
        slugs = (src.data or {}).get("entity_slugs") or []
        if not slugs:
            return []
        # Find other signals that overlap
        result = (
            supabase.table("foia_signals_feed")
            .select("*")
            .overlaps("entity_slugs", slugs)
            .neq("id", signal_id)
            .order("signal_date", desc=True)
            .limit(limit)
            .execute()
        )
        return [Signal(**row) for row in (result.data or [])]
    except Exception as e:
        logger.warning(f"find_related_signals failed for {signal_id}: {e}")
        return []


def get_entity_signals(entity_type: str, entity_slug: str, limit: int = 100) -> list[Signal]:
    """All signals across all sources that mention the given entity."""
    supabase = _get_supabase()
    if not supabase:
        return []
    try:
        key = _entity_key(entity_type, entity_slug)
        result = (
            supabase.table("foia_signals_feed")
            .select("*")
            .contains("entity_slugs", [key])
            .order("signal_date", desc=True)
            .limit(limit)
            .execute()
        )
        return [Signal(**row) for row in (result.data or [])]
    except Exception as e:
        logger.warning(f"get_entity_signals failed for {entity_type}/{entity_slug}: {e}")
        return []


def _slug_to_display_name(slug: str) -> str:
    """Convert a slug back to a human-friendly display name."""
    return " ".join(word.capitalize() for word in slug.split("-"))


def get_or_create_entity_bio(entity_type: str, entity_slug: str) -> dict:
    """Look up the cached entity bio. If absent, generate one with Claude
    using the most recent ~10 signals about the entity as context, then cache.
    Returns: {entity_type, entity_slug, display_name, bio, signal_count}
    """
    supabase = _get_supabase()
    if not supabase:
        return {
            "entity_type": entity_type,
            "entity_slug": entity_slug,
            "display_name": _slug_to_display_name(entity_slug),
            "bio": "",
            "signal_count": 0,
        }

    # Cache hit?
    try:
        cached = (
            supabase.table("entity_bios")
            .select("*")
            .eq("entity_type", entity_type)
            .eq("entity_slug", entity_slug)
            .single()
            .execute()
        )
        if cached.data:
            # Refresh signal count on the fly
            count_result = (
                supabase.table("foia_signals_feed")
                .select("id", count="exact")
                .contains("entity_slugs", [_entity_key(entity_type, entity_slug)])
                .execute()
            )
            current_count = count_result.count or 0
            if current_count != cached.data.get("signal_count"):
                supabase.table("entity_bios").update(
                    {"signal_count": current_count}
                ).eq("entity_type", entity_type).eq("entity_slug", entity_slug).execute()
                cached.data["signal_count"] = current_count
            return cached.data
    except Exception:
        pass  # not in cache, fall through to generate

    # Generate fresh bio via Claude using the most recent signals as context
    signals = get_entity_signals(entity_type, entity_slug, limit=10)
    if not signals:
        return {
            "entity_type": entity_type,
            "entity_slug": entity_slug,
            "display_name": _slug_to_display_name(entity_slug),
            "bio": "No signals on file.",
            "signal_count": 0,
        }

    # Try to recover a higher-fidelity display name from the actual signal entities
    display_name = _slug_to_display_name(entity_slug)

    bio_text = _generate_entity_bio_via_claude(entity_type, display_name, signals)

    row = {
        "entity_type": entity_type,
        "entity_slug": entity_slug,
        "display_name": display_name,
        "bio": bio_text,
        "signal_count": len(signals),
    }
    try:
        supabase.table("entity_bios").upsert(
            row, on_conflict="entity_type,entity_slug"
        ).execute()
    except Exception as e:
        logger.warning(f"entity_bios upsert failed: {e}")

    return row


def _generate_entity_bio_via_claude(entity_type: str, display_name: str, signals: list[Signal]) -> str:
    """Single Claude Haiku call to generate a 1-paragraph entity bio
    grounded in the provided signals."""
    import httpx

    if not settings.anthropic_api_key:
        return f"{display_name} has appeared in {len(signals)} signal(s) across our sources."

    summaries = "\n".join(
        f"- [{s.source}] {s.title}: {s.summary}"[:300]
        for s in signals[:10]
    )

    prompt = (
        f"You are writing a 1-paragraph factual bio for {display_name} "
        f"(entity type: {entity_type}) for a FOIA intelligence platform. "
        f"Base the bio strictly on the following signals — do not invent facts. "
        f"If the signals don't make a coherent story, write a 1-sentence "
        f"factual summary of what kind of entity this is.\n\n"
        f"Recent signals:\n{summaries}\n\n"
        f"Bio (1 paragraph, ~3-5 sentences, plain English, factual):"
    )

    try:
        with httpx.Client(timeout=45.0) as client:
            resp = client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": settings.anthropic_api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json={
                    "model": "claude-haiku-4-5-20251001",
                    "max_tokens": 400,
                    "messages": [{"role": "user", "content": prompt}],
                },
            )
            resp.raise_for_status()
            data = resp.json()
            return (data.get("content", [{}])[0].get("text", "") or "").strip()
    except Exception as e:
        logger.warning(f"entity bio generation failed: {e}")
        return f"{display_name} has appeared in {len(signals)} recent signal(s)."


# ── Patterns Feed (Phase 3.5) ───────────────────────────────────────────────

def get_patterns(
    personas: Optional[list[str]] = None,
    limit: int = 50,
) -> list[dict]:
    """Return AI-generated cross-source patterns, ordered most recent first.
    Honors the `visible` kill-switch column. Optionally filtered by persona.

    Each pattern is enriched with `evidence_signals`: a slim list of the source
    signals that anchor the pattern (id, source, title, signal_date) so the
    frontend cards can render the evidence section inline without a second call.
    """
    supabase = _get_supabase()
    if not supabase:
        return []
    try:
        q = supabase.table("signal_patterns").select("*").eq("visible", True)
        if personas:
            q = q.overlaps("persona_tags", personas)
        result = q.order("generated_at", desc=True).limit(limit).execute()
        patterns = result.data or []
    except Exception as e:
        logger.warning(f"get_patterns failed: {e}")
        return []

    # Batch-fetch all referenced signal IDs in one query, then index by id
    all_signal_ids: list[str] = []
    for p in patterns:
        for sid in (p.get("signal_ids") or []):
            if sid not in all_signal_ids:
                all_signal_ids.append(sid)

    signals_by_id: dict[str, dict] = {}
    if all_signal_ids:
        try:
            sigs_result = (
                supabase.table("foia_signals_feed")
                .select(
                    "id,source,source_id,title,summary,signal_date,requester,source_url,entities,entity_slugs"
                )
                .in_("id", all_signal_ids)
                .execute()
            )
            for s in (sigs_result.data or []):
                signals_by_id[s["id"]] = s
        except Exception as e:
            logger.warning(f"batch signal fetch failed: {e}")

    # Attach evidence_signals to each pattern (preserving the order Claude returned)
    for p in patterns:
        p["evidence_signals"] = [
            signals_by_id[sid]
            for sid in (p.get("signal_ids") or [])
            if sid in signals_by_id
        ]

    return patterns


def get_global_stats() -> dict:
    """Lightweight global stats for the /signals page header.

    Returns the all-time signal count, visible pattern count, enabled-source
    count from the registry, and the most recent ingest timestamp. Cheap —
    three indexed COUNTs and one max() — so frontend can call on every
    dashboard load.
    """
    supabase = _get_supabase()
    if not supabase:
        return {
            "total_signals": 0,
            "total_patterns_visible": 0,
            "sources_enabled": 0,
            "last_ingested_at": None,
        }

    from app.data.signals_sources import enabled_sources

    total_signals = 0
    total_patterns_visible = 0
    last_ingested_at: Optional[str] = None
    try:
        sig = (
            supabase.table("foia_signals_feed")
            .select("id", count="exact")
            .limit(1)
            .execute()
        )
        total_signals = sig.count or 0
    except Exception as e:
        logger.warning(f"global_stats: signals count failed: {e}")

    try:
        pat = (
            supabase.table("signal_patterns")
            .select("id", count="exact")
            .eq("visible", True)
            .limit(1)
            .execute()
        )
        total_patterns_visible = pat.count or 0
    except Exception as e:
        logger.warning(f"global_stats: patterns count failed: {e}")

    try:
        recent = (
            supabase.table("foia_signals_feed")
            .select("ingested_at")
            .order("ingested_at", desc=True)
            .limit(1)
            .execute()
        )
        if recent.data:
            last_ingested_at = recent.data[0].get("ingested_at")
    except Exception as e:
        logger.warning(f"global_stats: last_ingested fetch failed: {e}")

    return {
        "total_signals": total_signals,
        "total_patterns_visible": total_patterns_visible,
        "sources_enabled": len(enabled_sources()),
        "last_ingested_at": last_ingested_at,
    }


def get_public_sample(per_persona: int = 1, max_patterns: int = 3) -> dict:
    """Public sample for the marketing landing page (no auth).
    Returns:
      - one high-priority signal per pilot persona
      - the top N visible patterns (highest priority + most recent)
      - source coverage counts
    """
    supabase = _get_supabase()
    if not supabase:
        return {"signals_by_persona": {}, "patterns": [], "source_counts": {}, "total_signals": 0}

    PILOT = ["journalist", "pharma_analyst", "hedge_fund", "environmental"]
    signals_by_persona: dict[str, list[dict]] = {}

    for persona in PILOT:
        try:
            result = (
                supabase.table("foia_signals_feed")
                .select("id,source,source_id,title,summary,signal_date,requester,persona_tags,priority,entities")
                .contains("persona_tags", [persona])
                .order("priority", desc=True)
                .order("signal_date", desc=True)
                .limit(per_persona)
                .execute()
            )
            signals_by_persona[persona] = result.data or []
        except Exception as e:
            logger.warning(f"public sample fetch for {persona} failed: {e}")
            signals_by_persona[persona] = []

    # Top patterns — re-use the existing function which already attaches evidence_signals
    patterns = get_patterns(personas=None, limit=max_patterns)

    # Source coverage counts (totals across the corpus)
    source_counts: dict[str, int] = {}
    total_signals = 0
    try:
        # Get total
        total_res = (
            supabase.table("foia_signals_feed")
            .select("id", count="exact")
            .limit(1)
            .execute()
        )
        total_signals = total_res.count or 0

        # Get per-source counts — registry-driven so adding a source in
        # app.data.signals_sources is the only step needed.
        from app.data.signals_sources import source_ids
        for source in source_ids():
            r = (
                supabase.table("foia_signals_feed")
                .select("id", count="exact")
                .eq("source", source)
                .limit(1)
                .execute()
            )
            source_counts[source] = r.count or 0
    except Exception as e:
        logger.warning(f"source counts fetch failed: {e}")

    return {
        "signals_by_persona": signals_by_persona,
        "patterns": patterns,
        "source_counts": source_counts,
        "total_signals": total_signals,
    }


def get_pattern_with_signals(pattern_id: str) -> dict:
    """Return a single pattern plus the full signal records it references."""
    supabase = _get_supabase()
    if not supabase:
        return {}
    try:
        p_result = (
            supabase.table("signal_patterns")
            .select("*")
            .eq("id", pattern_id)
            .single()
            .execute()
        )
        pattern = p_result.data
        if not pattern:
            return {}

        sig_ids = pattern.get("signal_ids") or []
        signals: list[dict] = []
        if sig_ids:
            sig_result = (
                supabase.table("foia_signals_feed")
                .select("*")
                .in_("id", sig_ids)
                .execute()
            )
            signals = sig_result.data or []

        return {"pattern": pattern, "signals": signals}
    except Exception as e:
        logger.warning(f"get_pattern_with_signals failed for {pattern_id}: {e}")
        return {}


def get_recent_signals_for_chat(
    persona: str = "",
    query: str = "",
    days: int = 7,
    limit: int = 10,
) -> list[dict]:
    """Plain-dict variant for the chat tool. Filtered by optional persona,
    optional keyword (matched in title or summary), and a recency window."""
    supabase = _get_supabase()
    if not supabase:
        return []
    try:
        q = supabase.table("foia_signals_feed").select(
            "id,source,title,summary,source_url,signal_date,agency_codes,persona_tags,priority"
        )
        if persona:
            q = q.contains("persona_tags", [persona])
        if query:
            q = q.or_(f"title.ilike.%{query}%,summary.ilike.%{query}%")
        since = datetime.now(timezone.utc) - timedelta(days=max(1, days))
        q = q.gte("signal_date", since.isoformat())
        q = q.order("priority", desc=True).order("signal_date", desc=True).limit(limit)
        result = q.execute()
        return result.data or []
    except Exception as e:
        logger.warning(f"get_recent_signals_for_chat failed: {e}")
        return []
