"""Ingest EPA ECHO enforcement actions into the Live FOIA Signals feed.

ORIGINAL PLAN: Hit the get_cases REST endpoint at echo.epa.gov. KILLED: ECHO's
date-filter parameters are silently ignored on the live REST API and full pulls
trip a 100k-row "Queryset Limit exceeded" error.

NEW APPROACH: Pull the weekly bulk ZIP at echo.epa.gov/files/echodownloads/case_downloads.zip,
extract CASE_ENFORCEMENTS.csv, filter rows where CASE_STATUS_DATE is recent.
This is what EPA officially recommends for downstream consumers and is what
academic research projects use.

Run manually:
    cd backend
    python -m app.scripts.refresh_signals_epa_echo

Cadence: daily via Railway scheduled job (see SIGNALS_CRON.md).
"""
import asyncio
import csv
import io
import logging
import sys
import time
import zipfile
from datetime import datetime, timedelta, timezone

import httpx

from app.scripts._signals_common import already_exists, log_run_summary, process_item

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)

# EPA ECHO bulk download — refreshed weekly. ~76 MB ZIP, expands to ~91 MB CSV.
# Verified live April 2026.
ECHO_DOWNLOAD_URL = "https://echo.epa.gov/files/echodownloads/case_downloads.zip"
ECHO_CASES_FILENAME = "CASE_ENFORCEMENTS.csv"

SOURCE = "epa_echo"
SOURCE_LABEL = "EPA ECHO Enforcement Action"

# Look back 21 days. The bulk file refreshes weekly so a 14-21 day window catches
# everything published in the most recent refresh plus a buffer.
LOOKBACK_DAYS = 21
MAX_ITEMS_PER_RUN = 200
USER_AGENT = "FOIAFluent-Signals/1.0 (https://www.foiafluent.com)"


def parse_date(s: str) -> datetime | None:
    if not s:
        return None
    s = s.strip()
    for fmt in ("%m/%d/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(s, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


async def download_bulk_zip() -> bytes | None:
    """Stream the ECHO bulk ZIP into memory. Returns the bytes or None on failure."""
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(300.0)) as client:
            resp = await client.get(
                ECHO_DOWNLOAD_URL,
                headers={"User-Agent": USER_AGENT},
                follow_redirects=True,
            )
            resp.raise_for_status()
            return resp.content
    except Exception as e:
        logger.error(f"ECHO bulk download failed: {e}")
        return None


