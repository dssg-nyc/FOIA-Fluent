# FOIA Fluent

### A civic AI platform that cuts through government opacity — finding existing public records, drafting optimized requests under federal and state transparency laws, and tracking agency responses so documents reach the people who need them.

**[View the full product overview](https://foia-fluent.edgeone.app/)**

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

```
User: "My family member died in ICE detention and I want records
       about the circumstances of their death"
                    |
                    v
         +--------------------+
         | Query Interpreter  |  Claude parses intent, identifies
         | (Claude API)       |  agencies (ICE, DHS) and record
         +--------------------+  types (death reports, inspection
                    |            records, medical files)
                    v
    +---------------+---------------+
    |               |               |
    v               v               v
+--------+    +-----------+    +--------+
|MuckRock|    |DocumentCl.|    | Tavily |    Parallel search
| API    |    |   API     |    | Search |    via asyncio.gather()
+--------+    +-----------+    +--------+
    |               |               |
    +---------------+---------------+
                    |
                    v
         +--------------------+
         | Result Merger      |  Deduplicate, rank by relevance,
         | + Recommendation   |  assess: file new or use existing?
         +--------------------+
                    |
                    v
         Search results + "We recommend filing
         a FOIA request to ICE for these records"
```

- **Multi-source parallel search** across MuckRock, DocumentCloud, and web sources
- **Claude-powered query interpretation** — understands natural language, identifies relevant agencies and record types
- **Smart recommendations** — tells users whether existing documents answer their question or if a new FOIA request is needed

### Phase 2: AI-Assisted FOIA Request Drafting (Complete)

Generate legally sound, optimized FOIA request letters using verified legal context and MuckRock outcome intelligence.

```
User confirms agency (ICE) + enters request details
                    |
                    v
         +--------------------+
         | Parallel Research  |  Two agents run simultaneously
         | via asyncio.gather |  via asyncio.gather()
         +----------+---------+
                    |
        +-----------+-----------+
        |                       |
        v                       v
+----------------+    +------------------+
| Topic Agent    |    | Agency Intel     |
| Searches for   |    | Agent            |
| MuckRock reqs  |    | Researches ICE's |
| on this exact  |    | overall FOIA     |
| topic (ICE     |    | track record:    |
| detention      |    | - denial rates   |
| deaths)        |    | - exemptions     |
+----------------+    | - success        |
        |             |   patterns       |
        |             +------------------+
        |                       |
        +-----------+-----------+
                    |
                    v
    +-------------------------------+
    | Verified Context Assembly     |
    |                               |
    | 1. FOIA Statute (5 USC 552)   |  Actual statute text,
    |    - All 9 exemptions         |  not summaries
    |    - Fee waiver provisions    |
    |    - Time limit rules         |
    |                               |
    | 2. Agency Info (from DB)      |  Verified FOIA portal,
    |    - ICE FOIA email           |  email, regulations
    |    - CFR regulation cite      |  from foia.gov
    |    - Submission procedures    |
    |                               |
    | 3. MuckRock Intelligence      |  What worked, what
    |    - Successful requests      |  didn't, common
    |    - Denied requests          |  exemptions invoked
    |    - Exemption patterns       |
    +-------------------------------+
                    |
                    v
         +--------------------+
         | Claude Drafting    |  Generates letter using ONLY
         | (claude-sonnet-4)  |  the verified context above.
         |                    |  Zero hallucinated citations.
         +--------------------+
                    |
                    v
    +-------------------------------+
    | Output                        |
    | - Complete FOIA letter        |
    | - Submission instructions     |
    | - "How We Built This Draft"   |
    |   (AI reasoning transparency) |
    | - Similar requests found      |
    | - Agency FOIA profile stats   |
    +-------------------------------+
```

- **Anti-hallucination safeguards** — Claude drafts from three layers of verified context (statute text, agency regulations, MuckRock outcomes). It cannot cite law from its training data.
- **Dual parallel research agents** — Topic Agent (subject-specific) + Agency Intel Agent (agency-wide FOIA patterns) run simultaneously
- **Persistent agency intelligence cache** — 24-hour TTL, atomic writes. First request for an agency pays the research cost; subsequent requests are instant.
- **AI interpretability** — "How We Built This Draft" section shows what the AI learned from successful requests, what denial patterns it avoided, scope decisions, and exemption risk mitigation
- **Multi-step wizard UI** — agency confirmation → request details → draft review with copy-to-clipboard

### Phase 3: Response & Negotiation Tracking (Complete)

Track submitted requests from filing to resolution, with Claude-powered response analysis and letter generation.

```
User clicks "Track This Request" after drafting
                    |
                    v
         +--------------------+
         | Request Store      |  Saved to local JSON with all Phase 1+2
         | (JSON persistence) |  research context preserved for reference
         +--------------------+
                    |
          +---------+---------+
          |                   |
          v                   v
  +---------------+   +----------------+
  | /dashboard    |   | /requests/[id] |
  |               |   |                |
  | All requests  |   | Deadline card  |
  | Filter tabs:  |   | Action panel   |
  | All/Active/   |   | Research       |
  | Overdue/Done  |   | Context        |
  +---------------+   +----------------+
                              |
              +---------------+---------------+
              |               |               |
              v               v               v
    +--------------+  +--------------+  +----------+
    | Mark         |  | I Received   |  | Generate |
    | Submitted    |  | a Response   |  | Letter   |
    | (date picker)|  |              |  |          |
    +--------------+  +------+-------+  +----------+
                             |
                             v
                    +------------------+
                    | Response Analyzer|  Claude evaluates:
                    | (Claude API)     |  - Completeness
                    +------------------+  - Exemption validity
                             |            - Missing records
                             v            - Appeal grounds
                    +------------------+
                    | Letter Generator |  follow_up: cites
                    | (Claude API)     |  overdue deadline
                    +------------------+  appeal: challenges
                             |            each exemption
                             v
                    Auto-logged as
                    communication entry
```

- **Deadline monitoring** — calculates 20 business-day statutory deadline, skipping weekends and federal holidays 2025–2027
- **Research context preserved** — all Phase 1 discovery results and Phase 2 intelligence (similar requests, agency FOIA profile, drafting strategy, submission guide) travel with the request so users have full reference while negotiating
- **Claude response analysis** — evaluates agency response for completeness, validates each exemption cited, identifies missing records, and recommends accept / follow-up / appeal / negotiate scope
- **Letter generation** — follow-up letters cite the statutory deadline and days elapsed; appeal letters challenge each exemption with legal reasoning and reference OGIS mediation
- **Communication timeline** — chronological log of all outgoing/incoming correspondence, expandable per entry
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
                              │  - Federal agencies   │       │ API             │
                              │  - FOIA statute text  │       └─────────────────┘
                              │  - Agency intel cache │
                              └──────────────────────┘
```

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Backend | FastAPI (Python) | Async-native, built-in OpenAPI docs, Pydantic validation |
| Frontend | Next.js 14 (React 18, TypeScript) | App Router, SSR, Vercel-ready |
| AI | Claude API (claude-sonnet-4-20250514) | Large context window, structured output, strong at legal text |
| Search | Tavily API | Domain-scoped web search across MuckRock and DocumentCloud |
| Data | Local JSON cache (Supabase planned) | Zero-infrastructure MVP; swappable for PostgreSQL later |

## Quick Start

### Prerequisites

- Python 3.11+
- Node.js 18+
- API keys: Anthropic (Claude), Tavily

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
ANTHROPIC_API_KEY=     # Required — Claude API for drafting and analysis
TAVILY_API_KEY=        # Required — web search across MuckRock and DocumentCloud
```

## Project Structure

```
FOIA-Fluent/
├── backend/
│   └── app/
│       ├── main.py                    # FastAPI entry point
│       ├── config.py                  # Settings (env vars)
│       ├── data/
│       │   ├── federal_agencies.py    # Verified agency FOIA info
│       │   └── federal_foia_statute.py # 5 U.S.C. § 552 statute text
│       ├── models/
│       │   ├── draft.py               # Draft/agency Pydantic models
│       │   ├── search.py              # Discovery Pydantic models
│       │   └── tracking.py            # Request tracking + communication models
│       ├── routes/
│       │   ├── search.py              # Discovery endpoints
│       │   ├── draft.py               # Drafting endpoints
│       │   └── tracking.py            # Request lifecycle endpoints
│       └── services/
│           ├── drafter.py             # Claude-powered FOIA drafting
│           ├── agency_intel.py        # Agency FOIA pattern research + cache
│           ├── query_interpreter.py   # Claude-powered query parsing
│           ├── search.py              # Multi-source search orchestrator
│           ├── muckrock.py            # MuckRock API client
│           ├── documentcloud.py       # DocumentCloud API client
│           ├── tavily_search.py       # Tavily search client
│           ├── request_store.py       # JSON-backed request persistence
│           ├── deadline_calculator.py # 20 business-day FOIA deadline logic
│           ├── response_analyzer.py   # Claude-powered response analysis
│           └── letter_generator.py    # Follow-up and appeal letter generation
├── frontend/
│   └── src/
│       ├── app/
│       │   ├── page.tsx               # Main search + draft wizard
│       │   ├── globals.css            # Global styles
│       │   ├── layout.tsx             # App layout with Nav
│       │   ├── dashboard/
│       │   │   └── page.tsx           # My Requests dashboard
│       │   └── requests/[id]/
│       │       └── page.tsx           # Request detail page
│       ├── components/
│       │   └── Nav.tsx                # Sticky nav with active state
│       └── lib/
│           ├── api.ts                 # Discovery + drafting API client
│           └── tracking-api.ts        # Request tracking API client
└── implementation_strategy.md         # Full technical blueprint
```

## Who It's For

- **Journalists** investigating government activity and needing documents fast
- **Lawyers and legal organizations** filing records requests on behalf of clients
- **Researchers and academics** studying government policy, enforcement, and spending
- **Civic organizations and nonprofits** holding agencies accountable
- **Concerned citizens** exercising their right to public information

## Multi-Jurisdiction Support

FOIA is just the federal law. Every US state has its own public records law with different names, rules, and teeth:

| State | Law Name | Key Differences |
|-------|----------|----------------|
| Federal | FOIA | 9 exemptions, 20 business day deadline, OGIS mediation |
| New York | FOIL (Freedom of Information Law) | 5 business day acknowledge, 20 day response, COOG appeals |
| California | CPRA (California Public Records Act) | 10-day deadline, "catch-all" exemption, strong fee waivers |
| Texas | PIA (Public Information Act) | 10 business days, AG decides disputes, narrow exemptions |
| Florida | Sunshine Law | No specific deadline, broad access, criminal penalties for violations |

Currently supporting **federal FOIA** with state expansion planned.

## Key Data Sources

| Source | What It Provides |
|--------|-----------------|
| [MuckRock](https://www.muckrock.com) | Existing FOIA requests, agency response data, outcome intelligence |
| [DocumentCloud](https://www.documentcloud.org) | Searchable repository of public-interest documents |
| [Tavily](https://tavily.com) | Domain-scoped web search for research agents |

## Contributing

This project is open source under the [dssg-nyc](https://github.com/dssg-nyc) organization. If you're interested in civic tech, FOIA, or government accountability, we welcome contributions. See the issues tab or reach out.

## License

MIT
