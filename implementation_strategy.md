# FOIA Fluent — Implementation Strategy

A technical blueprint for building the platform from scratch. All recommendations prioritize free or low-cost services suitable for a nonprofit MVP.

---

## Table of Contents

1. [System Architecture](#system-architecture)
2. [Recommended Tech Stack](#recommended-tech-stack)
3. [Data Model](#data-model)
4. [API Integrations](#api-integrations)
5. [Phase 1: Document Discovery](#phase-1-document-discovery)
6. [Phase 2: Request Intelligence](#phase-2-request-intelligence)
7. [Phase 3: Response & Negotiation](#phase-3-response--negotiation)
8. [Phase 4: Import & Backfill](#phase-4-import--backfill)
9. [Deployment Strategy](#deployment-strategy)
10. [Future Phases](#future-phases)

---

## System Architecture

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

---

## Recommended Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Backend | FastAPI (Python 3.11) | Async-native, built-in OpenAPI docs, Pydantic validation |
| Frontend | Next.js 14 (React 18, TypeScript) | App Router, SSR, Vercel-ready |
| AI | Claude API (claude-sonnet-4-20250514) | Large context window, structured output, strong at legal text |
| Search | Tavily API | Domain-scoped web search across MuckRock and DocumentCloud |
| Database | Supabase (PostgreSQL + Auth) | RLS, magic link auth, free tier suitable for MVP |
| Backend Deploy | Railway | Zero-config Python deploys, nixpacks auto-detection |
| Frontend Deploy | Vercel | Zero-config Next.js deploys, monorepo support |

---

## Data Model

### Supabase Tables

**`agency_profiles`** — static reference data, no RLS
- `abbreviation` (PK), `name`, `jurisdiction`, `foia_email`, `foia_website`
- `foia_regulation`, `submission_notes`, `description`
- `cfr_summary`, `exemption_tendencies`, `routing_notes`
- `cfr_text` — verbatim regulation text fetched from eCFR (up to 50k chars)
- `cfr_last_fetched`

**`agency_intel_cache`** — MuckRock research cache, no RLS
- `agency_abbreviation`, `intel_json` (JSONB), `fetched_at`
- 24-hour TTL enforced in application layer

**`tracked_requests`** — user FOIA requests, RLS by `user_id`
- `id`, `user_id`, `title`, `description`, `status`
- `agency` (JSONB — full `AgencyInfo` including `cfr_available`)
- `letter_text`, `requester_name`, `requester_organization`
- `filed_date`, `statute_cited`
- `key_elements`, `tips` (JSONB arrays)
- `submission_info`, `similar_requests`, `drafting_strategy`, `agency_intel`, `discovery_results` (JSONB)
- `created_at`, `updated_at` (auto-trigger)

**`communications`** — correspondence log, RLS by `user_id` via `request_id`
- `id`, `request_id`, `user_id`, `direction` (incoming/outgoing)
- `comm_type`, `subject`, `body`, `date`

**`response_analyses`** — Claude's analysis of agency responses, RLS by `user_id`
- `id`, `request_id`, `user_id`
- `completeness`, `recommendation`, `exemptions_cited`
- `grounds_for_appeal`, `missing_records`, `negotiation_points`, `summary`

### RLS Policy Pattern

```sql
-- User data tables: strict isolation
CREATE POLICY "users_own_requests" ON tracked_requests
  USING (auth.uid()::text = user_id);

-- Reference tables: public read, service-role write
-- No RLS on agency_profiles, agency_intel_cache
```

---

## API Integrations

| API | Usage | Key Notes |
|-----|-------|-----------|
| Anthropic (Claude) | Drafting, analysis, letter generation, query interpretation | `claude-sonnet-4-20250514`, async client |
| Tavily | MuckRock search, DocumentCloud search, agency intel research | Domain-scoped, `include_domains` filter |
| MuckRock | Existing FOIA requests, outcomes | Public API, no auth required |
| DocumentCloud | Public interest documents | Public API |
| eCFR | Verbatim CFR regulation text | `GET /api/renderer/v1/content/enhanced/current/title-{N}?part={N}` |

---

## Phase 1: Document Discovery (Complete)

**Goal:** Search existing public records before filing a new request.

**Components:**
- `services/query_interpreter.py` — Claude parses natural language query, identifies agencies + record types
- `services/search.py` — orchestrates parallel search across MuckRock, DocumentCloud, Tavily
- `routes/search.py` — `/api/v1/search` endpoint
- `app/page.tsx` — multi-step wizard: query → results → proceed to draft

**Key design decisions:**
- `asyncio.gather()` for parallel search across all sources
- Results merged and deduplicated by URL
- Claude recommends: use existing documents vs. file new request

---

## Phase 2: Request Intelligence & Drafting (Complete)

**Goal:** Generate a legally sound FOIA letter using verified context, not hallucinated citations.

**Anti-hallucination architecture:**
1. `data/federal_foia_statute.py` — full 5 U.S.C. § 552 text (all 9 exemptions, fee waiver, expedited processing provisions)
2. `data/federal_agencies.py` + Supabase `agency_profiles` — verified FOIA contact info and CFR citations for 52 agencies
3. Supabase `agency_profiles.cfr_text` — verbatim CFR regulation text fetched from eCFR, injected verbatim into every prompt
4. `services/agency_intel.py` — real-time MuckRock research on agency's FOIA track record (24-hour cache)

**Store dispatcher pattern** (`routes/tracking.py`):
```python
def _get_request(request_id, user_id):
    if settings.supabase_url:
        return supabase_store.get_request(request_id, user_id)
    return request_store.get_request(request_id)
```
All route handlers use dispatcher functions — no direct store imports. Enables local dev without Supabase.

**Parallel research agents:**
```python
tasks = [research_similar_requests(agency, description)]
if intel_agent:
    tasks.append(intel_agent.research_agency(abbreviation, name))
results = await asyncio.gather(*tasks)
```

---

## Phase 3: Response & Negotiation Tracking (Complete)

**Goal:** Track requests end-to-end with deadline monitoring, response analysis, and letter generation.

**Deadline calculator** (`services/deadline_calculator.py`):
- 20 business-day statutory deadline (5 U.S.C. § 552(a)(6)(A)(i))
- Skips weekends and federal holidays (hardcoded 2025–2027)
- Returns days elapsed, days remaining, overdue flag, human-readable label

**Response analyzer** (`services/response_analyzer.py`):
- Claude evaluates completeness, validates each exemption cited against statute text
- Identifies missing records, negotiation points
- Recommends: accept / follow-up / appeal / negotiate scope

**Letter generator** (`services/letter_generator.py`):
- `follow_up` — cites statutory deadline, days elapsed, demands response
- `appeal` — challenges each exemption with legal reasoning, cites OGIS mediation option
- Auto-logged as outgoing `communication` entry after generation

**Communication timeline:**
- Each incoming/outgoing item stored in `communications` table
- Direction: `incoming` | `outgoing`
- Types: `initial_request`, `follow_up`, `response`, `appeal`, `acknowledgment`, `other`

---

## Phase 4: Import & Backfill (Complete)

**Goal:** Allow users to bring existing in-flight FOIA requests into the system.

**Import flow** (`POST /tracking/requests/import`):
1. Resolve agency abbreviation → full `AgencyInfo` from Supabase
2. Run full research pipeline concurrently (same as new draft flow)
3. `RequestAnalyzer.analyze_import()` — assesses existing letter against research context
4. Create `TrackedRequest` with analysis results
5. Log original letter as outgoing `communication`
6. If `existing_response` provided, run `ResponseAnalyzer` immediately

**`cfr_available` flag:**
- Set on `AgencyInfo` when building from profile: `cfr_available=bool(profile.get("cfr_text", ""))`
- NSA, ARMY, USAF return `cfr_available=False` (eCFR has no published part for these)
- Frontend shows amber notice explaining the gap and a mailto link to report it

---

## Deployment Strategy

### Services

| Service | Purpose | Config |
|---------|---------|--------|
| Supabase | PostgreSQL + Auth + RLS | `supabase_schema.sql` |
| Railway | FastAPI backend | `backend/railway.toml`, `backend/Procfile` |
| Vercel | Next.js frontend | `vercel.json` at repo root |

### Railway

```toml
# backend/railway.toml
[build]
builder = "nixpacks"
[deploy]
startCommand = "uvicorn app.main:app --host 0.0.0.0 --port $PORT"
healthcheckPath = "/health"
```

Set root directory to `backend/` in Railway service settings.

Required env vars: `ANTHROPIC_API_KEY`, `TAVILY_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `ADMIN_SECRET`, `BACKEND_CORS_ORIGINS`

### Vercel

```json
// vercel.json
{
  "buildCommand": "cd frontend && npm run build",
  "outputDirectory": "frontend/.next",
  "installCommand": "cd frontend && npm install",
  "framework": "nextjs"
}
```

Required env vars: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`

### One-time setup

```bash
# 1. Run schema in Supabase SQL Editor
# (paste contents of backend/supabase_schema.sql)

# 2. Seed agency profiles (run locally with Supabase credentials)
cd backend
python -m app.scripts.seed_agency_profiles
# Takes ~2 min, fetches verbatim CFR text from eCFR for all 52 agencies

# 3. Set Supabase auth redirect URL
# Authentication → URL Configuration → add https://your-app.vercel.app/auth/callback
```

### CORS wiring

After Vercel deploy, update Railway env:
```
BACKEND_CORS_ORIGINS=https://your-app.vercel.app,http://localhost:3005
```

---

## Future Phases

### Phase 5: Beyond FOIA

Alternative pathways when FOIA fails:
- Congressional inquiry templates
- Inspector General complaint generator
- State public records law engine (FOIL, CPRA, PIA, Sunshine Law)

### Phase 6: Data Hub

Agency transparency metrics:
- Response rate, median response time, exemption frequency by agency
- Public leaderboard — most/least transparent agencies
- Crowdsourced exemption validity scores from community appeals
