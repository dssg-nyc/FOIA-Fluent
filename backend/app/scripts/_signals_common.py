"""Shared helpers for Live FOIA Signals ingestion scripts.

Every refresh_signals_*.py script funnels each raw item through this module.
The helper handles:
  1. Dedup check against (source, source_id) — skip without Claude call if exists
  2. Claude Haiku extraction with forced tool-use for structured JSON output
  3. Upsert into foia_signals_feed (idempotent on the unique constraint)

Conservative tuning: Claude is instructed to tag only personas where the
relevance is concrete and verifiable. Speculative tagging is rejected.

The 4 pilot personas (Phase 1):
    journalist | pharma_analyst | hedge_fund | environmental
"""
import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Any, Optional

import httpx

logger = logging.getLogger(__name__)

PILOT_PERSONAS = ["journalist", "pharma_analyst", "hedge_fund", "environmental"]

CLAUDE_MODEL = "claude-haiku-4-5-20251001"
CLAUDE_MAX_TOKENS = 800


# ── Tool schema for forced structured output ────────────────────────────────

EXTRACT_SIGNAL_TOOL = {
    "name": "extract_signal",
    "description": "Extract structured fields from a raw FOIA-related signal.",
    "input_schema": {
        "type": "object",
        "required": ["summary", "entities", "persona_tags", "priority"],
        "properties": {
            "summary": {
                "type": "string",
                "description": "1-2 sentence plain English summary of the signal.",
            },
            "entities": {
                "type": "object",
                "description": "Named entities extracted from the signal.",
                "properties": {
                    "companies":      {"type": "array", "items": {"type": "string"}},
                    "people":         {"type": "array", "items": {"type": "string"}},
                    "agencies":       {"type": "array", "items": {"type": "string"}},
                    "locations":      {"type": "array", "items": {"type": "string"}},
                    "regulations":    {"type": "array", "items": {"type": "string"}},
                    "dollar_amounts": {"type": "array", "items": {"type": "string"}},
                },
            },
            "persona_tags": {
                "type": "array",
                "description": (
                    "Subset of these 4 personas this signal is concretely relevant to: "
                    "journalist, pharma_analyst, hedge_fund, environmental. "
                    "Be conservative — only include a persona if the relevance is direct "
                    "and verifiable from the signal text. Empty array is acceptable."
                ),
                "items": {
                    "type": "string",
                    "enum": PILOT_PERSONAS,
                },
            },
            "priority": {
                "type": "integer",
                "minimum": 0,
                "maximum": 2,
                "description": "0 = low (routine), 1 = normal, 2 = high (publicly traded company, large dollar amount, named investigation).",
            },
            "requester": {
                "type": "string",
                "description": (
                    "ONLY for FOIA-log signals (a row from an agency's FOIA request log). "
                    "Who filed the FOIA request. Pull the cleanest version: organization "
                    "name if present (e.g. 'Reuters', 'ACLU'), otherwise person name, "
                    "otherwise the category as published (e.g. 'Member of Public'). "
                    "For agency-action signals (enforcement, warning letters, GAO decisions), "
                    "leave this empty string."
                ),
            },
        },
    },
}


def build_extraction_prompt(source_label: str, title: str, body_excerpt: str) -> str:
    return f"""You are an extraction agent for a FOIA intelligence platform.

Source: {source_label}

Raw signal:
---
TITLE: {title}

BODY:
{body_excerpt}
---

Extract structured fields and return them via the extract_signal tool.

CONSERVATIVE RULES:
- Only tag personas where the relevance is direct and verifiable from the text above.
- Do NOT speculate about who might find this interesting.
- An empty persona_tags array is acceptable if nothing fits.
- Set priority=2 only if the signal clearly involves: a publicly traded company, a major federal agency action, a dollar amount in the millions+, or a named individual of public interest.

The 4 valid personas:
- journalist: relevant for accountability reporting, peer-FOIA awareness, named officials, agency mismanagement
- pharma_analyst: relevant for FDA actions, drug substances, GMP/CMO findings, healthcare regulation
- hedge_fund: relevant if a publicly traded company is named or there is a clear material financial implication
- environmental: relevant for EPA actions, NEPA, ESA, pollution, land use, climate
"""


# ── Claude call ─────────────────────────────────────────────────────────────

