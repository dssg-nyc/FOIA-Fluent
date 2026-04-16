# FOIA Fluent — Chat Assistant Architecture

A complete technical reference for the AI chat assistant that appears on every page of FOIA Fluent. Covers the 4-tier accuracy system, 11 tool definitions, SSE streaming, page-aware context, anti-hallucination safeguards, and the full data flow from browser to Claude and back.

Every file path links to the GitHub source at https://github.com/dssg-nyc/FOIA-Fluent.

---

## 1. Overview

The chat assistant is a floating sidebar panel available on every page of FOIA Fluent. It uses Claude (Haiku 4.5 by default, auto-escalating to Sonnet 4 when needed) with 11 tools that give it read-only access to the user's FOIA requests, saved discoveries, live signals, agency transparency data, FOIA law, and the open web.

```
┌─────────────────────────────────────────────────────────────┐
│                     FOIA Fluent (any page)                   │
│                                                             │
│  ┌─────────────────────────────────┐  ┌──────────────────┐ │
│  │                                 │  │  Chat Assistant   │ │
│  │    Main page content            │  │  ──────────────── │ │
│  │    (hub, draft, requests,       │  │  [message]        │ │
│  │     signals, discoveries)       │  │  [message]        │ │
│  │                                 │  │  [typing...]      │ │
│  │                                 │  │                   │ │
│  │                                 │  │  ┌─────────────┐  │ │
│  │                                 │  │  │ Type here... │  │ │
│  │                                 │  │  └─────────────┘  │ │
│  └─────────────────────────────────┘  └──────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

**Key properties:**
- Available on every page (rendered in the root layout)
- Toggled with Cmd+K / Ctrl+K or clicking the chat icon
- Streams responses in real-time via Server-Sent Events (SSE)
- Knows which page the user is on and adapts guidance accordingly
- READ-ONLY: cannot create, modify, or delete any user data
- 11 tools with access to 6 Supabase tables + 2 external APIs (Tavily, MuckRock)

---

## 2. The 4-Tier Accuracy System

The chat uses a tiered lookup pattern that starts with the cheapest/fastest data source and escalates only when needed:

```
                  USER QUESTION
                       │
                       ▼
              ┌─────────────────┐
              │   TIER 1        │
              │   Local Lookup  │    Cost: ~$0.003
              │                 │    Model: Haiku
              │   Hardcoded     │    Latency: ~1s
              │   exemptions,   │
              │   Supabase      │    7 tools:
              │   queries       │    lookup_exemption, lookup_agency,
              │                 │    search_requests, get_request_detail,
              │                 │    get_hub_stats, search_my_discoveries,
              └────────┬────────┘    get_recent_signals
                       │
              (if local data insufficient)
                       │
                       ▼
              ┌─────────────────┐
              │   TIER 2        │
              │   Trusted       │    Cost: ~$0.006
              │   Web Search    │    Model: Haiku
              │                 │    Latency: ~3s
              │   Tavily API    │
              │   scoped to 8   │    1 tool: search_web
              │   FOIA domains  │    Domains: justice.gov, foia.gov,
              │                 │    muckrock.com, rcfp.org, eff.org,
              └────────┬────────┘    congress.gov, law.cornell.edu, govinfo.gov
                       │
              (if trusted search returns 0 results)
                       │
                       ▼
              ┌─────────────────┐
              │   TIER 3        │
              │   Broad Search  │    Cost: ~$0.042
              │   + Model       │    Model: SONNET (upgraded)
              │   Upgrade       │    Latency: ~8s
              │                 │
              │   Tavily API    │    2 tools: search_web_broad,
              │   unrestricted  │    search_muckrock
              │   + Sonnet 4    │
              └────────┬────────┘
                       │
              (if still nothing useful)
                       │
                       ▼
              ┌─────────────────┐
              │   TIER 4        │
              │   Graceful      │    Cost: $0 (no new API call)
              │   Fallback      │
              │                 │    Response: "I don't have a verified
              │   Admits        │    answer, but you can check:"
              │   uncertainty,  │    - foia.gov
              │   provides      │    - rcfp.org/open-government-guide
              │   resource      │    - muckrock.com/about/muckrock-101
              │   links         │    - justice.gov/oip/doj-guide-...
              └─────────────────┘    - eff.org/issues/transparency
