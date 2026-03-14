import asyncio
import json
import logging
import os
import tempfile
from datetime import datetime, timezone

from tavily import AsyncTavilyClient

logger = logging.getLogger(__name__)

# Local JSON file — used as fallback when Supabase is not configured (local dev)
CACHE_FILE = os.path.join(
    os.path.dirname(os.path.dirname(__file__)), "data", "agency_intel_cache.json"
)
CACHE_TTL_HOURS = 24


def _extract_status(title: str, content: str) -> str:
    """Extract MuckRock request status from title + content."""
    combined = (title + " " + content).lower()
    status_keywords = [
        ("completed", "completed"),
        ("partially completed", "partially completed"),
        ("rejected", "rejected"),
        ("no responsive documents", "no responsive documents"),
        ("no responsive", "no responsive documents"),
        ("fix required", "fix required"),
        ("payment required", "payment required"),
        ("appealing", "appealing"),
        ("abandoned", "abandoned"),
        ("processing", "processing"),
        ("acknowledged", "acknowledged"),
        ("submitted", "submitted"),
        ("filed", "submitted"),
    ]
    for keyword, label in status_keywords:
        if keyword in combined:
            return label
    return ""


def _parse_tavily_results(results: list[dict]) -> list[dict]:
    """Parse Tavily results into a list of dicts with title, status, url, description."""
    parsed = []
    seen_urls: set[str] = set()
    for item in results:
        url = item.get("url", "")
        if "muckrock.com" not in url:
            continue
        normalized = url.rstrip("/").lower()
        if normalized in seen_urls:
            continue
        seen_urls.add(normalized)

        title = item.get("title", "").replace(" - MuckRock", "").strip()
        content = item.get("content", "")
        parsed.append({
            "title": title,
            "status": _extract_status(title, content),
            "url": url,
            "description": content[:300],
        })
    return parsed


