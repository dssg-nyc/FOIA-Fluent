"""Generate AI-curated FOIA news digest using Claude API.

Fetches recent FOIA-related news from RSS feeds and web sources,
then uses Claude to summarize and categorize each item.

Run manually or on a weekly schedule:
    cd backend
    python -m app.scripts.refresh_news_digest

Extensibility: Add new RSS feeds or sources to the SOURCES list below.
"""
import asyncio
import logging
import sys
from datetime import datetime, timezone

import httpx

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)

# ── Configurable source list ─────────────────────────────────────────────────
# Add new sources here — each needs a name, url, and type (rss or web)
SOURCES = [
    {"name": "RCFP", "url": "https://www.rcfp.org/feed/", "type": "rss"},
    {"name": "EFF", "url": "https://www.eff.org/rss/updates.xml", "type": "rss"},
    {"name": "IRE/NICAR", "url": "https://www.ire.org/feed/", "type": "rss"},
    {"name": "ProPublica", "url": "https://feeds.propublica.org/propublica/main", "type": "rss"},
    {"name": "The Intercept", "url": "https://theintercept.com/feed/?rss", "type": "rss"},
    {"name": "Just Security", "url": "https://www.justsecurity.org/feed/", "type": "rss"},
    {"name": "Center for Public Integrity", "url": "https://publicintegrity.org/feed/", "type": "rss"},
    {"name": "ACLU", "url": "https://www.aclu.org/feed", "type": "rss"},
    {"name": "GovExec", "url": "https://www.govexec.com/rss/all/", "type": "rss"},
    {"name": "FedScoop", "url": "https://fedscoop.com/feed/", "type": "rss"},
]

MAX_ITEMS_PER_SOURCE = 30
MAX_DIGEST_ITEMS = 40


def parse_rss_items(xml_text: str, source_name: str) -> list[dict]:
    """Parse RSS/Atom feed and extract recent items."""
    from xml.etree import ElementTree as ET

    items = []
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return []

    # Handle RSS 2.0
    for item in root.iter("item"):
        title = item.findtext("title", "").strip()
        link = item.findtext("link", "").strip()
        description = item.findtext("description", "").strip()
        pub_date = item.findtext("pubDate", "").strip()

        if title and link:
            # Check if FOIA-related
            text = f"{title} {description}".lower()
            if any(kw in text for kw in [
                "foia", "freedom of information", "public records",
                "transparency", "government secrecy", "open government",
                "records request", "information act", "redact",
                "classified", "disclosure", "sunshine",
                "open records", "government documents", "records release",
                "public access", "exemption", "withholding", "watchdog",
                "government accountability", "inspector general",
                "oversight", "whistleblow", "surveillance",
                "civil liberties", "first amendment", "press freedom",
                "government data", "data breach", "privacy act",
            ]):
                items.append({
                    "title": title[:200],
                    "link": link,
                    "description": description[:500],
                    "pub_date": pub_date,
                    "source_name": source_name,
                })

    # Handle Atom feeds
    ns = {"atom": "http://www.w3.org/2005/Atom"}
    for entry in root.iter("{http://www.w3.org/2005/Atom}entry"):
        title = ""
        link = ""
        summary = ""
        published = ""

        t = entry.find("atom:title", ns)
        if t is not None:
            title = (t.text or "").strip()

        for l in entry.findall("atom:link", ns):
            href = l.get("href", "")
            if href:
                link = href
                break

        s = entry.find("atom:summary", ns) or entry.find("atom:content", ns)
        if s is not None:
            summary = (s.text or "").strip()

        p = entry.find("atom:published", ns) or entry.find("atom:updated", ns)
        if p is not None:
            published = (p.text or "").strip()

        if title and link:
            text = f"{title} {summary}".lower()
            if any(kw in text for kw in [
                "foia", "freedom of information", "public records",
                "transparency", "government secrecy", "open government",
                "records request", "information act", "redact",
                "classified", "disclosure", "sunshine",
                "open records", "government documents", "records release",
                "public access", "exemption", "withholding", "watchdog",
                "government accountability", "inspector general",
                "oversight", "whistleblow", "surveillance",
                "civil liberties", "first amendment", "press freedom",
                "government data", "data breach", "privacy act",
            ]):
                items.append({
                    "title": title[:200],
                    "link": link,
                    "description": summary[:500],
                    "pub_date": published,
                    "source_name": source_name,
                })

    return items[:MAX_ITEMS_PER_SOURCE]