```

The auto-escalation from Tier 2 to Tier 3 is implemented in [backend/app/services/chat.py, lines 422-428](https://github.com/dssg-nyc/FOIA-Fluent/blob/main/backend/app/services/chat.py#L422-L428):

```python
# If trusted search returned nothing, escalate to Tier 3
if tool_name == "search_web" and not result_data.get("results"):
    model = "claude-sonnet-4-20250514"  # Upgrade model
    result_str = await execute_tool("search_web_broad", tool_input, user_id)
```

---

## 3. System Prompt Architecture

The system prompt is built dynamically by [`build_system_prompt()`](https://github.com/dssg-nyc/FOIA-Fluent/blob/main/backend/app/services/chat.py#L208) and contains 8 sections:

| Section | What it contains | Lines |
|---|---|---|
| **Platform Guide** | Explains FOIA Fluent's 3 features (Discover & Draft, My Requests, Transparency Hub) with exact URLs and guidance on when to direct users to each | 216-250 |
| **Communication Style** | Plain English, short answers (2-4 sentences), no legal jargon unless user uses it first, lead with practical answer | 251-259 |
| **Accuracy Rules** | 5 rules: never guess, cite sources briefly, tiered lookup, read-only, one response per question | 260-275 |
| **FOIA Statute Text** | First 200 chars of each section from the verified 5 U.S.C. 552 statute (loaded from [`federal_foia_statute.py`](https://github.com/dssg-nyc/FOIA-Fluent/blob/main/backend/app/data/federal_foia_statute.py)) | 276-277 |
| **Exemption Quick Reference** | One-line summary of all 9 FOIA exemptions (1-9, 7A-7F) | 279-283 |
| **Key Deadlines** | 20 business days, 10-day extension, appeal deadlines from statute | 285-289 |
| **Page-Specific Context** | Dynamic section that changes based on which page the user is on (draft, request_detail, dashboard, hub/states/insights) | 292-305 |
| **Fallback Resources** | 5 external URLs for when all tools fail | 307-316 |

### Page-Specific Context

The chat knows which page the user is on because the frontend passes a `context` object with every message:

```
Page the user is on          Context sent          Chat behavior
─────────────────────        ──────────────        ──────────────────────
/draft                       {page: "draft"}       "You're actively working on a FOIA request.
                                                    Help them describe records clearly, pick the
                                                    right agency, and refine scope."

/requests/{id}               {page:                "You're viewing a tracked request. Help them
                              "request_detail",      understand an agency response, decide whether
                              request_id: "..."}     to appeal, or write a follow-up."

/dashboard                   {page: "dashboard"}   "You're managing tracked FOIA requests.
                                                    Help with statuses, deadlines, next steps."

