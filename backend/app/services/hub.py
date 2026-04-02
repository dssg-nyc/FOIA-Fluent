"""Hub service — reads agency transparency stats from Supabase cache.

Data is populated weekly by scripts/refresh_hub_stats.py.
All methods are synchronous (matching the rest of the Supabase-accessing services).
"""
import logging
import statistics
from typing import Optional

from app.config import settings
from app.models.hub import AgencyStats, AgencyDetail, AgencyPageResponse, GlobalStats

logger = logging.getLogger(__name__)

_supabase = None


def _get_supabase():
    global _supabase
    if _supabase is not None:
        return _supabase
    if not settings.supabase_url or not settings.supabase_service_key:
        return None
    try:
        from supabase import create_client
        _supabase = create_client(settings.supabase_url, settings.supabase_service_key)
        return _supabase
    except Exception as e:
        logger.warning(f"Supabase client init failed: {e}")
        return None


def _row_to_stats(row: dict) -> AgencyStats:
    return AgencyStats(
        id=row["id"],
        name=row["name"],
        slug=row["slug"],
        jurisdiction=row.get("jurisdiction") or "",
        absolute_url=row.get("absolute_url") or "",
        average_response_time=row.get("average_response_time") or 0,
        fee_rate=row.get("fee_rate") or 0,
        success_rate=row.get("success_rate") or 0,
        number_requests=row.get("number_requests") or 0,
        number_requests_completed=row.get("number_requests_completed") or 0,
        number_requests_rejected=row.get("number_requests_rejected") or 0,
        number_requests_no_docs=row.get("number_requests_no_docs") or 0,
        number_requests_ack=row.get("number_requests_ack") or 0,
        number_requests_resp=row.get("number_requests_resp") or 0,
        number_requests_fix=row.get("number_requests_fix") or 0,
        number_requests_appeal=row.get("number_requests_appeal") or 0,
        number_requests_pay=row.get("number_requests_pay") or 0,
        number_requests_partial=row.get("number_requests_partial") or 0,
        number_requests_lawsuit=row.get("number_requests_lawsuit") or 0,
        number_requests_withdrawn=row.get("number_requests_withdrawn") or 0,
        has_portal=row.get("has_portal") or False,
        transparency_score=row.get("transparency_score") or 0,
        refreshed_at=str(row.get("refreshed_at") or ""),
    )


def get_global_stats() -> GlobalStats:
    """Return aggregated transparency metrics across all cached agencies."""
    supabase = _get_supabase()
    if not supabase:
        return _empty_global_stats()

    try:
        result = (
            supabase.table("agency_stats_cache")
            .select("*")
            .gte("number_requests", 5)   # only agencies with meaningful data
            .execute()
        )
        rows = result.data or []
    except Exception as e:
        logger.error(f"Hub global stats query failed: {e}")
        return _empty_global_stats()

    if not rows:
        return _empty_global_stats()

    all_stats = [_row_to_stats(r) for r in rows]

    total_requests = sum(s.number_requests for s in all_stats)
    total_completed = sum(s.number_requests_completed for s in all_stats)
    total_rejected = sum(s.number_requests_rejected for s in all_stats)
    total_no_docs = sum(s.number_requests_no_docs for s in all_stats)
    total_partial = sum(s.number_requests_partial for s in all_stats)
    total_appeal = sum(s.number_requests_appeal + s.number_requests_lawsuit for s in all_stats)
    total_withdrawn = sum(s.number_requests_withdrawn for s in all_stats)
    total_in_progress = sum(s.number_requests_ack + s.number_requests_resp + s.number_requests_fix + s.number_requests_pay for s in all_stats)
    overall_success = total_completed / total_requests if total_requests > 0 else 0

    response_times = [s.average_response_time for s in all_stats if s.average_response_time > 0]
    median_rt = statistics.median(response_times) if response_times else 0

    portal_count = sum(1 for s in all_stats if s.has_portal)
    portal_pct = (portal_count / len(all_stats)) * 100 if all_stats else 0

    sorted_by_score = sorted(all_stats, key=lambda s: s.transparency_score, reverse=True)
    top = sorted_by_score[:10]
    # bottom: exclude agencies with <10 requests to avoid noise
    meaningful = [s for s in all_stats if s.number_requests >= 10]
    bottom = sorted(meaningful, key=lambda s: s.transparency_score)[:10]

    last_refreshed = str(rows[0].get("refreshed_at")) if rows else None

    return GlobalStats(
        total_agencies=len(all_stats),
        total_requests=total_requests,
        total_completed=total_completed,
        total_rejected=total_rejected,
        total_no_docs=total_no_docs,
        total_partial=total_partial,
        total_appeal=total_appeal,
        total_withdrawn=total_withdrawn,
        total_in_progress=total_in_progress,
        overall_success_rate=round(overall_success * 100, 1),
        median_response_time=round(median_rt, 1),
        portal_coverage_pct=round(portal_pct, 1),
        top_agencies=top,
        bottom_agencies=bottom,
        last_refreshed=last_refreshed,
    )


