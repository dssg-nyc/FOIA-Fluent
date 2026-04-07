"""Refresh FOIA insights data from FOIA.gov annual report API.

Fetches annual FOIA report XML for federal agencies (FY 2008-2024),
parses key metrics, and upserts into foia_annual_reports + foia_insights_cache.

Run manually:
    cd backend
    python -m app.scripts.refresh_insights_data
"""
import asyncio
import logging
import statistics
import sys
from datetime import datetime, timezone
from xml.etree import ElementTree as ET

import httpx

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)

FOIA_GOV_BASE = "https://api.foia.gov/api"
# Major federal agencies to fetch (abbreviations used by FOIA.gov)
AGENCIES = [
    "ABMC", "ACHP", "ACUS", "AFRH", "CEQ", "CFPB", "CFTC", "CIA", "CIGIE",
    "CNCS", "Commerce", "CPPBSD", "CPSC", "CSB", "CSOSA", "DFC", "DHS",
    "DNFSB", "DOD", "DOE", "DOI", "DOJ", "DOL", "DOT", "EAC", "ED", "EEOC",
    "EPA", "EXIM", "FCA", "FCC", "FDIC", "FEC", "FERC", "FFIEC", "FHFA",
    "FLRA", "FMC", "FMCS", "FMSHRC", "FRB", "FRTIB", "FTC", "GSA", "HHS",
    "HUD", "IAF", "IMLS", "LSC", "MCC", "MMC", "MSPB", "NARA", "NASA",
    "NCPC", "NCUA", "NEA", "NEH", "NIGC", "NLRB", "NMB", "NRC", "NSF",
    "NTSB", "NWTRB", "ODNI", "OGE", "OMB", "ONDCP", "ONHIR", "OPM", "OSC",
    "OSHRC", "OSTP", "PBGC", "PCLOB", "PRC", "SBA", "SEC", "SIGAR", "SSA",
    "State", "STB", "Treasury", "TVA", "USAB", "USADF", "USAGM", "USAID",
    "USCCR", "USDA", "USIBWC", "USICH", "USIP", "USITC", "USPS", "USTDA",
    "USTR", "VA",
]
FISCAL_YEARS = list(range(2008, 2025))  # FY 2008-2024


def _ns(tag: str) -> str:
    """Build namespaced tag for FOIA.gov XML."""
    NS = {
        "foia": "http://leisp.usdoj.gov/niem/FoiaAnnualReport/extension/1.03",
        "nc": "http://niem.gov/niem/niem-core/2.0",
        "iepd": "http://leisp.usdoj.gov/niem/FoiaAnnualReport/exchange/1.03",
    }
    prefix, local = tag.split(":", 1) if ":" in tag else ("foia", tag)
    return f"{{{NS.get(prefix, '')}}}{local}"


def _find_text(elem, path: str, default: str = "0") -> str:
    """Find text in element, handling namespaces."""
    parts = path.split("/")
    current = elem
    for part in parts:
        if current is None:
            return default
        found = current.find(_ns(part))
        if found is None:
            # Try without namespace
            found = current.find(part)
        current = found
    return current.text if current is not None and current.text else default


def _sum_all(root, tag_name: str) -> int:
    """Sum all occurrences of a tag across all components."""
    total = 0
    ns_tag = _ns(tag_name)
    for elem in root.iter(ns_tag):
        try:
            total += int(elem.text or 0)
        except (ValueError, TypeError):
            pass
    # Also try without namespace
    for elem in root.iter(tag_name):
        try:
            total += int(elem.text or 0)
        except (ValueError, TypeError):
            pass
    return total


def _sum_exemption(root, exemption_code: str) -> int:
    """Sum uses of a specific exemption code across all components."""
    total = 0
    for applied in root.iter(_ns("AppliedExemption")):
        code_elem = applied.find(_ns("AppliedExemptionCode"))
        qty_elem = applied.find(_ns("AppliedExemptionQuantity"))
        if code_elem is not None and code_elem.text == exemption_code:
            try:
                total += int(qty_elem.text or 0)
            except (ValueError, TypeError):
                pass
    return total


def _avg_median(root, tag_name: str) -> float:
    """Average all occurrences of a median/average days tag."""
    values = []
    for elem in root.iter(_ns(tag_name)):
        try:
            v = float(elem.text or 0)
            if v > 0:
                values.append(v)
        except (ValueError, TypeError):
            pass
    return statistics.mean(values) if values else 0


