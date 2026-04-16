"""Ingest DHS FOIA logs into the Live FOIA Signals feed.

ORIGINAL PLAN: Scrape DHS FOIA Library for .xlsx logs. KILLED: DHS publishes
PDFs (not Excel), under per-component pages reached from /dhs-component-foia-logs,
with inconsistent formats — some are text-extractable, some are scanned images.

NEW APPROACH: Use Claude multimodal PDF input directly. One Claude call per PDF
extracts a structured JSON array of FOIA log entries (request ID, requester,
organization, subject, received date, disposition). Claude does its own OCR on
scanned PDFs, so we transparently handle both text-based and image-only formats.
This is ~10x cheaper than per-row Claude calls AND removes the pdfplumber
dependency entirely.

Run manually:
    cd backend
    python -m app.scripts.refresh_signals_dhs_foia_log

Cadence: weekly via Railway scheduled job (see SIGNALS_CRON.md).
"""
import asyncio
import base64
import logging
import re
import sys
import time
from datetime import datetime, timezone

import httpx

from app.scripts._signals_common import (
    PILOT_PERSONAS,
    already_exists,
    log_run_summary,
    upsert_signal,
)

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)

DHS_INDEX_URL = "https://www.dhs.gov/dhs-component-foia-logs"
SOURCE = "dhs_foia_log"
SOURCE_LABEL = "DHS FOIA Log Entry"
USER_AGENT = "FOIAFluent-Signals/1.0 (https://www.foiafluent.com)"

# Volume controls
MAX_PDFS_PER_RUN = 6           # newest 6 component PDFs per run (Phase 1 cap)
MAX_ENTRIES_PER_PDF = 100      # cap on log rows we ingest from a single PDF
CLAUDE_MULTIMODAL_MODEL = "claude-haiku-4-5-20251001"
CLAUDE_MAX_OUTPUT_TOKENS = 8000

# Tool schema for forced structured output from Claude multimodal PDF call
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
                    f"Return at most {MAX_ENTRIES_PER_PDF} of the MOST RECENT entries "
                    "(by received date). Skip header/footer rows."
                ),
                "items": {
                    "type": "object",
                    "required": ["request_id", "summary"],
                    "properties": {
                        "request_id": {
                            "type": "string",
                            "description": "FOIA tracking number, e.g. '2024-FEFO-00065' or '2025-CISFO-00123'",
                        },
                        "requester": {
                            "type": "string",
                            "description": "Person or organization that filed the request, as published. Empty string if redacted.",
                        },
                        "organization": {
                            "type": "string",
                            "description": "Requester's organization if separately listed (e.g. 'Reuters', 'ACLU'). Empty if not.",
                        },
                        "subject": {
                            "type": "string",
                            "description": "Description of the records requested. Verbatim or close paraphrase from the log.",
                        },
                        "received_date": {
                            "type": "string",
                            "description": "Date the request was received, in YYYY-MM-DD format. Best-effort if format varies.",
                        },
                        "disposition": {
                            "type": "string",
                            "description": "Outcome if shown (granted/partial/denied/no_records/withdrawn/pending). Empty if not.",
                        },
                        "summary": {
                            "type": "string",
                            "description": "1-sentence plain English description of what the requester was asking for.",
                        },
                        "persona_tags": {
                            "type": "array",
                            "items": {"type": "string", "enum": PILOT_PERSONAS},
                            "description": (
                                "Subset of {journalist, pharma_analyst, hedge_fund, environmental} this request "
                                "is concretely relevant to. Be conservative — only tag a persona if the requester "
                                "or subject clearly matches. journalist tag should fire when the requester is a "
                                "media outlet, news org, or known journalist. Empty array is acceptable."
                            ),
                        },
                    },
                },
            },
        },
    },
}


# ── DHS index + per-component crawlers ─────────────────────────────────────

PDF_HREF_RE = re.compile(r'href="([^"#]+\.pdf)"', re.IGNORECASE)
COMPONENT_HREF_RE = re.compile(r'href="(/[^"#]*foia-logs?/?)"', re.IGNORECASE)


