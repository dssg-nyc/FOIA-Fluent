"""Jurisdiction service — reads state-level transparency stats from Supabase cache.

Data is populated weekly by scripts/refresh_jurisdiction_stats.py.
"""
import logging
import statistics
from typing import Optional

from app.config import settings
from app.models.hub import AgencyStats, AgencyPageResponse
from app.models.jurisdictions import JurisdictionSummary, StateMapData, JurisdictionDetail

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


def _row_to_summary(jrow: dict, srow: dict) -> JurisdictionSummary:
    """Combine a jurisdiction_cache row with its jurisdiction_stats_cache row."""
    return JurisdictionSummary(
        id=jrow["id"],
        name=jrow["name"],
        slug=jrow["slug"],
        abbrev=jrow.get("abbrev") or "",
        level=jrow.get("level") or "state",
        transparency_score=srow.get("transparency_score") or 0,
        total_agencies=srow.get("total_agencies") or 0,
        total_requests=srow.get("total_requests") or 0,
        overall_success_rate=srow.get("overall_success_rate") or 0,
        average_response_time=srow.get("average_response_time") or 0,
        median_response_time=srow.get("median_response_time") or 0,
        fee_rate=srow.get("fee_rate") or 0,
        portal_coverage_pct=srow.get("portal_coverage_pct") or 0,
    )


def _row_to_agency_stats(row: dict) -> AgencyStats:
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


def get_map_data() -> StateMapData:
    """Return all states with transparency scores for the choropleth map."""
    supabase = _get_supabase()
    if not supabase:
        return StateMapData(states=[])

    try:
        j_result = supabase.table("jurisdiction_cache").select("*").eq("level", "state").execute()
        j_rows = {r["id"]: r for r in (j_result.data or [])}

        s_result = supabase.table("jurisdiction_stats_cache").select("*").execute()
        s_rows = {r["jurisdiction_id"]: r for r in (s_result.data or [])}
    except Exception as e:
        logger.error(f"Jurisdiction map query failed: {e}")
        return StateMapData(states=[])

    states = []
    for jid, jrow in j_rows.items():
        srow = s_rows.get(jid, {})
        states.append(_row_to_summary(jrow, srow))

    scores = [s.transparency_score for s in states if s.transparency_score > 0]
    success_rates = [s.overall_success_rate for s in states if s.total_requests > 0]
    response_times = [s.average_response_time for s in states if s.average_response_time > 0]

    # Aggregate outcome totals from all state agencies
    total_completed = 0
    total_rejected = 0
    total_no_docs = 0
    total_partial = 0
    total_appeal = 0
    total_withdrawn = 0
    total_in_progress = 0
    total_requests = 0
    portal_count = 0
    total_agency_count = 0
    try:
        agg_result = (
            supabase.table("agency_stats_cache")
            .select("number_requests,number_requests_completed,number_requests_rejected,number_requests_no_docs,number_requests_partial,number_requests_appeal,number_requests_lawsuit,number_requests_withdrawn,number_requests_ack,number_requests_resp,number_requests_fix,number_requests_pay,has_portal")
            .not_.is_("jurisdiction_id", "null")
            .neq("jurisdiction_id", 10)  # exclude federal
            .execute()
        )
        for r in (agg_result.data or []):
            total_requests += r.get("number_requests") or 0
            total_completed += r.get("number_requests_completed") or 0
            total_rejected += r.get("number_requests_rejected") or 0
            total_no_docs += r.get("number_requests_no_docs") or 0
            total_partial += r.get("number_requests_partial") or 0
            total_appeal += (r.get("number_requests_appeal") or 0) + (r.get("number_requests_lawsuit") or 0)
            total_withdrawn += r.get("number_requests_withdrawn") or 0
            total_in_progress += (r.get("number_requests_ack") or 0) + (r.get("number_requests_resp") or 0) + (r.get("number_requests_fix") or 0) + (r.get("number_requests_pay") or 0)
            if r.get("has_portal"):
                portal_count += 1
            total_agency_count += 1
    except Exception as e:
        logger.error(f"Aggregate state stats query failed: {e}")

    overall_success = (total_completed / total_requests * 100) if total_requests > 0 else 0
    portal_pct = (portal_count / total_agency_count * 100) if total_agency_count > 0 else 0
    median_rt = statistics.median(response_times) if response_times else 0

    sorted_states = sorted(states, key=lambda s: s.transparency_score, reverse=True)
    meaningful = [s for s in states if s.total_requests >= 10]
    top_states = sorted_states[:10]
    bottom_states = sorted(meaningful, key=lambda s: s.transparency_score)[:10]

    last_refreshed = None
    if s_rows:
        first = next(iter(s_rows.values()))
        last_refreshed = str(first.get("refreshed_at") or "")

    return StateMapData(
        states=sorted_states,
        national_avg_score=round(statistics.mean(scores), 1) if scores else 0,
        national_avg_success_rate=round(statistics.mean(success_rates), 1) if success_rates else 0,
        national_avg_response_time=round(statistics.mean(response_times), 1) if response_times else 0,
        total_state_agencies=sum(s.total_agencies for s in states),
        total_requests=total_requests,
        total_completed=total_completed,
        total_rejected=total_rejected,
        total_no_docs=total_no_docs,
        total_partial=total_partial,
        total_appeal=total_appeal,
        total_withdrawn=total_withdrawn,
        total_in_progress=total_in_progress,
        overall_success_rate=round(overall_success, 1),
        median_response_time=round(median_rt, 1),
        portal_coverage_pct=round(portal_pct, 1),
        top_states=top_states,
        bottom_states=bottom_states,
        last_refreshed=last_refreshed,
    )


