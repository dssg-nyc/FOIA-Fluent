"""Generate AI-detected cross-source patterns from the recent signal corpus.

Runs daily on Railway cron (Phase 3.5+). Reads the most recent ~200 signals
from foia_signals_feed and asks Claude Sonnet 4 to identify up to 5 non-obvious
cross-source patterns. Conservative tuning — only patterns with verifiable
shared entities, convergent investigations, or quantitative clusters survive.

Run manually:
    cd backend
    python -m app.scripts.refresh_signal_patterns

Cadence: daily via Railway scheduled job (see SIGNALS_CRON.md).
"""
import asyncio
import json
import logging
import sys
import time
from datetime import datetime, timedelta, timezone

import httpx

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)

# Use Sonnet here — quality matters for the headline feature, and it's one
# big call per run not thousands of small calls, so cost stays modest (~$0.30/run).
PATTERN_MODEL = "claude-sonnet-4-20250514"
PATTERN_MAX_TOKENS = 4000
LOOKBACK_DAYS = 30
MAX_SIGNALS_PER_RUN = 200
MAX_PATTERNS_PER_RUN = 5

PATTERN_TYPES = [
    "compounding_risk",      # multi-agency exposure on a single entity
    "coordinated_activity",  # multiple journalists/orgs filing on the same topic
    "trend_shift",           # quantitative cluster (e.g. 5+ similar enforcement actions)
    "convergence",           # different signal types pointing at the same event
]


# Forced tool-use schema so the response is always parseable JSON
EXTRACT_PATTERNS_TOOL = {
    "name": "extract_signal_patterns",
    "description": "Identify non-obvious cross-source patterns from a corpus of FOIA signals.",
    "input_schema": {
        "type": "object",
        "required": ["patterns"],
        "properties": {
            "patterns": {
                "type": "array",
                "description": (
                    f"Up to {MAX_PATTERNS_PER_RUN} non-obvious patterns. "
                    f"It is OK to return fewer than {MAX_PATTERNS_PER_RUN} if the "
                    "corpus does not support that many CONCRETE patterns. "
                    "Better to return 0 patterns than to invent speculative ones."
                ),
                "items": {
                    "type": "object",
                    "required": ["title", "narrative", "pattern_type", "signal_ids", "non_obviousness_score"],
                    "properties": {
                        "title": {
                            "type": "string",
                            "description": "Short headline (under 100 chars). E.g. 'Compounding regulatory exposure on WH Group'.",
                        },
                        "narrative": {
                            "type": "string",
                            "description": (
                                "2-paragraph plain English explanation of the pattern. "
                                "First paragraph: what the pattern is and which signals join it. "
                                "Second paragraph: why a normal user would miss this if reading "
                                "the signals one at a time, and which personas would care."
                            ),
                        },
                        "pattern_type": {
                            "type": "string",
                            "enum": PATTERN_TYPES,
                        },
                        "signal_ids": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": (
                                "UUIDs of the source signals that anchor the pattern. "
                                "Must reference signal IDs that appear in the input corpus. "
                                "Minimum 2 IDs required."
                            ),
                        },
                        "entity_slugs": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": (
                                "Shared entity slugs (format 'type:slug') that anchor the pattern. "
                                "Optional — leave empty if the pattern is not entity-anchored."
                            ),
                        },
                        "persona_tags": {
                            "type": "array",
                            "items": {
                                "type": "string",
                                "enum": ["journalist", "pharma_analyst", "hedge_fund", "environmental"],
                            },
                            "description": "Which personas would value this pattern. Be conservative.",
                        },
                        "non_obviousness_score": {
                            "type": "integer",
                            "minimum": 0,
                            "maximum": 10,
                            "description": (
                                "How non-obvious is this pattern? "
                                "0 = anyone reading the feed would notice immediately. "
                                "10 = required reading 200 signals across 4 sources to spot."
                            ),
                        },
                    },
                },
            },
        },
    },
}


SYSTEM_PROMPT = """You are an intelligence analyst for a FOIA transparency platform.

Your job: read a corpus of recent FOIA-derived signals (enforcement actions, agency
warning letters, FOIA request logs, bid protest decisions) and identify CONCRETE
non-obvious patterns that join 2+ signals from different sources.

CONSERVATIVE RULES — NON-NEGOTIABLE:
- Only identify patterns where the connection is verifiable from the signal text.
- A "concrete connection" means one of:
  (a) Two or more signals share a NAMED ENTITY (company, person, agency, facility, statute citation)
  (b) Two or more signals describe the same event/contract/incident from different angles
  (c) Five or more signals reflect a clear quantitative cluster (e.g. 5+ similar enforcement actions in 30 days)
- REJECT any speculative connection. If you cannot find 5 patterns that meet this bar, return fewer.
  Returning 0 patterns is acceptable if the corpus does not support any.
- A pattern must reference at least 2 signal IDs from the input corpus. Use the EXACT UUIDs given.
- Do NOT invent facts. Every claim in your narrative must be grounded in the input signals.

A good pattern is something a normal user reading one signal at a time would MISS.
A bad pattern is something obvious from a single card in the feed.

Return your analysis via the extract_signal_patterns tool."""