def parse_recent_cases(zip_bytes: bytes, cutoff: datetime) -> list[dict]:
    """Extract CASE_ENFORCEMENTS.csv from the ZIP and return rows
    with CASE_STATUS_DATE >= cutoff, ordered most recent first."""
    rows: list[dict] = []
    try:
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            with zf.open(ECHO_CASES_FILENAME) as f:
                reader = csv.DictReader(io.TextIOWrapper(f, encoding="latin-1"))
                for r in reader:
                    status_date = parse_date(r.get("CASE_STATUS_DATE", ""))
                    if not status_date or status_date < cutoff:
                        continue
                    rows.append(r)
    except Exception as e:
        logger.error(f"failed to parse ECHO CSV: {e}")
        return []

    # Sort newest first
    rows.sort(key=lambda r: parse_date(r.get("CASE_STATUS_DATE", "")) or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
    return rows[:MAX_ITEMS_PER_RUN]


def normalize_row(row: dict) -> dict | None:
    case_number = (row.get("CASE_NUMBER") or "").strip()
    if not case_number:
        return None

    case_name = (row.get("CASE_NAME") or "").strip()
    activity_name = (row.get("ACTIVITY_NAME") or "").strip()
    activity_type_desc = (row.get("ACTIVITY_TYPE_DESC") or "").strip()
    activity_status = (row.get("ACTIVITY_STATUS_DESC") or "").strip()
    enf_outcome = (row.get("ENF_OUTCOME_DESC") or "").strip()
    penalty = (row.get("TOTAL_PENALTY_ASSESSED_AMT") or "").strip()
    state_code = (row.get("STATE_CODE") or "").strip()
    region_code = (row.get("REGION_CODE") or "").strip()
    enf_summary = (row.get("ENF_SUMMARY_TEXT") or "").strip()
    fiscal_year = (row.get("FISCAL_YEAR") or "").strip()
    case_status_date = (row.get("CASE_STATUS_DATE") or "").strip()
    activity_status_date = (row.get("ACTIVITY_STATUS_DATE") or "").strip()
    multimedia = (row.get("MULTIMEDIA_FLAG") or "").strip() == "Y"
    voluntary_disclosure = (row.get("VOLUNTARY_SELF_DISCLOSURE_FLAG") or "").strip() == "Y"

    signal_date = parse_date(case_status_date) or parse_date(activity_status_date) or datetime.now(timezone.utc)

    title_parts = []
    if case_name:
        title_parts.append(case_name)
    elif activity_name:
        title_parts.append(activity_name)
    else:
        title_parts.append(f"EPA enforcement case {case_number}")
    if enf_outcome:
        title_parts.append(f"({enf_outcome})")
    title = " ".join(title_parts)

    body_lines = [
        f"Case number: {case_number}",
        f"Defendant / activity: {case_name or activity_name or 'unspecified'}",
        f"Activity type: {activity_type_desc or 'unspecified'}",
        f"Status: {activity_status or 'unspecified'} ({case_status_date or 'unknown date'})",
        f"Enforcement outcome: {enf_outcome or 'unspecified'}",
        f"State: {state_code or 'unknown'} | EPA region: {region_code or 'unknown'}",
        f"Fiscal year: {fiscal_year or 'unknown'}",
    ]
    if penalty:
        try:
            penalty_val = float(penalty)
            if penalty_val:
                body_lines.append(f"Total penalty assessed: ${penalty_val:,.0f}")
        except ValueError:
            pass
    if multimedia:
        body_lines.append("Multimedia case (multiple environmental statutes)")
    if voluntary_disclosure:
        body_lines.append("Triggered by a voluntary self-disclosure under the EPA Audit Policy")
    if enf_summary:
        body_lines.append("")
        body_lines.append(f"EPA summary: {enf_summary[:1500]}")

    return {
        "source_id": case_number,
        "title": title[:500],
        "body": "\n".join(body_lines),
        "url": f"https://echo.epa.gov/enforcement-case-report?id={case_number}",
        "signal_date": signal_date,
        "metadata": {
            "case_number": case_number,
            "case_name": case_name,
            "activity_type": activity_type_desc,
            "enforcement_outcome": enf_outcome,
            "state_code": state_code,
            "region_code": region_code,
            "fiscal_year": fiscal_year,
            "total_penalty_assessed": penalty,
            "multimedia": multimedia,
        },
    }


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
    cutoff = datetime.now(timezone.utc) - timedelta(days=LOOKBACK_DAYS)

    logger.info(f"Downloading ECHO bulk ZIP from {ECHO_DOWNLOAD_URL}")
    zip_bytes = await download_bulk_zip()
    if not zip_bytes:
        sys.exit(1)
    logger.info(f"Downloaded {len(zip_bytes) / 1024 / 1024:.1f} MB")

    rows = parse_recent_cases(zip_bytes, cutoff)
    logger.info(f"Found {len(rows)} cases with CASE_STATUS_DATE in last {LOOKBACK_DAYS} days (capped at {MAX_ITEMS_PER_RUN})")

    inserted = skipped = failed = 0
    for raw in rows:
        try:
            item = normalize_row(raw)
            if not item:
                continue

            if already_exists(supabase, SOURCE, item["source_id"]):
                skipped += 1
                continue

            status = await process_item(
                supabase=supabase,
                api_key=settings.anthropic_api_key,
                source=SOURCE,
                source_label=SOURCE_LABEL,
                source_id=item["source_id"],
                title=item["title"],
                body_excerpt=item["body"],
                source_url=item["url"],
                signal_date=item["signal_date"],
                default_agency_codes=["EPA"],
                extra_metadata=item["metadata"],
            )
            if status == "inserted":
                inserted += 1
                if inserted <= 20:
                    logger.info(f"  + {item['source_id']}: {item['title'][:80]}")
            elif status == "skipped":
                skipped += 1
            else:
                failed += 1
        except Exception as e:
            failed += 1
            logger.warning(f"  item failed {raw.get('CASE_NUMBER')}: {e}")
        await asyncio.sleep(0.15)

    log_run_summary(
        SOURCE,
        fetched=len(rows),
        inserted=inserted,
        skipped=skipped,
        failed=failed,
        runtime_seconds=time.monotonic() - started,
    )


if __name__ == "__main__":
    asyncio.run(main())
