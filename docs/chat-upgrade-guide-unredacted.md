# UNREDACTED Chatbot Upgrade Guide

An actionable implementation guide for upgrading the UNREDACTED chatbot from its current query-response agent panel to a full conversational AI assistant with tool use, streaming, page awareness, and anti-hallucination safeguards.

This document is designed to be read end-to-end by an engineer (or their Claude Code agent) and used as a direct implementation blueprint. It references FOIA Fluent's production chat system as the architectural model, with exact file paths in both repos.

**FOIA Fluent source:** https://github.com/dssg-nyc/FOIA-Fluent
**UNREDACTED source:** https://github.com/policybot-io/UNREDACTED
**Architecture reference:** See [docs/chat-architecture.md](https://github.com/dssg-nyc/FOIA-Fluent/blob/main/docs/chat-architecture.md) for FOIA Fluent's full chat system documentation.

---

## 1. Current State: What UNREDACTED Has Today

UNREDACTED does **not** have a chatbot. It has a **query-response agent panel** embedded in `src/App.jsx` (the `PolicyIntel` component, approximately lines 520-700). Here's what it does and doesn't do:

### What exists
- **Single-query input panel** in the PolicyIntel view — user types a question, gets a structured response
- **Multi-agent orchestrator** (`server/agents/orchestrator.js`) that decomposes queries into sub-tasks and dispatches to 3 data-fetching agents (policy, spending, donor)
- **AI synthesis** (`server/agents/corruptionAgent.js`) that reads all sub-agent results and produces structured "intelligence cards" with risk scores
- **7 LLM providers** (`server/services/aiService.js`) — DeepSeek (default), OpenAI, Anthropic, Groq, Ollama, Qwen, xAI Grok
- **LangChain/LangGraph Python agents** (`agents/main.py`) with DonorIntelligenceAgent, CorruptionDetectionAgent, PolicyAnalysisAgent
- **Supabase auth** for user identity

### What's missing

| Capability | Status |
|---|---|
| Dedicated chat UI (sidebar/overlay) | Missing — only an inline query panel |
| Conversation memory (multi-turn) | Missing — each query is stateless |
| SSE streaming | Missing — full response returned after all agents complete (10-30s wait) |
| Tool use / function calling | Missing — agents are hardcoded orchestration, not LLM-driven tool selection |
| Page-aware context | Missing — query panel is isolated from current view |
| User data access in chat | Missing — chat can't read user's watchlist, alerts, or saved items |
| Anti-hallucination safeguards | Missing — no "I don't know" fallback, no source verification tiers |
| Source citations with links | Missing — sources listed as names ("FEC, USASpending") but no specific URLs |
| Tiered accuracy system | Missing — no confidence scoring or escalation logic |

---

## 2. Gap Analysis: UNREDACTED vs FOIA Fluent

| Capability | FOIA Fluent | UNREDACTED | Priority |
|---|---|---|---|
| Dedicated chat UI | Floating sidebar on every page, Cmd+K toggle | Inline query panel in one view | HIGH |
| Conversation memory | Full multi-turn with message history | Single query-response, no memory | HIGH |
| SSE streaming | Real-time token streaming via EventSource | Blocking fetch, 10-30s wait | HIGH |
| Tool use / function calling | 11 Claude tools with structured I/O | Hardcoded agent routing, no tool-use | HIGH |
| Page-aware context | Chat adapts guidance based on current page | No context awareness | MEDIUM |
| User data access | Chat reads user's requests, discoveries, signals | No access to watchlist/alerts | MEDIUM |
| Anti-hallucination | 7 explicit safeguards (see architecture doc) | Relies on structured JSON output format | MEDIUM |
| Source citations | Inline citations with clickable links | Source names only, no URLs | MEDIUM |
| Tiered accuracy | 4-tier escalation (local → trusted → broad → fallback) | No tiered system | MEDIUM |
| Read-only constraint | Explicit system prompt rule + code enforcement | No constraint system | LOW |
| Markdown rendering | Bold, links, code, bullets, citation chips | Basic text rendering | LOW |
| Keyboard shortcuts | Cmd+K toggle, Esc to close | None | LOW |

---

## 3. Implementation Plan (8 Phases)

### Phase 1: Add a Real Chat UI Component

**Goal:** Replace the inline PolicyIntel query panel with a floating chat sidebar that persists across all views.

**What to build:**
- A new React component `src/components/ChatAssistant.jsx` — floating sidebar (right side, ~360px wide) with:
  - Message list (scrollable, each message has role + content)
  - Input field at the bottom with Send button
  - Toggle button (floating icon in bottom-right, or Cmd+K)
  - "Thinking..." indicator for when the AI is processing
  - Tool status display (e.g., "Searching spending data...")

**UNREDACTED files to modify:**
- `src/App.jsx` — import and render `<ChatAssistant />` at the root level (alongside existing tab content), not inside any specific tab. This makes it available on every view.
- New file: `src/components/ChatAssistant.jsx`
- New file: `src/components/ChatAssistant.css` (or use your existing styling approach)

**Reference implementation:**
- FOIA Fluent's [`ChatPanel.tsx`](https://github.com/dssg-nyc/FOIA-Fluent/blob/main/frontend/src/components/ChatPanel.tsx) — the full floating sidebar component. The state management pattern (lines 27-39), keyboard shortcut handling (lines 54-66), and message rendering (lines 158-207) are directly portable.

**Key design decisions:**
- Store `messages` in React state as `[{role: "user", content: "..."}, {role: "assistant", content: "..."}]`
- Include a `context` object that tracks which tab/view the user is on (e.g., `{page: "spending"}`, `{page: "donors"}`, `{page: "policy"}`)
- The panel should persist when switching tabs — conversation history survives tab changes

---

### Phase 2: Add SSE Streaming Backend Endpoint

**Goal:** Replace the blocking query-response pattern with real-time streaming so the user sees tokens appear as Claude generates them.

**What to build:**
- A new Express route `server/routes/chat.js` with `POST /api/chat` that returns a `text/event-stream` response
- The route opens a connection to the LLM (via the existing `aiService.js`), streams tokens to the client as `data: {...}\n\n` SSE events, and closes when done

**UNREDACTED files to modify:**
- New file: `server/routes/chat.js`
- `server/app.js` — mount the new chat route: `app.use('/api', chatRoutes)`
- `server/services/aiService.js` — add a `streamChat()` method that returns an async generator/stream instead of a complete response. The existing `createChatCompletion()` method (which returns the full response) should remain for non-chat uses.
- `src/api/client.js` — add a `streamChat(messages, context)` function that uses `fetch()` with `response.body.getReader()` to consume the SSE stream

**SSE event format (match FOIA Fluent's):**
```
data: {"type": "text", "content": "The "}
data: {"type": "text", "content": "EPA enforcement "}
data: {"type": "tool_call", "name": "search_spending", "status": "running"}
data: {"type": "tool_call", "name": "search_spending", "status": "done"}
data: {"type": "text", "content": "Based on the data..."}
data: {"type": "done"}
```

**Reference implementation:**
- FOIA Fluent's [`routes/chat.py`](https://github.com/dssg-nyc/FOIA-Fluent/blob/main/backend/app/routes/chat.py) — SSE endpoint with `StreamingResponse`
- FOIA Fluent's [`chat-api.ts`](https://github.com/dssg-nyc/FOIA-Fluent/blob/main/frontend/src/lib/chat-api.ts) — frontend SSE consumer using `getReader()`

**Note on Express vs FastAPI:** FOIA Fluent uses FastAPI's `StreamingResponse` with Python async generators. In Express, use `res.writeHead(200, {'Content-Type': 'text/event-stream'})` and `res.write()` for each event. The SSE format is identical.

---

### Phase 3: Implement Tool Use / Function Calling

**Goal:** Replace the hardcoded multi-agent orchestration with LLM-driven tool selection. Claude (or GPT-4) decides which tools to call based on the user's question, not a fixed decomposition pipeline.

**What to build:**
- Define tool schemas (JSON) that describe each data-access capability
- Pass the schemas to the LLM with every request
- When the LLM returns a `tool_use` block, execute the corresponding function and feed the result back
- Loop until the LLM responds with text (no more tool calls) or hits a max iteration count

**Suggested tools for UNREDACTED (based on existing data sources):**

| Tool | What it does | Existing code to wrap |
|---|---|---|
| `search_spending` | Search USASpending.gov for contracts/grants | Wrap `server/agents/spendingAgent.js` |
| `search_donors` | Search FEC for campaign contributions | Wrap `server/agents/donorAgent.js` |
| `search_policy` | Search Federal Register for rules/EOs | Wrap `server/agents/policyAgent.js` |
| `get_corruption_score` | Get AI-generated corruption index | Wrap `server/agents/corruptionAgent.js` |
| `lookup_politician` | Look up a politician's profile + voting record | New (or wrap existing civic API integration) |
| `search_stock_trades` | Search STOCK Act disclosures | Wrap existing trading data if available |
| `get_user_watchlist` | Read the current user's watchlist from Supabase | New (queries `user_profiles` table) |
| `search_news` | Search recent news/RSS feeds | Wrap existing RSS aggregation |
| `search_web` | General web search via Tavily or similar | New (add Tavily dependency) |

**UNREDACTED files to modify:**
- `server/routes/chat.js` — add the tool-use loop (same pattern as FOIA Fluent's `stream_chat()`)
- New file: `server/services/chatTools.js` — all tool function implementations
- `server/services/aiService.js` — the `streamChat()` method must pass `tools` parameter to the LLM and handle `tool_use` response blocks

**Reference implementation:**
- FOIA Fluent's tool-use loop: [`chat.py`, lines 388-444](https://github.com/dssg-nyc/FOIA-Fluent/blob/main/backend/app/services/chat.py#L388-L444) — the `for iteration in range(5)` loop that calls Claude, processes tool blocks, feeds results back, and repeats
- FOIA Fluent's tool definitions: [`chat.py`, lines 25-204](https://github.com/dssg-nyc/FOIA-Fluent/blob/main/backend/app/services/chat.py#L25-L204) — JSON schemas for all 11 tools
- FOIA Fluent's tool dispatcher: [`chat.py`, lines 322-366](https://github.com/dssg-nyc/FOIA-Fluent/blob/main/backend/app/services/chat.py#L322-L366) — `execute_tool()` function

**Key decision: Claude vs OpenAI tool-use format.**
- If using Claude (Anthropic SDK): tool calls come as `content[].type === "tool_use"` blocks in the response. Use `tool_choice` parameter to force or suggest tool use.
- If using OpenAI/GPT-4: tool calls come as `tool_calls[]` in the response. Use `functions` or `tools` parameter.
- UNREDACTED already supports both providers via `aiService.js` — the tool-use format will depend on which provider is active.

---

### Phase 4: Build Data-Access Tools

**Goal:** Implement the actual tool functions that the LLM calls. Each tool queries one of UNREDACTED's existing data sources and returns structured JSON.

**Pattern to follow (from FOIA Fluent's [`chat_tools.py`](https://github.com/dssg-nyc/FOIA-Fluent/blob/main/backend/app/services/chat_tools.py)):**

```javascript
// server/services/chatTools.js

async function searchSpending(query, filters = {}) {
  // Reuse existing spending agent logic
  const spendingAgent = require('../agents/spendingAgent');
  try {
    const results = await spendingAgent.search(query, filters);
    return {
      results: results.slice(0, 10),
      count: results.length,
      source: "USASpending.gov"
    };
  } catch (error) {
    return { results: [], message: `Error: ${error.message}` };
  }
}

async function getUserWatchlist(userId) {
  // Query Supabase for user's watchlist
  const { data } = await supabase
    .from('user_profiles')
    .select('watchlist')
    .eq('id', userId)
    .single();
  return {
    watchlist: data?.watchlist || [],
    source: "Your watchlist"
  };
}
```

**Key principle:** Each tool should return a JSON object with a `source` field so the LLM can cite where the data came from. Never return raw HTML or unstructured text.

---

### Phase 5: Add Conversation Memory + Multi-Turn

**Goal:** The chat remembers previous messages in the same session so the user can ask follow-up questions.

**What to build:**
- Store the full `messages` array in the React component state (already done if Phase 1 was followed)
- Send ALL messages (not just the latest) to the backend with every request
- The backend passes the full history to the LLM so Claude/GPT has context

**This is mostly free if Phases 1-3 were done correctly.** The key is that the frontend sends `{messages: [...allMessages], context: {...}}` on every request, not just the latest message.

**Optional: Persist conversations across page refreshes.**
- Store messages in `localStorage` (simplest, no backend change)
- Or store in Supabase `chat_conversations` table (more robust, survives device changes)

---

### Phase 6: Add Page-Aware Context

**Goal:** The chat knows which tab/view the user is currently on and adapts its guidance accordingly.

**What to build:**
- In `src/components/ChatAssistant.jsx`, detect the current active tab from the app state
- Pass it as `context.page` in every request: `{page: "spending"}`, `{page: "donors"}`, `{page: "policy_tracker"}`, etc.
- In the backend system prompt, add a dynamic section that changes based on `context.page`:

```
## CURRENT CONTEXT: User is viewing the Spending Explorer.
They're looking at government contract and grant data. Help them understand
specific awards, identify patterns in agency spending, and flag unusual
procurement activity. You can use the search_spending tool to pull data.
```

**UNREDACTED files to modify:**
- `src/components/ChatAssistant.jsx` — detect active tab from app state
- `server/routes/chat.js` — use `context.page` to customize the system prompt

**Reference implementation:**
- FOIA Fluent's page context: [`chat.py`, lines 292-305](https://github.com/dssg-nyc/FOIA-Fluent/blob/main/backend/app/services/chat.py#L292-L305)

---

### Phase 7: Add Tiered Accuracy + Anti-Hallucination Safeguards

**Goal:** Prevent the AI from making up facts. Build a tiered system that starts with verified local data and only escalates to less-certain sources when needed.

**What to build:**
1. **Hardcoded reference data** (Tier 1): Create a `server/data/` directory with verified JSON files for:
   - Common political terms and definitions
   - Campaign finance rules (FEC regulations)
   - Government spending thresholds and categories
   - Congressional committee memberships

2. **Trusted search** (Tier 2): Scope web search to authoritative domains:
   - fec.gov, usaspending.gov, congress.gov, gao.gov, sec.gov, opensecrets.org

3. **Broad search** (Tier 3): Unrestricted web search as a fallback

4. **Auto-escalation** (Tier 2 → 3): If the trusted search returns 0 results, automatically run a broad search AND optionally upgrade the model (e.g., from a cheaper model to Claude Sonnet)

5. **System prompt rules:**
```
## ACCURACY RULES
1. NEVER guess. Every fact must come from a tool result or verified reference data.
2. Cite sources at the end of your response.
3. Tiered lookup: verified reference → trusted search → broad search → "I don't know"
4. If you cannot verify a claim, say so explicitly.
5. READ-ONLY: you cannot modify any user data.
```

**Reference implementation:**
- FOIA Fluent's 7 anti-hallucination safeguards: see [docs/chat-architecture.md, Section 8](https://github.com/dssg-nyc/FOIA-Fluent/blob/main/docs/chat-architecture.md)

---

### Phase 8: Add Source Citation Rendering

**Goal:** When the AI cites a source, render it as a clickable link in the chat UI.

**What to build:**
- In the chat message renderer, parse source citations from the AI's response
- Two formats to detect:
  1. A `Source:` line at the end of the response → extract URLs and render as clickable chips
  2. Inline `[source: URL]` references → render as inline links

- Render citations as small pills/chips below the message with the source name and a link icon

**Reference implementation:**
- FOIA Fluent's markdown renderer with citation extraction: [`ChatPanel.tsx`, lines 158-207](https://github.com/dssg-nyc/FOIA-Fluent/blob/main/frontend/src/components/ChatPanel.tsx#L158-L207)

---

## 4. Leveraging UNREDACTED's Existing Infrastructure

UNREDACTED already has several components that can be reused directly:

| Existing Component | How to Leverage |
|---|---|
| `server/services/aiService.js` (7 LLM providers) | Add a `streamChat()` method alongside existing `createChatCompletion()`. The multi-provider abstraction is already solid. |
| `server/agents/orchestrator.js` (query decomposition) | DON'T use for chat. Tool-use replaces this. But keep it for the non-chat PolicyIntel panel. |
| `server/agents/spendingAgent.js`, `donorAgent.js`, `policyAgent.js` | Wrap each as a chat tool function. The data-fetching logic is reusable; only the interface changes. |
| Supabase auth (`src/contexts/AuthContext.jsx`) | Use the existing auth context to get the user's JWT and pass it to the chat API. |
| LangChain/LangGraph in `agents/` | Can be used for more complex multi-step reasoning if Claude's built-in tool-use isn't sufficient. But start with native tool-use first — it's simpler. |
| Neo4j graph database | Unique to UNREDACTED. Could power a `search_relationships` tool that finds connections between politicians, companies, and spending — something FOIA Fluent doesn't have. |
| Campaign Watch map | Could integrate with chat: "Which states have the highest corruption scores?" → chat calls a `get_state_corruption` tool → renders an answer that links to the map view. |

---

## 5. Suggested Build Order

| Phase | Effort | Depends on |
|---|---|---|
| 1. Chat UI component | ~2 hours | Nothing |
| 2. SSE streaming endpoint | ~2 hours | Phase 1 |
| 3. Tool use / function calling | ~3 hours | Phase 2 |
| 4. Data-access tools | ~2 hours | Phase 3 |
| 5. Conversation memory | ~30 min | Phase 1 (mostly free) |
| 6. Page-aware context | ~1 hour | Phase 2 |
| 7. Anti-hallucination safeguards | ~1 hour | Phase 3 |
| 8. Source citation rendering | ~1 hour | Phase 1 |
| **Total** | **~12 hours** | |

Phases 1-3 are the critical path. Everything else builds on top. If you're short on time, ship Phases 1-4 first and iterate on 5-8 after.

---

## 6. Key Differences to Preserve

UNREDACTED and FOIA Fluent serve different domains. When implementing the chat upgrade, preserve UNREDACTED's unique strengths:

1. **Multi-provider support**: UNREDACTED supports 7 LLM providers. FOIA Fluent only uses Claude. Keep the provider flexibility — it's a genuine differentiator.

2. **Corruption scoring**: UNREDACTED has an AI-generated corruption index that crosses spending, donors, and policy data. This is unique. Make it a first-class chat tool (`get_corruption_analysis`) so users can ask "How corrupt is [politician]?" and get a real answer.

3. **Graph relationships (Neo4j)**: UNREDACTED tracks relationships between entities in a graph database. This could power a `search_connections` tool that finds hidden links — "Who donated to [politician] AND received contracts from [agency]?" FOIA Fluent has nothing like this.

4. **STOCK Act monitoring**: Congressional trading data is unique to UNREDACTED. Make it a chat tool so users can ask "Has [politician] traded any stocks related to their committee assignments?"

5. **Campaign Watch map**: Let the chat reference the map: "Show me the corruption map for Texas" → chat returns a text answer AND suggests clicking the map tab to see it visually.

---

## 7. Testing Checklist

After implementing each phase, verify:

- [ ] **Phase 1:** Chat panel renders on every view. Messages persist when switching tabs. Cmd+K toggles. Esc closes.
- [ ] **Phase 2:** User sends a message → tokens stream in real-time (not a 10-30s wait). Tool status indicators show during tool execution.
- [ ] **Phase 3:** User asks "How much has the EPA spent this year?" → AI calls `search_spending` tool → reads the result → responds with data. Verify by checking backend logs for tool execution.
- [ ] **Phase 4:** Each data tool returns structured JSON with a `source` field. Test all tools individually with curl.
- [ ] **Phase 5:** User asks a follow-up question that depends on the previous answer → AI responds correctly (proves multi-turn memory works).
- [ ] **Phase 6:** User is on the Spending tab and asks a question → system prompt includes spending-specific context. Switch to Donors tab → system prompt changes.
- [ ] **Phase 7:** Ask a question the AI can't answer → it says "I don't have enough data" instead of guessing. Ask about a specific regulation → it cites the source.
- [ ] **Phase 8:** AI response includes "Source: USASpending.gov" → renders as a clickable link in the chat UI.

---

## 8. Agent Prompt

Copy and paste the prompt below into your Claude Code (or Cursor / Windsurf / Cline) session to kick off the implementation. It assumes both reference documents are accessible in your project directory.

---

```
You are helping me build a production-quality AI chat assistant for UNREDACTED (https://github.com/policybot-io/UNREDACTED), a government transparency and accountability platform built with React + Vite (frontend) and Express + Node.js (backend) with a secondary Python FastAPI agent service.

## Your two reference documents

Before writing ANY code, read these two documents end-to-end. They are your primary source of truth for architecture decisions, patterns, and implementation details:

1. **docs/chat-architecture.md** — Complete technical reference for FOIA Fluent's production chat assistant. Covers the 4-tier accuracy system, 11 tool definitions, SSE streaming, system prompt structure, anti-hallucination safeguards, and the full data flow. Every component is linked to exact source files at https://github.com/dssg-nyc/FOIA-Fluent. Use this as your architectural model — you are porting this system to UNREDACTED's tech stack (Express/Node instead of FastAPI/Python, React/Vite instead of Next.js).

2. **docs/chat-upgrade-guide-unredacted.md** — Actionable 8-phase implementation plan specific to UNREDACTED's codebase. Covers what UNREDACTED currently has (a query-response agent panel, not a chatbot), what's missing (15 capabilities compared in a gap analysis table), and exactly which files in the UNREDACTED repo to modify for each phase. Follow this document's phasing order.

## What UNREDACTED currently has that you must NOT break

- The PolicyIntel query panel in src/App.jsx (lines ~520-700) — leave it in place. The new chat assistant is ADDITIVE, not a replacement.
- The multi-agent orchestrator in server/agents/orchestrator.js — keep it for the PolicyIntel panel. The new chat uses tool-use instead.
- The 7-provider LLM abstraction in server/services/aiService.js — extend it with streaming support, don't replace it.
- Supabase auth in src/contexts/AuthContext.jsx — reuse it to get the user's JWT for the chat API.
- All existing API routes and data sources (USASpending, FEC, Federal Register, Neo4j, etc.) — these become chat tools, they don't change.

## What you are building

A floating chat sidebar component available on every view of the app, powered by Claude (or any provider via the existing aiService.js) with:
- Real-time SSE streaming (tokens appear as they're generated, not after a 10-30s wait)
- Tool use / function calling (the LLM decides which data sources to query based on the user's question)
- Multi-turn conversation memory (follow-up questions work)
- Page-aware context (the chat knows if you're on Spending, Donors, Policy, etc.)
- Anti-hallucination safeguards (tiered accuracy, "I don't know" fallbacks, source citations)
- User data access (the chat can read the user's watchlist and saved alerts from Supabase)

## Build order (follow this exactly)

Phase 1: Chat UI component (src/components/ChatAssistant.jsx)
Phase 2: SSE streaming backend endpoint (server/routes/chat.js)
Phase 3: Tool use / function calling (tool-use loop in the streaming endpoint)
Phase 4: Data-access tools (server/services/chatTools.js — wrap existing agents as tools)
Phase 5: Conversation memory (send full message history with every request)
Phase 6: Page-aware context (detect active tab, customize system prompt)
Phase 7: Anti-hallucination safeguards (tiered lookup, system prompt rules, fallback resources)
Phase 8: Source citation rendering (parse citations in chat messages, render as clickable links)

For each phase:
1. Read the corresponding section in docs/chat-upgrade-guide-unredacted.md for UNREDACTED-specific implementation details and which files to modify
2. Read the corresponding section in docs/chat-architecture.md for the reference implementation patterns from FOIA Fluent
3. Write the code, following the patterns from FOIA Fluent but adapted for Express/Node.js and React/Vite (not Next.js)
4. Test the phase before moving to the next one

## Technical constraints

- Frontend is React 19 + Vite (NOT Next.js). No App Router, no server components, no use client directives. Plain React with useState/useEffect.
- Backend is Express 5 on Node.js (NOT FastAPI/Python). SSE is done with res.writeHead + res.write, not StreamingResponse.
- The existing aiService.js supports 7 LLM providers. Default to Claude (Anthropic) for the chat, but the streaming endpoint should work with any provider that supports tool use. At minimum support Claude and GPT-4.
- Auth uses Supabase. The JWT is available in the frontend via AuthContext. Pass it as Authorization: Bearer header to the chat endpoint. Validate it server-side using the Supabase JWT secret.
- The existing agents (spendingAgent, donorAgent, policyAgent, corruptionAgent) are in server/agents/. Wrap them as chat tools — call their existing functions from inside the tool implementations, don't rewrite the data-fetching logic.
- UNREDACTED has a Neo4j graph database for entity relationships. This is unique — build a search_connections tool that queries Neo4j for relationships between politicians, companies, and spending. FOIA Fluent doesn't have this, so you'll need to design the tool schema yourself.

## System prompt for the UNREDACTED chat assistant

Write a system prompt following the structure in docs/chat-architecture.md Section 3 (8 sections), but adapted for UNREDACTED's domain. The prompt should:
- Explain UNREDACTED's features (Spending Explorer, Campaign Finance, Policy Tracker, Corruption Index, STOCK Act Monitor, Campaign Watch Map)
- List the available tools and when to use each one
- Include accuracy rules: never guess, cite sources, tiered lookup (verified data → trusted search → broad search → "I don't know")
- Include page-specific context sections for each UNREDACTED view
- Include communication style rules (plain English, lead with the answer, short responses)
- Be READ-ONLY: the chat cannot modify any user data

## Quality bar

- Every tool must return a source field so the LLM can cite where data came from
- SSE events must match the format in docs/chat-architecture.md Section 5 (text, tool_call, done)
- The chat must work without authentication (gracefully degrade — user-specific tools return "sign in to access your watchlist")
- Tool execution failures must not crash the stream — catch errors and return them as tool results so the LLM can explain the failure to the user
- The system prompt must explicitly forbid the LLM from guessing or hallucinating facts
- Messages should render markdown (bold, links, code blocks, bullet points) and source citations as clickable chips

## What success looks like

When you're done, a user should be able to:
1. Open the chat on any page of UNREDACTED
2. Ask "Who are the top donors to [politician] and did any of them receive federal contracts?" → the chat calls search_donors + search_spending + search_connections tools, cross-references the results, and gives a sourced answer with links
3. Ask a follow-up question that depends on the previous answer → the chat remembers the context
4. See tokens stream in real-time while the AI thinks
5. See tool execution indicators ("Searching spending data...", "Checking FEC records...")
6. Get "I don't have enough data to answer that" instead of a hallucinated response when the tools return nothing relevant
7. Click on cited sources to open the original data

Start with Phase 1. After each phase, show me what you built and confirm it works before moving to the next phase.
```

---

**End of guide.**
