"""rss fetch strategy — aggregate one or more RSS/Atom feeds, regex-filter.

Parsing goes through `feedparser`, which transparently handles RSS 2.0, Atom,
and malformed/partial feeds (unescaped ampersands, missing closing tags, etc.).

fetch_config:
  feeds:            list[dict]  — [{"name": "...", "url": "..."}]
  id_pattern:       str         — optional regex for extracting a source_id
                                  from title+body. First match is used.
  keyword_pattern:  str         — optional regex that title+body MUST contain
                                  for the item to qualify.
  canonical_url_template: str   — optional, "{id_lower}" placeholder supported
"""
from __future__ import annotations

import asyncio
import logging
import re
from datetime import datetime, timezone
from time import mktime

import feedparser
import httpx

from app.data.signals_sources import SourceConfig
from app.services.ingest.types import RawItem

logger = logging.getLogger(__name__)

USER_AGENT = "Mozilla/5.0 (compatible; FOIAFluent-Signals/1.0; +https://www.foiafluent.com)"


def _strip_html(s: str) -> str:
    s = re.sub(r"<[^>]+>", " ", s or "")
    return re.sub(r"\s+", " ", s).strip()


def _entry_date(entry: dict) -> datetime:
    """feedparser gives us a struct_time tuple in `*_parsed` keys for any
    date it could interpret. Try updated/published/issued in that order."""
    for key in ("updated_parsed", "published_parsed", "issued_parsed", "created_parsed"):
        t = entry.get(key)
        if t:
            try:
                return datetime.fromtimestamp(mktime(t), tz=timezone.utc)
            except Exception:
                continue
    return datetime.now(timezone.utc)


def _entry_body(entry: dict) -> str:
    """Prefer the full content, fall back to summary."""
    content = entry.get("content")
    if isinstance(content, list) and content:
        raw = content[0].get("value") if isinstance(content[0], dict) else str(content[0])
    else:
        raw = entry.get("summary") or entry.get("description") or ""
    return _strip_html(raw)[:5000]


async def _fetch_feed_bytes(client: httpx.AsyncClient, feed: dict) -> bytes | None:
    """Fetch the feed body as bytes (feedparser accepts bytes directly and
    handles encoding detection)."""
    try:
        resp = await client.get(
            feed["url"],
            headers={"User-Agent": USER_AGENT},
            timeout=30.0,
        )
        resp.raise_for_status()
        return resp.content
    except Exception as e:
        logger.warning(f"  fetch failed for {feed['name']}: {e}")
        return None


def _parse_feed(content: bytes, feed_name: str) -> list[dict]:
    """Parse a feed via feedparser. Returns normalized dicts."""
    parsed = feedparser.parse(content)
    # feedparser never raises — check .bozo for parse errors but still use
    # the entries it managed to recover
    if parsed.bozo and not parsed.entries:
        logger.warning(
            f"  feedparser returned zero entries from {feed_name}: "
            f"{getattr(parsed.bozo_exception, 'getMessage', lambda: parsed.bozo_exception)()}"
        )
        return []
    if parsed.bozo:
        logger.info(f"  feedparser recovered {len(parsed.entries)} entries from {feed_name} despite malformed XML")

    items: list[dict] = []
    for entry in parsed.entries:
        title = (entry.get("title") or "").strip()
        link = (entry.get("link") or "").strip()
        if not title or not link:
            continue
        items.append({
            "title": title[:500],
            "link": link,
            "description": _entry_body(entry),
            "signal_date": _entry_date(entry),
            "feed_name": feed_name,
        })
    return items


async def fetch(cfg: SourceConfig) -> list[RawItem]:
    fc = cfg.fetch_config
    feeds = fc.get("feeds") or []
    if not feeds:
        logger.error(f"{cfg.source_id}: rss strategy requires feeds list")
        return []

    id_re = re.compile(fc.get("id_pattern") or r"", re.IGNORECASE) if fc.get("id_pattern") else None
    keyword_re = (
        re.compile(fc.get("keyword_pattern"), re.IGNORECASE)
        if fc.get("keyword_pattern")
        else None
    )
    canonical_template = fc.get("canonical_url_template")

    all_posts: list[dict] = []
    async with httpx.AsyncClient(follow_redirects=True) as client:
        for feed in feeds:
            logger.info(f"{cfg.source_id}: fetching {feed['name']} ({feed['url']})")
            content = await _fetch_feed_bytes(client, feed)
            if content is None:
                continue
            items = _parse_feed(content, feed["name"])
            logger.info(f"  found {len(items)} items")
            all_posts.extend(items)
            await asyncio.sleep(0.3)  # polite between feeds

    logger.info(f"{cfg.source_id}: {len(all_posts)} total posts across {len(feeds)} feeds")

    seen_ids: set[str] = set()
    raw_items: list[RawItem] = []
    for post in all_posts:
        blob = f"{post['title']} {post['description']}"

        if keyword_re and not keyword_re.search(blob):
            continue

        ids: list[str] = []
        if id_re and id_re.pattern:
            for m in id_re.finditer(blob):
                tok = m.group(0).upper()
                if tok not in ids:
                    ids.append(tok)
            if not ids:
                continue
        else:
            ids = [post["link"]]

        primary_id = ids[0]
        if primary_id in seen_ids:
            continue
        seen_ids.add(primary_id)

        body_lines = [
            f"ID: {primary_id}",
            f"Source: {post['feed_name']} ({post['link']})",
        ]
        if len(ids) > 1:
            body_lines.insert(1, f"Related IDs: {', '.join(ids[1:])}")
        body_lines += ["", post["title"], "", post["description"]]
        body = "\n".join(body_lines)

        metadata: dict = {
            "id": primary_id,
            "all_ids": ids,
            "feed_name": post["feed_name"],
        }
        if canonical_template:
            metadata["canonical_url"] = canonical_template.format(
                id=primary_id, id_lower=primary_id.lower()
            )

        raw_items.append(
            RawItem(
                source_id=primary_id,
                title=post["title"],
                body_excerpt=body,
                source_url=post["link"],
                signal_date=post["signal_date"],
                default_agency_codes=list(cfg.agency_codes),
                extra_metadata=metadata,
            )
        )
        if len(raw_items) >= cfg.max_items_per_run:
            break

    logger.info(f"{cfg.source_id}: {len(raw_items)} items matched filters")
    return raw_items
