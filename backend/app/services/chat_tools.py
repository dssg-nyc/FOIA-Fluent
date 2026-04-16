"""Chat tool implementations — READ-ONLY access to all data sources.

Each tool function returns a dict with results and source citations.
NO tool may INSERT, UPDATE, or DELETE any database record.

To add a new tool:
1. Write the function here
2. Add it to TOOL_DEFINITIONS and TOOL_HANDLERS in chat.py
"""
import logging
from typing import Optional

from app.config import settings

logger = logging.getLogger(__name__)

# ── Verified FOIA exemption data (no API needed) ────────────────────────────

EXEMPTIONS = {
    "1": {"name": "Exemption 1", "short": "National Security", "description": "Protects classified national defense or foreign policy information. Requires proper classification under Executive Order.", "cite": "5 U.S.C. § 552(b)(1)"},
    "2": {"name": "Exemption 2", "short": "Internal Rules", "description": "Protects internal agency personnel rules and practices. Narrowed by the Supreme Court in Milner v. Department of the Navy (2011) to only trivial administrative matters.", "cite": "5 U.S.C. § 552(b)(2)"},
    "3": {"name": "Exemption 3", "short": "Statutory Exemption", "description": "Protects information specifically exempted by another federal statute, provided that statute either requires withholding or establishes particular criteria for withholding.", "cite": "5 U.S.C. § 552(b)(3)"},
    "4": {"name": "Exemption 4", "short": "Trade Secrets", "description": "Protects trade secrets and confidential commercial or financial information obtained from a person. After Food Marketing Institute v. Argus Leader Media (2019), information is 'confidential' if customarily kept private by the submitter.", "cite": "5 U.S.C. § 552(b)(4)"},
    "5": {"name": "Exemption 5", "short": "Deliberative Process", "description": "Protects inter-agency or intra-agency communications that are privileged, including deliberative process, attorney-client, and attorney work product privileges. Most commonly invoked exemption. Does not protect purely factual material.", "cite": "5 U.S.C. § 552(b)(5)"},
    "6": {"name": "Exemption 6", "short": "Personal Privacy", "description": "Protects information about individuals in personnel, medical, and similar files when disclosure would constitute a clearly unwarranted invasion of personal privacy. Requires balancing public interest against privacy interest.", "cite": "5 U.S.C. § 552(b)(6)"},
    "7(A)": {"name": "Exemption 7(A)", "short": "Law Enforcement — Proceedings", "description": "Protects law enforcement records that could reasonably be expected to interfere with enforcement proceedings.", "cite": "5 U.S.C. § 552(b)(7)(A)"},
    "7(B)": {"name": "Exemption 7(B)", "short": "Law Enforcement — Fair Trial", "description": "Protects law enforcement records that would deprive a person of a right to a fair trial or impartial adjudication.", "cite": "5 U.S.C. § 552(b)(7)(B)"},
    "7(C)": {"name": "Exemption 7(C)", "short": "Law Enforcement — Privacy", "description": "Protects law enforcement records that could reasonably be expected to constitute an unwarranted invasion of personal privacy. Broader than Exemption 6.", "cite": "5 U.S.C. § 552(b)(7)(C)"},
    "7(D)": {"name": "Exemption 7(D)", "short": "Law Enforcement — Confidential Sources", "description": "Protects the identity of confidential sources and information provided by them in law enforcement investigations.", "cite": "5 U.S.C. § 552(b)(7)(D)"},
    "7(E)": {"name": "Exemption 7(E)", "short": "Law Enforcement — Techniques", "description": "Protects law enforcement techniques and procedures if disclosure could risk circumvention of the law.", "cite": "5 U.S.C. § 552(b)(7)(E)"},
    "7(F)": {"name": "Exemption 7(F)", "short": "Law Enforcement — Safety", "description": "Protects information that could reasonably be expected to endanger the life or physical safety of any individual.", "cite": "5 U.S.C. § 552(b)(7)(F)"},
    "8": {"name": "Exemption 8", "short": "Financial Institutions", "description": "Protects information contained in or related to examination, operating, or condition reports prepared by, on behalf of, or for the use of an agency responsible for regulating financial institutions.", "cite": "5 U.S.C. § 552(b)(8)"},
    "9": {"name": "Exemption 9", "short": "Geological Data", "description": "Protects geological and geophysical information and data, including maps, concerning wells.", "cite": "5 U.S.C. § 552(b)(9)"},
}


