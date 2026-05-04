"""Generate AI-detected cross-source patterns from the recent signal corpus.

Runs daily via the in-app dispatcher in `app.services.ingest.runner`
(`maybe_run_pattern_detection()`), which calls `run_pattern_detection()`
below at the end of any tick that ingests new signals (subject to a 12h
debounce).

Manual invocation:
    cd backend
    python -m app.scripts.refresh_signal_patterns
    python -m app.scripts.refresh_signal_patterns --dry-run     # print only, no DB
    python -m app.scripts.refresh_signal_patterns --replace     # delete existing
                                                                  # patterns first

Phase 3 anti-hallucination guardrails (see plan section 0):
  - Pattern shape adds `subtitle`, structured `narrative`, and `confidence`.
  - System prompt forbids inferred motive, partisan framing, and outside-corpus
    facts. Every claim must trace to text inside the cited signals.
  - Post-processing drops patterns where:
      * any signal_id is unknown to the input corpus
      * any entity_slug is not in any cited signal's entity_slugs
      * confidence == "low"
      * fewer than 2 valid signal_ids remain
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys
import time
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

from app.data.signal_categories import (
    CATEGORIES,
    derive_persona_tags,
    filter_categories,
)

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)

# Sonnet 4.6 — quality matters for the headline feature. One big call per
# run, ~$0.75/run with the wider corpus + Phase 3's structured narrative
# (which roughly doubles output size per pattern).
PATTERN_MODEL = "claude-sonnet-4-6"
# 16K headroom for 8 patterns × ~1.5K tokens each (title + subtitle + 3-field
# structured narrative + IDs + entity slugs + categories + score + confidence).
# 5K used to fit the legacy 2-paragraph narrative; Phase 3 doubled output size
# so 5K silently truncates and Claude returns an empty array.
PATTERN_MAX_TOKENS = 16000

# Phase 2.5: wider window, larger corpus, more patterns per run.
LOOKBACK_DAYS = 60
MAX_SIGNALS_PER_RUN = 400
MAX_PATTERNS_PER_RUN = 8

# How far back to scan for already-surfaced pattern titles (passed to Claude
# as "don't re-surface these unless meaningfully evolved" context).
DEDUP_LOOKBACK_DAYS = 7
DEDUP_MAX_TITLES = 30


# Pattern types — 4 original + 3 new for Phase 2.5's broader source mix.
PATTERN_TYPES = [
    # Original
    "compounding_risk",       # multi-agency exposure on one entity
    "coordinated_activity",   # multiple journalists/orgs filing on same topic
    "trend_shift",            # quantitative cluster (5+ similar enforcement actions)
    "convergence",            # different signal types pointing at same event

    # Phase 2.5
    "regulatory_cascade",     # one agency's action triggers a follow-on by another
                              # (e.g. FDA warning → SEC litigation → DOJ probe in 30d)
    "recall_to_litigation",   # product recall co-occurs with court / SEC action
                              # on same company (consumer-safety + hedge_fund signal)
    "oversight_to_action",    # IG report flags a program, enforcement hits it
                              # within ~60 days (oversight.gov → enforcement)
]


# Forced tool-use schema so the response is always parseable JSON.
#
# Phase 3: title/subtitle become consumer-readable; narrative becomes a
# 3-field object (story / why_it_matters / evidence) so the drawer can
# render labeled sections; confidence is added so we can drop low-quality
# patterns before they hit the dashboard.
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
                    "Better to return 0 patterns than to invent speculative ones. "
                    "Skip patterns substantially overlapping with the RECENT_PATTERNS "
                    "list — re-surface only if there's meaningful new evidence."
                ),
                "items": {
                    "type": "object",
                    "required": [
                        "title",
                        "subtitle",
                        "narrative",
                        "pattern_type",
                        "signal_ids",
                        "non_obviousness_score",
                        "confidence",
                    ],
                    "properties": {
                        "title": {
                            "type": "string",
                            "description": (
                                "Plain-language headline a curious non-expert can understand "
                                "at a glance. Format: a short noun phrase followed by a colon "
                                "or comma, then what is happening. "
                                "Example: 'FDA retail crackdown: a dozen convenience stores cited in three days'. "
                                "Use everyday nouns, not bureaucratese ('drug factories' not "
                                "'CGMP cited establishments', 'safety problems' not 'warning "
                                "letter wave'). Spell out acronyms unless universally known "
                                "(FDA, EPA, DOJ are OK; FERC, NHTSA, CIGIE need spelling out). "
                                "PUNCTUATION — NO em-dashes (—) and NO hyphenated compound "
                                "adjectives anywhere in the title. Use a colon, a comma, or "
                                "rephrase. Write 'tip over recalls' (two words) not "
                                "'tip-over recalls'; 'high resolution' not 'high-resolution'. "
                                "Max 70 chars. NO evaluative or partisan framing: describe "
                                "what was DONE per the signal text, not why or how badly."
                            ),
                        },
                        "subtitle": {
                            "type": "string",
                            "description": (
                                "One sentence (90-130 chars) that finishes the headline's "
                                "thought: who is affected, what is at stake per the signal text. "
                                "Plain English. Avoid restating the headline. "
                                "PUNCTUATION — NO em-dashes (—) and NO hyphenated compounds "
                                "in prose. Use periods, commas, or rephrase. "
                                "Example pair:\n"
                                "  title='FDA cites 8 overseas drug factories for falsified records'\n"
                                "  subtitle='Plants in India and China supplied generic prescription drugs sold in U.S. pharmacies, per FDA letters.'\n"
                                "Do NOT speculate about consequences not visible in the corpus."
                            ),
                        },
                        "narrative": {
                            "type": "object",
                            "required": ["story", "why_it_matters", "evidence"],
                            "properties": {
                                "story": {
                                    "type": "string",
                                    "description": (
                                        "1-2 sentences in plain English describing what the cited "
                                        "signals TOGETHER show. Factual summary, not a "
                                        "characterization. Every noun and verb must be supported "
                                        "by signal text. Neutral, non-partisan phrasing only."
                                    ),
                                },
                                "why_it_matters": {
                                    "type": "string",
                                    "description": (
                                        "2-3 sentences naming the concrete consequence visible "
                                        "from the signals (e.g. 'this overlaps with an open SEC "
                                        "investigation, per signal X'). Do NOT speculate about "
                                        "reputation, market reaction, political fallout, or "
                                        "motive. If the consequence is not visible in the signal "
                                        "text, write 'The signals do not yet show downstream "
                                        "consequences.' instead of guessing."
                                    ),
                                },
                                "evidence": {
                                    "type": "string",
                                    "description": (
                                        "One paragraph that walks through the connected signals "
                                        "one by one, naming each by its source and date in plain "
                                        "English ('an EPA enforcement action filed Feb 12', NOT "
                                        "'epa_echo source row'). Quote short fragments from "
                                        "signal titles or summaries when appropriate. Do NOT add "
                                        "facts not in the signal text. Do NOT name entities "
                                        "outside `entity_slugs`."
                                    ),
                                },
                            },
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
                                "Minimum 2, prefer 3-6."
                            ),
                        },
                        "entity_slugs": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": (
                                "Shared entity slugs (format 'type:slug') that anchor the pattern. "
                                "Every slug listed here MUST appear in at least one cited signal's "
                                "entity_slugs in the input corpus — do not bring in outside-knowledge "
                                "entities (parent companies, related figures) not present in the data."
                            ),
                        },
                        "category_tags": {
                            "type": "array",
                            "items": {"type": "string", "enum": CATEGORIES},
                            "description": (
                                "Content categories this pattern spans. Pick from the same "
                                "20-category taxonomy used to tag individual signals."
                            ),
                        },
                        "non_obviousness_score": {
                            "type": "integer",
                            "minimum": 0,
                            "maximum": 10,
                            "description": (
                                "How non-obvious is this pattern? "
                                "0 = anyone reading the feed would notice immediately. "
                                "10 = required reading hundreds of signals across many "
                                "sources to spot."
                            ),
                        },
                        "confidence": {
                            "type": "string",
                            "enum": ["high", "medium", "low"],
                            "description": (
                                "high = every claim is directly supported by 3+ signals citing "
                                "the same entity / event / cascade. medium = supported by 2 "
                                "signals, or by 3+ where one or two claims are inferential. "
                                "low = the connection is plausible but several claims rest on "
                                "a single signal or require outside knowledge. PREFER returning "
                                "fewer high-confidence patterns to many medium/low ones. "
                                "Patterns marked `low` will be discarded."
                            ),
                        },
                    },
                },
            },
        },
    },
}


SYSTEM_PROMPT = """You are an intelligence analyst for a FOIA transparency platform.

