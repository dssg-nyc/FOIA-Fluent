"""pdf_vision fetch strategy — crawl a FOIA log index, download recent PDFs,
Claude-multimodal-extract structured rows per PDF.

Items come back **pre-extracted** (summary, entities, persona_tags already set)
so the runner skips the per-item Claude call.

fetch_config:
  index_url:                str  — the FOIA-logs index page
  base_url:                 str  — prefix for relative hrefs
  component_link_pattern:   str  — regex for per-component FOIA log pages
  pdf_link_pattern:         str  — regex for PDF hrefs on those pages
  newest_sort_pattern:      str  — regex with groups (YYYY)(MM) to pick newest PDF
  max_entries_per_pdf:      int  — cap on rows pulled from a single PDF
  claude_model:             str  — Claude model for vision extraction
  claude_max_output_tokens: int  — output cap
"""
from __future__ import annotations

import asyncio
import base64
import logging
import re
from datetime import datetime, timezone

import httpx

from app.config import settings
from app.data.signals_sources import SourceConfig
from app.scripts._signals_common import PILOT_PERSONAS
from app.services.ingest.types import Extracted, RawItem

logger = logging.getLogger(__name__)

USER_AGENT = "FOIAFluent-Signals/1.0 (+https://www.foiafluent.com)"

EXTRACT_LOG_TOOL = {
    "name": "extract_foia_log_entries",
    "description": "Extract structured FOIA request log entries from a PDF.",
    "input_schema": {
        "type": "object",
        "required": ["entries"],
        "properties": {
            "entries": {
                "type": "array",
                "description": (
                    "FOIA request log rows extracted from the PDF. "
                    "Return at most the requested number of the MOST RECENT entries "
                    "(by received date). Skip header/footer rows."
                ),
                "items": {
                    "type": "object",
                    "required": ["request_id", "summary"],
                    "properties": {
                        "request_id":    {"type": "string"},
                        "requester":     {"type": "string"},
                        "organization":  {"type": "string"},
                        "subject":       {"type": "string"},
                        "received_date": {"type": "string", "description": "YYYY-MM-DD"},
                        "disposition":   {"type": "string"},
                        "summary":       {"type": "string"},
                        "persona_tags": {
                            "type": "array",
                            "items": {"type": "string", "enum": PILOT_PERSONAS},
                        },
                    },
                },
            },
        },
    },
}


def _parse_iso_date(s: str) -> datetime:
    if not s:
        return datetime.now(timezone.utc)
    s = s.strip()
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y"):
        try:
            return datetime.strptime(s, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return datetime.now(timezone.utc)


async def _find_component_pages(client: httpx.AsyncClient, cfg: SourceConfig) -> list[str]:
    fc = cfg.fetch_config
    index_url = fc["index_url"]
    base_url = fc.get("base_url") or ""
    try:
        resp = await client.get(index_url, headers={"User-Agent": USER_AGENT}, timeout=60.0)
        resp.raise_for_status()
    except Exception as e:
        logger.error(f"{cfg.source_id}: index fetch failed: {e}")
        return []

    pattern = re.compile(fc["component_link_pattern"], re.IGNORECASE)
    hrefs: list[str] = []
    for href in pattern.findall(resp.text):
        full = href if href.startswith("http") else f"{base_url}{href}"
        if full == index_url:
            continue
        if full not in hrefs:
            hrefs.append(full)
    return hrefs


async def _find_pdf_links(client: httpx.AsyncClient, cfg: SourceConfig, page_url: str) -> list[str]:
    fc = cfg.fetch_config
    base_url = fc.get("base_url") or ""
    try:
        resp = await client.get(page_url, headers={"User-Agent": USER_AGENT}, timeout=60.0)
        resp.raise_for_status()
    except Exception as e:
        logger.warning(f"  fetch failed for {page_url}: {e}")
        return []

    pattern = re.compile(fc["pdf_link_pattern"], re.IGNORECASE)
    links: list[str] = []
    for href in pattern.findall(resp.text):
        if href.startswith("/"):
            href = f"{base_url}{href}"
        if href not in links:
            links.append(href)
    return links


def _newest_pdf(pdf_urls: list[str], sort_pattern: str) -> str | None:
    if not pdf_urls:
        return None
    sort_re = re.compile(sort_pattern)

    def key(url: str) -> str:
        m = sort_re.search(url)
        return f"{m.group(1)}{m.group(2)}" if m else "000000"

    return sorted(pdf_urls, key=key, reverse=True)[0]


async def _extract_entries_from_pdf(
    api_key: str, pdf_bytes: bytes, cfg: SourceConfig
) -> tuple[list[dict], int, int]:
    """Returns (entries, input_tokens, output_tokens)."""
    fc = cfg.fetch_config
    pdf_b64 = base64.standard_b64encode(pdf_bytes).decode("ascii")

    prompt = (
        f"This is a {cfg.label} — a FOIA request log published by an agency or component. "
        f"Each row represents one FOIA request the agency received from the public.\n\n"
        f"Extract the {fc['max_entries_per_pdf']} MOST RECENT entries (by received date) using the "
        f"extract_foia_log_entries tool. Skip header rows, footer rows, and obviously broken rows. "
        f"For each entry, generate a 1-sentence plain English summary and conservatively tag "
        f"any of the 4 personas (journalist, pharma_analyst, hedge_fund, environmental) where "
        f"the relevance is direct and verifiable."
    )

    payload = {
        "model": fc["claude_model"],
        "max_tokens": fc["claude_max_output_tokens"],
        "tools": [EXTRACT_LOG_TOOL],
        "tool_choice": {"type": "tool", "name": "extract_foia_log_entries"},
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "document",
                        "source": {
                            "type": "base64",
                            "media_type": "application/pdf",
                            "data": pdf_b64,
                        },
                    },
                    {"type": "text", "text": prompt},
                ],
            }
        ],
    }

    async with httpx.AsyncClient(timeout=httpx.Timeout(300.0)) as client:
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
            logger.warning(f"  Claude PDF extraction failed: {e}")
            return [], 0, 0

    usage = data.get("usage") or {}
    in_toks = int(usage.get("input_tokens") or 0)
    out_toks = int(usage.get("output_tokens") or 0)

    for block in data.get("content", []):
        if block.get("type") == "tool_use" and block.get("name") == "extract_foia_log_entries":
            entries = (block.get("input") or {}).get("entries", [])
            return entries[: fc["max_entries_per_pdf"]], in_toks, out_toks

    logger.warning("  Claude returned no tool_use block")
    return [], in_toks, out_toks