def _get_supabase():
    if not settings.supabase_url or not settings.supabase_service_key:
        return None
    from supabase import create_client
    return create_client(settings.supabase_url, settings.supabase_service_key)


# ── Tool: lookup_exemption ───────────────────────────────────────────────────

def lookup_exemption(exemption_number: str) -> dict:
    """Look up a specific FOIA exemption by number."""
    # Normalize input
    num = exemption_number.strip().upper().replace("EXEMPTION ", "").replace("EX. ", "").replace("EX ", "")

    if num in EXEMPTIONS:
        ex = EXEMPTIONS[num]
        return {"found": True, "source": ex["cite"], **ex}

    # Try partial match
    for key, ex in EXEMPTIONS.items():
        if num in key or key in num:
            return {"found": True, "source": ex["cite"], **ex}

    return {"found": False, "message": f"Exemption '{exemption_number}' not found. Valid exemptions: 1-9, 7(A)-7(F)."}


# ── Tool: lookup_agency ──────────────────────────────────────────────────────

def lookup_agency(agency_name: str) -> dict:
    """Look up agency profile and transparency stats. READ-ONLY."""
    supabase = _get_supabase()
    if not supabase:
        return {"found": False, "message": "Database unavailable."}

    results = {}

    # Search agency_profiles
    try:
        profile_result = (
            supabase.table("agency_profiles")
            .select("*")
            .or_(f"name.ilike.%{agency_name}%,abbreviation.ilike.%{agency_name}%")
            .limit(1)
            .execute()
        )
        if profile_result.data:
            p = profile_result.data[0]
            results["profile"] = {
                "name": p.get("name"),
                "abbreviation": p.get("abbreviation"),
                "foia_email": p.get("foia_email"),
                "foia_website": p.get("foia_website"),
                "description": p.get("description", "")[:300],
                "submission_notes": p.get("submission_notes", "")[:300],
            }
            results["source"] = "FOIA Fluent agency_profiles database"
    except Exception as e:
        logger.warning(f"Agency profile lookup failed: {e}")

    # Search agency_stats_cache for transparency data
    try:
        stats_result = (
            supabase.table("agency_stats_cache")
            .select("name,slug,transparency_score,success_rate,average_response_time,fee_rate,number_requests,has_portal")
            .ilike("name", f"%{agency_name}%")
            .order("number_requests", desc=True)
            .limit(3)
            .execute()
        )
        if stats_result.data:
            results["stats"] = stats_result.data
            results["stats_source"] = "MuckRock transparency data (agency_stats_cache)"
    except Exception as e:
        logger.warning(f"Agency stats lookup failed: {e}")

    if results:
        results["found"] = True
    else:
        results = {"found": False, "message": f"No data found for '{agency_name}'."}

    return results


# ── Tool: search_web ─────────────────────────────────────────────────────────

async def search_web(query: str, trusted_only: bool = True) -> dict:
    """Search the web for FOIA information. Returns results with source URLs."""
    if not settings.tavily_api_key:
        return {"results": [], "message": "Web search unavailable."}

    from tavily import AsyncTavilyClient
    client = AsyncTavilyClient(api_key=settings.tavily_api_key)

    try:
        kwargs = {
            "query": f"FOIA {query}",
            "max_results": 5,
            "search_depth": "basic" if trusted_only else "advanced",
        }
        if trusted_only:
            kwargs["include_domains"] = [
                "justice.gov", "foia.gov", "muckrock.com", "rcfp.org",
                "eff.org", "congress.gov", "law.cornell.edu", "govinfo.gov",
            ]

        response = await client.search(**kwargs)
        results = [
            {
                "title": r.get("title", ""),
                "url": r.get("url", ""),
                "snippet": r.get("content", "")[:300],
            }
            for r in response.get("results", [])
        ]
        return {
            "results": results,
            "source": "Tavily web search" + (" (trusted FOIA domains)" if trusted_only else " (broad search)"),
            "query_used": kwargs["query"],
        }
    except Exception as e:
        logger.error(f"Web search failed: {e}")
        return {"results": [], "message": f"Search error: {e}"}