Your job: read a corpus of recent FOIA-derived signals (enforcement actions,
warning letters, recalls, court filings, IG reports, congressional bills,
regulatory dockets, FOIA logs) and identify CONCRETE non-obvious patterns
that join 2+ signals from different sources or time periods.

GROUNDING — NON-NEGOTIABLE (failing any of these voids the pattern):
- Every claim in `title`, `subtitle`, and every sub-field of `narrative` must
  be supported by the explicit text of one or more signal IDs you list in
  `signal_ids`. If you cannot point to the source line, leave the claim out.
- Do NOT generalize from one example to a trend. A pattern requires 2+
  corroborating signals. If only one signal supports a claim, drop the claim.
- Do NOT infer motive, intent, partisan alignment, or political characterization.
  Describe what an agency or actor *did* per the signal text, not why.
  No 'crackdown', no 'attack', no 'targeting', no 'chilling effect' — unless
  the signal text uses that exact framing.
- Use neutral, descriptive verbs: 'cited', 'filed', 'recalled', 'opened a docket',
  'subpoenaed', 'awarded', 'denied'. AVOID evaluative verbs: 'failed',
  'botched', 'mishandled', 'covered up', 'rammed through'.

PUNCTUATION + STYLE — applies to title, subtitle, and every narrative field:
- NO em-dashes (—). Use a colon, a comma, a period, or rephrase. Em-dashes
  read as editorial flourish; this is a documentation surface, not an essay.
