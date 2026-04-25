"""json_api fetch strategy — paginated REST JSON endpoints (mostly federal
open-data APIs like openFDA, NHTSA, CPSC).

fetch_config keys:
  url:              str — full URL (may include query params)
  method:           str — 'GET' (default) | 'POST'
  body:             dict | None — JSON body when method=POST
  params_template:  dict — query params; {lookback_days} / {lookback_ymd} placeholders
  headers:          dict — optional extra headers (e.g. X-API-Key)
  items_path:       list[str] — dotted path into the JSON response to the list of items
                                e.g. ["results"] for {"results":[...]}
  id_field:         str — key in each item to use as source_id
  title_builder:    str — f-string-ish template using item fields, e.g. "{product_description}"
  date_field:       str — key in each item for signal_date (ISO-8601 or YYYYMMDD)
  url_field:        str | None — key in item to use as source_url, else url_template
  url_template:     str | None — f-string-ish template
  body_fields:      list[str] — keys in each item to include in body_excerpt
  page_size:        int — default 100
  max_pages:        int — default 5

Each item is pulled, filtered by lookback window, and returned as a RawItem
that will go through the standard Claude extraction path.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

from app.data.signals_sources import SourceConfig
from app.services.ingest.types import RawItem

logger = logging.getLogger(__name__)

USER_AGENT = "FOIAFluent-Signals/1.0 (+https://www.foiafluent.com)"


def _get_path(obj: Any, path: list[str]) -> Any:
    cur = obj
    for key in path or []:
        if isinstance(cur, list):
            if not cur:
                return []
            cur = cur[0]
        if not isinstance(cur, dict):
            return None
        cur = cur.get(key)
    return cur


def _parse_any_date(s: str) -> datetime | None:
    """Accept ISO, YYYY-MM-DD, YYYYMMDD, MM/DD/YYYY."""
    if not s:
        return None
    s = str(s).strip()
    # YYYYMMDD (openFDA uses this)
    if len(s) == 8 and s.isdigit():
        try:
            return datetime.strptime(s, "%Y%m%d").replace(tzinfo=timezone.utc)
        except ValueError:
            pass
    for fmt in ("%Y-%m-%d", "%Y-%m-%dT%H:%M:%S", "%m/%d/%Y"):
        try:
            dt = datetime.strptime(s[: len(fmt) + 2], fmt)
            return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    # ISO with timezone
    try:
        s2 = s.replace("Z", "+00:00")
        dt = datetime.fromisoformat(s2)
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _format_template(template: str, item: dict) -> str:
    """Safe f-string-ish substitution. Missing keys become empty strings."""
    if not template:
        return ""
    class _Safe(dict):
        def __missing__(self, key):
            return ""
    try:
        return template.format_map(_Safe(**item))
    except Exception:
        return ""


async def fetch(cfg: SourceConfig) -> list[RawItem]:
    fc = cfg.fetch_config
    url = fc.get("url")
    if not url:
        logger.error(f"{cfg.source_id}: json_api strategy requires url")
        return []

    method = fc.get("method", "GET").upper()
    raw_headers = dict(fc.get("headers") or {})

    # Param / body templating — supports {lookback_days} and {lookback_ymd}
    lookback_days = cfg.lookback_days
    lookback_ymd = (
        (datetime.now(timezone.utc) - timedelta(days=lookback_days)).strftime("%Y%m%d")
    )
    lookback_iso = (
        (datetime.now(timezone.utc) - timedelta(days=lookback_days)).strftime("%Y-%m-%d")
    )

    # Runtime secrets — keep out of the registry code
    from app.config import settings as _settings
    api_data_gov_key = _settings.api_data_gov_key or ""
    congress_gov_api_key = _settings.congress_gov_api_key or ""

    def _substitute(obj: Any) -> Any:
        if isinstance(obj, str):
            return (
                obj.replace("{lookback_days}", str(lookback_days))
                   .replace("{lookback_ymd}", lookback_ymd)
                   .replace("{lookback_iso}", lookback_iso)
                   .replace("{api_data_gov_key}", api_data_gov_key)
                   .replace("{congress_gov_api_key}", congress_gov_api_key)
            )
        if isinstance(obj, dict):
            return {k: _substitute(v) for k, v in obj.items()}
        if isinstance(obj, list):
            return [_substitute(v) for v in obj]
        return obj

    # URL itself may carry {lookback_*} placeholders (openFDA bakes the search
    # into the URL because the `+TO+` range syntax would otherwise be mangled
    # by URL encoding of the `+` signs).
    url = _substitute(url)

    # Headers need substitution too — that's where API keys get injected via
    # the {api_data_gov_key} placeholder (regulations.gov, FEC, etc.).
    headers = _substitute(raw_headers)
    headers.setdefault("User-Agent", USER_AGENT)
    headers.setdefault("Accept", "application/json")

    params = _substitute(fc.get("params_template") or {})
    body = _substitute(fc.get("body") or None)

    # Note: items_path can legitimately be [] (bare-array response like CPSC),
    # so use a sentinel rather than `or` with a default.
    items_path = fc.get("items_path", ["results"])
    if items_path is None:
        items_path = []
    id_field = fc.get("id_field")
    title_template = fc.get("title_template") or ""
    date_field = fc.get("date_field")
    url_field = fc.get("url_field")
    url_template = fc.get("url_template")
    body_fields = fc.get("body_fields") or []
    page_size = int(fc.get("page_size") or 100)
    max_pages = int(fc.get("max_pages") or 5)

    # Apply page size — but only if the config hasn't already specified one.
    # Socrata APIs use `$limit`; JSON:API shapes use `page[size]`. Don't step
    # on either.
    existing_size_keys = {"limit", "$limit", "per_page", "page[size]", "pageSize"}
    if not any(k in params for k in existing_size_keys) and page_size:
        params["limit"] = page_size

    # If the URL already carries a query string (e.g. openFDA bakes +TO+ range
    # into url), passing a `params` dict to httpx drops the existing query —
    # so we merge by appending to the URL as a string ourselves. Safe because
    # none of our params values need aggressive URL-encoding.
    url_has_query = "?" in url

    def _compose(page_params: dict) -> str:
        if not page_params:
            return url
        param_str = "&".join(f"{k}={v}" for k, v in page_params.items())
        separator = "&" if url_has_query else "?"
        return f"{url}{separator}{param_str}"

    all_items: list[dict] = []
    skip = 0

    async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as client:
        for page in range(max_pages):
            page_params = dict(params)
            if page > 0:
                # openFDA uses skip; most others use offset / page
                if "skip" in params or fc.get("pagination_mode") == "skip":
                    page_params["skip"] = skip
                elif fc.get("pagination_mode") == "page":
                    page_params["page"] = page + 1
                else:
                    page_params["offset"] = skip

            request_url = _compose(page_params)
            try:
                if method == "POST":
                    resp = await client.post(request_url, json=body, headers=headers)
                else:
                    resp = await client.get(request_url, headers=headers)
                # openFDA (and some sibling APIs) return 404 for "zero matches".
                # Treat that as an empty result set, not a fetch failure.
                if resp.status_code == 404:
                    logger.info(f"{cfg.source_id}: 404 = zero matches in window, done paginating")
                    break
                resp.raise_for_status()
                data = resp.json()
            except Exception as e:
                logger.warning(f"{cfg.source_id}: page {page} fetch failed: {e}")
                break

            page_items = _get_path(data, items_path)
            if not isinstance(page_items, list):
                if page == 0:
                    logger.warning(
                        f"{cfg.source_id}: items_path {items_path} not a list in response"
                    )
                break
            if not page_items:
                break

            all_items.extend(page_items)
            skip += len(page_items)

            if len(all_items) >= cfg.max_items_per_run:
                break
            if len(page_items) < page_size:
                break

    logger.info(f"{cfg.source_id}: fetched {len(all_items)} raw items from JSON API")

    cutoff = datetime.now(timezone.utc) - timedelta(days=lookback_days)
    raw_items: list[RawItem] = []
    for itm in all_items[: cfg.max_items_per_run]:
        if not isinstance(itm, dict):
            continue

        sid_raw = itm.get(id_field) if id_field else None
        if not sid_raw:
            continue
        sid = str(sid_raw)

        signal_date = _parse_any_date(itm.get(date_field, "")) or datetime.now(timezone.utc)
        if signal_date < cutoff:
            continue

        title = _format_template(title_template, itm) or sid

        if url_field and itm.get(url_field):
            source_url = str(itm[url_field])
        elif url_template:
            source_url = _format_template(url_template, itm)
        else:
            source_url = ""

        body_lines = []
        for field in body_fields:
            value = itm.get(field)
            if value:
                body_lines.append(f"{field}: {value}")
        body_excerpt = "\n".join(body_lines) or title

        raw_items.append(RawItem(
            source_id=sid,
            title=title[:500],
            body_excerpt=body_excerpt[:5000],
            source_url=source_url,
            signal_date=signal_date,
            default_agency_codes=list(cfg.agency_codes),
            extra_metadata={"raw": {k: v for k, v in itm.items() if isinstance(v, (str, int, float, bool))}},
        ))

    logger.info(f"{cfg.source_id}: {len(raw_items)} items within {lookback_days}-day lookback")
    return raw_items