/hub, /hub/states,           {page: "hub"}         "You're browsing the Transparency Hub.
/hub/insights                                       Help understand data, scores, trends."
```

---

## 4. Tool Definitions (11 tools)

Every tool is defined as a JSON schema in the [`TOOLS`](https://github.com/dssg-nyc/FOIA-Fluent/blob/main/backend/app/services/chat.py#L25) array and implemented as a function in [`chat_tools.py`](https://github.com/dssg-nyc/FOIA-Fluent/blob/main/backend/app/services/chat_tools.py).

| # | Tool Name | What It Does | Data Source | Tier |
|---|---|---|---|---|
| 1 | [`lookup_exemption`](https://github.com/dssg-nyc/FOIA-Fluent/blob/main/backend/app/services/chat_tools.py#L46) | Look up a FOIA exemption by number (1-9, 7A-7F) | Hardcoded `EXEMPTIONS` dict (verified, zero API calls) | 1 |
| 2 | [`lookup_agency`](https://github.com/dssg-nyc/FOIA-Fluent/blob/main/backend/app/services/chat_tools.py#L65) | Agency profile + transparency stats | Supabase: `agency_profiles`, `agency_stats_cache` | 1 |
| 3 | [`search_web`](https://github.com/dssg-nyc/FOIA-Fluent/blob/main/backend/app/services/chat_tools.py#L122) | Search trusted FOIA domains | Tavily API (8 whitelisted domains) | 2 |
| 4 | [`search_web_broad`](https://github.com/dssg-nyc/FOIA-Fluent/blob/main/backend/app/services/chat_tools.py#L163) | Unrestricted web search (fallback) | Tavily API (no domain restriction) | 3 |
| 5 | [`search_requests`](https://github.com/dssg-nyc/FOIA-Fluent/blob/main/backend/app/services/chat_tools.py#L170) | List/search user's tracked FOIA requests | Supabase: `tracked_requests` (RLS-scoped) | 1 |
| 6 | [`get_request_detail`](https://github.com/dssg-nyc/FOIA-Fluent/blob/main/backend/app/services/chat_tools.py#L232) | Full details of one tracked request | Supabase: `tracked_requests`, `communications`, `response_analyses` | 1 |
| 7 | [`get_hub_stats`](https://github.com/dssg-nyc/FOIA-Fluent/blob/main/backend/app/services/chat_tools.py#L284) | Transparency stats from the Data Hub | Supabase: `agency_stats_cache` | 1 |
| 8 | [`search_muckrock`](https://github.com/dssg-nyc/FOIA-Fluent/blob/main/backend/app/services/chat_tools.py#L326) | Search MuckRock for similar FOIA requests | Tavily API (site:muckrock.com) | 3 |
| 9 | [`search_my_discoveries`](https://github.com/dssg-nyc/FOIA-Fluent/blob/main/backend/app/services/chat_tools.py#L333) | Search user's saved discoveries library | Supabase: `discovered_documents` (RLS-scoped) | 1 |
| 10 | [`read_saved_document`](https://github.com/dssg-nyc/FOIA-Fluent/blob/main/backend/app/services/chat_tools.py#L373) | Fetch one saved document's full content | Supabase + Tavily extract (fetches URL text live) | 1+ext |
| 11 | [`get_recent_signals`](https://github.com/dssg-nyc/FOIA-Fluent/blob/main/backend/app/services/chat_tools.py#L399) | Recent items from Live FOIA Signals feed | Supabase: `foia_signals_feed` | 1 |

### How Claude decides which tool to call

Claude reads the user's question + the system prompt (which describes all 11 tools) and decides which tool(s) to call. This is native Claude tool-use (function calling), not hardcoded routing. The system prompt's "Tiered lookup" rule guides Claude to try local tools first, then web search, then broad search. But Claude can skip tiers or use multiple tools in parallel if the question warrants it.

---

## 5. Frontend Components

### [`ChatPanel.tsx`](https://github.com/dssg-nyc/FOIA-Fluent/blob/main/frontend/src/components/ChatPanel.tsx)

The floating chat sidebar component, rendered in the root layout so it's available on every page.

**State management:**
- `open`: whether the panel is visible (Cmd+K to toggle)
- `messages`: array of `{role, content}` objects (conversation history)
- `input`: the user's current typed message
- `streaming`: whether a response is in-flight
- `thinking`: whether Claude is processing (shows "Thinking..." indicator)
- `toolStatus`: friendly label for the current tool being executed

**Page context detection:**
```typescript
function getPageContext(pathname: string): ChatContext {
  if (pathname === "/draft")                    return { page: "draft" };
  if (pathname.startsWith("/requests/"))        return { page: "request_detail", request_id: ... };
  if (pathname.startsWith("/hub/insights"))     return { page: "insights" };
  if (pathname.startsWith("/hub/states"))       return { page: "states" };
  if (pathname.startsWith("/hub"))              return { page: "hub" };
  if (pathname.startsWith("/dashboard"))        return { page: "dashboard" };
  return { page: "general" };
}
```

**Markdown rendering:** Parses `**bold**`, `[link](url)`, `` `code` ``, bullet points, and extracts source citations into clickable chips at the bottom of each message. FOIA statute references link to Cornell Law.

### [`chat-api.ts`](https://github.com/dssg-nyc/FOIA-Fluent/blob/main/frontend/src/lib/chat-api.ts)

The SSE streaming client. Uses `fetch()` with `response.body.getReader()` to consume the stream incrementally.

```
Browser                              Railway (FastAPI)
   │                                       │
   │  POST /api/v1/chat                    │
   │  Body: {messages, context}            │
   │  Headers: Authorization: Bearer JWT   │
   │  ─────────────────────────────────>   │
   │                                       │
   │  SSE stream (text/event-stream)       │
   │  <─────────────────────────────────   │
   │                                       │
   │  data: {"type":"text","content":"The  │
   │  data: {"type":"text","content":" EP  │
   │  data: {"type":"tool_call","name":... │
   │  data: {"type":"tool_call","status":. │
   │  data: {"type":"text","content":"Bas  │
   │  data: {"type":"done"}                │
   │                                       │
```

**SSE event types:**
- `{"type": "text", "content": "..."}` — streamed assistant text (can be many of these)
- `{"type": "tool_call", "name": "...", "status": "running"}` — tool execution started
- `{"type": "tool_call", "name": "...", "status": "done"}` — tool execution finished
- `{"type": "done"}` — stream complete

---

## 6. Backend Orchestrator

### [`chat.py`](https://github.com/dssg-nyc/FOIA-Fluent/blob/main/backend/app/services/chat.py)

The core `stream_chat()` function (lines 371-446) implements a tool-use loop:

```
stream_chat(messages, context, user_id)
  │
  │  model = "claude-haiku-4-5"     ← Start with the fast/cheap model
  │  max_iterations = 5              ← Max tool-use rounds before stopping
  │
  │  for iteration in range(5):
  │    │
  │    │  response = claude.messages.create(
  │    │    model=model,
  │    │    system=system_prompt,
  │    │    tools=TOOLS,              ← 11 tool definitions
  │    │    messages=claude_messages   ← Full conversation history
  │    │  )
  │    │
  │    │  for block in response.content:
  │    │    │
  │    │    ├─ if text block:
  │    │    │    yield SSE {"type": "text", "content": block.text}
  │    │    │
  │    │    └─ if tool_use block:
  │    │         yield SSE {"type": "tool_call", "status": "running"}
  │    │         result = execute_tool(tool_name, args, user_id)
  │    │         │
  │    │         ├─ if search_web returned empty:
  │    │         │    AUTO-ESCALATE: model → Sonnet, run search_web_broad
  │    │         │
  │    │         yield SSE {"type": "tool_call", "status": "done"}
  │    │         append tool result to messages
  │    │
  │    │  if no tool_use blocks: break  ← Claude is done, stop looping
  │    │  else: continue loop           ← Claude wants to call more tools
  │
  │  yield SSE {"type": "done"}
```

### [`chat_tools.py`](https://github.com/dssg-nyc/FOIA-Fluent/blob/main/backend/app/services/chat_tools.py)

All 11 tool implementations live here. Every tool that accesses user data takes `user_id` as a parameter and scopes all queries to that user. The `_get_supabase()` helper (line 37) creates a Supabase client with the service key for server-side queries.

---

## 7. Auth Integration

```
Browser                  FastAPI                        Supabase
  │                        │                              │
  │  User signs in via     │                              │
  │  Supabase Auth (OTP)   │                              │
  │  ─────────────────────>│                              │
  │                        │                              │
  │  Receives JWT token    │                              │
  │  <─────────────────────│                              │
  │                        │                              │
  │  POST /api/v1/chat     │                              │
  │  Authorization: Bearer │                              │
  │  {JWT}                 │                              │
  │  ─────────────────────>│                              │
  │                        │                              │
  │                        │  auth.py validates JWT       │
  │                        │  (HS256 or RS256/JWKS)       │
  │                        │  extracts user_id from       │
  │                        │  "sub" claim                 │
  │                        │                              │
  │                        │  Passes user_id to           │
  │                        │  stream_chat() → tools       │
  │                        │                              │
  │                        │  Tools query Supabase        │
  │                        │  with user_id filter         │
  │                        │  ──────────────────────────> │
  │                        │                              │
  │                        │  RLS enforces at DB level    │
  │                        │  (defense-in-depth)          │
  │                        │  <────────────────────────── │
```

[`middleware/auth.py`](https://github.com/dssg-nyc/FOIA-Fluent/blob/main/backend/app/middleware/auth.py) handles JWT validation. In local dev (no Supabase configured), it returns a fixed dev user ID so the app works without authentication.

---

## 8. Anti-Hallucination Safeguards

| # | Safeguard | Where | How |
|---|---|---|---|
| 1 | **Hardcoded exemption data** | [`chat_tools.py`, lines 19-34](https://github.com/dssg-nyc/FOIA-Fluent/blob/main/backend/app/services/chat_tools.py#L19-L34) | EXEMPTIONS dict is verified legal text, never queries an external API |
| 2 | **Whitelisted web search** | [`chat_tools.py`, line 137](https://github.com/dssg-nyc/FOIA-Fluent/blob/main/backend/app/services/chat_tools.py#L137) | Trusted-only mode restricts Tavily to 8 authoritative FOIA domains |
| 3 | **"Never guess" system prompt rule** | [`chat.py`, line 262](https://github.com/dssg-nyc/FOIA-Fluent/blob/main/backend/app/services/chat.py#L262) | "Every fact must come from a tool result or the verified statute" |
| 4 | **Tiered escalation** | [`chat.py`, lines 266-270](https://github.com/dssg-nyc/FOIA-Fluent/blob/main/backend/app/services/chat.py#L266-L270) | Verified statute -> trusted web -> broad web -> fallback resources |
| 5 | **User data isolation** | [`chat_tools.py`](https://github.com/dssg-nyc/FOIA-Fluent/blob/main/backend/app/services/chat_tools.py) (all user-scoped tools) | Every user-specific tool filters by `user_id` from JWT |
| 6 | **Read-only constraint** | [`chat.py`, line 272](https://github.com/dssg-nyc/FOIA-Fluent/blob/main/backend/app/services/chat.py#L272) | System prompt explicitly states "You cannot create, modify, or delete any user data" |
| 7 | **Citation rules** | [`chat.py`, lines 262-264](https://github.com/dssg-nyc/FOIA-Fluent/blob/main/backend/app/services/chat.py#L262-L264) | "Cite sources briefly at end" — forces Claude to attribute every claim |

---

## 9. File Map

| Layer | File | Purpose |
|---|---|---|
| Frontend | [`frontend/src/components/ChatPanel.tsx`](https://github.com/dssg-nyc/FOIA-Fluent/blob/main/frontend/src/components/ChatPanel.tsx) | Chat sidebar UI, SSE consumer, page context, markdown renderer |
| Frontend | [`frontend/src/lib/chat-api.ts`](https://github.com/dssg-nyc/FOIA-Fluent/blob/main/frontend/src/lib/chat-api.ts) | `streamChat()` async generator, fetch + SSE parsing |
| Frontend | [`frontend/src/app/layout.tsx`](https://github.com/dssg-nyc/FOIA-Fluent/blob/main/frontend/src/app/layout.tsx) | Root layout that renders `<ChatPanel />` on every page |
| Backend | [`backend/app/routes/chat.py`](https://github.com/dssg-nyc/FOIA-Fluent/blob/main/backend/app/routes/chat.py) | `POST /api/v1/chat` endpoint, JWT extraction, StreamingResponse |
| Backend | [`backend/app/services/chat.py`](https://github.com/dssg-nyc/FOIA-Fluent/blob/main/backend/app/services/chat.py) | `stream_chat()` orchestrator, `build_system_prompt()`, `execute_tool()`, TOOLS array |
| Backend | [`backend/app/services/chat_tools.py`](https://github.com/dssg-nyc/FOIA-Fluent/blob/main/backend/app/services/chat_tools.py) | 11 tool function implementations |
| Backend | [`backend/app/models/chat.py`](https://github.com/dssg-nyc/FOIA-Fluent/blob/main/backend/app/models/chat.py) | Pydantic models: `ChatMessage`, `ChatContext`, `ChatRequest` |
| Backend | [`backend/app/middleware/auth.py`](https://github.com/dssg-nyc/FOIA-Fluent/blob/main/backend/app/middleware/auth.py) | JWT validation (HS256 + RS256/JWKS), `get_current_user_id()` |
| Backend | [`backend/app/data/federal_foia_statute.py`](https://github.com/dssg-nyc/FOIA-Fluent/blob/main/backend/app/data/federal_foia_statute.py) | Verified FOIA statute text embedded in system prompt |
| Config | [`backend/app/config.py`](https://github.com/dssg-nyc/FOIA-Fluent/blob/main/backend/app/config.py) | `Settings` class reading env vars (API keys, Supabase URL, etc.) |

---

## 10. Cost Profile

| Scenario | Claude calls | Model | Approx cost |
|---|---|---|---|
| Simple lookup (exemption, agency stats) | 1 round | Haiku | $0.003 |
| Typical message (1 tool call) | 2 rounds | Haiku | $0.007 |
| Tool-heavy message (3 tool calls) | 4 rounds | Haiku | $0.014 |
| Escalated message (trusted search empty, broad search + Sonnet) | 5 rounds | Haiku + Sonnet | $0.042 |

**Average cost per chat message: ~$0.007.** See [docs/cost-analysis.md](https://github.com/dssg-nyc/FOIA-Fluent/blob/main/docs/cost-analysis.md) for full token-level breakdown.