- NO hyphenated compound adjectives in prose. Write 'tip over hazard' not
  'tip-over hazard'; 'high resolution images' not 'high-resolution images';
  'real time feed' not 'real-time feed'.
- KEEP hyphens ONLY where they appear in formal proper names that are always
  hyphenated (statute names, model numbers, software identifiers).
- Do NOT name parties, candidates, or political figures unless they appear in
  the signal text. Do NOT make claims about elections, campaigns, or party
  policy positions.
- If signal coverage is thin (e.g., only one source covered an event), say so
  explicitly. 'Three EPA enforcement actions' is fine; 'an EPA crackdown' is
  editorial.
- Every entity named in any narrative field must appear in `entity_slugs` of
  at least one cited signal. Do NOT bring in outside-knowledge entities
  (e.g. a parent company not in the signal text).
- The platform is non-partisan. Apply the above uniformly regardless of which
  agency, company, or actor is involved.

CONNECTION RULES — what counts as a real pattern:
- A "concrete connection" means one of:
  (a) 2+ signals share a NAMED ENTITY (company, person, agency, statute)
  (b) 2+ signals describe the same event/contract/incident from different angles
      (e.g. recall + SEC litigation + DOJ press)
  (c) A temporal cascade: agency A's action → agency B's follow-on within a clear
      window (regulatory_cascade, oversight_to_action)
  (d) Five or more signals reflect a clear quantitative cluster
- `coordinated_activity` requires either (a) explicit shared participants named
  across signals, or (b) 4+ signals about the same regulatory standard, recall
  reason, or program in a 14-day window. Two unrelated bills moving the same
  week does NOT qualify.

EXPECTED YIELD:
- A 400-signal corpus across 19 federal sources WILL contain real cross-source
  patterns — companies cited by multiple agencies, recall waves on a single
  product category, oversight findings followed by enforcement, and so on.
  Aim to surface 5-{max_patterns} CONCRETE patterns per run.
- Returning fewer than 5 is acceptable only if the corpus genuinely lacks
  cross-source connections. Returning 0 should be very rare.
- The grounding rules above are about HOW to write each pattern, not whether
  to surface it. If the connection is real and supported by signal text,
  surface it.

CONFIDENCE:
- Mark each pattern `high`, `medium`, or `low`. Patterns marked `low` will be
  discarded by the system before storage. Mark high when 3+ signals support
  every claim; mark medium when 2 signals or a few claims are inferential.

DEDUP:
- The RECENT_PATTERNS section lists pattern titles surfaced in the last
  {dedup_days} days. SKIP patterns that substantially overlap with these
  unless you have NEW evidence signals that materially change the story.

