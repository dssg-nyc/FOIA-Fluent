# FOIA Fluent

### A civic AI platform that cuts through government opacity — finding existing public records, drafting optimized requests under federal and state transparency laws, and tracking agency responses so documents reach the people who need them.

---

## The Problem

The Freedom of Information Act promises government transparency, but the reality is broken:

- **Documents already exist in the public domain** but are scattered across dozens of repositories, reading rooms, and databases with no unified search
- **Every jurisdiction has different rules** — federal FOIA, New York's FOIL, California's CPRA, Texas's PIA — each with unique exemptions, deadlines, appeal processes, and fee structures. Requesters must be legal experts in whichever state they're filing in
- **Requests fail at alarming rates** — poorly worded requests, wrong agencies, missing legal citations, and vague scope give agencies easy reasons to deny or delay
- **Requesters are on their own** — journalists, lawyers, and civic organizations each reinvent the wheel, with no shared intelligence on what works, which agencies cooperate, or how to appeal denials
- **The process is deliberately opaque** — response timelines stretch from weeks to years, improper redactions go unchallenged, and most people give up before getting results

The information belongs to the public. The process shouldn't be this hard.

## What's Built

### Phase 1: Document Discovery (Complete)

Search across multiple public records sources before filing a new request.

- **Multi-source parallel search** across MuckRock, DocumentCloud, and web sources
- **Claude-powered query interpretation** — understands natural language, identifies relevant agencies and record types
- **Smart recommendations** — tells users whether existing documents answer their question or if a new FOIA request is needed

### Phase 2: AI-Assisted FOIA Request Drafting (Complete)

Generate legally sound, optimized FOIA request letters using verified legal context and MuckRock outcome intelligence.

- **Anti-hallucination safeguards** — Claude drafts from three layers of verified context (statute text, agency CFR regulations fetched from eCFR, MuckRock outcomes). It cannot cite law from its training data.
- **Dual parallel research agents** — Topic Agent (subject-specific) + Agency Intel Agent (agency-wide FOIA patterns) run simultaneously
- **Persistent agency intelligence cache** — 24-hour TTL, atomic writes. First request for an agency pays the research cost; subsequent requests are instant.
- **AI interpretability** — "How We Built This Draft" section shows what the AI learned from successful requests, what denial patterns it avoided, scope decisions, and exemption risk mitigation
- **Multi-step wizard UI** — agency confirmation → request details → draft review with copy-to-clipboard

### Phase 3: Response & Negotiation Tracking (Complete)

Track submitted requests from filing to resolution, with Claude-powered response analysis and letter generation.

- **Supabase-backed persistence** with Row Level Security — each user sees only their own requests
- **Magic link authentication** — no passwords, email-based sign-in via Supabase Auth
- **Deadline monitoring** — calculates 20 business-day statutory deadline, skipping weekends and federal holidays 2025–2027
- **Research context preserved** — all Phase 1 discovery results and Phase 2 intelligence (similar requests, agency FOIA profile, drafting strategy, submission guide) travel with the request
- **Claude response analysis** — evaluates agency response for completeness, validates each exemption cited, identifies missing records, and recommends accept / follow-up / appeal / negotiate scope
- **Letter generation** — follow-up letters cite the statutory deadline and days elapsed; appeal letters challenge each exemption with legal reasoning and reference OGIS mediation
- **Communication timeline** — chronological log of all outgoing/incoming correspondence
- **Import existing requests** — bring in-flight requests into the system with full research pipeline analysis and optional immediate response analysis
- **Dashboard** — lists all tracked requests with overdue-first sorting, status badges, and filter tabs

### Future Phases

- **Phase 4: Beyond FOIA** — alternative pathways when FOIA fails (congressional inquiries, state equivalents, inspector general complaints)
- **Phase 5: Data Hub** — agency transparency metrics, exemption pattern analysis, public leaderboard

## Architecture

```
Frontend (Next.js 14)          Backend (FastAPI)              External Services
┌──────────────────┐          ┌──────────────────────┐       ┌─────────────────┐
│                  │   HTTP   │                      │       │ Claude API      │
│  Search + Draft  │ ──────> │  Query Interpreter    │ ────> │ (Anthropic)     │
│  Wizard          │          │  FOIA Drafter         │       │                 │
│  Request Tracker │          │  Agency Intel Agent   │       │ Tavily Search   │
│  Dashboard       │          │  Response Analyzer    │       │ (MuckRock,      │
│                  │ <────── │  Letter Generator     │       │  DocumentCloud) │
│  Next.js App     │          │  Deadline Calculator  │       │                 │
│  Router          │          │                      │       │ MuckRock API    │
└──────────────────┘          │  Verified Data:       │       │ DocumentCloud   │
                              │  - 52 federal agencies│       │ API             │
                              │  - FOIA statute text  │       └─────────────────┘
                              │  - Verbatim CFR text  │
                              │  - Agency intel cache │       ┌─────────────────┐
                              └──────────────────────┘       │ Supabase        │
                                                             │ (PostgreSQL +   │
                                                             │  Auth + RLS)    │
                                                             └─────────────────┘
```

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Backend | FastAPI (Python) | Async-native, built-in OpenAPI docs, Pydantic validation |
| Frontend | Next.js 14 (React 18, TypeScript) | App Router, SSR, Vercel-ready |
| AI | Claude API (claude-sonnet-4-20250514) | Large context window, structured output, strong at legal text |
| Search | Tavily API | Domain-scoped web search across MuckRock and DocumentCloud |
| Database | Supabase (PostgreSQL + Auth) | RLS, magic link auth, free tier suitable for MVP |
| Deployment | Railway (backend) + Vercel (frontend) | Zero-config deploys, generous free tiers |

## Quick Start (Local)

### Prerequisites