class AgencyIntelAgent:
    """Researches an agency's overall FOIA track record on MuckRock.

    Runs 3 parallel Tavily searches to understand:
    - Denial patterns (why requests get rejected)
    - Success patterns (what language/scope works)
    - Exemption patterns (which exemptions the agency invokes)

    Results are cached to a local JSON file with a 24-hour TTL.
    """

    def __init__(self, tavily_api_key: str):
        self.tavily = AsyncTavilyClient(api_key=tavily_api_key) if tavily_api_key else None

    async def research_agency(self, abbreviation: str, name: str) -> dict:
        """Get agency intelligence, from cache if fresh or via live research."""
        # Check cache first
        cached = self._read_cache(abbreviation)
        if cached:
            logger.info(f"Using cached intel for {abbreviation}")
            return cached

        if not self.tavily:
            return self._empty_intel(abbreviation)

        logger.info(f"Researching {abbreviation} FOIA patterns on MuckRock")

        # Run 3 searches in parallel
        try:
            denial_task = self.tavily.search(
                query=f"{name} FOIA request denied rejected no responsive",
                max_results=8,
                search_depth="advanced",
                include_domains=["muckrock.com"],
            )
            success_task = self.tavily.search(
                query=f"{name} FOIA request completed fulfilled documents released",
                max_results=8,
                search_depth="advanced",
                include_domains=["muckrock.com"],
            )
            exemption_task = self.tavily.search(
                query=f"{name} FOIA exemption withheld redacted",
                max_results=8,
                search_depth="advanced",
                include_domains=["muckrock.com"],
            )

            denial_resp, success_resp, exemption_resp = await asyncio.gather(
                denial_task, success_task, exemption_task
            )

            intel = {
                "agency_abbreviation": abbreviation,
                "denial_patterns": _parse_tavily_results(
                    denial_resp.get("results", [])
                ),
                "success_patterns": _parse_tavily_results(
                    success_resp.get("results", [])
                ),
                "exemption_patterns": _parse_tavily_results(
                    exemption_resp.get("results", [])
                ),
                "cached_at": datetime.now(timezone.utc).isoformat(),
            }

            self._write_cache(abbreviation, intel)
            return intel

        except Exception as e:
            logger.error(f"Agency intel research failed for {abbreviation}: {e}")
            return self._empty_intel(abbreviation)

    def _empty_intel(self, abbreviation: str) -> dict:
        return {
            "agency_abbreviation": abbreviation,
            "denial_patterns": [],
            "success_patterns": [],
            "exemption_patterns": [],
            "cached_at": "",
        }

    def _read_cache(self, abbreviation: str) -> dict | None:
        """Read cached intel if it exists and is fresh.

        Tries Supabase first, falls back to the local JSON file.
        """
        # Try Supabase cache
        try:
            from app.services.agency_profiles import _get_supabase
            sb = _get_supabase()
            if sb:
                result = (
                    sb.table("agency_intel_cache")
                    .select("data, cached_at")
                    .eq("agency_abbreviation", abbreviation)
                    .single()
                    .execute()
                )
                if result.data:
                    cached_at_str = result.data["cached_at"]
                    cached_time = datetime.fromisoformat(cached_at_str.replace("Z", "+00:00"))
                    age_hours = (datetime.now(timezone.utc) - cached_time).total_seconds() / 3600
                    if age_hours <= CACHE_TTL_HOURS:
                        return result.data["data"]
                return None  # Supabase configured but cache miss/stale
        except Exception as e:
            logger.debug(f"Supabase cache read failed ({e}), trying local file")

        # Fallback: local JSON file
        try:
            if not os.path.exists(CACHE_FILE):
                return None
            with open(CACHE_FILE, "r") as f:
                cache = json.load(f)
            entry = cache.get(abbreviation)
            if not entry or not entry.get("cached_at"):
                return None
            cached_time = datetime.fromisoformat(entry["cached_at"])
            age_hours = (datetime.now(timezone.utc) - cached_time).total_seconds() / 3600
            if age_hours > CACHE_TTL_HOURS:
                return None
            return entry
        except Exception as e:
            logger.warning(f"Local cache read failed: {e}")
            return None

    def _write_cache(self, abbreviation: str, intel: dict) -> None:
        """Write intel to cache.

        Tries Supabase first, falls back to the local JSON file.
        """
        # Try Supabase cache
        try:
            from app.services.agency_profiles import _get_supabase
            sb = _get_supabase()
            if sb:
                sb.table("agency_intel_cache").upsert({
                    "agency_abbreviation": abbreviation,
                    "data": intel,
                    "cached_at": datetime.now(timezone.utc).isoformat(),
                }).execute()
                return
        except Exception as e:
            logger.debug(f"Supabase cache write failed ({e}), writing to local file")

        # Fallback: local JSON file with atomic write
        try:
            cache = {}
            if os.path.exists(CACHE_FILE):
                with open(CACHE_FILE, "r") as f:
                    cache = json.load(f)

            cache[abbreviation] = intel

            cache_dir = os.path.dirname(CACHE_FILE)
            fd, tmp_path = tempfile.mkstemp(dir=cache_dir, suffix=".tmp")
            try:
                with os.fdopen(fd, "w") as f:
                    json.dump(cache, f, indent=2)
                os.replace(tmp_path, CACHE_FILE)
            except Exception:
                os.unlink(tmp_path)
                raise
        except Exception as e:
            logger.warning(f"Local cache write failed: {e}")

    def format_for_prompt(self, intel: dict) -> str:
        """Format agency intelligence for Claude's context."""
        if not intel or not any([
            intel.get("denial_patterns"),
            intel.get("success_patterns"),
            intel.get("exemption_patterns"),
        ]):
            return "No agency-level FOIA intelligence available."

        lines = [f"Agency FOIA Intelligence for {intel.get('agency_abbreviation', 'Unknown')}:\n"]

        successes = intel.get("success_patterns", [])
        denials = intel.get("denial_patterns", [])
        exemptions = intel.get("exemption_patterns", [])

        lines.append(f"Research summary: {len(successes)} completed requests, "
                     f"{len(denials)} denied/rejected requests, "
                     f"{len(exemptions)} exemption-related results found.\n")

        if successes:
            lines.append("SUCCESSFUL REQUEST PATTERNS:")
            for s in successes[:5]:
                lines.append(f"  - \"{s['title']}\" (Status: {s.get('status', 'unknown')})")
                if s.get("description"):
                    lines.append(f"    Context: {s['description'][:200]}")

        if denials:
            lines.append("\nDENIAL PATTERNS:")
            for d in denials[:5]:
                lines.append(f"  - \"{d['title']}\" (Status: {d.get('status', 'unknown')})")
                if d.get("description"):
                    lines.append(f"    Context: {d['description'][:200]}")

        if exemptions:
            lines.append("\nEXEMPTION PATTERNS:")
            for e in exemptions[:5]:
                lines.append(f"  - \"{e['title']}\"")
                if e.get("description"):
                    lines.append(f"    Context: {e['description'][:200]}")

        lines.append(
            "\nUse these agency-wide patterns to inform the request: "
            "mirror strategies that led to fulfillment, avoid patterns that "
            "led to denials, and proactively address commonly invoked exemptions."
        )
        return "\n".join(lines)