A good pattern is something a normal user reading one signal at a time would
MISS. A bad pattern is something obvious from a single card, or something that
requires inference beyond the signal text.

Return your analysis via the extract_signal_patterns tool."""


def fetch_recent_signals(supabase) -> list[dict]:
    """Pull the most recent N signals from the feed for analysis."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=LOOKBACK_DAYS)).isoformat()
    try:
        result = (
            supabase.table("foia_signals_feed")
            .select(
                "id,source,source_id,title,summary,signal_date,entity_slugs,"
                "category_tags,persona_tags,requester"
            )
            .gte("signal_date", cutoff)
            .order("signal_date", desc=True)
            .limit(MAX_SIGNALS_PER_RUN)
            .execute()
        )
        return result.data or []
    except Exception as e:
        logger.error("fetch_recent_signals failed: %s", e)
        return []


def fetch_recent_pattern_titles(supabase) -> list[str]:
    """Titles of patterns generated in the last N days, passed to Claude as
    'already surfaced — skip unless new evidence'."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=DEDUP_LOOKBACK_DAYS)).isoformat()
    try:
        result = (
            supabase.table("signal_patterns")
            .select("title")
            .gte("generated_at", cutoff)
            .order("generated_at", desc=True)
            .limit(DEDUP_MAX_TITLES)
            .execute()
        )
        return [r["title"] for r in (result.data or []) if r.get("title")]
    except Exception as e:
        logger.warning("fetch_recent_pattern_titles failed: %s", e)
        return []


def build_corpus_text(signals: list[dict]) -> str:
    """Format the signal corpus as one bullet list, one signal per line group."""
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
        if s.get("category_tags"):
            line += f"  categories: {', '.join(s['category_tags'])}\n"
        lines.append(line)
    return "\n".join(lines)


async def extract_patterns_via_claude(
    api_key: str,
    corpus_text: str,
    recent_titles: list[str],
) -> list[dict]:
    """One Claude Sonnet call with forced tool-use. Returns the list of patterns."""
    if not api_key:
        return []

    dedup_block = ""
    if recent_titles:
        bullets = "\n".join(f"  - {t}" for t in recent_titles[:DEDUP_MAX_TITLES])
        dedup_block = (
            f"\n\nRECENT_PATTERNS (already surfaced in the last {DEDUP_LOOKBACK_DAYS} days "
            f"— skip unless new evidence):\n{bullets}\n"
        )

    user_message = (
        f"Here are {corpus_text.count('- id=')} recent FOIA signals from the past "
        f"{LOOKBACK_DAYS} days. Identify up to {MAX_PATTERNS_PER_RUN} non-obvious "
        f"cross-source patterns. Apply the conservative rules strictly."
        f"{dedup_block}\n\n"
        f"=== CORPUS ===\n{corpus_text}\n=== END CORPUS ===\n\n"
        f"Use the extract_signal_patterns tool to return your analysis."
    )

    payload = {
        "model": PATTERN_MODEL,
        "max_tokens": PATTERN_MAX_TOKENS,
        "system": SYSTEM_PROMPT.format(
            max_patterns=MAX_PATTERNS_PER_RUN,
            dedup_days=DEDUP_LOOKBACK_DAYS,
        ),
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

    # Log Claude's stop reason and any text blocks for diagnostics. When the
    # model returns an empty patterns array, the text block usually explains
    # why ("the corpus is mostly routine enforcement, no cross-source pattern
    # qualifies under the rules").
    stop_reason = data.get("stop_reason")
    usage = data.get("usage", {})
    logger.info(
        "Claude response: stop_reason=%s in_tokens=%s out_tokens=%s",
        stop_reason, usage.get("input_tokens"), usage.get("output_tokens"),
    )
    for block in data.get("content", []):
        btype = block.get("type")
        if btype == "text":
            text = (block.get("text") or "").strip()
            if text:
                logger.info("Claude text block: %s", text[:600])
        elif btype == "tool_use" and block.get("name") == "extract_signal_patterns":
            patterns = (block.get("input") or {}).get("patterns", []) or []
            if not patterns:
                logger.warning(
                    "Claude returned empty patterns array — model "
                    "decided no pattern in the 400-signal corpus meets the rules. "
                    "Check the system prompt's caution-vs-find balance."
                )
            return patterns

    logger.warning("Claude returned no tool_use block")
    return []


def _validate_pattern(
    p: dict,
    *,
    valid_signal_ids: set[str],
    signal_entity_slugs_by_id: dict[str, set[str]],
) -> tuple[bool, str, list[str], list[str]]:
    """Phase 3 grounding guards. Returns (ok, reason, kept_signal_ids, kept_entity_slugs).

    Drops the pattern if:
      - confidence is "low"
      - fewer than 2 of its signal_ids exist in the input corpus
      - any entity_slug is not present in any cited signal's entity_slugs
        (we filter those out rather than reject the whole pattern, but if
         every slug is dropped we keep the pattern minus its entity anchor).
    """
    confidence = (p.get("confidence") or "high").strip().lower()
    if confidence not in {"high", "medium"}:
        return False, f"confidence={confidence!r}", [], []

    raw_ids = p.get("signal_ids") or []
    sig_ids = [sid for sid in raw_ids if sid in valid_signal_ids]
    if len(sig_ids) < 2:
        return (
            False,
            f"only {len(sig_ids)} of {len(raw_ids)} signal_ids exist in corpus",
            sig_ids,
            [],
        )

    raw_slugs = p.get("entity_slugs") or []
    valid_slugs_for_pattern: set[str] = set()
    for sid in sig_ids:
        valid_slugs_for_pattern |= signal_entity_slugs_by_id.get(sid, set())
    kept_slugs = [s for s in raw_slugs if s in valid_slugs_for_pattern]

    return True, "ok", sig_ids, kept_slugs


# Threshold for treating two patterns as the same underlying cluster. Tuned
# from production data: legit re-detections on overlapping evidence fall in
# 0.6–1.0; distinct clusters that happen to share one signal fall below 0.3.
# 0.5 is the safe gap.
SIGNAL_OVERLAP_DEDUP_THRESHOLD = 0.5


def _signal_jaccard(a: list[str], b: list[str]) -> float:
    """Jaccard similarity on signal_id sets. 0.0 if either side is empty."""
    A = set(a or [])
    B = set(b or [])
    if not A or not B:
        return 0.0
    return len(A & B) / len(A | B)


def insert_patterns(
    supabase,
    patterns: list[dict],
    *,
    valid_signal_ids: set[str],
    signal_entity_slugs_by_id: dict[str, set[str]],
    dry_run: bool = False,
) -> dict[str, int]:
    """Insert patterns into signal_patterns with Phase 3 grounding guards.

    Includes signal-overlap dedup: if a candidate's signal_ids overlap an
    existing visible pattern's by Jaccard ≥ SIGNAL_OVERLAP_DEDUP_THRESHOLD,
    the older row is deleted and the new one inserted in its place. This
    catches the case where Claude rephrases a previously-surfaced cluster
    on a later run (the title-string dedup-context is too weak on its own
    because each run produces a slightly different headline).

    Returns a dict with insert/drop/replace counters per reason."""
    counters = {
        "inserted": 0,
        "replaced": 0,
        "dropped_confidence": 0,
        "dropped_signals": 0,
        "errors": 0,
    }

    # Snapshot existing visible patterns once. We keep the in-memory list
    # in sync as we delete/insert so candidates within the same run also
    # dedupe against each other.
    existing_visible: list[dict] = []
    if not dry_run:
        try:
            result = (
                supabase.table("signal_patterns")
                .select("id,title,signal_ids,generated_at")
                .eq("visible", True)
                .execute()
            )
            existing_visible = result.data or []
            logger.info(
                "Overlap dedup: snapshot %d existing visible patterns",
                len(existing_visible),
            )
        except Exception as e:
            logger.warning("Overlap dedup: snapshot fetch failed: %s", e)

    for p in patterns:
        title_short = (p.get("title") or "?")[:60]
        ok, reason, sig_ids, kept_slugs = _validate_pattern(
            p,
            valid_signal_ids=valid_signal_ids,
            signal_entity_slugs_by_id=signal_entity_slugs_by_id,
        )
        if not ok:
            if reason.startswith("confidence="):
                counters["dropped_confidence"] += 1
            else:
                counters["dropped_signals"] += 1
            logger.info("  ✗ DROP  %s — %s", title_short, reason)
            continue

        # Categories on the pattern; derive persona_tags from them so the
        # legacy persona-filter UI keeps working.
        cats = filter_categories(p.get("category_tags") or [])
        personas = derive_persona_tags(cats)

        # Narrative is now an object — JSON-encode for storage in the TEXT
        # column. Backward-compatible: legacy rows are plain strings, the
        # frontend renders both shapes.
        narrative_obj = p.get("narrative")
        if isinstance(narrative_obj, dict):
            narrative_serialized = json.dumps(narrative_obj, ensure_ascii=False)
        else:
            narrative_serialized = (narrative_obj or "").strip()

        row = {
            "title": (p.get("title") or "")[:300],
            "subtitle": (p.get("subtitle") or "")[:400],
            "narrative": narrative_serialized,
            "pattern_type": (p.get("pattern_type") or "").strip(),
            "signal_ids": sig_ids,
            "entity_slugs": kept_slugs,
            "persona_tags": personas,
            "non_obviousness_score": int(p.get("non_obviousness_score", 0) or 0),
            "confidence": (p.get("confidence") or "high").strip().lower(),
            "visible": True,
        }

        if dry_run:
            counters["inserted"] += 1
            logger.info(
                "  ✓ DRY   [%s · %d/10] %s",
                row["confidence"], row["non_obviousness_score"], row["title"][:80],
            )
            continue

        # Signal-overlap dedup: if a previously-surfaced pattern shares
        # ≥ threshold of its evidence signals with this candidate, treat
        # them as the same cluster. Delete the older row before inserting
        # so the freshest title/narrative wins.
        overlap_match: dict | None = None
        for ev in existing_visible:
            if (
                _signal_jaccard(sig_ids, ev.get("signal_ids") or [])
                >= SIGNAL_OVERLAP_DEDUP_THRESHOLD
            ):
                overlap_match = ev
                break
        if overlap_match:
            try:
                supabase.table("signal_patterns").delete().eq(
                    "id", overlap_match["id"]
                ).execute()
                existing_visible = [
                    e for e in existing_visible if e["id"] != overlap_match["id"]
                ]
                counters["replaced"] += 1
                logger.info(
                    "  ↻ REPLACE older %s — %s",
                    overlap_match["id"][:8],
                    (overlap_match.get("title") or "")[:60],
                )
            except Exception as e:
                logger.warning("  ! REPLACE delete failed: %s", str(e)[:200])

        try:
            inserted = supabase.table("signal_patterns").insert(row).execute()
            counters["inserted"] += 1
            # Track the new row so subsequent candidates in this run also
            # dedupe against it (Claude occasionally returns two near-twin
            # clusters in one shot).
            inserted_id = None
            if inserted and getattr(inserted, "data", None):
                inserted_id = (inserted.data[0] or {}).get("id")
            existing_visible.append(
                {
                    "id": inserted_id or "new",
                    "title": row["title"],
                    "signal_ids": sig_ids,
                    "generated_at": "",
                }
            )
            logger.info(
                "  ✓ INS   [%s · %d/10] %s (%d signals, cats=%s)",
                row["confidence"],
                row["non_obviousness_score"],
                row["title"][:80],
                len(sig_ids),
                cats,
            )
        except Exception as e:
            counters["errors"] += 1
            logger.warning("  ! ERR   %s — %s", title_short, str(e)[:200])

    return counters


# ── Public entry point — used by both the CLI wrapper and the in-app
#    dispatcher (app.services.ingest.runner.maybe_run_pattern_detection).

async def run_pattern_detection(
    *, dry_run: bool = False, replace: bool = False
) -> dict[str, Any]:
    """Run one full pattern-detection cycle. Idempotent. Returns a status
    dict suitable for logging or returning from an admin endpoint.

    Args:
        dry_run: extract via Claude but do NOT write to Supabase. Useful
            for previewing prompt changes without committing them.
        replace: delete all existing rows from signal_patterns before
            inserting the new ones. Use for a one-shot regeneration that
            should fully replace the corpus rather than append.
    """
    from app.config import settings

    if not settings.anthropic_api_key:
        return {"status": "error", "error": "ANTHROPIC_API_KEY not set"}
    if not settings.supabase_url or not settings.supabase_service_key:
        return {"status": "error", "error": "SUPABASE_URL / SUPABASE_SERVICE_KEY not set"}

    from supabase import create_client
    supabase = create_client(settings.supabase_url, settings.supabase_service_key)

    started = time.monotonic()

    logger.info(
        "Pattern detection: lookback=%dd cap=%d signals max=%d patterns "
        "dry_run=%s replace=%s",
        LOOKBACK_DAYS, MAX_SIGNALS_PER_RUN, MAX_PATTERNS_PER_RUN, dry_run, replace,
    )

    signals = fetch_recent_signals(supabase)
    logger.info("Loaded %d signals for analysis", len(signals))

    if len(signals) < 5:
        runtime = time.monotonic() - started
        logger.warning(
            "Corpus too small (%d < 5). Skipping pattern detection.", len(signals)
        )
        return {
            "status": "skipped_small_corpus",
            "signals": len(signals),
            "patterns_inserted": 0,
            "runtime_seconds": round(runtime, 1),
        }

    # Skip the dedup-context query when --replace is set: we want the model
    # to regenerate the corpus from scratch, not to "skip" titles that the
    # caller is explicitly asking to overwrite.
    if replace:
        recent_titles: list[str] = []
        logger.info("Replace mode: skipping dedup context")
    else:
        recent_titles = fetch_recent_pattern_titles(supabase)
        if recent_titles:
            logger.info("Dedup context: %d recent pattern titles", len(recent_titles))

    corpus_text = build_corpus_text(signals)
    logger.info("Calling Claude with %d chars of corpus", len(corpus_text))

    patterns = await extract_patterns_via_claude(
        settings.anthropic_api_key, corpus_text, recent_titles
    )
    logger.info("Claude returned %d pattern candidates", len(patterns))

    # Build entity-slug index for grounding validation.
    valid_ids = {s["id"] for s in signals}
    signal_entity_slugs_by_id: dict[str, set[str]] = {}
    for s in signals:
        signal_entity_slugs_by_id[s["id"]] = set(s.get("entity_slugs") or [])

    # Replace-mode delete is gated on Claude returning at least one candidate
    # so a bad prompt or rate-limit response can't leave the table empty.
    if replace and not dry_run and len(patterns) > 0:
        try:
            # Postgres requires a WHERE clause on DELETE via PostgREST. The
            # `not is null` predicate matches every row.
            supabase.table("signal_patterns").delete().not_.is_("id", "null").execute()
            logger.info("Replace mode: cleared signal_patterns")
        except Exception as e:
            logger.warning("Replace mode: clear failed: %s", e)
    elif replace and not dry_run:
        logger.warning(
            "Replace mode: skipping clear because Claude returned 0 candidates "
            "(would have left the table empty)"
        )

    counters = insert_patterns(
        supabase,
        patterns,
        valid_signal_ids=valid_ids,
        signal_entity_slugs_by_id=signal_entity_slugs_by_id,
        dry_run=dry_run,
    )

    runtime = time.monotonic() - started
    logger.info(
        "[signal_patterns] candidates=%d inserted=%d replaced=%d "
        "dropped_confidence=%d dropped_signals=%d errors=%d runtime=%.1fs",
        len(patterns),
        counters["inserted"],
        counters["replaced"],
        counters["dropped_confidence"],
        counters["dropped_signals"],
        counters["errors"],
        runtime,
    )
    return {
        "status": "succeeded",
        "signals": len(signals),
        "candidates": len(patterns),
        "patterns_inserted": counters["inserted"],
        "patterns_replaced": counters["replaced"],
        "dropped_confidence": counters["dropped_confidence"],
        "dropped_signals": counters["dropped_signals"],
        "errors": counters["errors"],
        "dry_run": dry_run,
        "replace": replace,
        "runtime_seconds": round(runtime, 1),
    }


# ── CLI wrapper for manual invocation ──────────────────────────────────────

async def main():
    parser = argparse.ArgumentParser(description="Run pattern detection.")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Extract patterns but do not write to the database. "
             "Useful for previewing prompt changes.",
    )
    parser.add_argument(
        "--replace",
        action="store_true",
        help="Delete all existing patterns before inserting. Phase 3 "
             "regeneration uses this to fully replace the legacy corpus "
             "rather than append.",
    )
    args = parser.parse_args()

    result = await run_pattern_detection(dry_run=args.dry_run, replace=args.replace)
    if result.get("status") == "error":
        logger.error("pattern detection error: %s", result.get("error"))
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