def fetch_recent_signals(supabase) -> list[dict]:
    """Pull the most recent N signals from the feed for analysis."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=LOOKBACK_DAYS)).isoformat()
    try:
        result = (
            supabase.table("foia_signals_feed")
            .select("id,source,source_id,title,summary,signal_date,entity_slugs,persona_tags,requester")
            .gte("signal_date", cutoff)
            .order("signal_date", desc=True)
            .limit(MAX_SIGNALS_PER_RUN)
            .execute()
        )
        return result.data or []
    except Exception as e:
        logger.error("fetch_recent_signals failed: %s", e)
        return []


def build_corpus_text(signals: list[dict]) -> str:
    """Format the signal corpus as a single text block for Claude.
    Each signal is one bullet line with its UUID for grounding."""
    lines = []
    for s in signals:
        line = (
            f"- id={s['id']} | source={s['source']} | date={s.get('signal_date','')[:10]}\n"
            f"  title: {s.get('title','')[:160]}\n"
            f"  summary: {s.get('summary','')[:240]}\n"
        )
        if s.get("requester"):
            line += f"  requester: {s['requester']}\n"
        if s.get("entity_slugs"):
            line += f"  entities: {', '.join(s['entity_slugs'][:8])}\n"
        if s.get("persona_tags"):
            line += f"  personas: {', '.join(s['persona_tags'])}\n"
        lines.append(line)
    return "\n".join(lines)


async def extract_patterns_via_claude(api_key: str, corpus_text: str) -> list[dict]:
    """One Claude Sonnet call with forced tool-use. Returns the list of patterns."""
    if not api_key:
        return []

    user_message = (
        f"Here are {corpus_text.count('- id=')} recent FOIA signals from the past "
        f"{LOOKBACK_DAYS} days. Identify up to {MAX_PATTERNS_PER_RUN} non-obvious "
        f"cross-source patterns. Apply the conservative rules strictly.\n\n"
        f"=== CORPUS ===\n{corpus_text}\n=== END CORPUS ===\n\n"
        f"Use the extract_signal_patterns tool to return your analysis."
    )

    payload = {
        "model": PATTERN_MODEL,
        "max_tokens": PATTERN_MAX_TOKENS,
        "system": SYSTEM_PROMPT,
        "tools": [EXTRACT_PATTERNS_TOOL],
        "tool_choice": {"type": "tool", "name": "extract_signal_patterns"},
        "messages": [{"role": "user", "content": user_message}],
    }

    async with httpx.AsyncClient(timeout=httpx.Timeout(180.0)) as client:
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
            logger.error("Claude pattern extraction failed: %s", e)
            return []

    for block in data.get("content", []):
        if block.get("type") == "tool_use" and block.get("name") == "extract_signal_patterns":
            return (block.get("input") or {}).get("patterns", []) or []

    logger.warning("Claude returned no tool_use block")
    return []


def insert_patterns(supabase, patterns: list[dict], valid_signal_ids: set[str]) -> int:
    """Insert patterns into signal_patterns. Filters out patterns whose
    signal_ids reference UUIDs not in the input corpus (defensive against
    Claude hallucinating IDs)."""
    inserted = 0
    for p in patterns:
        try:
            sig_ids = [sid for sid in (p.get("signal_ids") or []) if sid in valid_signal_ids]
            if len(sig_ids) < 2:
                logger.warning("  skipping pattern %r — fewer than 2 valid signal IDs", p.get("title", "")[:60])
                continue

            row = {
                "title": (p.get("title") or "")[:300],
                "narrative": (p.get("narrative") or "").strip(),
                "pattern_type": (p.get("pattern_type") or "").strip(),
                "signal_ids": sig_ids,
                "entity_slugs": p.get("entity_slugs") or [],
                "persona_tags": p.get("persona_tags") or [],
                "non_obviousness_score": int(p.get("non_obviousness_score", 0) or 0),
                "visible": True,
            }
            supabase.table("signal_patterns").insert(row).execute()
            inserted += 1
            logger.info("  + [%d/10] %s (%d signals)",
                        row["non_obviousness_score"], row["title"][:80], len(sig_ids))
        except Exception as e:
            logger.warning("  insert failed for pattern %r: %s",
                           (p.get("title") or "?")[:60], e)
    return inserted


async def main():
    from app.config import settings

    if not settings.anthropic_api_key:
        logger.error("ANTHROPIC_API_KEY must be set")
        sys.exit(1)
    if not settings.supabase_url or not settings.supabase_service_key:
        logger.error("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set")
        sys.exit(1)

    from supabase import create_client
    supabase = create_client(settings.supabase_url, settings.supabase_service_key)

    started = time.monotonic()

    logger.info("Fetching last %d days of signals (max %d)", LOOKBACK_DAYS, MAX_SIGNALS_PER_RUN)
    signals = fetch_recent_signals(supabase)
    logger.info("Loaded %d signals for analysis", len(signals))

    if len(signals) < 5:
        logger.warning("Corpus too small for meaningful pattern detection (need >= 5). Exiting.")
        return

    corpus_text = build_corpus_text(signals)
    logger.info("Calling Claude Sonnet 4 with %d chars of corpus", len(corpus_text))

    patterns = await extract_patterns_via_claude(settings.anthropic_api_key, corpus_text)
    logger.info("Claude returned %d pattern candidates", len(patterns))

    if not patterns:
        logger.info("No patterns identified this run.")
        return

    valid_ids = {s["id"] for s in signals}
    inserted = insert_patterns(supabase, patterns, valid_ids)

    runtime = time.monotonic() - started
    logger.info("[signal_patterns] inserted=%d candidates=%d runtime=%.1fs",
                inserted, len(patterns), runtime)


if __name__ == "__main__":
    asyncio.run(main())
