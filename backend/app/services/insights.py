"""Insights service — reads FOIA.gov annual report data from Supabase cache.

Each section is a separate function for extensibility.
Adding a new section = new function + add to get_insights_overview().
"""
import json
import logging
from typing import Optional

from app.config import settings
from app.models.insights import (
    HeroStats, VolumeTrend, TransparencyTrend, AgencyRequests,
    ExemptionItem, ProcessingTimeTrend, CostStaffingTrend,
    AppealsLitigationTrend, NewsDigestItem, InsightsOverview,
)

logger = logging.getLogger(__name__)

EXEMPTION_DESCRIPTIONS = {
    "ex1": ("Exemption 1", "National security classified information"),
    "ex2": ("Exemption 2", "Internal agency rules and practices"),
    "ex3": ("Exemption 3", "Information exempted by other statutes"),
    "ex4": ("Exemption 4", "Trade secrets and commercial information"),
    "ex5": ("Exemption 5", "Inter/intra-agency privileged communications"),
    "ex6": ("Exemption 6", "Personal privacy information"),
    "ex7a": ("Exemption 7(A)", "Law enforcement — could interfere with proceedings"),
    "ex7b": ("Exemption 7(B)", "Law enforcement — deprive right to fair trial"),
    "ex7c": ("Exemption 7(C)", "Law enforcement — personal privacy"),
    "ex7d": ("Exemption 7(D)", "Law enforcement — confidential sources"),
    "ex7e": ("Exemption 7(E)", "Law enforcement — techniques and procedures"),
    "ex7f": ("Exemption 7(F)", "Law enforcement — endanger life/safety"),
    "ex8": ("Exemption 8", "Financial institution supervision"),
    "ex9": ("Exemption 9", "Geological and geophysical information"),
}

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


def _get_cache_rows() -> list[dict]:
    """Fetch all rows from foia_insights_cache ordered by year."""
    supabase = _get_supabase()
    if not supabase:
        return []
    try:
        result = supabase.table("foia_insights_cache").select("*").order("fiscal_year").execute()
        return result.data or []
    except Exception as e:
        logger.error(f"Insights cache query failed: {e}")
        return []


def get_hero_stats(rows: list[dict]) -> HeroStats:
    if not rows:
        return HeroStats()
    latest = rows[-1]

    # Cumulative totals across all years
    cumulative_received = sum(r.get("total_received") or 0 for r in rows)
    cumulative_processed = sum(r.get("total_processed") or 0 for r in rows)

    # Count unique agencies in foia_annual_reports
    total_agencies = 0
    supabase = _get_supabase()
    if supabase:
        try:
            result = supabase.table("foia_annual_reports").select("agency_abbreviation").execute()
            total_agencies = len(set(r["agency_abbreviation"] for r in (result.data or [])))
        except Exception:
            pass

    return HeroStats(
        latest_year=latest["fiscal_year"],
        total_agencies=total_agencies,
        cumulative_received=cumulative_received,
        cumulative_processed=cumulative_processed,
        current_backlog=latest.get("total_backlog") or 0,
        total_costs=latest.get("total_costs") or 0,
        total_staff_fte=latest.get("total_staff_fte") or 0,
    )


def get_volume_trends(rows: list[dict]) -> list[VolumeTrend]:
    return [
        VolumeTrend(
            year=r["fiscal_year"],
            received=r.get("total_received") or 0,
            processed=r.get("total_processed") or 0,
            backlog=r.get("total_backlog") or 0,
        )
        for r in rows
    ]


def get_transparency_trends(rows: list[dict]) -> list[TransparencyTrend]:
    trends = []
    for r in rows:
        total = (r.get("total_full_grants") or 0) + (r.get("total_partial_grants") or 0) + (r.get("total_full_denials") or 0)
        if total == 0:
            trends.append(TransparencyTrend(year=r["fiscal_year"]))
            continue
        trends.append(TransparencyTrend(
            year=r["fiscal_year"],
            full_grant_rate=round((r.get("total_full_grants") or 0) / total * 100, 1),
            partial_grant_rate=round((r.get("total_partial_grants") or 0) / total * 100, 1),
            denial_rate=round((r.get("total_full_denials") or 0) / total * 100, 1),
        ))
    return trends