def _entry_to_raw_item(
    entry: dict, cfg: SourceConfig, pdf_url: str, component_url: str
) -> RawItem | None:
    request_id = (entry.get("request_id") or "").strip()
    if not request_id:
        return None

    requester = (entry.get("requester") or "").strip()
    organization = (entry.get("organization") or "").strip()
    subject = (entry.get("subject") or "").strip()
    summary = (entry.get("summary") or "").strip()
    received_date = (entry.get("received_date") or "").strip()
    disposition = (entry.get("disposition") or "").strip()
    persona_tags = [p for p in (entry.get("persona_tags") or []) if p in PILOT_PERSONAS]

    requester_display = organization or requester or "Member of Public"

    title_parts = [request_id]
    if subject:
        title_parts.append(f"— {subject[:120]}")
    title = " ".join(title_parts)[:500]

    body_lines = [f"FOIA request {request_id}", f"Filed by: {requester_display}"]
    if requester and requester != requester_display:
        body_lines.append(f"Individual requester: {requester}")
    if subject:
        body_lines.append(f"Subject: {subject}")
    if disposition:
        body_lines.append(f"Disposition: {disposition}")
    if received_date:
        body_lines.append(f"Received: {received_date}")
    body = "\n".join(body_lines)

    entities: dict[str, list[str]] = {}
    if requester and requester not in (organization, "Member of Public"):
        entities["people"] = [requester]
    if organization:
        entities["companies"] = [organization]

    return RawItem(
        source_id=request_id,
        title=title,
        body_excerpt=body,
        source_url=pdf_url,
        signal_date=_parse_iso_date(received_date),
        default_agency_codes=list(cfg.agency_codes),
        extra_metadata={
            "request_id": request_id,
            "subject": subject,
            "disposition": disposition,
            "component_page": component_url,
            "pdf_url": pdf_url,
        },
        requester=requester_display,
        pre_extracted=Extracted(
            summary=summary,
            entities=entities,
            persona_tags=persona_tags,
            priority=1 if organization else 0,
        ),
    )


