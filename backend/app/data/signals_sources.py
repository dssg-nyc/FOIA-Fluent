"""Signals source registry — single source of truth for every feed we ingest.

Adding a source = add one SourceConfig entry below + wire any strategy-specific
config. No new cron jobs, no new scripts.

Fetch strategies supported (see backend/app/services/ingest/*.py):
  - rss          : aggregate one or more RSS feeds, regex-filter items
  - html         : fetch a listing page, extract items via regex / selectors
  - json_api     : paginated REST JSON endpoint
  - csv_bulk     : download ZIP or CSV, filter rows
  - pdf_vision   : crawl PDFs, Claude multimodal extraction per PDF
  - sitemap      : crawl sitemap.xml, filter by path prefix
  - courtlistener: PACER-backed RSS per court

The registry is a code file (not YAML) so we get type checking and can express
non-trivial filters (regex patterns, selector chains) without inventing a DSL.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class SourceConfig:
    source_id: str                             # unique key, used in foia_signals_feed.source
    label: str                                 # human label passed to Claude
    family: str                                # 'enforcement' | 'spending' | 'courts' | 'research'
    fetch_strategy: str                        # see module docstring
    fetch_config: dict[str, Any]               # strategy-specific payload
    cadence_minutes: int                       # runner re-runs after this many minutes
    agency_codes: tuple[str, ...] = ()         # default agency_codes stamped onto every signal
    lookback_days: int = 21                    # recency window for filtering items
    max_items_per_run: int = 200               # volume cap; strategy-specific interpretation
    max_claude_calls_per_day: int = 300        # hard ceiling, drives budget
    enabled: bool = True                       # kill-switch


# ── Registry ────────────────────────────────────────────────────────────────
#
# Order roughly matches feed prominence. Everything here is currently
# enabled=True unless marked otherwise. Phase 2.3 will add sources in
# waves — keep entries alphabetical within a family to make diffs easy.

SOURCES: dict[str, SourceConfig] = {
    # ── Enforcement & investigations ────────────────────────────────────────
    "gao_protests": SourceConfig(
        source_id="gao_protests",
        label="GAO Bid Protest Decision (via legal blog)",
        family="enforcement",
        fetch_strategy="rss",
        cadence_minutes=24 * 60,  # daily — GovCon blog feeds roll slowly enough
        agency_codes=("GAO",),
        max_items_per_run=200,
        fetch_config={
            # Direct gao.gov RSS is WAF'd; aggregate from GovCon law firm feeds
            # which naturally curate to *sustained* protests (the high-value ~14%
            # of decisions with market / legal significance).
            "feeds": [
                {"name": "SmallGovCon",          "url": "https://smallgovcon.com/feed/"},
                {"name": "PilieroMazza",         "url": "https://www.pilieromazza.com/feed/"},
                {"name": "NatLawReview GovCon",  "url": "https://natlawreview.com/practice-groups/government-contracts/feed"},
                {"name": "GovConWire Contracts", "url": "https://www.govconwire.com/category/contracts/feed/"},
            ],
            # Items must mention a B-XXXXXX docket…
            "id_pattern": r"\bB-\d{6,}(?:\.\d+)?\b",
            # …AND contain protest-related keywords. Both filters must hit.
            "keyword_pattern": (
                r"\b(bid protest|protest decision|sustain|sustained|denied|"
                r"gao decision|government accountability office|bid award|protest)\b"
            ),
            # Optional link to the canonical GAO product page (shown as metadata)
            "canonical_url_template": "https://www.gao.gov/products/{id_lower}",
        },
    ),

    "epa_echo": SourceConfig(
        source_id="epa_echo",
        label="EPA ECHO Enforcement Action",
        family="enforcement",
        fetch_strategy="csv_bulk",
        cadence_minutes=24 * 60,  # daily
        agency_codes=("EPA",),
        lookback_days=21,
        max_items_per_run=200,
        fetch_config={
            "zip_url": "https://echo.epa.gov/files/echodownloads/case_downloads.zip",
            "csv_filename": "CASE_ENFORCEMENTS.csv",
            "date_column": "CASE_STATUS_DATE",
            "id_column": "CASE_NUMBER",
            "encoding": "latin-1",
            "detail_url_template": "https://echo.epa.gov/enforcement-case-report?id={id}",
        },
    ),

    "fda_warning_letters": SourceConfig(
        source_id="fda_warning_letters",
        label="FDA Warning Letter",
        family="enforcement",
        fetch_strategy="html",
        cadence_minutes=24 * 60,  # daily
        agency_codes=("FDA",),
        max_items_per_run=50,
        fetch_config={
            "index_url": (
                "https://www.fda.gov/inspections-compliance-enforcement-and-criminal-investigations/"
                "compliance-actions-and-activities/warning-letters"
            ),
            # Anchor regex: href + visible text on the index page
            "link_pattern": (
                r'href="(/inspections-compliance-enforcement-and-criminal-investigations/'
                r'warning-letters/[^"\'#]+)"[^>]*>([^<]+)</a>'
            ),
            "base_url": "https://www.fda.gov",
            "source_id_mode": "slug_from_href",  # slug is final path segment
            # Slugs we should never treat as warning letters (index pages that
            # happen to match the anchor pattern)
            "slug_blocklist": ["warning-letters", "warning-letters-archive"],
            # After discovery, fetch each detail page for body + date
            "detail_fetch": True,
            "detail_body_region": r'<div[^>]+class="[^"]*main-content[^"]*"[^>]*>(.*?)</div>\s*</div>',
            "detail_date_pattern": r"(?:Issued|Date)[:\s]*([A-Z][a-z]+ \d{1,2},?\s+\d{4})",
        },
    ),

    "dhs_foia_log": SourceConfig(
        source_id="dhs_foia_log",
        label="DHS FOIA Log Entry",
        family="research",
        fetch_strategy="pdf_vision",
        # Daily — but PDF-URL dedup in pdf_vision.py means we only Claude-extract
        # PDFs we haven't seen yet. DHS publishes quarterly; most days we just
        # crawl the index, find nothing new, exit ~free.
        cadence_minutes=24 * 60,
        agency_codes=("DHS",),
        max_items_per_run=6,  # = max PDFs per run; each PDF yields up to 100 entries
        max_claude_calls_per_day=10,  # each PDF is one Sonnet-class call
        fetch_config={
            "index_url": "https://www.dhs.gov/dhs-component-foia-logs",
            "base_url": "https://www.dhs.gov",
            "component_link_pattern": r'href="(/[^"#]*foia-logs?/?)"',
            "pdf_link_pattern": r'href="([^"#]+\.pdf)"',
            "newest_sort_pattern": r"/(\d{4})-(\d{2})/",
            "max_entries_per_pdf": 100,
            # NOTE: Sonnet 4.6 returned 400 Bad Request on our document+tool_use
            # PDF calls in production. Haiku 4.5 works; keeping here until we
            # diagnose the Sonnet request-shape issue (likely needs a beta
            # header or a different tool_choice payload). OCR quality on
            # Haiku is acceptable for the current DHS PDFs.
            "claude_model": "claude-haiku-4-5-20251001",
            "claude_max_output_tokens": 8000,
        },
    ),

    # ── New sources (Phase 2.3 wave 1) ──────────────────────────────────────
    # Only entries with URLs that were 200-verified at add-time are enabled.
    # Others are scaffolded with enabled=False + notes so they're ready to
    # flip on once an API key is obtained or the URL is confirmed.

    # ── RSS — verified live ─────────────────────────────────────────────────

    "oversight_ig_reports": SourceConfig(
        source_id="oversight_ig_reports",
        label="Federal Inspector General Report (via oversight.gov)",
        family="enforcement",
        fetch_strategy="rss",
        # oversight.gov aggregates IG reports across all 73 federal IG offices.
        # Single highest-leverage source in the registry — one feed, dozens of agencies.
        cadence_minutes=24 * 60,  # twice daily
        agency_codes=(),  # agency varies per item; Claude extracts from title/body
        max_items_per_run=100,
        fetch_config={
            "feeds": [
                {"name": "oversight.gov",
                 "url": "https://www.oversight.gov/rss.xml"},
            ],
            # No id_pattern — each item's link is its unique id
            # No keyword_pattern — everything on oversight.gov is by definition
            # an IG report, accountability investigation, or audit
        },
    ),

    "gao_reports": SourceConfig(
        source_id="gao_reports",
        label="GAO Report (audits, evaluations, testimony)",
        family="research",
        fetch_strategy="rss",
        cadence_minutes=24 * 60,  # daily
        agency_codes=("GAO",),
        max_items_per_run=100,
        fetch_config={
            "feeds": [
                {"name": "gao.gov reports",
                 "url": "https://www.gao.gov/rss/reports.xml"},
            ],
        },
    ),

    "osha_news": SourceConfig(
        source_id="osha_news",
        label="OSHA news release (workplace-safety enforcement)",
        family="enforcement",
        fetch_strategy="rss",
        cadence_minutes=24 * 60,
        agency_codes=("OSHA",),
        max_items_per_run=100,
        fetch_config={
            "feeds": [
                {"name": "osha.gov news",
                 "url": "https://www.osha.gov/news/newsreleases.xml"},
            ],
        },
    ),

    "irs_news": SourceConfig(
        source_id="irs_news",
        label="IRS news release",
        family="enforcement",
        fetch_strategy="html",
        cadence_minutes=24 * 60,
        agency_codes=("IRS",),
        max_items_per_run=40,
        fetch_config={
            # IRS retired their RSS feed. The current-month news page is a
            # reliable index of recent press releases; blocklist filters out
            # nav/resource pages that share the /newsroom/ prefix.
            "index_url": "https://www.irs.gov/newsroom/news-releases-for-current-month",
            "link_pattern": r'href="(/newsroom/[a-z0-9][a-z0-9-]{15,})"[^>]*(?:title="[^"]*")?[^>]*>([^<]{5,200})</a>',
            "base_url": "https://www.irs.gov",
            "source_id_mode": "slug_from_href",
            "slug_blocklist": [
                # IRS nav / resource index pages, NOT news releases
                "news-releases-for-current-month",
                "news-releases-for-frequently-asked-questions",
                "news-release-and-fact-sheet-archive",
                "e-news-subscriptions",
                "fact-sheets",
                "multimedia-center",
                "topics-in-the-news",
                "tax-relief-in-disaster-situations",
                "irs-guidance",
                "irs-tax-tips",
                "irs-statements-and-announcements",
                "irs-media-relations-office-contact",
                "commissioners-comments-statements-and-remarks",
                "filing-season-statistics-by-year",
            ],
            "detail_fetch": True,
            # IRS pages wrap main content in various class names; use a generic
            # content-wrapper regex that matches their Drupal theme
            "detail_body_region": r'<article[^>]*>(.*?)</article>',
            "detail_date_pattern": r"(?:IR-\d{4}-\d+,?\s*|Published[:\s]+)?([A-Z][a-z]+ \d{1,2},?\s+\d{4})",
        },
    ),

    # ── JSON API — verified live (openFDA, NHTSA, CPSC) ─────────────────────

    "fda_drug_recalls": SourceConfig(
        source_id="fda_drug_recalls",
        label="FDA Drug Recall (openFDA enforcement)",
        family="recalls",
        fetch_strategy="json_api",
        cadence_minutes=24 * 60,
        agency_codes=("FDA",),
        max_items_per_run=100,
        fetch_config={
            # openFDA's `+TO+` range syntax relies on literal `+` characters in
            # the URL. httpx would URL-encode `+` in params to `%2B`, breaking
            # the search, so we bake the search into the URL itself.
            "url": "https://api.fda.gov/drug/enforcement.json?search=recall_initiation_date:[{lookback_ymd}+TO+99999999]",
            "params_template": {"limit": 100},
            "items_path": ["results"],
            "id_field": "recall_number",
            "title_template": "{product_description}",
            "date_field": "recall_initiation_date",
            "url_template": "https://api.fda.gov/drug/enforcement.json?search=recall_number:{recall_number}",
            "body_fields": [
                "product_description", "reason_for_recall", "classification",
                "recalling_firm", "distribution_pattern", "voluntary_mandated",
            ],
            "pagination_mode": "skip",
        },
    ),

    "fda_food_recalls": SourceConfig(
        source_id="fda_food_recalls",
        label="FDA Food/Cosmetic Recall (openFDA enforcement)",
        family="recalls",
        fetch_strategy="json_api",
        cadence_minutes=24 * 60,
        agency_codes=("FDA",),
        max_items_per_run=100,
        fetch_config={
            "url": "https://api.fda.gov/food/enforcement.json?search=recall_initiation_date:[{lookback_ymd}+TO+99999999]",
            "params_template": {"limit": 100},
            "items_path": ["results"],
            "id_field": "recall_number",
            "title_template": "{product_description}",
            "date_field": "recall_initiation_date",
            "url_template": "https://api.fda.gov/food/enforcement.json?search=recall_number:{recall_number}",
            "body_fields": [
                "product_description", "reason_for_recall", "classification",
                "recalling_firm", "distribution_pattern", "voluntary_mandated",
            ],
            "pagination_mode": "skip",
        },
    ),

    "fda_device_recalls": SourceConfig(
        source_id="fda_device_recalls",
        label="FDA Medical Device Recall (openFDA enforcement)",
        family="recalls",
        fetch_strategy="json_api",
        cadence_minutes=24 * 60,
        agency_codes=("FDA",),
        max_items_per_run=100,
        fetch_config={
            "url": "https://api.fda.gov/device/enforcement.json?search=recall_initiation_date:[{lookback_ymd}+TO+99999999]",
            "params_template": {"limit": 100},
            "items_path": ["results"],
            "id_field": "recall_number",
            "title_template": "{product_description}",
            "date_field": "recall_initiation_date",
            "url_template": "https://api.fda.gov/device/enforcement.json?search=recall_number:{recall_number}",
            "body_fields": [
                "product_description", "reason_for_recall", "classification",
                "recalling_firm", "distribution_pattern",
            ],
            "pagination_mode": "skip",
        },
    ),

    "cpsc_recalls": SourceConfig(
        source_id="cpsc_recalls",
        label="CPSC Product Recall (saferproducts.gov)",
        family="recalls",
        fetch_strategy="json_api",
        cadence_minutes=24 * 60,
        agency_codes=("CPSC",),
        max_items_per_run=100,
        fetch_config={
            "url": "https://www.saferproducts.gov/RestWebServices/Recall",
            "params_template": {
                "format": "Json",
                "RecallDateStart": "{lookback_iso}",
            },
            # CPSC returns a bare JSON array (not wrapped in "results")
            "items_path": None,
            "id_field": "RecallID",
            "title_template": "{Title}",
            "date_field": "RecallDate",
            "url_field": "URL",
            "body_fields": [
                "Description", "Hazards", "ConsumerContact", "Incidents",
                "Injuries", "Remedies",
            ],
        },
    ),

    "nhtsa_recalls": SourceConfig(
        source_id="nhtsa_recalls",
        label="NHTSA Vehicle Recall",
        family="recalls",
        fetch_strategy="json_api",
        cadence_minutes=24 * 60,
        agency_codes=("NHTSA",),
        max_items_per_run=100,
        fetch_config={
            # NHTSA's `api.nhtsa.gov` endpoint requires per-vehicle filters
            # and can't produce a cross-manufacturer recent-recalls feed.
            # The authoritative bulk dataset is published on the DOT datahub
            # (Socrata-powered), which supports SQL-style filtering.
            # Dataset ID: 6axg-epim — NHTSA Recalls.
            "url": (
                "https://datahub.transportation.gov/resource/6axg-epim.json"
                "?$where=report_received_date >= '{lookback_iso}T00:00:00'"
                "&$order=report_received_date DESC"
            ),
            "params_template": {"$limit": 100},
            "items_path": None,  # Socrata returns a bare JSON array
            "id_field": "nhtsa_id",
            "title_template": "{manufacturer}: {subject}",
            "date_field": "report_received_date",
            "url_field": "recall_link",
            "body_fields": [
                "subject", "component", "manufacturer", "defect_summary",
                "consequence_summary", "corrective_action", "recall_type",
                "potentially_affected",
            ],
        },
    ),

    # ── Key-gated APIs (scaffolded, disabled until you grab a key) ──────────

    "congress_gov": SourceConfig(
        source_id="congress_gov",
        label="Congress.gov recent bill",
        family="research",
        fetch_strategy="json_api",
        cadence_minutes=24 * 60,
        agency_codes=("Congress",),
        max_items_per_run=50,
        fetch_config={
            "url": "https://api.congress.gov/v3/bill",
            "params_template": {"format": "json", "limit": 50, "sort": "updateDate+desc"},
            "headers": {"X-Api-Key": "{congress_gov_api_key}"},
            "items_path": ["bills"],
            "id_field": "number",
            "title_template": "{type} {number}: {title}",
            "date_field": "updateDate",
            "url_field": "url",
            "body_fields": ["title", "originChamber", "latestAction", "congress", "type"],
        },
    ),

    "regulations_gov": SourceConfig(
        source_id="regulations_gov",
        label="Regulations.gov new docket",
        family="research",
        fetch_strategy="json_api",
        cadence_minutes=24 * 60,
        agency_codes=(),
        max_items_per_run=50,
        fetch_config={
            "url": "https://api.regulations.gov/v4/dockets",
            "params_template": {"sort": "-lastModifiedDate", "page[size]": 50},
            "headers": {"X-Api-Key": "{api_data_gov_key}"},
            "items_path": ["data"],
            "id_field": "id",
            # Regulations.gov uses JSON:API shape: fields live under .attributes
            "title_template": "{id}",
            "date_field": "_attributes_lastModifiedDate",  # filled via body_fields fallback
            "url_template": "https://www.regulations.gov/docket/{id}",
            "body_fields": ["type", "id", "attributes"],
        },
    ),

    # ── Phase 2.3 wave 2: verified federal sources ──────────────────────────

    "sec_press_releases": SourceConfig(
        source_id="sec_press_releases",
        label="SEC press release (enforcement, rulemaking, policy)",
        family="enforcement",
        fetch_strategy="rss",
        cadence_minutes=24 * 60,  # twice daily
        agency_codes=("SEC",),
        max_items_per_run=50,
        fetch_config={
            "feeds": [
                {"name": "sec.gov press releases",
                 "url": "https://www.sec.gov/news/pressreleases.rss"},
            ],
        },
    ),

    "ftc_press_releases": SourceConfig(
        source_id="ftc_press_releases",
        label="FTC press release (antitrust, consumer protection)",
        family="enforcement",
        fetch_strategy="html",
        cadence_minutes=24 * 60,
        agency_codes=("FTC",),
        max_items_per_run=40,
        fetch_config={
            # FTC has no real RSS feed; their /press-releases URL returns HTML.
            # Link pattern is very clean: /news-events/news/press-releases/YYYY/MM/slug
            "index_url": "https://www.ftc.gov/news-events/news/press-releases",
            "link_pattern": r'href="(/news-events/news/press-releases/\d{4}/\d{2}/[^"#]+)"[^>]*(?:title="[^"]*")?[^>]*>([^<]{5,300})</a>',
            "base_url": "https://www.ftc.gov",
            "source_id_mode": "slug_from_href",
            "slug_blocklist": [],
            "detail_fetch": True,
            "detail_body_region": r'<article[^>]*>(.*?)</article>',
            "detail_date_pattern": r"([A-Z][a-z]+ \d{1,2},?\s+\d{4})",
        },
    ),

    "courtlistener_opinions": SourceConfig(
        source_id="courtlistener_opinions",
        label="Federal court opinion (via CourtListener)",
        family="courts",
        fetch_strategy="rss",
        cadence_minutes=24 * 60,
        agency_codes=(),  # court varies per item; Claude extracts from title
        max_items_per_run=50,
        fetch_config={
            # Atom feed — handled transparently by feedparser. Cross-court
            # opinions feed; CourtListener's per-court RSS feeds return
            # empty as of 2026, but this search-based feed works.
            "feeds": [
                {"name": "courtlistener search",
                 "url": "https://www.courtlistener.com/feed/search/?type=o"},
            ],
        },
    ),

    "fec_enforcement": SourceConfig(
        source_id="fec_enforcement",
        label="FEC enforcement matter (MUR)",
        family="enforcement",
        fetch_strategy="json_api",
        cadence_minutes=24 * 60,
        agency_codes=("FEC",),
        max_items_per_run=50,
        fetch_config={
            # FEC takes the api.data.gov key as a query param (not header).
            # MURs (Matters Under Review) = enforcement cases.
            "url": "https://api.open.fec.gov/v1/legal/search/",
            "params_template": {
                "type": "murs",
                "api_key": "{api_data_gov_key}",
            },
            "items_path": ["murs"],
            "id_field": "no",
            "title_template": "MUR {no}: {name}",
            "date_field": "open_date",
            "url_field": "url",
            "body_fields": [
                "name", "mur_type", "respondents", "subjects",
                "open_date", "close_date", "dispositions",
            ],
        },
    ),
}


def get_source(source_id: str) -> SourceConfig:
    """Look up a source by id. Raises KeyError if unknown."""
    return SOURCES[source_id]


def enabled_sources() -> list[SourceConfig]:
    """All currently enabled sources, registry order."""
    return [cfg for cfg in SOURCES.values() if cfg.enabled]


def source_ids() -> list[str]:
    """All registered source_ids (including disabled)."""
    return list(SOURCES.keys())
