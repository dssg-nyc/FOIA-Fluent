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
import logging
import re
from datetime import datetime, timezone
from typing import Any, Optional

import httpx

logger = logging.getLogger(__name__)

from app.data.signal_categories import (
    CATEGORIES,
    PERSONAS,
    categories_for_signal,
    derive_persona_tags,
    filter_categories,
)

# Deprecated alias for back-compat with any straggler imports.
# Phase 2.5 made personas a derived view over categories — see
# app/data/signal_categories.py.
PILOT_PERSONAS = PERSONAS

CLAUDE_MODEL = "claude-haiku-4-5-20251001"
CLAUDE_MAX_TOKENS = 800


# ── Entity slug normalization (Phase 1.5) ───────────────────────────────────

# Strip only unambiguous legal entity suffixes — words like "group" or "holdings"
# are often part of the actual company name (e.g. "WH Group", "Smithfield Holdings")
# so we leave them in.
_CORP_SUFFIX_PATTERN = (
    r"\b(inc|incorporated|corp|corporation|llc|llp|lp|ltd|limited|plc|gmbh|nv)\b\.?"
)
_CORP_SUFFIX_RE = re.compile(_CORP_SUFFIX_PATTERN, re.IGNORECASE)
_NON_SLUG_RE = re.compile(r"[^a-z0-9]+")
_LEADING_TRAILING_DASH_RE = re.compile(r"^-+|-+$")

# Generic placeholders that should NOT become entity slugs
_GENERIC_VALUES = {
    "member of public",
    "individual",
    "unknown",
    "redacted",
    "n/a",
    "",
}


def normalize_entity_name(name: str) -> str:
    """Normalize an entity name to a stable slug.
    'Smithfield Foods, Inc.' → 'smithfield-foods'
    'EPA Region 6'           → 'epa-region-6'
    'Member of Public'       → '' (filtered out as generic)
    """
    if not name:
        return ""
    s = name.strip().lower()
    if s in _GENERIC_VALUES:
        return ""
    s = _CORP_SUFFIX_RE.sub("", s)
    s = _NON_SLUG_RE.sub("-", s)
    s = _LEADING_TRAILING_DASH_RE.sub("", s)
    # Drop very short or very long slugs as noise
    if len(s) < 3 or len(s) > 80:
        return ""
    return s


def build_entity_slugs(entities: dict, requester: str = "") -> list[str]:
    """Build the flat array of '{type}:{slug}' entries for foia_signals_feed.entity_slugs.

    Reads from the structured entities dict (companies/people/agencies/locations)
    plus the requester field. Skips generic placeholders.
    """
    slugs: list[str] = []

    def _add(entity_type: str, raw: str) -> None:
        slug = normalize_entity_name(raw)
        if not slug:
            return
        key = f"{entity_type}:{slug}"
        if key not in slugs:
            slugs.append(key)

    if entities:
        for company in (entities.get("companies") or []):
            _add("company", str(company))
        for person in (entities.get("people") or []):
            _add("person", str(person))
        for agency in (entities.get("agencies") or []):
            _add("agency", str(agency))
        for location in (entities.get("locations") or []):
            _add("location", str(location))

    if requester:
        # Requester slugs into 'company' bucket if it looks like an org,
        # else 'person'. Heuristic: contains 'LLC', 'Inc', or capitalized run.
        if any(s in requester.lower() for s in (" llc", " llp", " inc", " corp", " ltd", "the ")):
            _add("company", requester)
        else:
            _add("person", requester)

    return slugs


# ── Tool schema for forced structured output ────────────────────────────────