- Python 3.11+
- Node.js 18+
- API keys: Anthropic (Claude), Tavily
- Optional: Supabase project (for auth and persistence; falls back to local JSON without it)

### Setup

```bash
# Clone the repo
git clone https://github.com/dssg-nyc/FOIA-Fluent.git
cd FOIA-Fluent

# Backend
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp ../.env.example .env
# Edit .env with your API keys

# Start backend
uvicorn app.main:app --reload --port 8000

# Frontend (new terminal)
cd frontend
npm install
npm run dev -- --port 3005
```

Open [http://localhost:3005](http://localhost:3005) in your browser.

### Environment Variables

```
# Required
ANTHROPIC_API_KEY=     # Claude API for drafting and analysis
TAVILY_API_KEY=        # Web search across MuckRock and DocumentCloud

# Required for auth + cloud persistence (optional for local dev)
SUPABASE_URL=          # Your Supabase project URL
SUPABASE_SERVICE_KEY=  # Service role key (backend only — never expose publicly)

# Frontend (.env.local or Vercel env vars)
NEXT_PUBLIC_API_URL=            # Backend URL
NEXT_PUBLIC_SUPABASE_URL=       # Same as SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=  # Supabase anon/public key
```

## Deployment

The app is designed for zero-config deployment:

- **Backend → Railway**: Set root directory to `backend/`, add env vars. `railway.toml` and `Procfile` handle the rest.
- **Frontend → Vercel**: Import repo, set env vars. `vercel.json` at repo root handles the monorepo build.
- **Database → Supabase**: Run `backend/supabase_schema.sql` in SQL Editor to create all tables, RLS policies, and indexes.
- **Seed agency profiles**: Run `python -m app.scripts.seed_agency_profiles` once to populate all 52 federal agencies with verbatim CFR regulation text from eCFR.

## Project Structure

```
FOIA-Fluent/
├── backend/
│   ├── app/
│   │   ├── main.py                    # FastAPI entry point
│   │   ├── config.py                  # Settings (env vars)
│   │   ├── data/
│   │   │   ├── federal_agencies.py    # 52 verified agency FOIA profiles
│   │   │   └── federal_foia_statute.py # 5 U.S.C. § 552 full statute text
│   │   ├── middleware/
│   │   │   └── auth.py                # JWT validation via PyJWT
│   │   ├── models/
│   │   │   ├── draft.py               # Draft/agency Pydantic models
│   │   │   ├── search.py              # Discovery Pydantic models
│   │   │   └── tracking.py            # Request tracking + communication models
│   │   ├── routes/
│   │   │   ├── admin.py               # Agency profile admin endpoints
│   │   │   ├── search.py              # Discovery endpoints
│   │   │   ├── draft.py               # Drafting endpoints
│   │   │   └── tracking.py            # Request lifecycle endpoints
│   │   ├── scripts/
│   │   │   └── seed_agency_profiles.py # One-time Supabase seeder
│   │   └── services/
│   │       ├── drafter.py             # Claude-powered FOIA drafting
│   │       ├── agency_intel.py        # Agency FOIA pattern research + cache
│   │       ├── agency_profiles.py     # Agency profile lookup (Supabase-first)
│   │       ├── supabase_store.py      # Supabase-backed request persistence
│   │       ├── request_store.py       # Local JSON fallback persistence
│   │       ├── request_analyzer.py    # Analyzes imported FOIA letters
│   │       ├── deadline_calculator.py # 20 business-day FOIA deadline logic
│   │       ├── response_analyzer.py   # Claude-powered response analysis
│   │       └── letter_generator.py    # Follow-up and appeal letter generation
│   ├── supabase_schema.sql            # Full DB schema with RLS policies
│   ├── railway.toml                   # Railway deployment config
│   └── Procfile                       # Fallback start command
├── frontend/
│   └── src/
│       ├── app/
│       │   ├── page.tsx               # Main search + draft wizard
│       │   ├── globals.css            # Global styles
│       │   ├── layout.tsx             # App layout with Nav
│       │   ├── auth/callback/         # Supabase magic link callback
│       │   ├── login/                 # Login page
│       │   ├── dashboard/             # My Requests dashboard
│       │   ├── import/                # Track existing request wizard
│       │   └── requests/[id]/         # Request detail page
│       ├── components/
│       │   ├── AuthGuard.tsx          # Auth gate wrapper
│       │   └── Nav.tsx                # Sticky nav with user session
│       └── lib/
│           ├── api.ts                 # Discovery + drafting API client
│           ├── supabase.ts            # Supabase client + auth helpers
│           └── tracking-api.ts        # Request tracking API client
├── vercel.json                        # Vercel monorepo build config
├── .env.example                       # All required env vars documented
└── implementation_strategy.md         # Full technical blueprint
```

## Who It's For

- **Journalists** investigating government activity and needing documents fast
- **Lawyers and legal organizations** filing records requests on behalf of clients
- **Researchers and academics** studying government policy, enforcement, and spending
- **Civic organizations and nonprofits** holding agencies accountable
- **Concerned citizens** exercising their right to public information

## Key Data Sources

| Source | What It Provides |
|--------|-----------------|
| [MuckRock](https://www.muckrock.com) | Existing FOIA requests, agency response data, outcome intelligence |
| [DocumentCloud](https://www.documentcloud.org) | Searchable repository of public-interest documents |
| [Tavily](https://tavily.com) | Domain-scoped web search for research agents |
| [eCFR](https://www.ecfr.gov) | Verbatim CFR regulation text for 52 federal agencies |

## Contributing

This project is open source under the [dssg-nyc](https://github.com/dssg-nyc) organization. If you're interested in civic tech, FOIA, or government accountability, we welcome contributions. See the issues tab or reach out.

## License

MIT