# ── Tool: search_web_broad (Tier 3) ─────────────────────────────────────────

async def search_web_broad(query: str) -> dict:
    """Broader web search when trusted sources don't have the answer."""
    return await search_web(query, trusted_only=False)


# ── Tool: search_requests ────────────────────────────────────────────────────

def search_requests(user_id: str, query: str = "", status_filter: str = "") -> dict:
    """Search the user's own tracked FOIA requests. READ-ONLY.

    Can list all requests, filter by keyword, or filter by status.
    Also returns summary stats (total, by status, overdue count).
    """
    supabase = _get_supabase()
    if not supabase or not user_id:
        return {"requests": [], "message": "Not authenticated. Please sign in to access your requests."}

    try:
        q = supabase.table("tracked_requests").select(
            "id,title,description,status,agency,filed_date,due_date,created_at,letter_text"
        ).eq("user_id", user_id)

        if query:
            q = q.or_(f"title.ilike.%{query}%,description.ilike.%{query}%")

        if status_filter:
            q = q.eq("status", status_filter)

        q = q.order("created_at", desc=True).limit(25)
        result = q.execute()
        requests = result.data or []

        # Compute summary stats
        from datetime import date
        today = date.today()
        status_counts: dict[str, int] = {}
        overdue = 0
        for r in requests:
            s = r.get("status", "unknown")
            status_counts[s] = status_counts.get(s, 0) + 1
            due = r.get("due_date")
            if due and r.get("status") in ("submitted", "awaiting_response"):
                try:
                    due_date = date.fromisoformat(due)
                    if due_date < today:
                        overdue += 1
                except (ValueError, TypeError):
                    pass

        # Strip letter_text to keep response small (just first 200 chars for context)
        for r in requests:
            if r.get("letter_text"):
                r["letter_text"] = r["letter_text"][:200] + "..."

        return {
            "requests": requests,
            "count": len(requests),
            "summary": {
                "total": len(requests),
                "by_status": status_counts,
                "overdue": overdue,
            },
            "source": "Your tracked FOIA requests in My Requests",
        }
    except Exception as e:
        logger.error(f"Request search failed: {e}")
        return {"requests": [], "message": f"Error: {e}"}


def get_request_detail(user_id: str, request_id: str) -> dict:
    """Get full details of a specific tracked request including communications. READ-ONLY."""
    supabase = _get_supabase()
    if not supabase or not user_id:
        return {"message": "Not authenticated."}

    try:
        # Get the request
        req_result = (
            supabase.table("tracked_requests")
            .select("*")
            .eq("id", request_id)
            .eq("user_id", user_id)
            .single()
            .execute()
        )
        request = req_result.data
        if not request:
            return {"message": "Request not found."}

        # Get communications
        comms_result = (
            supabase.table("communications")
            .select("id,direction,comm_type,subject,body,date")
            .eq("request_id", request_id)
            .order("date", desc=False)
            .execute()
        )

        # Get analyses
        analyses_result = (
            supabase.table("response_analyses")
            .select("summary,recommended_action,exemptions_cited,grounds_for_appeal,analyzed_at")
            .eq("request_id", request_id)
            .order("analyzed_at", desc=True)
            .limit(3)
            .execute()
        )

        return {
            "request": request,
            "communications": comms_result.data or [],
            "analyses": analyses_result.data or [],
            "source": "Your tracked request details",
        }
    except Exception as e:
        logger.error(f"Request detail lookup failed: {e}")
        return {"message": f"Error: {e}"}


# ── Tool: get_hub_stats ──────────────────────────────────────────────────────

def get_hub_stats(query: str = "") -> dict:
    """Get transparency statistics from the Data Hub. READ-ONLY."""
    supabase = _get_supabase()
    if not supabase:
        return {"message": "Database unavailable."}

    try:
        if query:
            # Search for specific agency/state
            result = (
                supabase.table("agency_stats_cache")
                .select("name,transparency_score,success_rate,average_response_time,number_requests,jurisdiction")
                .ilike("name", f"%{query}%")
                .order("number_requests", desc=True)
                .limit(5)
                .execute()
            )
            return {
                "results": result.data or [],
                "source": "FOIA Fluent Transparency Hub (MuckRock data)",
            }
        else:
            # General stats
            result = (
                supabase.table("agency_stats_cache")
                .select("name,transparency_score,success_rate,number_requests")
                .gte("number_requests", 50)
                .order("transparency_score", desc=True)
                .limit(10)
                .execute()
            )
            return {
                "top_agencies": result.data or [],
                "source": "FOIA Fluent Transparency Hub — top agencies by transparency score",
            }
    except Exception as e:
        logger.error(f"Hub stats query failed: {e}")
        return {"message": f"Error: {e}"}