def get_top_agencies() -> list[AgencyRequests]:
    """Top agencies by total requests received (latest year)."""
    supabase = _get_supabase()
    if not supabase:
        return []
    try:
        # Get latest year
        cache = supabase.table("foia_insights_cache").select("fiscal_year").order("fiscal_year", desc=True).limit(1).execute()
        if not cache.data:
            return []
        latest_year = cache.data[0]["fiscal_year"]

        result = (
            supabase.table("foia_annual_reports")
            .select("agency_abbreviation,requests_received")
            .eq("fiscal_year", latest_year)
            .order("requests_received", desc=True)
            .limit(15)
            .execute()
        )
        return [
            AgencyRequests(name=r["agency_abbreviation"], requests_received=r["requests_received"])
            for r in (result.data or [])
            if r.get("requests_received", 0) > 0
        ]
    except Exception as e:
        logger.error(f"Top agencies query failed: {e}")
        return []


def get_exemption_breakdown(rows: list[dict]) -> list[ExemptionItem]:
    """Aggregate exemption usage from latest year."""
    if not rows:
        return []
    latest = rows[-1]
    exemptions_raw = latest.get("exemptions_json")
    if isinstance(exemptions_raw, str):
        exemptions_raw = json.loads(exemptions_raw)
    if not exemptions_raw:
        return []

    items = []
    for code, count in exemptions_raw.items():
        if count > 0 and code in EXEMPTION_DESCRIPTIONS:
            name, desc = EXEMPTION_DESCRIPTIONS[code]
            items.append(ExemptionItem(code=code, name=name, count=count, description=desc))

    return sorted(items, key=lambda x: x.count, reverse=True)


def get_requester_types(rows: list[dict]) -> dict:
    """Requester type breakdown — not available in FOIA.gov XML API.

    Returns empty until a reliable automated data source is integrated.
    Candidates: DOJ OIP Excel downloads, FOIA.gov dataset export tool.
    """
    return {}


def get_processing_times(rows: list[dict]) -> list[ProcessingTimeTrend]:
    return [
        ProcessingTimeTrend(
            year=r["fiscal_year"],
            median_simple=r.get("median_simple_days") or 0,
            median_complex=r.get("median_complex_days") or 0,
        )
        for r in rows
    ]


def get_costs_staffing(rows: list[dict]) -> list[CostStaffingTrend]:
    trends = []
    for r in rows:
        processed = r.get("total_processed") or 1
        costs = r.get("total_costs") or 0
        trends.append(CostStaffingTrend(
            year=r["fiscal_year"],
            total_costs=costs,
            staff_fte=r.get("total_staff_fte") or 0,
            cost_per_request=round(costs / processed, 2) if processed > 0 else 0,
        ))
    return trends


def get_appeals_litigation(rows: list[dict]) -> list[AppealsLitigationTrend]:
    trends = []
    for r in rows:
        appeals = r.get("total_appeals") or 0
        litigation = r.get("total_litigation") or 0
        # Overturn rate is approximate
        trends.append(AppealsLitigationTrend(
            year=r["fiscal_year"],
            appeals=appeals,
            litigation=litigation,
            overturn_rate=0,  # Would need affirmed/reversed breakdown per year
        ))
    return trends


def get_news_digest() -> list[NewsDigestItem]:
    """Fetch latest news digest entries."""
    supabase = _get_supabase()
    if not supabase:
        return []
    try:
        result = (
            supabase.table("foia_news_digest")
            .select("*")
            .order("published_date", desc=True)
            .limit(10)
            .execute()
        )
        return [
            NewsDigestItem(
                title=r["title"],
                summary=r["summary"],
                source_url=r.get("source_url") or "",
                source_name=r.get("source_name") or "",
                category=r.get("category") or "",
                published_date=str(r.get("published_date") or ""),
            )
            for r in (result.data or [])
        ]
    except Exception as e:
        logger.error(f"News digest query failed: {e}")
        return []


def get_insights_overview() -> InsightsOverview:
    """Assemble full insights response from all sections."""
    rows = _get_cache_rows()

    last_refreshed = None
    if rows:
        last_refreshed = str(rows[-1].get("refreshed_at") or "")

    return InsightsOverview(
        hero_stats=get_hero_stats(rows),
        volume_trends=get_volume_trends(rows),
        transparency_trends=get_transparency_trends(rows),
        top_agencies=get_top_agencies(),
        requester_types=get_requester_types(rows),
        exemption_breakdown=get_exemption_breakdown(rows),
        processing_times=get_processing_times(rows),
        costs_staffing=get_costs_staffing(rows),
        appeals_litigation=get_appeals_litigation(rows),
        news_digest=get_news_digest(),
        last_refreshed=last_refreshed,
    )