def parse_annual_report(xml_text: str, agency: str, year: int) -> dict | None:
    """Parse FOIA.gov annual report XML into a flat dict."""
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return None

    return {
        "agency_abbreviation": agency,
        "agency_name": agency,  # Will be enriched later
        "fiscal_year": year,
        "requests_received": _sum_all(root, "ProcessingStatisticsReceivedQuantity"),
        "requests_processed": _sum_all(root, "ProcessingStatisticsProcessedQuantity"),
        "requests_backlog": _sum_all(root, "BackloggedRequestQuantity"),
        "full_grants": _sum_all(root, "RequestDispositionFullGrantQuantity"),
        "partial_grants": _sum_all(root, "RequestDispositionPartialGrantQuantity"),
        "full_denials": _sum_all(root, "RequestDispositionFullExemptionDenialQuantity"),
        "exemption_1": _sum_exemption(root, "Ex. 1"),
        "exemption_2": _sum_exemption(root, "Ex. 2"),
        "exemption_3": _sum_exemption(root, "Ex. 3"),
        "exemption_4": _sum_exemption(root, "Ex. 4"),
        "exemption_5": _sum_exemption(root, "Ex. 5"),
        "exemption_6": _sum_exemption(root, "Ex. 6"),
        "exemption_7a": _sum_exemption(root, "Ex. 7(A)"),
        "exemption_7b": _sum_exemption(root, "Ex. 7(B)"),
        "exemption_7c": _sum_exemption(root, "Ex. 7(C)"),
        "exemption_7d": _sum_exemption(root, "Ex. 7(D)"),
        "exemption_7e": _sum_exemption(root, "Ex. 7(E)"),
        "exemption_7f": _sum_exemption(root, "Ex. 7(F)"),
        "exemption_8": _sum_exemption(root, "Ex. 8"),
        "exemption_9": _sum_exemption(root, "Ex. 9"),
        "median_days_simple": round(_avg_median(root, "ResponseTimeMedianDaysValue"), 1),
        "median_days_complex": round(_avg_median(root, "AdjudicationMedianDaysValue"), 1),
        "median_days_expedited": 0,  # Not always present
        "total_costs": _sum_float(root, "ProcessingCostAmount") + _sum_float(root, "TotalCostAmount"),
        "staff_fte": _sum_float(root, "EquivalentFullTimeEmployeeQuantity") + _sum_float(root, "TotalFullTimeStaffQuantity"),
        "appeals_received": _sum_all(root, "ProcessingStatisticsReceivedQuantity"),  # appeal section has same tag
        "appeals_affirmed": _sum_all(root, "AppealDispositionAffirmedQuantity"),
        "appeals_reversed": _sum_all(root, "AppealDispositionReversedQuantity"),
        "appeals_partially_reversed": _sum_all(root, "AppealDispositionPartialQuantity"),
        "litigation_cases": _sum_all(root, "Case"),
        "requester_commercial": 0,  # Parsed from specific section if present
        "requester_media": 0,
        "requester_educational": 0,
        "requester_other": 0,
    }


def _sum_float(root, tag_name: str) -> float:
    """Sum all float values of a tag."""
    total = 0.0
    for elem in root.iter(_ns(tag_name)):
        try:
            total += float(elem.text or 0)
        except (ValueError, TypeError):
            pass
    return total


