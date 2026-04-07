# FOIA Fluent

### A civic AI platform that cuts through government opacity — finding existing public records, drafting optimized requests under federal and state transparency laws, tracking agency responses, and providing deep FOIA insights so documents reach the people who need them.

**[Live Site](https://www.foiafluent.com)** · Built with ❤️ by [NYC-DSSG](https://www.nyc-dssg.org/) (Data Science for Social Good).

![FOIA Fluent — Homepage](docs/images/homepage_update.png)

![FOIA Fluent — Search & Draft](docs/images/draft_page.png)

---

## The Problem

The Freedom of Information Act promises government transparency, but the reality is broken:

- **Documents already exist in the public domain** but are scattered across dozens of repositories, reading rooms, and databases with no unified search
- **Every jurisdiction has different rules** — federal FOIA, New York's FOIL, California's CPRA, Texas's PIA — each with unique exemptions, deadlines, appeal processes, and fee structures
- **Requests fail at alarming rates** — poorly worded requests, wrong agencies, missing legal citations, and vague scope give agencies easy reasons to deny or delay
- **Requesters are on their own** — journalists, lawyers, and civic organizations each reinvent the wheel, with no shared intelligence on what works
- **The process is deliberately opaque** — response timelines stretch from weeks to years, improper redactions go unchallenged, and most people give up

The information belongs to the public. The process shouldn't be this hard.

## What's Built

### Search & Draft
Intelligent search that auto-identifies the best agency and generates legally optimized FOIA request letters.

- **Claude-powered query interpretation** — understands natural language, identifies relevant agencies and record types
- **Automatic agency identification** — Claude identifies the best federal agency with alternatives and reasoning
- **Anti-hallucination drafting** — Claude drafts from three layers of verified context (statute text, agency CFR regulations from eCFR, MuckRock outcomes). It cannot cite law from its training data.
- **Agency intelligence research** — analyzes successful/denied/exemption-related FOIA outcomes for the target agency to inform drafting strategy
- **AI interpretability** — "How We Built This Draft" section shows what the AI learned and what strategies it applied

### My Requests
Track submitted requests from filing to resolution with Claude-powered response analysis and letter generation.

- **Supabase-backed persistence** with Row Level Security — each user sees only their own requests
- **OTP authentication** — email-based sign-in via Supabase Auth
- **Deadline monitoring** — calculates 20 business-day statutory deadline, skipping weekends and federal holidays
- **Claude response analysis** — evaluates agency responses for completeness, validates each exemption cited, identifies missing records, and recommends next steps
- **Appeal & follow-up letter generation** — generates letters directly from the communication timeline
- **Import existing requests** — bring in-flight FOIA requests into the system with full research pipeline analysis

### Data Hub — Federal Agencies
Public transparency dashboard surfacing aggregated FOIA data across 1,600+ federal agencies.

- **Transparency Score** — composite of success rate (40%), response speed (30%), fee rate (15%), and portal availability (15%)
- **Interactive charts** — outcome breakdown, top/bottom agency rankings
- **Searchable directory** — paginated, sortable table with key metrics
- **Per-agency deep-dives** — outcome pie chart, score breakdown, exemption patterns, success/denial patterns
- **Weekly refresh** — MuckRock data cached in Supabase via `refresh_hub_stats.py`

### Data Hub — State & Local
Interactive choropleth map of state-level FOIA transparency across 54 state jurisdictions and thousands of agencies.

- **Interactive US map** — states color-coded by transparency score, hover tooltips, click to drill down
- **State detail pages** — per-state stats, outcome charts, top/bottom agency rankings, searchable agency directory
- **Jurisdiction-scoped agency routing** — `/hub/states/california/department-of-education` avoids slug conflicts across jurisdictions
- **Data pipeline** — `refresh_jurisdiction_stats.py` fetches from MuckRock API

### Data Hub — Insights
Deep FOIA analysis using government-authoritative data from FOIA.gov annual reports (FY 2008–2024).

- **FOIA at a Glance** — hero stats with year-over-year change indicators
- **Request Volume Trends** — area chart showing received, processed, and backlog over 17 years
- **Transparency Trends** — stacked area chart of full grant, partial, and denial rates over time
- **Most Requested Agencies** — horizontal bar chart of top 15 agencies
- **Exemption Patterns** — most cited exemptions with descriptions
- **Processing Times** — median days for simple vs. complex requests over time
- **Costs & Staffing** — total FOIA costs and cost-per-request trends
- **Appeals & Litigation** — appeal volume and litigation cases over time
- **AI News Digest** — Claude-curated FOIA news from 10 RSS feeds, categorized and summarized
- **Data pipeline** — `refresh_insights_data.py` fetches FOIA.gov XML API; `refresh_news_digest.py` generates AI summaries

### AI Chat Assistant
Persistent FOIA research assistant on every page with tool use, 4-tier accuracy system, and anti-hallucination safeguards.

- **Floating chat panel** — appears on every page, minimizable, Cmd+K to toggle
- **7 tools** — lookup exemptions, search agencies, query user's requests, search web (trusted + broad), search MuckRock, query hub stats
- **4-tier accuracy system** — instant local lookup → trusted domain search → deep research agent → graceful fallback with resource links
- **Auto-escalation** — upgrades from Haiku to Sonnet and broadens search when trusted sources don't have the answer
- **READ-ONLY** — chat cannot modify any database records. Enforced at code level.
- **Anti-hallucination** — every fact must come from a tool result or verified reference data. Sources cited as clickable chips.
- **Platform expert** — guides users through Search & Draft, My Requests, and Data Hub instead of giving generic advice
- **Context-aware** — knows which page the user is on and adapts guidance accordingly
- **SSE streaming** — real-time response with thinking dots, tool call indicators, and incremental text

## Architecture

```
Frontend (Next.js 14)          Backend (FastAPI)              External Services
┌──────────────────┐          ┌──────────────────────┐       ┌─────────────────┐
│                  │   HTTP   │                      │       │ Claude API      │
│  Data Hub        │ ──────> │  Chat Orchestrator    │ ────> │ (Haiku+Sonnet)  │
│  Search + Draft  │          │  Query Interpreter    │       │                 │
│  My Requests     │   SSE   │  FOIA Drafter         │       │ Tavily Search   │
│  Chat Panel      │ <────── │  Agency Intel Agent   │       │                 │
│                  │          │  Response Analyzer    │       │ MuckRock API    │
│  Insights        │          │  Letter Generator     │       │ FOIA.gov API    │
│  State Map       │          │  Insights Service     │       │ DocumentCloud   │
│                  │          │  Chat Tools (7)       │       │ eCFR API        │
└──────────────────┘          └──────────────────────┘       └─────────────────┘
                                        │
                              ┌─────────▼─────────┐
                              │     Supabase       │
                              │  PostgreSQL + Auth  │
                              │  + Row Level Security│
                              └────────────────────┘
```

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Backend | FastAPI (Python) | Async-native, SSE streaming, Pydantic validation |
| Frontend | Next.js 14 (React 18, TypeScript) | App Router, SSR, Vercel-ready |
| AI | Claude API (Haiku + Sonnet) | Tool use, large context, strong at legal text |
| Search | Tavily API | Domain-scoped web search |
| Charts | Recharts + react-simple-maps | SVG-based, React-native, lightweight |
| Database | Supabase (PostgreSQL + Auth) | RLS, OTP auth, free tier suitable for MVP |
| Deployment | Railway (backend) + Vercel (frontend) | Zero-config deploys |

## Quick Start (Local)

### Prerequisites

- Python 3.11+
- Node.js 18+
- API keys: Anthropic (Claude), Tavily
- Optional: Supabase project (for auth and persistence), FOIA.gov API key (for insights)

### Setup

```bash
# Clone
git clone https://github.com/dssg-nyc/FOIA-Fluent.git
cd FOIA-Fluent

# Backend
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp ../.env.example .env   # Edit with your API keys

uvicorn app.main:app --reload --port 8000

# Frontend (new terminal)
cd frontend
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Environment Variables

```
# Required
ANTHROPIC_API_KEY=         # Claude API
TAVILY_API_KEY=            # Web search

# Required for auth + persistence (optional for local dev)
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
SUPABASE_JWT_SECRET=

# Optional
FOIA_GOV_API_KEY=          # FOIA.gov annual report data

# Frontend (.env.local)
NEXT_PUBLIC_API_URL=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

## Data Refresh Scripts

```bash
cd backend

# Federal agency transparency stats (weekly)
python -m app.scripts.refresh_hub_stats

# State & local jurisdiction stats (weekly)
python -m app.scripts.refresh_jurisdiction_stats

# FOIA.gov annual report data for Insights (annual)
python -m app.scripts.refresh_insights_data

# AI news digest (weekly)
python -m app.scripts.refresh_news_digest
```

## Deployment

- **Backend → Railway**: Root directory `backend/`, add env vars
- **Frontend → Vercel**: Root directory `frontend/`, add env vars
- **Database → Supabase**: Run `backend/supabase_schema.sql` in SQL Editor
- **Seed agencies**: `python -m app.scripts.seed_agency_profiles`
- **Auth redirect**: Add Vercel URL to Supabase Auth → Redirect URLs

## Key Data Sources

| Source | What It Provides |
|--------|-----------------|
| [MuckRock](https://www.muckrock.com) | FOIA requests, agency response data, outcome intelligence |
| [FOIA.gov](https://www.foia.gov) | Annual report data (FY 2008–2024) for 100+ federal agencies |
| [DocumentCloud](https://www.documentcloud.org) | Searchable repository of public-interest documents |
| [Tavily](https://tavily.com) | Domain-scoped web search |
| [eCFR](https://www.ecfr.gov) | Verbatim CFR regulation text for 52 federal agencies |

## Who It's For

- **Journalists** investigating government activity and needing documents fast
- **Lawyers and legal organizations** filing records requests on behalf of clients
- **Researchers and academics** studying government policy, enforcement, and spending
- **Civic organizations and nonprofits** holding agencies accountable
- **Concerned citizens** exercising their right to public information

## Contributing

This project is open source under [dssg-nyc](https://github.com/dssg-nyc). We welcome contributions — see the issues tab or reach out.

## License

MIT
