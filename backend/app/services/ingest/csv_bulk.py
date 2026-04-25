"""csv_bulk fetch strategy — download a ZIP (or raw CSV), filter recent rows.

fetch_config:
  zip_url:            str — ZIP download URL (or csv_url if not a ZIP)
  csv_filename:       str — entry inside the ZIP (required when using zip_url)
  csv_url:            str — alternative to zip_url for raw CSV
  date_column:        str — CSV column used for recency filter
  id_column:          str — CSV column used as source_id
  encoding:           str — default 'latin-1' (EPA ECHO is latin-1)
  detail_url_template: str — with {id} placeholder for the item's source_url
  title_builder:      optional callable hint (not used in Phase 2.1 — the
                      strategy builds a generic title from row contents)
"""
from __future__ import annotations

import csv
import io
import logging
import zipfile
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

from app.data.signals_sources import SourceConfig
from app.services.ingest.types import RawItem

logger = logging.getLogger(__name__)

USER_AGENT = "FOIAFluent-Signals/1.0 (+https://www.foiafluent.com)"


def _parse_date(s: str) -> datetime | None:
    if not s:
        return None
    s = s.strip()
    for fmt in ("%m/%d/%Y", "%Y-%m-%d", "%m/%d/%y"):
        try:
            return datetime.strptime(s, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


async def _download_zip(url: str) -> bytes | None:
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(300.0), follow_redirects=True) as client:
            resp = await client.get(url, headers={"User-Agent": USER_AGENT})
            resp.raise_for_status()
            return resp.content
    except Exception as e:
        logger.error(f"ZIP download failed for {url}: {e}")
        return None


def _extract_csv_from_zip(zip_bytes: bytes, filename: str, encoding: str) -> list[dict]:
    try:
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            with zf.open(filename) as f:
                reader = csv.DictReader(io.TextIOWrapper(f, encoding=encoding))
                return list(reader)
    except Exception as e:
        logger.error(f"failed to read {filename} from ZIP: {e}")
        return []


def _build_epa_echo_item(row: dict, cfg: SourceConfig) -> RawItem | None:
    """EPA ECHO CSV row → RawItem. Mirrors the normalize_row() in the old
    refresh_signals_epa_echo.py so we get byte-for-byte parity."""
    fc = cfg.fetch_config
    case_number = (row.get(fc["id_column"]) or "").strip()
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

    signal_date = (
        _parse_date(case_status_date)
        or _parse_date(activity_status_date)
        or datetime.now(timezone.utc)
    )

    title_parts: list[str] = []
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

    detail_url = (fc.get("detail_url_template") or "").format(id=case_number)

    return RawItem(
        source_id=case_number,
        title=title[:500],
        body_excerpt="\n".join(body_lines),
        source_url=detail_url,
        signal_date=signal_date,
        default_agency_codes=list(cfg.agency_codes),
        extra_metadata={
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
    )


async def fetch(cfg: SourceConfig) -> list[RawItem]:
    fc = cfg.fetch_config
    zip_url = fc.get("zip_url")
    if not zip_url:
        logger.error(f"{cfg.source_id}: csv_bulk strategy requires zip_url")
        return []

    logger.info(f"{cfg.source_id}: downloading {zip_url}")
    zip_bytes = await _download_zip(zip_url)
    if not zip_bytes:
        return []
    logger.info(f"{cfg.source_id}: downloaded {len(zip_bytes) / 1024 / 1024:.1f} MB")

    rows = _extract_csv_from_zip(zip_bytes, fc["csv_filename"], fc.get("encoding", "utf-8"))

    cutoff = datetime.now(timezone.utc) - timedelta(days=cfg.lookback_days)
    date_col = fc["date_column"]
    fresh: list[dict] = []
    for row in rows:
        d = _parse_date(row.get(date_col, ""))
        if d and d >= cutoff:
            fresh.append(row)
    fresh.sort(
        key=lambda r: _parse_date(r.get(date_col, "")) or datetime.min.replace(tzinfo=timezone.utc),
        reverse=True,
    )
    fresh = fresh[: cfg.max_items_per_run]

    logger.info(
        f"{cfg.source_id}: {len(fresh)} rows with {date_col} in last "
        f"{cfg.lookback_days} days (cap {cfg.max_items_per_run})"
    )

    # Dispatch on source_id for row → RawItem conversion. Only EPA ECHO today;
    # add more csv_bulk sources by extending this map.
    builder_map = {
        "epa_echo": _build_epa_echo_item,
    }
    build = builder_map.get(cfg.source_id)
    if not build:
        logger.error(f"{cfg.source_id}: no csv_bulk row builder registered")
        return []

    items: list[RawItem] = []
    for row in fresh:
        item = build(row, cfg)
        if item is not None:
            items.append(item)
    return items