def get_jurisdiction_detail(slug: str) -> Optional[JurisdictionDetail]:
    """Return detailed stats for a single state jurisdiction."""
    supabase = _get_supabase()
    if not supabase:
        return None

    try:
        j_result = (
            supabase.table("jurisdiction_cache")
            .select("*")
            .eq("slug", slug)
            .single()
            .execute()
        )
        jrow = j_result.data
    except Exception:
        return None

    if not jrow:
        return None

    jid = jrow["id"]

    # Get jurisdiction stats
    try:
        s_result = (
            supabase.table("jurisdiction_stats_cache")
            .select("*")
            .eq("jurisdiction_id", jid)
            .single()
            .execute()
        )
        srow = s_result.data or {}
    except Exception:
        srow = {}

    summary = _row_to_summary(jrow, srow)

    # Top and bottom agencies in this jurisdiction
    try:
        top_result = (
            supabase.table("agency_stats_cache")
            .select("*")
            .eq("jurisdiction_id", jid)
            .gte("number_requests", 5)
            .order("transparency_score", desc=True)
            .limit(10)
            .execute()
        )
        top_agencies = [_row_to_agency_stats(r) for r in (top_result.data or [])]

        bottom_result = (
            supabase.table("agency_stats_cache")
            .select("*")
            .eq("jurisdiction_id", jid)
            .gte("number_requests", 10)
            .order("transparency_score", desc=False)
            .limit(10)
            .execute()
        )
        bottom_agencies = [_row_to_agency_stats(r) for r in (bottom_result.data or [])]
    except Exception:
        top_agencies = []
        bottom_agencies = []

    # Compute outcome totals from agencies
    total_no_docs = 0
    total_partial = 0
    total_appeal = 0
    total_withdrawn = 0
    total_in_progress = 0
    try:
        all_result = (
            supabase.table("agency_stats_cache")
            .select("number_requests_no_docs,number_requests_partial,number_requests_appeal,number_requests_lawsuit,number_requests_withdrawn,number_requests_ack,number_requests_resp,number_requests_fix,number_requests_pay")
            .eq("jurisdiction_id", jid)
            .execute()
        )
        for r in (all_result.data or []):
            total_no_docs += r.get("number_requests_no_docs") or 0
            total_partial += r.get("number_requests_partial") or 0
            total_appeal += (r.get("number_requests_appeal") or 0) + (r.get("number_requests_lawsuit") or 0)
            total_withdrawn += r.get("number_requests_withdrawn") or 0
            total_in_progress += (r.get("number_requests_ack") or 0) + (r.get("number_requests_resp") or 0) + (r.get("number_requests_fix") or 0) + (r.get("number_requests_pay") or 0)
    except Exception:
        pass

    # Percentile among all states
    percentile = 0
    try:
        lower_count_result = (
            supabase.table("jurisdiction_stats_cache")
            .select("jurisdiction_id", count="exact")
            .lt("transparency_score", summary.transparency_score)
            .execute()
        )
        total_count_result = (
            supabase.table("jurisdiction_stats_cache")
            .select("jurisdiction_id", count="exact")
            .execute()
        )
        lower = lower_count_result.count or 0
        total = total_count_result.count or 1
        percentile = round((lower / total) * 100, 0)
    except Exception:
        pass

    return JurisdictionDetail(
        jurisdiction=summary,
        top_agencies=top_agencies,
        bottom_agencies=bottom_agencies,
        total_no_docs=total_no_docs,
        total_partial=total_partial,
        total_appeal=total_appeal,
        total_withdrawn=total_withdrawn,
        total_in_progress=total_in_progress,
        percentile=percentile,
    )


def get_jurisdiction_agencies(
    slug: str,
    search: Optional[str] = None,
    sort_by: str = "transparency_score",
    min_requests: int = 5,
    page: int = 1,
    page_size: int = 25,
) -> AgencyPageResponse:
    """Return paginated agencies for a specific jurisdiction."""
    supabase = _get_supabase()
    if not supabase:
        return AgencyPageResponse(agencies=[], total=0, page=page, page_size=page_size)

    # Look up jurisdiction_id from slug
    try:
        j_result = (
            supabase.table("jurisdiction_cache")
            .select("id")
            .eq("slug", slug)
            .single()
            .execute()
        )
        jid = j_result.data["id"]
    except Exception:
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
            .eq("jurisdiction_id", jid)
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
            .eq("jurisdiction_id", jid)
            .gte("number_requests", min_requests)
            .order(sort_field, desc=not sort_asc)
            .range(offset, offset + page_size - 1)
        )
        if search:
            data_query = data_query.ilike("name", f"%{search}%")
        result = data_query.execute()

        agencies = [_row_to_agency_stats(r) for r in (result.data or [])]
        last_refreshed = str(result.data[0].get("refreshed_at")) if result.data else None

        return AgencyPageResponse(
            agencies=agencies,
            total=total,
            page=page,
            page_size=page_size,
            last_refreshed=last_refreshed,
        )
    except Exception as e:
        logger.error(f"Jurisdiction agencies query failed: {e}")
        return AgencyPageResponse(agencies=[], total=0, page=page, page_size=page_size)