async def summarize_with_claude(items: list[dict], api_key: str) -> list[dict]:
    """Use Claude API to summarize and categorize FOIA news items."""
    if not items:
        return []

    # Build prompt with all items
    items_text = ""
    for i, item in enumerate(items):
        items_text += f"\n--- Item {i+1} ---\n"
        items_text += f"Source: {item['source_name']}\n"
        items_text += f"Title: {item['title']}\n"
        items_text += f"URL: {item['link']}\n"
        items_text += f"Description: {item['description'][:300]}\n"

    prompt = f"""You are a FOIA and government transparency analyst curating a news digest for people who file public records requests.

For each item below, provide:
1. A concise 1-2 sentence summary focusing on relevance to FOIA, public records, government transparency, or accountability
2. A category: one of "court_case", "policy", "report", "investigation", "news"

Return your response as a JSON array with objects having these fields:
- "index": the item number (1-based)
- "summary": your 1-2 sentence summary
- "category": one of the categories above

Include items about: FOIA requests/lawsuits, public records access, government transparency/secrecy, whistleblower protections, surveillance oversight, inspector general reports, government accountability, press freedom, classified document disputes, and data privacy laws. Be inclusive — if an article touches on government transparency or access to information in any meaningful way, include it.

{items_text}

Respond with ONLY the JSON array, no other text."""

    async with httpx.AsyncClient() as client:
        try:
            resp = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json={
                    "model": "claude-haiku-4-5-20251001",
                    "max_tokens": 2000,
                    "messages": [{"role": "user", "content": prompt}],
                },
                timeout=60.0,
            )
            resp.raise_for_status()
            data = resp.json()
            text = data["content"][0]["text"].strip()

            # Parse JSON from response
            import json
            # Handle potential markdown code blocks
            if text.startswith("```"):
                text = text.split("\n", 1)[1].rsplit("```", 1)[0]
            summaries = json.loads(text)

            # Merge summaries back with items
            result = []
            for s in summaries:
                idx = s.get("index", 0) - 1
                if 0 <= idx < len(items):
                    item = items[idx]
                    result.append({
                        "title": item["title"],
                        "summary": s.get("summary", ""),
                        "source_url": item["link"],
                        "source_name": item["source_name"],
                        "category": s.get("category", "news"),
                        "published_date": item.get("pub_date", ""),
                    })

            return result[:MAX_DIGEST_ITEMS]

        except Exception as e:
            logger.error(f"Claude API error: {e}")
            # Fallback: return items without AI summaries
            return [
                {
                    "title": item["title"],
                    "summary": item["description"][:200],
                    "source_url": item["link"],
                    "source_name": item["source_name"],
                    "category": "news",
                    "published_date": item.get("pub_date", ""),
                }
                for item in items[:MAX_DIGEST_ITEMS]
            ]


def parse_date(date_str: str) -> str | None:
    """Try to parse various date formats into YYYY-MM-DD."""
    if not date_str:
        return None
    from email.utils import parsedate_to_datetime
    try:
        dt = parsedate_to_datetime(date_str)
        return dt.strftime("%Y-%m-%d")
    except Exception:
        pass
    # Try ISO format
    try:
        dt = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
        return dt.strftime("%Y-%m-%d")
    except Exception:
        pass
    return None


async def main():
    from app.config import settings

    if not settings.anthropic_api_key:
        logger.error("ANTHROPIC_API_KEY must be set.")
        sys.exit(1)

    if not settings.supabase_url or not settings.supabase_service_key:
        logger.error("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set.")
        sys.exit(1)

    from supabase import create_client
    supabase = create_client(settings.supabase_url, settings.supabase_service_key)

    # Step 1: Fetch RSS feeds
    all_items = []
    async with httpx.AsyncClient(follow_redirects=True, timeout=20.0) as client:
        for source in SOURCES:
            logger.info(f"Fetching {source['name']}...")
            try:
                resp = await client.get(source["url"])
                if resp.status_code == 200:
                    items = parse_rss_items(resp.text, source["name"])
                    all_items.extend(items)
                    logger.info(f"  Found {len(items)} FOIA-related items")
                else:
                    logger.warning(f"  HTTP {resp.status_code}")
            except Exception as e:
                logger.warning(f"  Error: {e}")
            await asyncio.sleep(0.5)

    logger.info(f"Total raw items: {len(all_items)}")

    if not all_items:
        logger.info("No FOIA news items found. Done.")
        return

    # Step 2: Summarize with Claude
    logger.info("Generating AI summaries with Claude...")
    digest_items = await summarize_with_claude(all_items, settings.anthropic_api_key)
    logger.info(f"Generated {len(digest_items)} digest entries.")

    # Step 3: Clear old digest and insert new
    try:
        supabase.table("foia_news_digest").delete().neq("id", 0).execute()
        logger.info("Cleared old digest entries.")
    except Exception as e:
        logger.warning(f"Failed to clear old entries: {e}")

    upserted = 0
    for item in digest_items:
        row = {
            "title": item["title"],
            "summary": item["summary"],
            "source_url": item.get("source_url", ""),
            "source_name": item.get("source_name", ""),
            "category": item.get("category", "news"),
            "published_date": parse_date(item.get("published_date", "")),
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }
        try:
            supabase.table("foia_news_digest").insert(row).execute()
            upserted += 1
        except Exception as e:
            logger.warning(f"Failed to insert digest item: {e}")

    logger.info(f"Inserted {upserted} digest entries. Done.")


if __name__ == "__main__":
    asyncio.run(main())