# ── Tool: search_muckrock ───────────────────────────────────────────────────

async def search_muckrock(query: str) -> dict:
    """Search MuckRock for similar FOIA requests and outcomes."""
    return await search_web(f"site:muckrock.com {query}", trusted_only=False)


# ── Tool: search_my_discoveries (Discover & Draft saved library) ─────────────

def search_my_discoveries(
    user_id: str,
    query: str = "",
    status: str = "",
    tag: str = "",
    days: int = 30,
) -> dict:
    """Search the user's saved discoveries library. READ-ONLY.

    Returns documents the user has bookmarked from the Discover & Draft search,
    optionally filtered by free-text query (title/description/note), status, tag,
    or recency window in days.
    """
    if not user_id:
        return {
            "discoveries": [],
            "message": "Not signed in. Sign in and save discoveries from the Discover & Draft tab to use this.",
        }
    try:
        from app.services.discoveries import search_my_discoveries_for_chat
        rows = search_my_discoveries_for_chat(
            user_id=user_id, query=query, status=status, tag=tag, days=days, limit=10
        )
        if not rows:
            return {
                "discoveries": [],
                "message": "No saved discoveries match. Save documents from the Discover & Draft tab to build your library.",
            }
        return {
            "discoveries": rows,
            "count": len(rows),
            "source": "Your saved discoveries library (My Discoveries)",
        }
    except Exception as e:
        logger.error(f"search_my_discoveries failed: {e}")
        return {"discoveries": [], "message": f"Error: {e}"}


# ── Tool: read_saved_document (Discover & Draft saved library) ──────────────

async def read_saved_document(user_id: str, document_id: str = "", title_or_url: str = "") -> dict:
    """Fetch a single saved document by ID (preferred), title, or URL.
    Returns the AI-generated summary, the user's own note, and (when possible)
    the FULL extracted text content from the source URL via Tavily extract.
    READ-ONLY.

    IMPORTANT: If you have the document's `id` from a previous
    search_my_discoveries call, always pass it as `document_id` — this
    guarantees an exact match. Only fall back to title_or_url when you
    don't have the ID.
    """
    if not user_id:
        return {
            "error": "Not signed in.",
            "hint": "Sign in to access your saved discoveries library.",
        }
    if not document_id and not title_or_url:
        return {
            "error": "Need a document ID, title, or URL to look up.",
            "hint": "Pass the document_id from search_my_discoveries, or a title/URL.",
        }
    try:
        from app.services.discoveries import read_saved_document_for_chat
        return await read_saved_document_for_chat(
            user_id=user_id,
            document_id=document_id,
            title_or_url=title_or_url,
        )
    except Exception as e:
        logger.error(f"read_saved_document failed: {e}")
        return {"error": str(e)}


# ── Tool: get_recent_signals (Live FOIA Signals) ────────────────────────────

def get_recent_signals(persona: str = "", query: str = "", days: int = 7) -> dict:
    """Get recent items from the Live FOIA Signals feed.

    Filters by optional persona ("journalist", "pharma_analyst", "hedge_fund",
    "environmental"), optional keyword (matched in title/summary), and a recency
    window in days. READ-ONLY.
    """
    from app.services.signals import get_recent_signals_for_chat
    try:
        rows = get_recent_signals_for_chat(persona=persona, query=query, days=days, limit=10)
        if not rows:
            return {
                "signals": [],
                "message": "No signals matched. The Live FOIA Signals feed updates from GAO bid protests, EPA ECHO enforcement, FDA Warning Letters, and DHS FOIA logs.",
            }
        return {
            "signals": rows,
            "count": len(rows),
            "source": "FOIA Fluent Live Signals feed (foia_signals_feed)",
        }
    except Exception as e:
        logger.error(f"get_recent_signals failed: {e}")
        return {"signals": [], "message": f"Error: {e}"}