def get_agencies(
    search: Optional[str] = None,
    sort_by: str = "transparency_score",
    min_requests: int = 5,
    page: int = 1,
    page_size: int = 25,
) -> AgencyPageResponse:
    """Return a paginated, optionally filtered list of agencies."""
    supabase = _get_supabase()
    if not supabase:
        return AgencyPageResponse(agencies=[], total=0, page=page, page_size=page_size)

    valid_sort_fields = {
        "transparency_score", "success_rate", "average_response_time",
        "fee_rate", "number_requests", "name",
    }
    sort_field = sort_by if sort_by in valid_sort_fields else "transparency_score"
    sort_asc = sort_field in ("name", "average_response_time", "fee_rate")

    try:
        query = (
            supabase.table("agency_stats_cache")
            .select("*", count="exact")
            .gte("number_requests", min_requests)
        )
        if search:
            query = query.ilike("name", f"%{search}%")

        count_result = query.execute()
        total = count_result.count or 0

        offset = (page - 1) * page_size
        data_query = (
            supabase.table("agency_stats_cache")
            .select("*")
            .gte("number_requests", min_requests)
            .order(sort_field, desc=not sort_asc)
            .range(offset, offset + page_size - 1)
        )
        if search:
            data_query = data_query.ilike("name", f"%{search}%")
        result = data_query.execute()
        result_data = result.data or []

        agencies = [_row_to_stats(r) for r in result_data]
        last_refreshed = str(result_data[0].get("refreshed_at")) if result_data else None

        return AgencyPageResponse(
            agencies=agencies,
            total=total,
            page=page,
            page_size=page_size,
            last_refreshed=last_refreshed,
        )
    except Exception as e:
        logger.error(f"Hub agencies query failed: {e}")
        return AgencyPageResponse(agencies=[], total=0, page=page, page_size=page_size)


def get_agency_detail(slug: str, jurisdiction: Optional[str] = None) -> Optional[AgencyDetail]:
    """Return detailed stats for a single agency, including exemption patterns."""
    supabase = _get_supabase()
    if not supabase:
        return None

    try:
        query = (
            supabase.table("agency_stats_cache")
            .select("*")
            .eq("slug", slug)
        )
        if jurisdiction:
            query = query.eq("jurisdiction", jurisdiction)
        result = query.order("number_requests", desc=True).limit(1).execute()
        row = result.data[0] if result.data else None
    except Exception as e:
        logger.warning(f"Hub agency detail query failed for {slug}: {e}")
        return None

    if not row:
        return None

    stats = _row_to_stats(row)

    # Compute percentile: what % of agencies have a lower transparency score
    try:
        count_result = supabase.table("agency_stats_cache").select("id", count="exact").gte("number_requests", 5).lt("transparency_score", stats.transparency_score).execute()
        lower_count = count_result.count or 0
        total_result = supabase.table("agency_stats_cache").select("id", count="exact").gte("number_requests", 5).execute()
        total_count = total_result.count or 1
        percentile = round((lower_count / total_count) * 100, 0)
    except Exception:
        percentile = 0

    # Pull exemption/denial/success patterns from agency_intel_cache if available
    denial_patterns = []
    success_patterns = []
    exemption_patterns = []
    try:
        # Try matching by slug-derived abbreviation or name search
        intel_result = (
            supabase.table("agency_intel_cache")
            .select("data")
            .ilike("agency_abbreviation", f"%{slug.upper().replace('-', '')}%")
            .limit(1)
            .execute()
        )
        if intel_result.data:
            intel = intel_result.data[0].get("data", {})
            denial_patterns = intel.get("denial_patterns", [])[:5]
            success_patterns = intel.get("success_patterns", [])[:5]
            exemption_patterns = intel.get("exemption_patterns", [])[:5]
    except Exception:
        pass

    return AgencyDetail(
        stats=stats,
        percentile=percentile,
        denial_patterns=denial_patterns,
        success_patterns=success_patterns,
        exemption_patterns=exemption_patterns,
    )


def _empty_global_stats() -> GlobalStats:
    return GlobalStats(
        total_agencies=0,
        total_requests=0,
        total_completed=0,
        total_rejected=0,
        overall_success_rate=0,
        median_response_time=0,
        portal_coverage_pct=0,
        top_agencies=[],
        bottom_agencies=[],
        last_refreshed=None,
    )
