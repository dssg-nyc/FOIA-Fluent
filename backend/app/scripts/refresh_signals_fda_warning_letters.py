"""Ingest FDA Warning Letters into the Live FOIA Signals feed.

The FDA publishes warning letters at /inspections-compliance-enforcement-and-criminal-investigations/
compliance-actions-and-activities/warning-letters. There's no API; the index page
serves a JSON datatables payload that we can call directly.

Run manually:
    cd backend
    python -m app.scripts.refresh_signals_fda_warning_letters

Cadence: daily via Railway scheduled job (see SIGNALS_CRON.md).
"""
import asyncio
import logging
import re
import sys
import time
from datetime import datetime, timezone

import httpx

from app.scripts._signals_common import log_run_summary, process_item

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)

# FDA's warning letter listing endpoint (returns JSON for the datatables on the index page).
# This is a public, undocumented endpoint that powers the FDA's own website.
# If the URL changes, swap to scraping the index HTML at:
#   https://www.fda.gov/inspections-compliance-enforcement-and-criminal-investigations/
#     compliance-actions-and-activities/warning-letters
FDA_LIST_URL = (
    "https://www.fda.gov/datatables/views/ajax"
    "?_drupal_ajax=1&view_name=warning_letter_solr_index"
    "&view_display_id=block_1&items_per_page=50"
)

# Fallback to the human-readable index page (we scrape table rows if the JSON endpoint fails)
FDA_INDEX_URL = (
    "https://www.fda.gov/inspections-compliance-enforcement-and-criminal-investigations/"
    "compliance-actions-and-activities/warning-letters"
)

SOURCE = "fda_warning_letters"
SOURCE_LABEL = "FDA Warning Letter"
MAX_ITEMS_PER_RUN = 50


def strip_html(s: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", s or "")).strip()


async def fetch_index(client: httpx.AsyncClient) -> str:
    """Fetch the human-readable warning letters index page HTML.

    The FDA's JSON datatables endpoint is unstable and undocumented; scraping
    the index page is more reliable for Phase 1.
    """
    try:
        resp = await client.get(
            FDA_INDEX_URL,
            headers={"User-Agent": "FOIAFluent-Signals/1.0", "Accept": "text/html"},
            timeout=60.0,
        )
        resp.raise_for_status()
        return resp.text
    except Exception as e:
        logger.error(f"FDA index fetch failed: {e}")
        return ""


def parse_index(html: str) -> list[dict]:
    """Parse warning-letter rows from the FDA index page HTML.

    Defensive parsing: the FDA's table format may change. We look for table rows
    that contain a link with /inspections-compliance-enforcement-and-criminal-investigations/
    warning-letters/{slug}, plus a date and a company name.
    """
    items: list[dict] = []

    # Find anchor tags pointing at individual warning letter pages
    href_re = re.compile(
        r'href="(/inspections-compliance-enforcement-and-criminal-investigations/'
        r'warning-letters/[^"\'#]+)"[^>]*>([^<]+)</a>',
        re.IGNORECASE,
    )
    matches = href_re.findall(html)
    seen: set[str] = set()
    for href, anchor_text in matches:
        slug = href.rstrip("/").rsplit("/", 1)[-1]
        if slug in seen:
            continue
        seen.add(slug)
        # Skip the index page link itself if it appears
        if slug.lower() in {"warning-letters", "warning-letters-archive"}:
            continue
        items.append({
            "source_id": slug,
            "title": strip_html(anchor_text)[:500] or slug,
            "url": f"https://www.fda.gov{href}",
        })
        if len(items) >= MAX_ITEMS_PER_RUN:
            break
    return items


async def fetch_letter_detail(client: httpx.AsyncClient, url: str) -> tuple[str, datetime]:
    """Fetch a single warning letter detail page and return (body_excerpt, signal_date).

    Best-effort: returns ("", now) if the fetch fails.
    """
    try:
        resp = await client.get(url, headers={"User-Agent": "FOIAFluent-Signals/1.0"}, timeout=45.0)
        resp.raise_for_status()
        html = resp.text
    except Exception as e:
        logger.warning(f"detail fetch failed for {url}: {e}")
        return "", datetime.now(timezone.utc)

    # Best-effort body extraction: grab the main content region
    body_match = re.search(
        r'<div[^>]+class="[^"]*main-content[^"]*"[^>]*>(.*?)</div>\s*</div>',
        html,
        re.IGNORECASE | re.DOTALL,
    )
    raw_body = body_match.group(1) if body_match else html
    body = strip_html(raw_body)[:5000]

    # Extract the issue date — FDA pages typically have "Issuing Office:" or a "Date" field
    date_match = re.search(r"(?:Issued|Date)[:\s]*([A-Z][a-z]+ \d{1,2},?\s+\d{4})", body)
    signal_date = datetime.now(timezone.utc)
    if date_match:
        try:
            signal_date = datetime.strptime(date_match.group(1).replace(",", ""), "%B %d %Y").replace(tzinfo=timezone.utc)
        except Exception:
            pass

    return body, signal_date


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

    async with httpx.AsyncClient() as client:
        html = await fetch_index(client)
        if not html:
            logger.error("FDA index returned no HTML; aborting")
            sys.exit(1)

        items = parse_index(html)
        logger.info(f"Found {len(items)} warning letter links on index")

        inserted = skipped = failed = 0
        for item in items:
            try:
                # Cheap dedup before fetching detail page or Claude
                from app.scripts._signals_common import already_exists
                if already_exists(supabase, SOURCE, item["source_id"]):
                    skipped += 1
                    continue

                body, signal_date = await fetch_letter_detail(client, item["url"])
                if not body:
                    body = item["title"]

                status = await process_item(
                    supabase=supabase,
                    api_key=settings.anthropic_api_key,
                    source=SOURCE,
                    source_label=SOURCE_LABEL,
                    source_id=item["source_id"],
                    title=item["title"],
                    body_excerpt=body,
                    source_url=item["url"],
                    signal_date=signal_date,
                    default_agency_codes=["FDA"],
                    extra_metadata={"slug": item["source_id"]},
                )
                if status == "inserted":
                    inserted += 1
                    logger.info(f"  + {item['source_id']}: {item['title'][:80]}")
                elif status == "skipped":
                    skipped += 1
                else:
                    failed += 1
            except Exception as e:
                failed += 1
                logger.warning(f"item failed {item.get('source_id')}: {e}")
            await asyncio.sleep(0.5)

    log_run_summary(
        SOURCE,
        fetched=len(items),
        inserted=inserted,
        skipped=skipped,
        failed=failed,
        runtime_seconds=time.monotonic() - started,
    )


if __name__ == "__main__":
    asyncio.run(main())
