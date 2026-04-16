"""Ingest GAO bid protest decisions into the Live FOIA Signals feed.

ORIGINAL PLAN: Scrape gao.gov/rss/legal.xml directly. KILLED: Akamai WAF.
GovInfo's GAOREPORTS feed/API is also dead (last build July 2024).

NEW APPROACH: Aggregate from public GovCon law firm RSS feeds.
- The blogs naturally curate to *sustained* protests (the high-value ~14% of decisions
  that produce stories, market signals, and legal precedent).
- Each blog post mentions one or more B-XXXXXX dockets in the body. We extract them
  with the same regex used in the original direct-scrape plan.
- The source_id is the docket number itself, so multiple blog posts about the same
  decision dedup naturally to one row in foia_signals_feed.
- The source_url points at the law firm's writeup, which gives users richer editorial
  context (legal significance, precedent implications) than raw GAO text would.

Run manually:
    cd backend
    python -m app.scripts.refresh_signals_gao

Cadence: hourly via Railway scheduled job (see SIGNALS_CRON.md).
"""
import asyncio
import logging
import re
import sys
import time
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from xml.etree import ElementTree as ET

import httpx

from app.scripts._signals_common import already_exists, log_run_summary, process_item

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)

SOURCE = "gao_protests"
SOURCE_LABEL = "GAO Bid Protest Decision (via legal blog)"

# Verified-live RSS feeds from GovCon law firms / publications.
# Add more feeds here as you discover them — each must serve standard RSS 2.0
# from a non-WAF'd CDN. Verify with: curl -sI <url> -A "Mozilla/5.0"
LEGAL_BLOG_FEEDS: list[dict] = [
    {"name": "SmallGovCon",          "url": "https://smallgovcon.com/feed/"},
    {"name": "PilieroMazza",         "url": "https://www.pilieromazza.com/feed/"},
    {"name": "NatLawReview GovCon",  "url": "https://natlawreview.com/practice-groups/government-contracts/feed"},
    {"name": "GovConWire Contracts", "url": "https://www.govconwire.com/category/contracts/feed/"},
]

# B-XXXXXX or B-XXXXXX.N (e.g. B-422518, B-414410.4).
DOCKET_RE = re.compile(r"\bB-\d{6,}(?:\.\d+)?\b", re.IGNORECASE)

# Posts must mention bid protests in some form to qualify
PROTEST_KEYWORDS = re.compile(
    r"\b(bid protest|protest decision|sustain|sustained|denied|gao decision|"
    r"government accountability office|bid award|protest)\b",
    re.IGNORECASE,
)

USER_AGENT = "Mozilla/5.0 (compatible; FOIAFluent-Signals/1.0; +https://www.foiafluent.com)"


def strip_html(s: str) -> str:
    """Basic HTML strip for RSS description fields."""
    s = re.sub(r"<[^>]+>", " ", s or "")
    return re.sub(r"\s+", " ", s).strip()


def parse_rss(xml_text: str, source_name: str) -> list[dict]:
    """Parse a law-firm RSS feed and return blog post items.

    We don't filter to bid protests here — that happens after we look for B-dockets
    and protest keywords in process_item below, since the RSS bodies are usually
    short summaries and we want to also grab posts whose docket only appears in
    the title.
    """
    items: list[dict] = []
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as e:
        logger.warning(f"  RSS parse error from {source_name}: {e}")
        return items

    # WordPress / WP-style RSS puts the full post body in <content:encoded>.
    CONTENT_NS = "{http://purl.org/rss/1.0/modules/content/}encoded"

    for item in root.iter("item"):
        title = (item.findtext("title") or "").strip()
        link = (item.findtext("link") or "").strip()
        # Prefer content:encoded (full body), fall back to description (summary).
        content_encoded = item.findtext(CONTENT_NS) or ""
        description = strip_html(content_encoded or item.findtext("description") or "")
        pub_date_raw = (item.findtext("pubDate") or "").strip()

        if not title or not link:
            continue

        signal_date = datetime.now(timezone.utc)
        if pub_date_raw:
            try:
                signal_date = parsedate_to_datetime(pub_date_raw)
                if signal_date.tzinfo is None:
                    signal_date = signal_date.replace(tzinfo=timezone.utc)
            except Exception:
                pass

        items.append({
            "title": title[:500],
            "link": link,
            "description": description[:5000],
            "signal_date": signal_date,
            "source_name": source_name,
        })

    return items