def _already_processed_pdfs(supabase, source_id: str, lookback_runs: int = 30) -> set[str]:
    """Aggregate `metadata.processed_pdfs` URLs from this source's recent
    successful runs. PDFs in the returned set are skipped this time around —
    each PDF is one Claude vision call and DHS publishes quarterly so the
    same PDF lingers for ~90 days.
    """
    try:
        rows = (
            supabase.table("signals_source_runs")
            .select("metadata")
            .eq("source_id", source_id)
            .eq("status", "succeeded")
            .order("started_at", desc=True)
            .limit(lookback_runs)
            .execute()
        ).data or []
    except Exception as e:
        logger.warning(f"{source_id}: pdf-dedup lookup failed: {e}")
        return set()
    seen: set[str] = set()
    for row in rows:
        md = row.get("metadata") or {}
        for url in md.get("processed_pdfs", []):
            if isinstance(url, str):
                seen.add(url)
    return seen


async def fetch(cfg: SourceConfig, *, result=None) -> list[RawItem]:
    """Crawl FOIA-log index, download recent PDFs (skipping ones we've already
    processed in any recent successful run), Claude-multimodal-extract entries.

    `result` is the in-flight RunResult; we stash this run's PDF URLs in
    `result.metadata['processed_pdfs']` so the next run can dedup against
    them.
    """
    if not settings.anthropic_api_key:
        logger.error(f"{cfg.source_id}: ANTHROPIC_API_KEY not set")
        return []

    fc = cfg.fetch_config
    max_pdfs = cfg.max_items_per_run  # for pdf_vision, max_items_per_run = PDF count

    # PDF-URL dedup: skip any URL we've already extracted in a recent run.
    already_seen: set[str] = set()
    try:
        from app.services.agency_profiles import _get_supabase
        sb = _get_supabase()
        if sb:
            already_seen = _already_processed_pdfs(sb, cfg.source_id)
    except Exception as e:
        logger.warning(f"{cfg.source_id}: pdf-dedup setup failed (continuing without dedup): {e}")

    async with httpx.AsyncClient(follow_redirects=True) as client:
        component_pages = await _find_component_pages(client, cfg)
        logger.info(f"{cfg.source_id}: found {len(component_pages)} component pages")

        pdf_jobs: list[tuple[str, str]] = []
        for cp in component_pages:
            pdfs = await _find_pdf_links(client, cfg, cp)
            newest = _newest_pdf(pdfs, fc["newest_sort_pattern"])
            if newest:
                pdf_jobs.append((cp, newest))
            await asyncio.sleep(0.3)

        # Filter: drop PDFs we've already processed in a recent run
        before_dedup = len(pdf_jobs)
        pdf_jobs = [(cp, url) for cp, url in pdf_jobs if url not in already_seen]
        deduped = before_dedup - len(pdf_jobs)
        if deduped:
            logger.info(
                f"{cfg.source_id}: skipped {deduped} PDF(s) already processed "
                f"in recent runs (URL-level dedup)"
            )

        pdf_jobs = pdf_jobs[:max_pdfs]
        logger.info(f"{cfg.source_id}: processing {len(pdf_jobs)} newest unseen PDFs")

        all_items: list[RawItem] = []
        processed_pdfs: list[str] = []
        for component_url, pdf_url in pdf_jobs:
            logger.info(f"  downloading {pdf_url}")
            try:
                resp = await client.get(
                    pdf_url, headers={"User-Agent": USER_AGENT}, timeout=180.0
                )
                resp.raise_for_status()
                pdf_bytes = resp.content
                logger.info(f"  {len(pdf_bytes) / 1024 / 1024:.1f} MB downloaded")
            except Exception as e:
                logger.warning(f"  download failed: {e}")
                continue

            entries, in_toks, out_toks = await _extract_entries_from_pdf(
                settings.anthropic_api_key, pdf_bytes, cfg
            )
            logger.info(f"  Claude extracted {len(entries)} entries "
                        f"(tokens in={in_toks}, out={out_toks})")

            # Even if 0 entries, mark the URL as processed so we don't re-Claude
            # this PDF on the next run. (DHS sometimes publishes empty / scan-
            # damaged PDFs that yield 0 rows; no point re-extracting them.)
            processed_pdfs.append(pdf_url)

            for entry in entries:
                item = _entry_to_raw_item(entry, cfg, pdf_url, component_url)
                if item is None:
                    continue
                # Stamp token usage on the FIRST item so the runner can attribute cost
                if not all_items and (in_toks or out_toks):
                    item.extra_metadata["_claude_input_tokens"] = in_toks
                    item.extra_metadata["_claude_output_tokens"] = out_toks
                all_items.append(item)

            await asyncio.sleep(0.5)

    # Record processed URLs for next-run dedup
    if result is not None and processed_pdfs:
        result.metadata.setdefault("processed_pdfs", []).extend(processed_pdfs)

    return all_items
