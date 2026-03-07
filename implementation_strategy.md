# FOIA Fluent — Implementation Strategy

A technical blueprint for building the platform from scratch. All recommendations prioritize free or low-cost services suitable for a nonprofit MVP.

---

## Table of Contents

1. [System Architecture](#system-architecture)
2. [Recommended Tech Stack](#recommended-tech-stack)
3. [Data Model](#data-model)
4. [API Integrations](#api-integrations)
5. [MCP Architecture](#mcp-architecture)
6. [State Law Engine](#state-law-engine)
7. [Phase 1: Document Discovery](#phase-1-document-discovery)
8. [Phase 2: Request Intelligence](#phase-2-request-intelligence)
9. [Phase 3: Response & Negotiation](#phase-3-response--negotiation)
10. [Phase 4: Beyond FOIA](#phase-4-beyond-foia)
11. [Phase 5: Data Hub](#phase-5-data-hub)
12. [Deployment Strategy](#deployment-strategy)
13. [Development Roadmap](#development-roadmap)

---

## System Architecture

```
+------------------+        +-------------------+        +--------------------+
|                  |        |                   |        |                    |
|   Web Frontend   | <----> |   MCP Server      | <----> |   Supabase         |
|   (Next.js)      |  HTTP  |   (FastAPI)       |  SQL   |   (PostgreSQL)     |
|                  |  SSE   |                   |        |                    |
+------------------+        +--------+----------+        +---------+----------+
                                     |                             |
                                     | HTTP                        | pgvector
                                     v                             v
                            +--------+----------+        +---------+----------+
                            |  External APIs    |        |  Semantic Search   |
                            |                   |        |  (embeddings for   |
                            |  - MuckRock API   |        |   past requests,   |
                            |  - DocumentCloud  |        |   FOIA laws, etc.) |
                            |  - data.gov       |        |                    |
                            |  - Claude API     |        +--------------------+
                            +-------------------+
```

### Request Flow

```
User enters search query
        |
        v
+-------+--------+
| Next.js Frontend|----> SSE connection for streaming results
+-------+--------+
        | POST /api/search
        v
+-------+--------+
| FastAPI Server  |----> Validates, routes, orchestrates
+-------+--------+
        |
        +-------+--------+--------+
        |       |        |        |
        v       v        v        v
   MuckRock  DocCloud  data.gov  Supabase
     API       API      API     (cached)
        |       |        |        |
        +-------+--------+--------+
        |
        v
  Deduplicate, rank, return results
        |
        v
  Cache in Supabase for future queries
```

---

## Recommended Tech Stack

### Backend: FastAPI (Python)

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| **FastAPI** | Async-native, built-in OpenAPI docs, SSE support, lightweight | Smaller ecosystem than Django | **Recommended** |
| Django | Batteries-included, ORM, admin panel | Heavier, sync by default, overkill for API-first app | Good for later if admin needed |
| Flask | Simple, familiar | No async, no built-in validation | Too bare-bones |

**Why FastAPI:** The platform is API-first with streaming needs (SSE for real-time search results). FastAPI's async support, automatic request validation via Pydantic, and built-in `/docs` endpoint accelerate development. The MCP protocol maps naturally to FastAPI's routing.

### Database: Supabase (PostgreSQL)

| Option | Free Tier | Pros | Cons |
|--------|-----------|------|------|
| **Supabase** | 500MB DB, 1GB storage, 50K monthly active users | Managed Postgres, REST API, pgvector, auth, realtime | Vendor lock-in risk |
| Neon | 512MB storage, 1 project | Serverless Postgres, branching | Fewer built-in features |
| PlanetScale | Deprecated free tier | MySQL-based | Not PostgreSQL |

**Why Supabase:** Free Postgres with pgvector (critical for semantic search over past FOIA requests and legal text), built-in auth, REST API, and a dashboard. The Row Level Security model works well for multi-user access control.

### Frontend: Next.js

| Option | Pros | Cons |
|--------|------|------|
| **Next.js** | SSR/SSG, API routes, Vercel free hosting, React ecosystem | Heavier than SPA for simple apps |
| SvelteKit | Lightweight, fast | Smaller ecosystem |
| Plain React SPA | Simple | No SSR, worse SEO |

**Why Next.js:** Free Vercel deployment, SSR for public-facing pages (important for grant reviewers and SEO), and API routes that can proxy to FastAPI during development.

### AI/LLM: Claude API (Anthropic)

For request drafting, legal analysis, and document summarization. Claude's large context window is well-suited for processing long FOIA documents and legal text. Use the Anthropic SDK directly from FastAPI.

### Hosting

| Service | Free Tier | Use For |
|---------|-----------|---------|
| **Vercel** | Unlimited static, 100GB bandwidth | Next.js frontend |
| **Railway** | $5/month credit (hobby) | FastAPI backend |
| **Supabase** | 500MB DB, 1GB storage | PostgreSQL + auth |
| **GitHub Actions** | 2,000 min/month | CI/CD |

---

## Data Model

### Core Tables

```sql
-- Government agencies that receive FOIA requests
CREATE TABLE agencies (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    abbreviation    TEXT,
    jurisdiction    TEXT NOT NULL,        -- 'federal', 'state:CA', etc.
    foia_portal_url TEXT,
    avg_response_days INTEGER,
    denial_rate     DECIMAL(5,2),
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

-- FOIA laws and regulations by jurisdiction
CREATE TABLE foia_laws (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    jurisdiction    TEXT NOT NULL,        -- 'federal', 'state:CA', etc.
    law_name        TEXT NOT NULL,        -- 'FOIA', 'CPRA', etc.
    statute_ref     TEXT,
    exemptions      JSONB,               -- structured exemption categories
    appeal_process  TEXT,
    time_limits     JSONB,               -- { initial_response: 20, appeal: 30 }
    content         TEXT,                 -- full text for semantic search
    embedding       vector(1536)         -- pgvector for semantic search
);

-- Users of the platform
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           TEXT UNIQUE NOT NULL,
    name            TEXT,
    organization    TEXT,
    role            TEXT DEFAULT 'requester',  -- requester, journalist, lawyer, admin
    created_at      TIMESTAMPTZ DEFAULT now()
);

-- FOIA requests (both imported from MuckRock and user-created)
CREATE TABLE requests (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID REFERENCES users(id),
    agency_id       UUID REFERENCES agencies(id),
    title           TEXT NOT NULL,
    request_text    TEXT NOT NULL,
    status          TEXT DEFAULT 'draft',  -- draft, submitted, processing,
                                           -- fulfilled, denied, appealed, litigated
    muckrock_id     INTEGER,              -- link to MuckRock if imported/filed there
    jurisdiction    TEXT,
    filed_date      DATE,
    due_date        DATE,
    source          TEXT DEFAULT 'user',   -- 'user', 'muckrock_import', 'generated'
    success_score   DECIMAL(3,2),          -- AI-predicted success probability
    embedding       vector(1536),          -- for finding similar requests
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

-- Communications (correspondence for a request)
CREATE TABLE communications (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id      UUID REFERENCES requests(id) ON DELETE CASCADE,
    direction       TEXT NOT NULL,         -- 'outgoing', 'incoming'
    subject         TEXT,
    body            TEXT NOT NULL,
    sent_date       TIMESTAMPTZ,
    sender          TEXT,
    attachments     JSONB,                -- [{filename, url, size}]
    comm_type       TEXT DEFAULT 'email', -- email, letter, portal_message
    created_at      TIMESTAMPTZ DEFAULT now()
);

-- Documents received or found
CREATE TABLE documents (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id      UUID REFERENCES requests(id),
    title           TEXT NOT NULL,
    source          TEXT,                  -- 'muckrock', 'documentcloud', 'data.gov', 'upload'
    source_url      TEXT,
    file_url        TEXT,
    file_type       TEXT,                  -- 'pdf', 'csv', 'doc', etc.
    page_count      INTEGER,
    has_redactions   BOOLEAN DEFAULT false,
    summary         TEXT,                  -- AI-generated summary
    embedding       vector(1536),
    created_at      TIMESTAMPTZ DEFAULT now()
);

-- Search cache to avoid redundant API calls
CREATE TABLE search_cache (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    query_hash      TEXT NOT NULL,
    source          TEXT NOT NULL,          -- 'muckrock', 'documentcloud', 'data.gov'
    results         JSONB NOT NULL,
    expires_at      TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT now()
);

-- Agency performance tracking
CREATE TABLE agency_metrics (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agency_id       UUID REFERENCES agencies(id),
    year            INTEGER NOT NULL,
    total_requests  INTEGER,
    fulfilled       INTEGER,
    denied          INTEGER,
    avg_days        INTEGER,
    common_exemptions JSONB,
    created_at      TIMESTAMPTZ DEFAULT now(),
    UNIQUE(agency_id, year)
);
```

### Entity Relationship Diagram

```
users 1──────< requests >──────1 agencies
                  |
                  |
          +-------+-------+
          |               |
    communications     documents

foia_laws (standalone, linked by jurisdiction)
agency_metrics >──────1 agencies
search_cache (standalone, TTL-based)
```

---

## API Integrations

### MuckRock API

**Base URL:** `https://www.muckrock.com/api_v1/`
**Auth:** Username/password credentials via `python-muckrock` client
**Key Endpoints:**

| Endpoint | Purpose | Usage |
|----------|---------|-------|
| `GET /foia/` | Search existing FOIA requests | Phase 1: find existing docs |
| `GET /agency/` | Look up agencies by name/jurisdiction | Phase 1 & 2: identify correct agency |
| `GET /foia/{id}/communications/` | Get correspondence for a request | Phase 3: import communication history |
| `GET /foia/{id}/files/` | Download documents from a request | Phase 1: retrieve found documents |
| `GET /jurisdiction/` | List jurisdictions | Phase 2: match to correct FOIA laws |
| `POST /foia/` | File a new FOIA request | Phase 2: submit requests via MuckRock |

**Integration pattern:**
```python
# app/services/muckrock.py
from muckrock import MuckRock

class MuckRockService:
    def __init__(self):
        self.client = MuckRock(
            username=settings.MUCKROCK_USERNAME,
            password=settings.MUCKROCK_PASSWORD
        )

    async def search_requests(self, query: str, agency: str = None) -> list[dict]:
        """Search existing FOIA requests on MuckRock."""
        params = {"q": query, "status": "done"}
        if agency:
            params["agency"] = agency
        return self.client.foia.get(**params)

    async def get_agency(self, name: str, jurisdiction: str = None) -> dict:
        """Find an agency by name and optional jurisdiction."""
        return self.client.agency.get(name=name, jurisdiction=jurisdiction)
```

### DocumentCloud API

**Base URL:** `https://api.www.documentcloud.org/api/`
**Auth:** Bearer token (free account)
**Key Endpoints:**

| Endpoint | Purpose |
|----------|---------|
| `GET /documents/search/?q=` | Full-text search across public documents |
| `GET /documents/{id}/` | Get document metadata |
| `GET /documents/{id}/pages/` | Get individual pages with OCR text |

### data.gov CKAN API

**Base URL:** `https://catalog.data.gov/api/3/`
**Auth:** None (public)
**Key Endpoints:**

| Endpoint | Purpose |
|----------|---------|
| `GET /action/package_search?q=` | Search datasets |
| `GET /action/package_show?id=` | Get dataset details |

---

## MCP Architecture

The Model Context Protocol (MCP) provides a standardized way for LLM clients to interact with external tools and data. FOIA Fluent uses MCP to expose its capabilities as tools that any MCP-compatible AI client (Claude Desktop, custom apps) can invoke.

### MCP Server Design

```
MCP Client (Claude Desktop, Web App, etc.)
        |
        | JSON-RPC over HTTP/SSE
        v
+-------+------------------+
|   MCP Server (FastAPI)   |
|                          |
|   Tools:                 |
|   - search_documents     |
|   - draft_request        |
|   - check_status         |
|   - analyze_response     |
|   - find_agency          |
|   - get_foia_law         |
|   - suggest_appeal       |
|                          |
|   Resources:             |
|   - foia://laws/{state}  |
|   - foia://agency/{id}   |
|   - foia://request/{id}  |
+-------+------------------+
        |
        v
   Internal Services
   (MuckRock, DocumentCloud, Supabase, Claude API)
```

### MCP Tool Definitions

```python
# app/mcp/tools.py

tools = [
    {
        "name": "search_documents",
        "description": "Search for existing FOIA documents and public records across "
                       "MuckRock, DocumentCloud, and data.gov",
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "What documents to search for"},
                "agency": {"type": "string", "description": "Optional: specific agency name"},
                "jurisdiction": {"type": "string", "description": "Optional: federal, or state code"},
                "date_range": {"type": "string", "description": "Optional: e.g. 2020-2024"}
            },
            "required": ["query"]
        }
    },
    {
        "name": "draft_request",
        "description": "Generate an optimized FOIA request letter for a specific agency "
                       "and document need, using state-specific laws and best practices",
        "inputSchema": {
            "type": "object",
            "properties": {
                "description": {"type": "string", "description": "What records are needed and why"},
                "agency": {"type": "string", "description": "Target agency name"},
                "jurisdiction": {"type": "string", "description": "federal or state code"}
            },
            "required": ["description", "agency"]
        }
    },
    {
        "name": "analyze_response",
        "description": "Analyze an agency response for completeness, improper redactions, "
                       "and potential grounds for appeal",
        "inputSchema": {
            "type": "object",
            "properties": {
                "response_text": {"type": "string", "description": "The agency's response letter text"},
                "original_request": {"type": "string", "description": "The original request text"},
                "jurisdiction": {"type": "string", "description": "federal or state code"}
            },
            "required": ["response_text"]
        }
    }
]
```

---

## State Law Engine

Every US state has its own public records law. The platform must treat jurisdiction as a first-class concept — not an afterthought. This section describes how multi-jurisdiction support works across the entire system.

### The Problem

| Dimension | Federal FOIA | NY FOIL | CA CPRA | TX PIA |
|-----------|-------------|---------|---------|--------|
| **Statute** | 5 U.S.C. 552 | Public Officers Law Art. 6 | Gov. Code 7920-7931 | Gov. Code Ch. 552 |
| **Response deadline** | 20 business days | 5 days to acknowledge, ~20 to respond | 10 days (+ 14 day extension) | 10 business days |
| **Exemptions** | 9 categories (b)(1)-(9) | 8 categories, narrower scope | Broad + catch-all balancing test | Narrow, AG decides disputes |
| **Appeal body** | Agency head, then OGIS, then court | COOG (Committee on Open Government) | Superior Court | Attorney General |
| **Fee structure** | Search + review + duplication | $0.25/page max | 10 cents/page, direct cost only | Cost of materials only |
| **Penalties** | None for non-compliance | Possible attorney fees | $1,000/day willful violation | Criminal misdemeanor possible |

Every one of these differences affects request drafting, deadline tracking, appeal generation, and success prediction.

### Data Architecture

The `foia_laws` table stores structured law data per jurisdiction:

```sql
-- Example seed data for NY FOIL
INSERT INTO foia_laws (jurisdiction, law_name, statute_ref, exemptions, appeal_process, time_limits, content)
VALUES (
    'state:NY',
    'Freedom of Information Law (FOIL)',
    'N.Y. Public Officers Law, Article 6, Sections 84-90',
    '{
        "categories": [
            {"code": "87(2)(a)", "name": "Trade secrets", "description": "Trade secrets or information maintained for regulation of commercial enterprise"},
            {"code": "87(2)(b)", "name": "Unwarranted invasion of privacy", "description": "Would constitute an unwarranted invasion of personal privacy"},
            {"code": "87(2)(e)", "name": "Law enforcement", "description": "Compiled for law enforcement purposes"},
            {"code": "87(2)(f)", "name": "Safety/security", "description": "Could endanger life or safety"},
            {"code": "87(2)(g)", "name": "Inter/intra-agency materials", "description": "Inter-agency or intra-agency materials except statistical data, instructions, or final policy"}
        ]
    }'::jsonb,
    'Administrative appeal to agency head within 30 days. Then appeal to COOG (Committee on Open Government) for advisory opinion. Then Article 78 proceeding in court.',
    '{"acknowledge": 5, "initial_response": 20, "appeal_deadline": 30, "unit": "business_days"}'::jsonb,
    'Full text of FOIL statute for semantic search...'
);
```

### Jurisdiction Resolution Flow

```
User selects or describes target agency
        |
        v
+-------+---------------+
| Jurisdiction Resolver  |
+-------+---------------+
        |
        +---> Is it a federal agency?  --> jurisdiction = 'federal'
        |     (match against federal agency list)
        |
        +---> Is it a state agency?    --> jurisdiction = 'state:{code}'
        |     (match state from agency name/address)
        |
        +---> Is it a local agency?    --> jurisdiction = 'state:{code}'
        |     (local agencies follow state law)
        |
        +---> Multi-jurisdiction?      --> return both applicable laws
              (e.g., state university with federal funding)
        |
        v
+-------+---------------+
| Law Lookup             |
| foia_laws WHERE        |
| jurisdiction = ?       |
+-------+---------------+
        |
        v
  Return: {
    law_name,         -- "FOIL" / "FOIA" / "CPRA"
    statute_ref,      -- exact statute citation
    exemptions,       -- structured exemption list
    time_limits,      -- deadlines for this jurisdiction
    appeal_process,   -- who to appeal to and how
    fee_rules         -- fee schedule and waiver eligibility
  }
```

### How Jurisdiction Flows Through Each Phase

```
PHASE 1 (Discovery)
  - Filter search results by jurisdiction
  - Show state-specific portals alongside MuckRock/DocumentCloud

PHASE 2 (Request Intelligence)
  - Cite correct statute (FOIA vs FOIL vs CPRA)
  - Apply jurisdiction-specific exemption avoidance
  - Use correct fee waiver language
  - Set proper deadline expectations

PHASE 3 (Response & Negotiation)
  - Track jurisdiction-specific deadlines (20 days federal vs 5+20 NY)
  - Route appeals to correct body (OGIS vs COOG vs AG vs court)
  - Validate exemptions against correct law
  - Generate jurisdiction-appropriate follow-up language

PHASE 4 (Beyond FOIA)
  - Suggest cross-jurisdiction filing (federal AND state for same records)
  - Recommend state-specific remedies (e.g., FL criminal penalties)

PHASE 5 (Data Hub)
  - Compare agency performance WITHIN jurisdiction
  - Track which state laws produce best outcomes
  - Identify jurisdictions with weakest/strongest enforcement
```

### Rollout Strategy

```
Wave 1 (MVP):     Federal FOIA + New York FOIL
                   - Two jurisdictions with very different rules
                   - Validates the multi-jurisdiction architecture works

Wave 2:           + California (CPRA) + Texas (PIA) + Florida (Sunshine)
                   - High-population states with active FOIA communities
                   - Covers ~40% of US population

Wave 3:           + 10 more states (IL, PA, OH, GA, NC, MI, NJ, VA, WA, MA)
                   - Prioritized by population + MuckRock request volume

Wave 4:           All 50 states + DC + territories
                   - Community-contributed law data with validation

Future:           International (UK FOI Act, Canada ATIA, EU transparency)
```

### Seeding the Law Database

Sources for structured law data:
- **Reporters Committee for Freedom of the Press** — maintains state-by-state guides
- **National Freedom of Information Coalition (NFOIC)** — state FOI resources
- **MuckRock jurisdiction data** — their API has jurisdiction metadata
- **State legislature websites** — primary statute text

The initial seed (federal + NY) will be manually curated for accuracy. Later states can be semi-automated: scrape statute text, use Claude to extract structured exemptions/deadlines/appeal processes, then human-verify before adding to production.

---

## Phase 1: Document Discovery

**Goal:** Before filing anything, find documents that already exist in the public domain.

### Architecture

```
User Query: "ICE detention facility inspection reports 2023"
        |
        v
+-------+--------+
| Search Router   |-----> Parallel queries to:
+-------+--------+
        |
   +----+----+----+----+
   |         |         |
   v         v         v
MuckRock  DocCloud  data.gov     Supabase
  API       API      API        (cached)
   |         |         |            |
   +----+----+----+----+----+------+
        |
        v
+-------+--------+
| Result Merger   |
| - Deduplicate   |
| - Rank by       |
|   relevance     |
| - Attach source |
|   metadata      |
+-------+--------+
        |
        v
  Return to user with:
  - Found documents (direct links)
  - Similar past requests (status, outcomes)
  - Recommendation: file new request or use existing
```

### Key Implementation Details

1. **Parallel API queries** using `asyncio.gather()` to search MuckRock, DocumentCloud, and data.gov simultaneously
2. **Result deduplication** by normalizing titles and matching on agency + date range + topic
3. **Relevance ranking** combining text similarity (TF-IDF or embedding cosine similarity) with recency and source authority
4. **Search caching** in Supabase with TTL (24-hour expiry) to reduce API calls
5. **Semantic search** using pgvector to find similar past requests in the local database

### API Endpoints

```
POST /api/v1/search
  Body: { query, agency?, jurisdiction?, date_range? }
  Returns: { results: [...], recommendation: "file_new" | "use_existing" }

GET  /api/v1/search/suggestions
  Query: ?q=partial+query
  Returns: { suggestions: [...] }
```

---

## Phase 2: Request Intelligence

**Goal:** Generate optimized, legally sound FOIA requests with high success probability.

### Architecture

```
User describes what they need
        |
        v
+-------+-----------+
| Agency Identifier  |----> Match to correct agency + jurisdiction
+-------+-----------+
        |
        v
+-------+-----------+
| Law Matcher        |----> Pull applicable FOIA statute, exemptions,
+-------+-----------+       time limits from foia_laws table
        |
        v
+-------+-----------+
| Similar Request    |----> Semantic search (pgvector) for past requests
| Finder             |      to same agency on similar topics
+-------+-----------+
        |
        v
+-------+-----------+
| Request Drafter    |----> Claude API generates optimized request text
| (Claude API)       |      using: law, agency profile, similar cases,
+-------+-----------+       best practice templates
        |
        v
+-------+-----------+
| Success Predictor  |----> Score based on: agency denial rate,
+-------+-----------+       exemption overlap, request specificity
        |
        v
  Return: {
    draft_text,
    success_score,
    suggested_modifications,
    applicable_law,
    similar_past_requests
  }
```

### Request Drafting Prompt Strategy (Implemented)

The drafting system uses a three-layer verified context approach to prevent hallucinated legal citations:

1. **Verified Legal Context** — actual text of 5 U.S.C. § 552 sections (request rights, time limits, fee waivers, expedited processing, all 9 exemptions) embedded in `backend/app/data/federal_foia_statute.py`
2. **Verified Agency Info** — FOIA portal URLs, email addresses, CFR regulation citations, and submission procedures from foia.gov, stored in `backend/app/data/federal_agencies.py`
3. **MuckRock Outcome Intelligence** — two parallel research agents (Topic Agent + Agency Intel Agent) search MuckRock via Tavily for similar requests and agency-wide FOIA patterns

The Claude prompt explicitly instructs: "You may ONLY cite statutes and regulations provided in the VERIFIED LEGAL CONTEXT below. Do NOT cite any statute, regulation, case law, or legal authority from your training data."

Claude outputs structured JSON including the letter text, a `drafting_strategy` object explaining its reasoning (what it learned from successes, what denial patterns it avoided, scope decisions, exemption risk mitigation), and submission instructions.

### Success Prediction Model (Deferred)

A lightweight scoring model is planned but deferred until real outcome data is available via Supabase:

```
Score = weighted average of:
  - Agency historical fulfillment rate (30%)
  - Request specificity score (25%)       # narrow > broad
  - Exemption overlap risk (20%)          # does the topic hit known exemptions?
  - Similar request outcomes (15%)        # how did similar requests fare?
  - Jurisdiction strength (10%)           # federal FOIA vs weak state laws
```

Currently, the `drafting_strategy` output provides qualitative reasoning about these factors instead of a numeric score, avoiding false precision from incomplete data.

---

## Phase 3: Response & Negotiation

**Goal:** Track agency responses, detect issues, and guide users through appeals.

### Communication Timeline Tracking

```
Request Filed (Day 0)
    |
    v
[20 business days — federal FOIA statutory deadline]
    |
    +---> No response? --> Generate follow-up letter
    |                      referencing statute deadline
    v
Response Received
    |
    +---> Fulfilled       --> Document analysis, summary
    +---> Partial         --> Identify missing records, draft narrowed follow-up
    +---> Denied          --> Exemption analysis, appeal recommendation
    +---> Fee estimate    --> Draft fee waiver or negotiate scope
    +---> "No records"    --> Suggest alternative agencies or record descriptions
```

### Redaction Detection

When documents are received as PDFs:

1. **Text layer analysis** — compare visible text to OCR text; discrepancies indicate redactions
2. **Black rectangle detection** — image processing to identify blacked-out regions
3. **Exemption validation** — cross-reference cited exemptions with the FOIA law to check if they're properly applied
4. **Glomar response detection** — identify "neither confirm nor deny" responses

```python
async def analyze_response(response_text: str, original_request: str,
                           jurisdiction: str) -> ResponseAnalysis:
    law = await get_foia_law(jurisdiction)

    analysis = await anthropic_client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=2000,
        messages=[{"role": "user", "content": f"""
Analyze this FOIA response for issues:

ORIGINAL REQUEST: {original_request}
AGENCY RESPONSE: {response_text}
APPLICABLE LAW: {law.law_name}
VALID EXEMPTIONS: {json.dumps(law.exemptions)}

Identify:
1. Are cited exemptions properly applied?
2. Is the response complete relative to the request?
3. Are there grounds for appeal?
4. Recommended next steps.
"""}]
    )
    return parse_analysis(analysis)
```

### Appeal Generation

```
Denied Response
    |
    v
+---+---+
| Appeal |
| Engine |
+---+---+
    |
    +---> Administrative appeal (draft letter to agency head)
    +---> OGIS mediation referral (federal)
    +---> State equivalent referral
    +---> Litigation pathway info (link to legal resources)
```

---

## Phase 4: Beyond FOIA

**Goal:** When FOIA fails or is blocked, surface alternative pathways to the information.

### Alternative Pathways Engine

```python
ALTERNATIVE_PATHWAYS = {
    "congressional_inquiry": {
        "description": "Request through your congressional representative",
        "when": "Agency is unresponsive or stonewalling",
        "template": "congressional_inquiry_template.md"
    },
    "state_equivalent": {
        "description": "Use state public records law instead of federal FOIA",
        "when": "Records may be held at state level",
        "lookup": "foia_laws table filtered by state"
    },
    "inspector_general": {
        "description": "File complaint with the agency's Inspector General",
        "when": "Suspected misconduct in records handling",
        "resources": ["oversight.gov"]
    },
    "reading_room": {
        "description": "Check agency's electronic reading room",
        "when": "Records may be proactively disclosed",
        "lookup": "agencies.foia_portal_url"
    },
    "journalist_network": {
        "description": "Connect with journalists who've filed similar requests",
        "when": "Multiple requesters seeking same records",
        "source": "MuckRock user data for similar requests"
    }
}
```

### Pathway Recommendation

Given a blocked request, the system scores each alternative pathway based on:
- Agency type and history
- Record type requested
- Jurisdiction
- Reason for denial/delay

---

## Phase 5: Data Hub

**Goal:** Aggregate transparency metrics across all requests to expose patterns and inform future requests.

### Dashboard Metrics

```
+------------------------------------------------------------------+
|  FOIA TRANSPARENCY DASHBOARD                                     |
|                                                                  |
|  Agency Leaderboard          Response Time Trends                |
|  +-----------------------+  +-----------------------------+      |
|  | Agency    | Rate | Avg|  |  Days                       |      |
|  |-----------|------|----+  |  60|        ___              |      |
|  | EPA       | 72%  | 28d|  |  40|   ___/   \___          |      |
|  | DOJ       | 45%  | 89d|  |  20|__/           \___      |      |
|  | DHS       | 38%  |142d|  |    +--+--+--+--+--+--+--+   |      |
|  | ICE       | 31%  |186d|  |    J  F  M  A  M  J  J      |      |
|  +-----------------------+  +-----------------------------+      |
|                                                                  |
|  Top Exemptions Used         Your Requests                       |
|  +-----------------------+  +-----------------------------+      |
|  | (b)(6) Privacy  42%   |  | 3 fulfilled                 |      |
|  | (b)(7) Law Enf  28%   |  | 1 pending (day 34 of 20)    |      |
|  | (b)(5) Deliber  18%   |  | 1 denied -> appeal drafted  |      |
|  +-----------------------+  +-----------------------------+      |
+------------------------------------------------------------------+
```

### Data Pipeline

```
Incoming data sources:
  - User request outcomes (direct)
  - MuckRock bulk data (periodic sync)
  - Agency annual FOIA reports (manual + scraping)
        |
        v
+-------+--------+
| ETL Pipeline    |
| (scheduled job) |
+-------+--------+
        |
        v
agency_metrics table
        |
        v
+-------+--------+
| Analytics API   |
+-------+--------+
        |
        v
Dashboard (Next.js + chart library)
```

### API Endpoints

```
GET /api/v1/analytics/agencies
  Query: ?jurisdiction=federal&sort=denial_rate
  Returns: ranked agency list with metrics

GET /api/v1/analytics/agencies/{id}/trends
  Returns: monthly metrics over time

GET /api/v1/analytics/exemptions
  Query: ?agency_id=...
  Returns: exemption usage breakdown

GET /api/v1/analytics/user/summary
  Returns: current user's request outcomes
```

---

## Deployment Strategy

### Environment Setup

```
Development:
  - Local FastAPI server (uvicorn)
  - Supabase cloud project (free tier) — shared dev DB
  - Next.js dev server
  - .env file for API keys

Staging:
  - Railway (FastAPI) + Vercel (Next.js) + Supabase
  - GitHub Actions deploys on push to `staging` branch

Production:
  - Same stack, separate Supabase project
  - GitHub Actions deploys on push to `main`
```

### Project Structure

```
foia-fluent/
├── backend/
│   ├── app/
│   │   ├── main.py                 # FastAPI app entry point
│   │   ├── config.py               # Settings (env vars)
│   │   ├── models/                 # Pydantic models
│   │   │   ├── request.py
│   │   │   ├── agency.py
│   │   │   ├── communication.py
│   │   │   └── document.py
│   │   ├── services/               # Business logic
│   │   │   ├── muckrock.py         # MuckRock API client
│   │   │   ├── documentcloud.py    # DocumentCloud API client
│   │   │   ├── datagov.py          # data.gov API client
│   │   │   ├── search.py           # Unified search orchestrator
│   │   │   ├── drafter.py          # Request drafting (Claude API)
│   │   │   ├── analyzer.py         # Response analysis
│   │   │   └── predictor.py        # Success prediction
│   │   ├── mcp/                    # MCP protocol implementation
│   │   │   ├── server.py           # MCP server setup
│   │   │   ├── tools.py            # Tool definitions
│   │   │   └── resources.py        # Resource definitions
│   │   ├── routes/                 # API endpoints
│   │   │   ├── search.py
│   │   │   ├── requests.py
│   │   │   ├── analytics.py
│   │   │   └── auth.py
│   │   └── db/
│   │       ├── supabase.py         # Supabase client
│   │       └── migrations/         # SQL migration files
│   ├── tests/
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── app/                    # Next.js app router
│   │   ├── components/
│   │   └── lib/
│   ├── package.json
│   └── next.config.js
├── docs/
│   └── implementation_strategy.md
├── README.md
└── .github/
    └── workflows/
        ├── backend.yml
        └── frontend.yml
```

### Cost Estimate (Monthly)

| Service | Tier | Cost |
|---------|------|------|
| Supabase | Free | $0 |
| Railway | Hobby ($5 credit) | $0-5 |
| Vercel | Free | $0 |
| Claude API | Pay-as-you-go | ~$5-20 (depends on usage) |
| GitHub | Free | $0 |
| **Total** | | **$5-25/month** |

---

## Development Roadmap

### Milestone 1: Foundation ✅

- [x] Set up monorepo structure (backend + frontend)
- [x] FastAPI skeleton with health check, config, CORS
- [x] MuckRock API client with search endpoint
- [x] Basic Next.js frontend with search input and results display
- [ ] Supabase project + initial schema migration *(deferred — using local JSON cache for MVP)*
- [ ] Deploy to Railway + Vercel

**Deliverable:** User can search MuckRock for existing FOIA requests from the web UI.

### Milestone 2: Multi-Source Discovery ✅

- [x] DocumentCloud API integration
- [x] Tavily-powered web search integration *(replaced data.gov direct integration)*
- [x] Parallel search orchestrator (`asyncio.gather` across all sources)
- [x] Result deduplication and ranking
- [x] Claude-powered query interpretation (intent summaries, agency/record type identification)
- [x] Animated progress stepper UI
- [ ] Search caching in Supabase *(deferred — no database yet)*
- [ ] Semantic search setup (pgvector + embeddings) *(deferred — no database yet)*

**Deliverable:** Unified search across MuckRock, DocumentCloud, and web with Claude-powered query understanding and smart recommendations.

### Milestone 3: Request Intelligence ✅

- [x] Federal agency database (20+ agencies with verified FOIA info from foia.gov)
- [x] FOIA statute text embedded as verified context (5 U.S.C. § 552, all 9 exemptions)
- [x] Claude API integration for request drafting with anti-hallucination safeguards
- [x] MuckRock similar request finder (topic-specific via Tavily)
- [x] Agency Intel Agent (agency-wide FOIA pattern research — denials, successes, exemptions)
- [x] Parallel research agents running via `asyncio.gather`
- [x] Persistent agency intelligence cache (JSON, 24h TTL, atomic writes)
- [x] Request drafting UI (multi-step wizard: agency confirmation → details → draft review)
- [x] AI interpretability ("How We Built This Draft" with reasoning transparency)
- [ ] State Law Engine: seed New York FOIL *(deferred — federal FOIA only for now)*
- [ ] Jurisdiction resolver (map agency → correct law) *(deferred)*
- [ ] Success prediction scoring *(deferred — insufficient data for reliable scores)*

**Deliverable:** User describes what they need, gets an optimized FOIA request letter drafted from verified legal context and MuckRock outcome intelligence.

### Milestone 4: Response Tracking 🔧 *(In Progress)*

- [ ] JSON-based request persistence (local store, Supabase migration path)
- [ ] Request lifecycle tracking (draft → submitted → awaiting → fulfilled/denied)
- [ ] Deadline calculator (20 business days, federal holidays)
- [ ] Communication timeline logging
- [ ] Claude-powered response analysis (completeness, exemption validity, appeal grounds)
- [ ] Follow-up letter generation (overdue requests)
- [ ] Appeal letter generation (denied requests)
- [ ] Request dashboard page (status overview, deadline countdowns)
- [ ] Request detail page (timeline, actions, analysis)
- [ ] Navigation between search/draft and request tracking

**Deliverable:** Full request lifecycle management from draft to resolution.

### Milestone 5: Beyond FOIA + Data Hub

- [ ] Alternative pathway recommendations
- [ ] Agency analytics dashboard
- [ ] Exemption pattern analysis
- [ ] Bulk MuckRock data sync for metrics
- [ ] User request history and outcomes
- [ ] Public transparency leaderboard

**Deliverable:** Complete platform with analytics and alternative pathways.

### Milestone 6: State Expansion

- [ ] Add New York FOIL, California CPRA, Texas PIA, Florida Sunshine Law
- [ ] Semi-automated law seeding pipeline (scrape + Claude extraction + human review)
- [ ] State-specific agency databases
- [ ] Jurisdiction comparison in Data Hub (which states are most/least transparent)
- [ ] Cross-jurisdiction filing suggestions (file federal AND state simultaneously)

**Deliverable:** Platform covers ~40% of US population across 5 jurisdictions.

### Milestone 7: Infrastructure + Polish

- [ ] Supabase migration (PostgreSQL + pgvector for semantic search)
- [ ] Authentication and user management (Supabase Auth)
- [ ] MCP server implementation (tool + resource definitions)
- [ ] Success prediction model (rule-based, backed by real outcome data)
- [ ] Rate limiting and error handling
- [ ] Deploy to Railway + Vercel
- [ ] Documentation and onboarding flow

**Deliverable:** Production-ready platform with persistent storage and MCP support.