def extract_dockets(post: dict) -> list[str]:
    """Extract B-XXXXXX dockets from a post's title + body. Deduped, preserves order."""
    blob = f"{post['title']} {post['description']}"
    seen = []
    for m in DOCKET_RE.finditer(blob):
        d = m.group(0).upper()
        if d not in seen:
            seen.append(d)
    return seen


def is_protest_post(post: dict) -> bool:
    """Quick heuristic — does the post discuss a bid protest at all?"""
    blob = f"{post['title']} {post['description']}"
    return bool(PROTEST_KEYWORDS.search(blob))


def files_gao_url_for(docket: str) -> str:
    """Construct a best-guess files.gao.gov URL for a decision PDF.

    GAO decisions are sometimes hosted at files.gao.gov but the path is not
    fully predictable across all decisions. We return the GAO product page URL
    as the canonical link instead — even though gao.gov is WAF'd to us, the
    user's browser hits it just fine.
    """
    return f"https://www.gao.gov/products/{docket.lower()}"


async def fetch_feed(client: httpx.AsyncClient, feed: dict) -> list[dict]:
    """Fetch one feed and return parsed items, or [] on error."""
    try:
        resp = await client.get(feed["url"], headers={"User-Agent": USER_AGENT}, timeout=30.0)
        resp.raise_for_status()
    except Exception as e:
        logger.warning(f"  fetch failed for {feed['name']}: {e}")
        return []
    return parse_rss(resp.text, feed["name"])


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

    # Fetch all law firm feeds
    all_posts: list[dict] = []
    async with httpx.AsyncClient(follow_redirects=True) as client:
        for feed in LEGAL_BLOG_FEEDS:
            logger.info(f"Fetching {feed['name']}: {feed['url']}")
            items = await fetch_feed(client, feed)
            logger.info(f"  found {len(items)} items")
            all_posts.extend(items)
            await asyncio.sleep(0.3)   # gentle on the upstream

    logger.info(f"Total posts across {len(LEGAL_BLOG_FEEDS)} feeds: {len(all_posts)}")

    # Filter to posts that (a) mention a B-docket and (b) talk about bid protests.
    # The same docket can appear in multiple posts; we dedup at the docket level
    # by passing the docket as source_id, which is the unique key on foia_signals_feed.
    candidates: list[dict] = []
    for post in all_posts:
        if not is_protest_post(post):
            continue
        dockets = extract_dockets(post)
        if not dockets:
            continue
        # Use the first docket as the source_id for this post.
        # If a post discusses multiple dockets, only the first becomes a row;
        # the others get folded into the body and Claude can extract them as entities.
        post["docket"] = dockets[0]
        post["all_dockets"] = dockets
        candidates.append(post)

    logger.info(f"{len(candidates)} candidate posts contain a B-docket and protest keywords")

    inserted = skipped = failed = 0
    for post in candidates:
        try:
            # Cheap dedup before any Claude work
            if already_exists(supabase, SOURCE, post["docket"]):
                skipped += 1
                continue

            body_lines = [
                f"Docket: {post['docket']}",
                f"Source: {post['source_name']} ({post['link']})",
                "",
                post["title"],
                "",
                post["description"],
            ]
            if len(post["all_dockets"]) > 1:
                body_lines.insert(1, f"Related dockets: {', '.join(post['all_dockets'][1:])}")

            body = "\n".join(body_lines)

            status = await process_item(
                supabase=supabase,
                api_key=settings.anthropic_api_key,
                source=SOURCE,
                source_label=SOURCE_LABEL,
                source_id=post["docket"],
                title=post["title"],
                body_excerpt=body,
                source_url=post["link"],
                signal_date=post["signal_date"],
                default_agency_codes=["GAO"],
                extra_metadata={
                    "docket": post["docket"],
                    "all_dockets": post["all_dockets"],
                    "blog_source": post["source_name"],
                    "gao_product_url": files_gao_url_for(post["docket"]),
                },
            )
            if status == "inserted":
                inserted += 1
                logger.info(f"  + {post['docket']}: {post['title'][:80]}")
            elif status == "skipped":
                skipped += 1
            else:
                failed += 1
        except Exception as e:
            failed += 1
            logger.warning(f"  item failed {post.get('docket')}: {e}")
        await asyncio.sleep(0.2)

    log_run_summary(
        SOURCE,
        fetched=len(all_posts),
        inserted=inserted,
        skipped=skipped,
        failed=failed,
        runtime_seconds=time.monotonic() - started,
    )


if __name__ == "__main__":
    asyncio.run(main())
