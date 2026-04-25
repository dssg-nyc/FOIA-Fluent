"""Signal category taxonomy + persona bundles.

Categories are the data primitive on `foia_signals_feed.category_tags`. They
describe *what a signal is about* — concrete content topics, not audiences.

Personas are *named bundles of categories* used for narrative onboarding
("I'm a journalist") and as a backward-compatible filter on top of categories.
A signal with `category_tags = [drug_recalls, securities_litigation]` is
automatically derived into `persona_tags = [pharma_analyst, hedge_fund,
consumer_safety]` because each of those personas' bundles overlaps with the
extracted categories.

Adding a category requires:
  1. Add to CATEGORIES list below
  2. Update at least one persona bundle that includes it
  3. Re-run `python -m app.scripts.backfill_category_tags` to retag history
"""
from __future__ import annotations


# ── Category taxonomy ───────────────────────────────────────────────────────
# Keep this list at ~20 entries. Friction is the feature: every new category
# means a code change + a backfill, which keeps the taxonomy from sprawling.

CATEGORIES: list[str] = [
    # Enforcement & oversight (6)
    "agency_enforcement",          # OSHA, FERC, FCC, NLRB enforcement actions
    "agency_warnings",             # FDA warning letters, preliminary citations
    "oversight_findings",          # IG reports, GAO audits, CIGIE aggregator
    "securities_litigation",       # SEC enforcement, EDGAR litigation
    "campaign_finance",            # FEC enforcement (MURs)
    "tax_enforcement",             # IRS news, TIGTA reports

    # Recalls & safety (6)
    "drug_recalls",
    "food_recalls",                # FDA food + USDA FSIS
    "device_recalls",
    "vehicle_recalls",             # NHTSA
    "consumer_product_recalls",    # CPSC
    "workplace_safety",            # OSHA

    # Courts & legal (3)
    "court_opinions",              # CourtListener federal
    "government_litigation",       # DOJ press, agency-as-plaintiff
    "foia_logs",                   # DHS quarterly, etc.

    # Spending & policy (5)
    "federal_contracts",           # GAO bid protests, SAM.gov, USAspending
    "regulatory_dockets",          # regulations.gov
    "legislation",                 # Congress.gov bills
    "executive_actions",           # White House, agency rule announcements
    "lobbying_ethics",             # Senate LDA, OGE filings, FEC
]

CATEGORY_SET: frozenset[str] = frozenset(CATEGORIES)


# ── Persona bundles ─────────────────────────────────────────────────────────
# Each persona maps to a list of category IDs. A signal's persona_tags are
# derived: a persona is included iff its bundle overlaps the signal's
# category_tags. Edit cautiously — bundle changes affect every existing
# signal's derived persona_tags on the next backfill / re-extraction.

PERSONA_BUNDLES: dict[str, list[str]] = {
    "journalist": [
        "oversight_findings",
        "agency_enforcement",
        "foia_logs",
        "government_litigation",
        "campaign_finance",
        "lobbying_ethics",
        "tax_enforcement",
    ],
    "pharma_analyst": [
        "agency_warnings",
        "drug_recalls",
        "device_recalls",
        "securities_litigation",
    ],
    "hedge_fund": [
        "securities_litigation",
        "agency_enforcement",
        "federal_contracts",
        "court_opinions",
        "drug_recalls",
        "device_recalls",
    ],
    "environmental": [
        "agency_enforcement",
        "oversight_findings",
        "regulatory_dockets",
    ],
    "policy_researcher": [
        "legislation",
        "regulatory_dockets",
        "oversight_findings",
        "executive_actions",
        "lobbying_ethics",
    ],
    "legal_analyst": [
        "court_opinions",
        "securities_litigation",
        "government_litigation",
        "agency_enforcement",
        "foia_logs",
        "campaign_finance",
        "tax_enforcement",
    ],
    "consumer_safety": [
        "drug_recalls",
        "food_recalls",
        "device_recalls",
        "vehicle_recalls",
        "consumer_product_recalls",
        "workplace_safety",
        "agency_warnings",
    ],
}

PERSONAS: list[str] = list(PERSONA_BUNDLES.keys())
PERSONA_SET: frozenset[str] = frozenset(PERSONAS)


def derive_persona_tags(category_tags: list[str] | None) -> list[str]:
    """Derive persona_tags from a signal's category_tags.

    A persona is tagged if any of its bundle categories appear in the signal's
    category_tags. Stable, deterministic, idempotent.

    Returns personas in the same order as PERSONAS for stable output.
    """
    if not category_tags:
        return []
    cats = set(category_tags)
    out: list[str] = []
    for persona in PERSONAS:
        bundle = PERSONA_BUNDLES[persona]
        if any(c in cats for c in bundle):
            out.append(persona)
    return out


def filter_categories(candidate: list[str] | None) -> list[str]:
    """Return only the entries that are valid CATEGORIES, preserving order
    and deduping. Defensive helper used after Claude extraction in case the
    model emits an unexpected category id."""
    if not candidate:
        return []
    seen: set[str] = set()
    out: list[str] = []
    for c in candidate:
        if c in CATEGORY_SET and c not in seen:
            out.append(c)
            seen.add(c)
    return out


# ── Source-aware defaults ──────────────────────────────────────────────────
#
# Every source produces signals of a known primary type — e.g. cpsc_recalls
# is always a consumer product recall, congress_gov is always legislation.
# Claude's extraction is sometimes too conservative on sparse-body items
# (regulations.gov dockets that are just an ID, NHTSA recalls with terse
# titles), so we ALWAYS union Claude's tags with the source's defaults.
# Result: every signal gets at least one category, even when the body is
# too thin for the model to commit.

SOURCE_DEFAULT_CATEGORIES: dict[str, list[str]] = {
    "gao_protests":            ["federal_contracts"],
    "epa_echo":                ["agency_enforcement"],
    "fda_warning_letters":     ["agency_warnings"],
    "dhs_foia_log":            ["foia_logs"],
    "oversight_ig_reports":    ["oversight_findings"],
    "gao_reports":              ["oversight_findings"],
    "osha_news":                ["agency_enforcement", "workplace_safety"],
    "irs_news":                 ["tax_enforcement"],
    "fda_drug_recalls":         ["drug_recalls"],
    "fda_food_recalls":         ["food_recalls"],
    "fda_device_recalls":       ["device_recalls"],
    "cpsc_recalls":             ["consumer_product_recalls"],
    "nhtsa_recalls":            ["vehicle_recalls"],
    "congress_gov":             ["legislation"],
    "regulations_gov":          ["regulatory_dockets"],
    "sec_press_releases":       ["securities_litigation"],
    "ftc_press_releases":       ["agency_enforcement"],
    "courtlistener_opinions":   ["court_opinions"],
    "fec_enforcement":          ["campaign_finance"],
    # dol_news is disabled but defaults left here in case we re-enable.
    "dol_news":                 ["agency_enforcement", "workplace_safety"],
}


def categories_for_signal(
    source: str, claude_categories: list[str] | None
) -> list[str]:
    """Return final category_tags: union of Claude's extraction (filtered to
    valid categories) and the source's default categories. Order: Claude's
    picks first, then any defaults Claude didn't already include. Ensures
    every signal has at least the source-natural category, even when Claude
    returns empty."""
    cats = filter_categories(claude_categories)
    seen = set(cats)
    for d in SOURCE_DEFAULT_CATEGORIES.get(source, []):
        if d in CATEGORY_SET and d not in seen:
            cats.append(d)
            seen.add(d)
    return cats
