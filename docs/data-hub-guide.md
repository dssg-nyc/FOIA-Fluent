# Data Hub — Complete Data Guide

> Everything you need to know about where the Data Hub data comes from, what's stored, what overlaps, and what's missing.

---

## The Three Tabs at a Glance

| Tab | Data Source | What It Shows | Agencies Covered |
|-----|-----------|---------------|-----------------|
| **Federal** | MuckRock API | Real-time FOIA request outcomes for federal agencies | ~1,000+ federal agencies (with 5+ requests) |
| **State & Local** | MuckRock API | Same metrics, but for state-level agencies across 54 jurisdictions | Thousands of state/local agencies |
| **Insights** | FOIA.gov API (government) | Historical annual report data (FY 2008-2024): costs, staffing, exemptions, backlogs, trends | 32 major federal agencies |

---

## Where Does the Data Come From?

### Federal Tab → MuckRock

**Source:** MuckRock's public API (`muckrock.com/api_v1/agency/`)

MuckRock is a nonprofit that helps people file FOIA requests. They track every request filed through their platform — the agency, whether it was granted/denied, how long it took, what exemptions were cited, etc.

**What we fetch:** All agencies registered in MuckRock under `jurisdiction=10` (which is MuckRock's ID for "United States of America" / federal level).

**How many agencies?** MuckRock has data on ~1,694 federal agencies. However, many have very few requests. We only display agencies with **5+ requests** in the main directory (to avoid noisy data from agencies with 1-2 requests).

**What we store per agency:**
- Name, slug, MuckRock URL
- Success rate (% of requests fully completed)
- Average response time (days)
- Fee rate (% of requests where fees were charged)
- Has portal (yes/no — does the agency have an online FOIA portal?)
- Request outcome breakdown: completed, rejected, no responsive docs, partial, appealing, withdrawn, in progress
- **Transparency Score** — our composite metric (0-100), weighted: success rate 40%, response speed 30%, fee rate 15%, portal availability 15%

**Script:** `python -m app.scripts.refresh_hub_stats`
**Refresh:** Weekly (manual, ~2 minutes to run)

---

### State & Local Tab → MuckRock

**Source:** Same MuckRock API, but filtered by state jurisdictions

**How it works:**
1. First, we fetch all state-level jurisdictions from MuckRock (`level=s`, `parent=10`)
2. MuckRock returns 54 jurisdictions: **50 states + DC + Puerto Rico + Guam + Virgin Islands**
3. For each jurisdiction, we fetch all agencies registered under that state
4. We compute aggregate stats per state (total requests, success rate, etc.)

**What we store:**
- `jurisdiction_cache` table: state metadata (name, slug, abbreviation)
- `agency_stats_cache` table: same columns as federal, but with `jurisdiction_id` set to the state's MuckRock ID and `jurisdiction` set to the state name (e.g., "California")
- `jurisdiction_stats_cache` table: aggregated stats per state

**Script:** `python -m app.scripts.refresh_jurisdiction_stats`
**Refresh:** Weekly (manual, ~10 minutes to run due to API rate limiting)

---

### Insights Tab → FOIA.gov (Government Source)

**Source:** FOIA.gov annual report XML API (`api.foia.gov/api/annual-report-xml/{agency}/{year}`)

This is **completely different data from MuckRock.** FOIA.gov is the official government portal. Every federal agency is required by law to submit an annual FOIA report to the Department of Justice. These reports contain detailed statistics about their FOIA operations.

**What we fetch:** Annual reports for 32 major federal agencies across fiscal years 2008-2024:

```
DOJ, DHS, DOD, HHS, VA, USDA, DOI, Treasury, DOT, Commerce,
DOL, ED, EPA, HUD, DOE, State, SBA, SSA, NASA, OPM, GSA,
NRC, SEC, FTC, FCC, EEOC, NARA, USPS, CIA, ODNI, NSA, FEMA
```

**What we store per agency per year:**
- Requests received, processed, and backlog
- Dispositions: full grants, partial grants, full denials
- All 14 FOIA exemptions cited (Ex. 1, 2, 3, 4, 5, 6, 7A-7F, 8, 9)
- Processing times: median days for simple and complex requests
- Total costs and staff FTEs (full-time equivalents)
- Appeals: received, affirmed, reversed, partially reversed
- Litigation cases

**Script:** `python -m app.scripts.refresh_insights_data`
**Refresh:** Annual (when new fiscal year data is published, usually spring)

---

## Do the Tabs Overlap?

### Federal vs. State — NO overlap

These are completely separate datasets from MuckRock:

- **Federal tab** = agencies with `jurisdiction=10` (federal)
- **State tab** = agencies with `jurisdiction={state_id}` (state-level)

An agency like "Department of Education" exists as both a federal agency (U.S. Department of Education) and state agencies (California Department of Education, New York Department of Education, etc.) — but they are **different MuckRock entries with different IDs.** They don't overlap in our data.

The `jurisdiction_id` column in `agency_stats_cache` distinguishes them:
- Federal agencies: `jurisdiction_id` is NULL
- State agencies: `jurisdiction_id` = the state's MuckRock ID (e.g., 52 for California)

### Federal vs. Insights — DIFFERENT data sources, some agency overlap

The Federal tab and Insights tab both cover federal agencies, but:

| | Federal Tab | Insights Tab |
|---|---|---|
| **Source** | MuckRock (nonprofit) | FOIA.gov (government) |
| **Data type** | Real-time request tracking from MuckRock's platform | Official annual reports submitted to DOJ |
| **Agencies** | ~1,694 (every agency anyone has filed through MuckRock) | 32 (major agencies only) |
| **Time range** | Current snapshot only | FY 2008-2024 (17 years of history) |
| **Metrics** | Success rate, response time, outcomes | Costs, staffing, exemptions, appeals, litigation, backlogs |
| **Table** | `agency_stats_cache` | `foia_annual_reports` + `foia_insights_cache` |

The 32 agencies in Insights are a **subset** of the ~1,694 in the Federal tab. But the data itself is different — MuckRock tracks requests filed through their platform, while FOIA.gov has official government-reported statistics covering ALL requests each agency received (not just MuckRock ones).

### If you totaled Federal + State agencies, would it equal Insights?

**No.** They measure completely different things:

- **Federal tab:** ~1,694 agencies from MuckRock (real-time, platform-specific)
- **State tab:** Thousands of agencies across 54 jurisdictions from MuckRock
- **Insights tab:** 32 agencies from FOIA.gov (government annual reports)

The Insights data is the most **authoritative** (it's the official government data), but it only covers major agencies. The Federal/State MuckRock data covers far more agencies but only reflects requests filed through MuckRock's platform.

---

## What's in the Database?

### Table: `agency_stats_cache`

**What:** Every agency (federal + state) from MuckRock with FOIA request data.
**Size:** ~5,000-10,000 rows (1,694 federal + thousands of state agencies)
**Key columns:** id, name, slug, jurisdiction, jurisdiction_id, success_rate, average_response_time, fee_rate, has_portal, transparency_score, number_requests (+ 11 outcome breakdown columns)

### Table: `jurisdiction_cache`

**What:** 54 state/territory jurisdictions from MuckRock
**Size:** 54 rows
**Key columns:** id, name, slug, abbrev, level, parent_id

### Table: `jurisdiction_stats_cache`

**What:** Aggregated stats per state (computed from agencies in that state)
**Size:** 54 rows
**Key columns:** jurisdiction_id, total_agencies, total_requests, overall_success_rate, transparency_score

### Table: `foia_annual_reports`

**What:** Per-agency per-year data from FOIA.gov XML
**Size:** ~400-500 rows (32 agencies × 17 years, minus years where data wasn't available)
**Key columns:** agency_abbreviation, fiscal_year, requests_received, requests_processed, requests_backlog, full_grants, partial_grants, full_denials, exemption_1 through exemption_9, total_costs, staff_fte, appeals, litigation

### Table: `foia_insights_cache`

**What:** Year-level aggregates across all 32 agencies (one row per fiscal year)
**Size:** 17 rows (FY 2008-2024)
**Key columns:** fiscal_year, total_received, total_processed, total_backlog, exemptions_json, total_costs, total_staff_fte

### Table: `foia_news_digest`

**What:** AI-generated news summaries from RSS feeds
**Size:** ~10-20 rows (refreshed on demand)
**Key columns:** title, summary, source_url, source_name, category, published_date

---

## What's Missing / Limitations

### Federal Tab
- **Only MuckRock data** — agencies that nobody has filed through MuckRock won't appear, even if they exist
- **Biased sample** — MuckRock users tend to be journalists and researchers, so the request patterns may not represent all FOIA activity
- **No historical trends** — only stores the latest snapshot, no year-over-year comparison at the agency level
- **Some agencies have very few requests** — agencies with 1-2 requests have unreliable metrics (we filter to 5+ for display, 10+ for "least transparent")

### State & Local Tab
- **Coverage varies wildly** — some states (Massachusetts, California) have hundreds of agencies on MuckRock; others have fewer than 10
- **No state FOIA law info** — we show MuckRock stats but don't include state-specific FOIA law names, deadlines, or exemption guides (MuckRock has this on their /place/ pages but it's not in their API)
- **Territories have minimal data** — Puerto Rico, Guam, Virgin Islands have very few agencies tracked
- **Same MuckRock bias** — state data reflects MuckRock usage, not all FOIA activity in that state

### Insights Tab
- **Only 32 agencies** — FOIA.gov has annual reports for 100+ agencies, but we only fetch the 32 major ones. Adding more is just adding abbreviations to the `AGENCIES` list.
- **Requester type data unavailable** — the FOIA.gov XML API doesn't include who filed the requests (commercial, media, etc.). That data exists in DOJ Excel downloads but we haven't integrated those.
- **XML parsing may miss some fields** — the FOIA.gov XML schema is complex and varies slightly between agencies. Some fields may not parse correctly for all agencies.
- **No sub-agency breakdown** — FOIA.gov reports include component-level data (e.g., FBI within DOJ) but we aggregate at the agency level
- **Data published with delay** — FY 2024 data was published in spring 2025. FY 2025 data won't be available until early 2026.

### Cross-Tab Limitations
- **No unified agency ID** — MuckRock uses its own IDs, FOIA.gov uses abbreviations. There's no automatic linking between a MuckRock agency entry and a FOIA.gov annual report for the same agency.
- **Different time periods** — MuckRock data is a rolling snapshot; FOIA.gov data is annual. They can't be directly compared.
- **Different request counts** — MuckRock's "number_requests" counts requests filed through MuckRock. FOIA.gov's "requests_received" counts ALL requests an agency received from all sources. FOIA.gov numbers are much larger.

---

## How to Refresh Data

```bash
cd backend

# Federal agency stats from MuckRock (~2 min)
python -m app.scripts.refresh_hub_stats

# State jurisdiction + agency stats from MuckRock (~10 min)
python -m app.scripts.refresh_jurisdiction_stats

# FOIA.gov annual reports for Insights (~5 min)
python -m app.scripts.refresh_insights_data

# AI news digest (~30 sec)
python -m app.scripts.refresh_news_digest
```

All scripts upsert (insert or update) — safe to re-run anytime.