EXTRACT_SIGNAL_TOOL = {
    "name": "extract_signal",
    "description": "Extract structured fields from a raw FOIA-related signal.",
    "input_schema": {
        "type": "object",
        "required": ["summary", "entities", "category_tags", "priority"],
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
            "category_tags": {
                "type": "array",
                "description": (
                    "Subset of canonical content categories this signal belongs to. "
                    "Categories describe WHAT the signal is about, not WHO would care. "
                    "Be conservative — only include a category if the signal clearly "
                    "matches it. 1-3 tags is typical; >5 tags is almost never right. "
                    "Empty array is acceptable if nothing fits."
                ),
                "items": {
                    "type": "string",
                    "enum": CATEGORIES,
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


_CATEGORY_GUIDE = """The 20 valid categories (pick by content topic, not audience):

ENFORCEMENT & OVERSIGHT:
- agency_enforcement: any federal-agency enforcement action (OSHA, FERC, FCC, NLRB, EPA, etc.)
- agency_warnings: pre-enforcement warnings (FDA warning letters, preliminary citations)
- oversight_findings: IG reports, GAO audits, oversight.gov aggregator
- securities_litigation: SEC enforcement, litigation releases, EDGAR filings
- campaign_finance: FEC enforcement (MURs)
- tax_enforcement: IRS / TIGTA actions

RECALLS & SAFETY:
- drug_recalls: pharmaceuticals
- food_recalls: food + cosmetics (FDA + USDA FSIS)
- device_recalls: medical devices
- vehicle_recalls: NHTSA
- consumer_product_recalls: CPSC
- workplace_safety: OSHA workplace incidents

COURTS & LEGAL:
- court_opinions: federal court decisions / opinions
- government_litigation: DOJ press releases, agency-as-plaintiff actions
- foia_logs: rows from agency FOIA request logs

SPENDING & POLICY:
- federal_contracts: contract awards, GAO bid protests, SAM.gov
- regulatory_dockets: regulations.gov rulemaking dockets
- legislation: Congress.gov bills, committee actions
- executive_actions: WH / agency rule announcements
- lobbying_ethics: Senate LDA, OGE filings, ethics matters
"""


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

{_CATEGORY_GUIDE}

CONSERVATIVE RULES:
- Tag with categories that match the signal's CONTENT — what it's about, not
  who might care.
- 1-3 categories is typical. If you're tagging more than 5, you're probably
  matching loosely; tighten up.
- Empty category_tags is acceptable if nothing fits cleanly. Do not stretch.
- Set priority=2 only if the signal clearly involves: a publicly traded company,
  a major federal agency action, a dollar amount in the millions+, or a named
  individual of public interest.
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
    or None on failure. Legacy callers should use this; the runner uses
    `extract_with_claude_instrumented` when it needs token counts.
    """
    extract, _in, _out = await extract_with_claude_instrumented(
        api_key, source_label, title, body_excerpt, timeout=timeout
    )
    return extract


async def extract_with_claude_instrumented(
    api_key: str,
    source_label: str,
    title: str,
    body_excerpt: str,
    timeout: float = 45.0,
) -> tuple[Optional[dict], int, int]:
    """Same as extract_with_claude but also returns (input_tokens, output_tokens)
    from the Anthropic API response. Used by the ingest runner for cost
    tracking; (0, 0) on failure.
    """
    if not api_key:
        return None, 0, 0

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
            return None, 0, 0

    usage = data.get("usage") or {}
    in_toks = int(usage.get("input_tokens") or 0)
    out_toks = int(usage.get("output_tokens") or 0)

    for block in data.get("content", []):
        if block.get("type") == "tool_use" and block.get("name") == "extract_signal":
            return block.get("input", {}) or {}, in_toks, out_toks

    logger.warning("Claude returned no tool_use block")
    return None, in_toks, out_toks


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

def _clamp_signal_date(d: Any) -> datetime:
    """Defensive clamp: future-dated signals (some upstream feeds — notably
    CourtListener's Atom <updated> field — emit hearing dates or scheduling
    metadata that point years into the future) sort to the top of the feed
    and poison pattern detection's recency window. Cap any signal_date at
    'now' so the feed stays sane regardless of feed quirks."""
    now = datetime.now(timezone.utc)
    if isinstance(d, str):
        try:
            d = datetime.fromisoformat(d.replace("Z", "+00:00"))
        except Exception:
            return now
    if not isinstance(d, datetime):
        return now
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d if d <= now else now


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
    category_tags: Optional[list[str]] = None,
) -> bool:
    """Idempotent upsert keyed on (source, source_id). Returns True on success.

    `category_tags` is the new Phase 2.5 field. `persona_tags` is still written
    (derived from category_tags via PERSONA_BUNDLES) for back-compat with the
    existing UI/API that filters by personas.
    """
    clamped = _clamp_signal_date(signal_date)
    row = {
        "source": source,
        "source_id": source_id,
        "title": title[:500],
        "summary": (summary or "")[:1000],
        "body_excerpt": (body_excerpt or "")[:5000],
        "source_url": source_url or "",
        "signal_date": clamped.isoformat(),
        "ingested_at": datetime.now(timezone.utc).isoformat(),
        "agency_codes": agency_codes or [],
        "entities": entities or {},
        "entity_slugs": build_entity_slugs(entities or {}, requester or ""),
        "category_tags": category_tags or [],
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

    summary       = extract.get("summary", "")
    entities      = extract.get("entities", {}) or {}
    # Union Claude's categories with the source's defaults so every signal
    # ends up with at least its source-natural tag (Phase 2.5).
    category_tags = categories_for_signal(source, extract.get("category_tags", []))
    priority      = extract.get("priority", 0)
    claude_requester = (extract.get("requester") or "").strip()

    # Personas are derived from categories now (Phase 2.5).
    persona_tags = derive_persona_tags(category_tags)

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
        category_tags=category_tags,
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