async def find_component_pages(client: httpx.AsyncClient) -> list[str]:
    """Crawl the DHS index for per-component FOIA log pages."""
    try:
        resp = await client.get(DHS_INDEX_URL, headers={"User-Agent": USER_AGENT}, timeout=60.0)
        resp.raise_for_status()
    except Exception as e:
        logger.error(f"DHS index fetch failed: {e}")
        return []

    hrefs: list[str] = []
    for href in COMPONENT_HREF_RE.findall(resp.text):
        full = href if href.startswith("http") else f"https://www.dhs.gov{href}"
        if full == DHS_INDEX_URL:
            continue
        if full not in hrefs:
            hrefs.append(full)
    return hrefs


async def find_pdf_links(client: httpx.AsyncClient, page_url: str) -> list[str]:
    """Find PDF links on a single component FOIA log page."""
    try:
        resp = await client.get(page_url, headers={"User-Agent": USER_AGENT}, timeout=60.0)
        resp.raise_for_status()
    except Exception as e:
        logger.warning(f"  fetch failed for {page_url}: {e}")
        return []

    links: list[str] = []
    for href in PDF_HREF_RE.findall(resp.text):
        if href.startswith("/"):
            href = f"https://www.dhs.gov{href}"
        if href not in links:
            links.append(href)
    return links


def newest_pdf_url(pdf_urls: list[str]) -> str | None:
    """Pick the most recent PDF based on URL date hints (sites/default/files/YYYY-MM/)."""
    if not pdf_urls:
        return None
    def sort_key(url: str) -> str:
        m = re.search(r"/(\d{4})-(\d{2})/", url)
        if m:
            return f"{m.group(1)}{m.group(2)}"
        return "000000"
    return sorted(pdf_urls, key=sort_key, reverse=True)[0]


# ── Claude multimodal extraction ─────────────────────────────────────────────

