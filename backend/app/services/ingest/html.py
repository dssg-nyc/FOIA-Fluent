"""html fetch strategy — fetch a listing page, extract items via regex,
optionally fetch each detail page for body + date.

fetch_config:
  index_url:             str  — the listing page to fetch
  link_pattern:          str  — regex with 2 groups (href, visible_text)
  base_url:              str  — prefix for relative hrefs
  source_id_mode:        str  — 'slug_from_href' | 'href' (default: slug_from_href)
  slug_blocklist:        list — slugs to skip (e.g. index pages)
  detail_fetch:          bool — fetch each detail page for body + date
  detail_body_region:    str  — regex to extract body region from detail HTML
  detail_date_pattern:   str  — regex to extract date string (group 1) from body
"""
from __future__ import annotations

import asyncio
import logging
import re
from datetime import datetime, timezone

import httpx

from app.data.signals_sources import SourceConfig
from app.services.ingest.types import RawItem

logger = logging.getLogger(__name__)

USER_AGENT = "FOIAFluent-Signals/1.0 (+https://www.foiafluent.com)"


def _strip_html(s: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", s or "")).strip()


def _try_parse_date(s: str) -> datetime | None:
    s = s.strip().replace(",", "")
    for fmt in ("%B %d %Y", "%Y-%m-%d", "%m/%d/%Y"):
        try:
            return datetime.strptime(s, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


async def _fetch_text(client: httpx.AsyncClient, url: str, timeout: float = 60.0) -> str:
    resp = await client.get(
        url,
        headers={"User-Agent": USER_AGENT, "Accept": "text/html"},
        timeout=timeout,
    )
    resp.raise_for_status()
    return resp.text


async def _fetch_detail(client: httpx.AsyncClient, cfg: SourceConfig, url: str) -> tuple[str, datetime]:
    """Fetch a detail page → (body_excerpt, signal_date). Best-effort."""
    fc = cfg.fetch_config
    try:
        html = await _fetch_text(client, url, timeout=45.0)
    except Exception as e:
        logger.warning(f"  detail fetch failed for {url}: {e}")
        return "", datetime.now(timezone.utc)

    body_region_pat = fc.get("detail_body_region")
    if body_region_pat:
        m = re.search(body_region_pat, html, re.IGNORECASE | re.DOTALL)
        raw_body = m.group(1) if m else html
    else:
        raw_body = html
    body = _strip_html(raw_body)[:5000]

    signal_date = datetime.now(timezone.utc)
    date_pat = fc.get("detail_date_pattern")
    if date_pat:
        dm = re.search(date_pat, body)
        if dm:
            parsed = _try_parse_date(dm.group(1))
            if parsed:
                signal_date = parsed

    return body, signal_date


async def fetch(cfg: SourceConfig) -> list[RawItem]:
    fc = cfg.fetch_config
    index_url = fc.get("index_url")
    link_pattern = fc.get("link_pattern")
    base_url = fc.get("base_url") or ""
    id_mode = fc.get("source_id_mode", "slug_from_href")
    blocklist = set(fc.get("slug_blocklist") or [])
    detail_fetch = bool(fc.get("detail_fetch"))

    if not index_url or not link_pattern:
        logger.error(f"{cfg.source_id}: html strategy requires index_url + link_pattern")
        return []

    async with httpx.AsyncClient() as client:
        try:
            html = await _fetch_text(client, index_url)
        except Exception as e:
            logger.error(f"{cfg.source_id}: index fetch failed: {e}")
            return []

        href_re = re.compile(link_pattern, re.IGNORECASE)
        matches = href_re.findall(html)
        logger.info(f"{cfg.source_id}: found {len(matches)} candidate links on index")

        seen: set[str] = set()
        raw_items: list[RawItem] = []
        for href, anchor_text in matches:
            slug = href.rstrip("/").rsplit("/", 1)[-1]
            if id_mode == "slug_from_href":
                source_id = slug
            else:
                source_id = href

            if source_id in seen or source_id.lower() in blocklist:
                continue
            seen.add(source_id)

            full_url = href if href.startswith("http") else f"{base_url}{href}"
            title = _strip_html(anchor_text)[:500] or slug

            body = title
            signal_date = datetime.now(timezone.utc)

            if detail_fetch:
                body, signal_date = await _fetch_detail(client, cfg, full_url)
                if not body:
                    body = title
                await asyncio.sleep(0.5)  # polite per-detail pacing

            raw_items.append(
                RawItem(
                    source_id=source_id,
                    title=title,
                    body_excerpt=body,
                    source_url=full_url,
                    signal_date=signal_date,
                    default_agency_codes=list(cfg.agency_codes),
                    extra_metadata={"slug": slug},
                )
            )

            if len(raw_items) >= cfg.max_items_per_run:
                break

    logger.info(f"{cfg.source_id}: built {len(raw_items)} raw items")
    return raw_items