async def extract_with_claude(
    api_key: str,
    source_label: str,
    title: str,
    body_excerpt: str,
    timeout: float = 45.0,
) -> Optional[dict]:
    """Single Claude call with forced tool-use. Returns the parsed extract dict
    or None on failure (caller should fall back to a minimal record).
    """
    if not api_key:
        return None

    prompt = build_extraction_prompt(source_label, title, body_excerpt[:6000])

    payload = {
        "model": CLAUDE_MODEL,
        "max_tokens": CLAUDE_MAX_TOKENS,
        "tools": [EXTRACT_SIGNAL_TOOL],
        "tool_choice": {"type": "tool", "name": "extract_signal"},
        "messages": [{"role": "user", "content": prompt}],
    }

    async with httpx.AsyncClient(timeout=timeout) as client:
        try:
            resp = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json=payload,
            )
            resp.raise_for_status()
            data = resp.json()
        except Exception as e:
            logger.warning(f"Claude extraction failed: {e}")
            return None

    # Find the tool_use block
    for block in data.get("content", []):
        if block.get("type") == "tool_use" and block.get("name") == "extract_signal":
            return block.get("input", {}) or {}

    logger.warning("Claude returned no tool_use block")
    return None


# ── Dedup ───────────────────────────────────────────────────────────────────

def already_exists(supabase, source: str, source_id: str) -> bool:
    """Cheap existence check. Returns True if (source, source_id) is already in the feed."""
    if not source_id:
        return False
    try:
        result = (
            supabase.table("foia_signals_feed")
            .select("id")
            .eq("source", source)
            .eq("source_id", source_id)
            .limit(1)
            .execute()
        )
        return bool(result.data)
    except Exception as e:
        logger.warning(f"dedup check failed for {source}/{source_id}: {e}")
        return False


# ── Upsert ──────────────────────────────────────────────────────────────────

def upsert_signal(
    supabase,
    *,
    source: str,
    source_id: str,
    title: str,
    summary: str,
    body_excerpt: str,
    source_url: str,
    signal_date: datetime,
    agency_codes: list[str],
    entities: dict[str, Any],
    persona_tags: list[str],
    priority: int,
    metadata: dict[str, Any],
    requester: str = "",
) -> bool:
    """Idempotent upsert keyed on (source, source_id). Returns True on success."""
    row = {
        "source": source,
        "source_id": source_id,
        "title": title[:500],
        "summary": (summary or "")[:1000],
        "body_excerpt": (body_excerpt or "")[:5000],
        "source_url": source_url or "",
        "signal_date": signal_date.isoformat() if isinstance(signal_date, datetime) else signal_date,
        "ingested_at": datetime.now(timezone.utc).isoformat(),
        "agency_codes": agency_codes or [],
        "entities": entities or {},
        "persona_tags": persona_tags or [],
        "priority": int(priority or 0),
        "requester": (requester or "")[:300],
        "metadata": metadata or {},
    }
    try:
        supabase.table("foia_signals_feed").upsert(row, on_conflict="source,source_id").execute()
        return True
    except Exception as e:
        logger.warning(f"upsert failed for {source}/{source_id}: {e}")
        return False


# ── End-to-end pipeline for one item ────────────────────────────────────────

async def process_item(
    *,
    supabase,
    api_key: str,
    source: str,
    source_label: str,
    source_id: str,
    title: str,
    body_excerpt: str,
    source_url: str,
    signal_date: datetime,
    default_agency_codes: list[str] | None = None,
    extra_metadata: dict[str, Any] | None = None,
    requester: str = "",
) -> str:
    """End-to-end: dedup → Claude extract → upsert. Returns a status string:
    "skipped" (already exists), "inserted", or "failed".
    """
    if already_exists(supabase, source, source_id):
        return "skipped"

    extract = await extract_with_claude(api_key, source_label, title, body_excerpt) or {}

    summary      = extract.get("summary", "")
    entities     = extract.get("entities", {}) or {}
    persona_tags = extract.get("persona_tags", []) or []
    priority     = extract.get("priority", 0)
    claude_requester = (extract.get("requester") or "").strip()

    # Defensive: drop any persona tags that aren't in the pilot set
    persona_tags = [p for p in persona_tags if p in PILOT_PERSONAS]

    # If the caller didn't pass an explicit requester, use Claude's extracted one
    if not requester and claude_requester:
        requester = claude_requester

    ok = upsert_signal(
        supabase,
        source=source,
        source_id=source_id,
        title=title,
        summary=summary,
        body_excerpt=body_excerpt,
        source_url=source_url,
        signal_date=signal_date,
        agency_codes=default_agency_codes or [],
        entities=entities,
        persona_tags=persona_tags,
        priority=priority,
        metadata=extra_metadata or {},
        requester=requester,
    )
    return "inserted" if ok else "failed"


# ── Convenience: run-summary logger ─────────────────────────────────────────

def log_run_summary(
    source: str,
    *,
    fetched: int,
    inserted: int,
    skipped: int,
    failed: int,
    runtime_seconds: float,
):
    logger.info(
        f"[{source}] fetched={fetched} inserted={inserted} skipped={skipped} "
        f"failed={failed} runtime={runtime_seconds:.1f}s"
    )