async def extract_entries_from_pdf(api_key: str, pdf_bytes: bytes, source_label: str) -> list[dict]:
    """Call Claude multimodal with the PDF attached, get a JSON array of FOIA log entries."""
    if not api_key:
        return []

    pdf_b64 = base64.standard_b64encode(pdf_bytes).decode("ascii")

    prompt = (
        f"This is a {source_label} — a FOIA request log published by a DHS component agency. "
        f"Each row represents one FOIA request the agency received from the public.\n\n"
        f"Extract the {MAX_ENTRIES_PER_PDF} MOST RECENT entries (by received date) using the "
        f"extract_foia_log_entries tool. Skip header rows, footer rows, and obviously broken rows. "
        f"For each entry, generate a 1-sentence plain English summary and conservatively tag "
        f"any of the 4 personas (journalist, pharma_analyst, hedge_fund, environmental) where "
        f"the relevance is direct and verifiable from the requester or subject."
    )

    payload = {
        "model": CLAUDE_MULTIMODAL_MODEL,
        "max_tokens": CLAUDE_MAX_OUTPUT_TOKENS,
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
            return []

    for block in data.get("content", []):
        if block.get("type") == "tool_use" and block.get("name") == "extract_foia_log_entries":
            entries = (block.get("input") or {}).get("entries", [])
            return entries[:MAX_ENTRIES_PER_PDF]

    logger.warning("  Claude returned no tool_use block")
    return []


def parse_iso_date(s: str) -> datetime:
    if not s:
        return datetime.now(timezone.utc)
    s = s.strip()
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y"):
        try:
            return datetime.strptime(s, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return datetime.now(timezone.utc)


# ── Main pipeline ────────────────────────────────────────────────────────────

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

    async with httpx.AsyncClient(follow_redirects=True) as client:
        component_pages = await find_component_pages(client)
        logger.info(f"Found {len(component_pages)} DHS component FOIA log pages")

        # For each component, find the newest PDF
        pdf_jobs: list[tuple[str, str]] = []   # (component_url, pdf_url)
        for cp in component_pages:
            pdfs = await find_pdf_links(client, cp)
            newest = newest_pdf_url(pdfs)
            if newest:
                pdf_jobs.append((cp, newest))
                logger.info(f"  {cp} -> {newest}")
            await asyncio.sleep(0.3)

        # Cap to avoid overspending Claude on a single run
        pdf_jobs = pdf_jobs[:MAX_PDFS_PER_RUN]
        logger.info(f"Processing {len(pdf_jobs)} newest PDFs")

        total_fetched = 0
        inserted = skipped = failed = 0

        for component_url, pdf_url in pdf_jobs:
            logger.info(f"\nDownloading {pdf_url}")
            try:
                resp = await client.get(pdf_url, headers={"User-Agent": USER_AGENT}, timeout=180.0)
                resp.raise_for_status()
                pdf_bytes = resp.content
                logger.info(f"  {len(pdf_bytes) / 1024 / 1024:.1f} MB downloaded")
            except Exception as e:
                logger.warning(f"  download failed: {e}")
                continue

            entries = await extract_entries_from_pdf(
                settings.anthropic_api_key, pdf_bytes, SOURCE_LABEL
            )
            logger.info(f"  Claude extracted {len(entries)} entries")
            total_fetched += len(entries)

            for entry in entries:
                try:
                    request_id = (entry.get("request_id") or "").strip()
                    if not request_id:
                        continue

                    if already_exists(supabase, SOURCE, request_id):
                        skipped += 1
                        continue

                    requester = (entry.get("requester") or "").strip()
                    organization = (entry.get("organization") or "").strip()
                    subject = (entry.get("subject") or "").strip()
                    summary = (entry.get("summary") or "").strip()
                    received_date = (entry.get("received_date") or "").strip()
                    disposition = (entry.get("disposition") or "").strip()
                    persona_tags = [p for p in (entry.get("persona_tags") or []) if p in PILOT_PERSONAS]

                    # Best display name for the requester field: prefer org if present
                    requester_display = organization or requester or "Member of Public"

                    title_parts = [request_id]
                    if subject:
                        title_parts.append(f"— {subject[:120]}")
                    title = " ".join(title_parts)[:500]

                    body_lines = [
                        f"DHS FOIA request {request_id}",
                        f"Filed by: {requester_display}",
                    ]
                    if requester and requester != requester_display:
                        body_lines.append(f"Individual requester: {requester}")
                    if subject:
                        body_lines.append(f"Subject: {subject}")
                    if disposition:
                        body_lines.append(f"Disposition: {disposition}")
                    if received_date:
                        body_lines.append(f"Received: {received_date}")
                    body = "\n".join(body_lines)

                    ok = upsert_signal(
                        supabase,
                        source=SOURCE,
                        source_id=request_id,
                        title=title,
                        summary=summary,
                        body_excerpt=body,
                        source_url=pdf_url,
                        signal_date=parse_iso_date(received_date),
                        agency_codes=["DHS"],
                        entities={
                            "people":    [requester] if requester and requester not in (organization, "Member of Public") else [],
                            "companies": [organization] if organization else [],
                        },
                        persona_tags=persona_tags,
                        priority=1 if organization else 0,
                        metadata={
                            "request_id": request_id,
                            "subject": subject,
                            "disposition": disposition,
                            "component_page": component_url,
                            "pdf_url": pdf_url,
                        },
                        requester=requester_display,
                    )
                    if ok:
                        inserted += 1
                    else:
                        failed += 1
                except Exception as e:
                    failed += 1
                    logger.warning(f"  entry failed {entry.get('request_id')}: {e}")

            await asyncio.sleep(0.5)

    log_run_summary(
        SOURCE,
        fetched=total_fetched,
        inserted=inserted,
        skipped=skipped,
        failed=failed,
        runtime_seconds=time.monotonic() - started,
    )


if __name__ == "__main__":
    asyncio.run(main())