def compute_year_aggregates(rows: list[dict]) -> dict:
    """Aggregate all agency rows for a single fiscal year."""
    if not rows:
        return {}

    year = rows[0]["fiscal_year"]
    agg = {
        "fiscal_year": year,
        "total_received": sum(r["requests_received"] for r in rows),
        "total_processed": sum(r["requests_processed"] for r in rows),
        "total_backlog": sum(r["requests_backlog"] for r in rows),
        "total_full_grants": sum(r["full_grants"] for r in rows),
        "total_partial_grants": sum(r["partial_grants"] for r in rows),
        "total_full_denials": sum(r["full_denials"] for r in rows),
        "total_costs": sum(r["total_costs"] for r in rows),
        "total_staff_fte": sum(r["staff_fte"] for r in rows),
        "total_appeals": sum(r["appeals_affirmed"] + r["appeals_reversed"] + r["appeals_partially_reversed"] for r in rows),
        "total_litigation": sum(r["litigation_cases"] for r in rows),
        "exemptions_json": {
            "ex1": sum(r["exemption_1"] for r in rows),
            "ex2": sum(r["exemption_2"] for r in rows),
            "ex3": sum(r["exemption_3"] for r in rows),
            "ex4": sum(r["exemption_4"] for r in rows),
            "ex5": sum(r["exemption_5"] for r in rows),
            "ex6": sum(r["exemption_6"] for r in rows),
            "ex7a": sum(r["exemption_7a"] for r in rows),
            "ex7b": sum(r["exemption_7b"] for r in rows),
            "ex7c": sum(r["exemption_7c"] for r in rows),
            "ex7d": sum(r["exemption_7d"] for r in rows),
            "ex7e": sum(r["exemption_7e"] for r in rows),
            "ex7f": sum(r["exemption_7f"] for r in rows),
            "ex8": sum(r["exemption_8"] for r in rows),
            "ex9": sum(r["exemption_9"] for r in rows),
        },
        "requester_types_json": {
            "commercial": sum(r["requester_commercial"] for r in rows),
            "media": sum(r["requester_media"] for r in rows),
            "educational": sum(r["requester_educational"] for r in rows),
            "other": sum(r["requester_other"] for r in rows),
        },
        "median_simple_days": round(
            statistics.mean([r["median_days_simple"] for r in rows if r["median_days_simple"] > 0]) if any(r["median_days_simple"] > 0 for r in rows) else 0,
            1,
        ),
        "median_complex_days": round(
            statistics.mean([r["median_days_complex"] for r in rows if r["median_days_complex"] > 0]) if any(r["median_days_complex"] > 0 for r in rows) else 0,
            1,
        ),
    }
    return agg


async def main():
    from app.config import settings
    import json

    if not settings.foia_gov_api_key:
        logger.error("FOIA_GOV_API_KEY must be set.")
        sys.exit(1)

    if not settings.supabase_url or not settings.supabase_service_key:
        logger.error("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set.")
        sys.exit(1)

    from supabase import create_client
    supabase = create_client(settings.supabase_url, settings.supabase_service_key)
    now = datetime.now(timezone.utc).isoformat()

    # Collect all rows by year for aggregation
    rows_by_year: dict[int, list[dict]] = {y: [] for y in FISCAL_YEARS}

    async with httpx.AsyncClient(
        headers={
            "X-API-Key": settings.foia_gov_api_key,
            "Accept": "application/xml",
        },
        follow_redirects=True,
        timeout=30.0,
    ) as client:
        for agency in AGENCIES:
            for year in FISCAL_YEARS:
                url = f"{FOIA_GOV_BASE}/annual-report-xml/{agency}/{year}"
                try:
                    resp = await client.get(url)
                    if resp.status_code != 200:
                        continue
                    if not resp.text.strip().startswith("<?xml"):
                        continue

                    row = parse_annual_report(resp.text, agency, year)
                    if not row or row["requests_received"] == 0:
                        continue

                    row["refreshed_at"] = now
                    rows_by_year[year].append(row)

                    # Upsert into foia_annual_reports
                    try:
                        supabase.table("foia_annual_reports").upsert(
                            row, on_conflict="agency_abbreviation,fiscal_year"
                        ).execute()
                    except Exception as e:
                        logger.warning(f"  Upsert failed {agency}/{year}: {e}")

                except httpx.TimeoutException:
                    logger.warning(f"  Timeout: {agency}/{year}")
                except Exception as e:
                    logger.warning(f"  Error {agency}/{year}: {e}")

                await asyncio.sleep(0.5)  # Rate limit

            logger.info(f"Fetched {agency}")

    # Compute and upsert year aggregates
    for year, rows in rows_by_year.items():
        if not rows:
            continue
        agg = compute_year_aggregates(rows)
        agg["refreshed_at"] = now
        # Convert dicts to JSON strings for Supabase
        agg["exemptions_json"] = json.dumps(agg["exemptions_json"])
        agg["requester_types_json"] = json.dumps(agg["requester_types_json"])
        try:
            supabase.table("foia_insights_cache").upsert(
                agg, on_conflict="fiscal_year"
            ).execute()
            logger.info(f"  Aggregated FY {year}: {len(rows)} agencies, {agg['total_received']} requests")
        except Exception as e:
            logger.warning(f"  Aggregate upsert failed FY {year}: {e}")

    logger.info("Done refreshing insights data.")


if __name__ == "__main__":
    asyncio.run(main())
