# AI Chat Assistant — Architecture & Implementation Spec

> A production-ready AI chat assistant with tool use, 4-tier accuracy system, anti-hallucination safeguards, and streaming responses. Built with Claude API, FastAPI, Next.js, and Supabase.

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [4-Tier Layered Accuracy System](#4-tier-layered-accuracy-system)
- [Model Selection Strategy](#model-selection-strategy)
- [Safety & Anti-Hallucination](#safety--anti-hallucination)
- [Tool System](#tool-system)
- [Auto-Escalation Logic](#auto-escalation-logic)
- [Streaming Architecture](#streaming-architecture)
- [Natural Response Style](#natural-response-style)
- [Source Citations](#source-citations)
- [Context-Aware System Prompt](#context-aware-system-prompt)
- [Platform Integration](#platform-integration)
- [Authentication & User Data](#authentication--user-data)
- [Frontend Component](#frontend-component)
- [Adapting for Another Platform](#adapting-for-another-platform)

---

## Overview

A persistent floating chat panel that appears on every page of the application. The assistant can:

- Answer domain-specific questions using verified data
- Search the web for information, scoped to trusted sources
- Access the user's own data (with authentication)
- Query internal databases (read-only)
- Guide users through platform features instead of giving generic advice
- Stream responses in real-time with visual indicators for tool usage

**Stack:** Claude API (Haiku + Sonnet), FastAPI (Python), Next.js (React), Supabase (Postgres + Auth)

---

## Architecture

```
┌─────────────────────────────────────────────┐
│  Frontend (Next.js)                         │
│  ┌─────────────────────────────────────┐    │
│  │ ChatPanel.tsx                       │    │
│  │ - Floating panel in root layout     │    │
│  │ - SSE stream consumer               │    │
│  │ - Page context detection            │    │
│  │ - Markdown + source chip rendering  │    │
│  └──────────────┬──────────────────────┘    │
└─────────────────┼───────────────────────────┘
                  │ POST /api/v1/chat (SSE)
                  ▼
┌─────────────────────────────────────────────┐
│  Backend (FastAPI)                          │
│  ┌─────────────────────────────────────┐    │
│  │ chat.py (Orchestrator)              │    │
│  │ - Builds context-aware system prompt│    │
│  │ - Manages Claude tool_use loop      │    │
│  │ - Auto-escalates tiers              │    │
│  │ - Streams SSE events                │    │
│  └──────────────┬──────────────────────┘    │
│                 │                            │
│  ┌──────────────▼──────────────────────┐    │
│  │ chat_tools.py (Tool Implementations)│    │
│  │ - All tools are READ-ONLY           │    │
│  │ - Reuses existing services          │    │
│  │ - Each returns data + source cite   │    │
│  └─────────────────────────────────────┘    │
└─────────────────────────────────────────────┘
```

**No MCP needed.** Since we own the entire backend, tools are plain Python functions called directly. MCP adds protocol overhead without benefit when all tools live in the same codebase.

---

## 4-Tier Layered Accuracy System

The core innovation. Every question goes through escalating tiers until answered:

```
User question
    │
    ▼
┌─ TIER 1: Instant Lookup (< 1s) ──────────────────────────────┐
│                                                                │
│  Checks local verified data first:                             │
│  - Hardcoded reference data (statutes, definitions, etc.)     │
│  - Database lookups (profiles, cached stats)                  │
│  - User's own data (if authenticated)                         │
│                                                                │
│  ✓ Found → respond with source citation → DONE                │
└────────────────────────────────────────────────────────────────┘
    │ not found locally
    ▼
┌─ TIER 2: Trusted Web Search (2-5s) ──────────────────────────┐
│                                                                │
│  Web search scoped to whitelisted domains only:                │
│  - Government sites, authoritative organizations              │
│  - Known expert sources in your domain                        │
│  - Uses "basic" search depth for speed                        │
│                                                                │
│  ✓ Found → respond with source URL → DONE                    │
└────────────────────────────────────────────────────────────────┘
    │ not found in trusted sources
    ▼
┌─ TIER 3: Research Agent (5-15s) ──────────────────────────────┐
│                                                                │
│  Deeper research session:                                      │
│  - Broad web search (no domain restriction)                   │
│  - Domain-specific API searches                               │
│  - Cross-references multiple sources                          │
│  - Automatically upgrades model (Haiku → Sonnet)              │
│  - Shows "Researching..." indicator to user                   │
│                                                                │
│  ✓ Found → respond with multiple source URLs → DONE           │
└────────────────────────────────────────────────────────────────┘
    │ still no confident answer
    ▼
┌─ TIER 4: Graceful Fallback ──────────────────────────────────┐
│                                                                │
│  "I don't have a verified answer for this.                    │
│   Here's where you can look:"                                 │
│  - Suggests specific resources relevant to the topic          │
│  - NEVER fabricates an answer                                 │
│  - NEVER says "I think" or "probably" about facts             │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

---

## Model Selection Strategy

| Tier | Model | Why |
|------|-------|-----|
| 1-2 | `claude-haiku` | Fast (~1s), cheap, sufficient for tool orchestration and simple answers |
| 3 | `claude-sonnet` | Auto-upgrades when Tier 2 fails. Better at synthesizing multiple sources |

The upgrade happens automatically in the backend — no user or frontend involvement.

---

## Safety & Anti-Hallucination

### Rule 1: READ-ONLY Database Access

All tool functions enforce read-only at the code level:

```python
# ✅ This is all tools can do
supabase.table("requests").select("*").eq("user_id", uid).execute()

# ❌ These are never implemented in any tool function
supabase.table("requests").insert(...)   # NEVER
supabase.table("requests").update(...)   # NEVER
supabase.table("requests").delete(...)   # NEVER
```

This is enforced in the tool implementations, not just the prompt. There is no write path.

### Rule 2: Anti-Hallucination System Prompt

Key instructions in the system prompt:

```
- NEVER guess. Every fact MUST come from a tool result or verified reference data.
- If unsure, USE A TOOL to find the answer.
- If tools don't help, say "I don't know" and point to a resource.
- Never answer domain-specific facts from training data alone.
- One response per question. Don't repeat yourself.
```

### Rule 3: Source Citation

Every factual claim must be traceable to a source (see [Source Citations](#source-citations) section).

---

## Tool System

Tools are passed to Claude via the `tools` parameter in the Messages API. Claude decides which to call based on the user's question.

### Tool Definition Pattern

```python
{
    "name": "tool_name",
    "description": "Clear description of what this tool does and WHEN to use it",
    "input_schema": {
        "type": "object",
        "properties": {
            "param": {"type": "string", "description": "What this param is"}
        },
        "required": ["param"]
    }
}
```

### Tool Implementation Pattern

Every tool returns a dict with:
- The actual data/results
- A `source` field describing where the data came from

```python
def my_tool(query: str) -> dict:
    """Docstring explaining the tool. READ-ONLY."""
    result = database.select(query)  # READ-ONLY
    return {
        "results": result,
        "source": "Internal database — table_name"
    }
```

### Tool Execution Loop

```python
max_iterations = 5  # Prevents infinite tool loops

for iteration in range(max_iterations):
    response = await claude.messages.create(
        model=model,
        system=system_prompt,
        tools=TOOLS,
        messages=messages,
    )

    for block in response.content:
        if block.type == "text":
            # Stream text to frontend via SSE
            yield {"type": "text", "content": block.text}

        elif block.type == "tool_use":
            # Show indicator to user
            yield {"type": "tool_call", "name": block.name, "status": "running"}

            # Execute tool
            result = await execute_tool(block.name, block.input)

            # Auto-escalate if needed (see next section)
            # ...

            # Add result to conversation for next Claude iteration
            tool_results.append({"tool_use_id": block.id, "content": result})

    if no_tool_use_blocks:
        break  # Final answer delivered
```

---

## Auto-Escalation Logic

When `search_web` (Tier 2, trusted domains) returns no results:

```python
if tool_name == "search_web" and not result_data.get("results"):
    # Auto-escalate to Tier 3
    yield {"type": "tool_call", "name": "search_web_broad", "status": "researching deeper..."}
    model = "claude-sonnet"  # Upgrade model
    result = await execute_tool("search_web_broad", tool_input)
```

This happens transparently — Claude doesn't need to decide to escalate. The backend handles it.

---

## Streaming Architecture

### Backend → Frontend: Server-Sent Events (SSE)

```python
# FastAPI endpoint
@router.post("")
async def chat(body: ChatRequest, request: Request):
    return StreamingResponse(
        stream_chat(body.messages, body.context, user_id),
        media_type="text/event-stream",
    )
```

### SSE Event Types

```
data: {"type": "text", "content": "Partial text..."}      # Streamed text
data: {"type": "tool_call", "name": "search_web", "status": "running"}  # Tool started
data: {"type": "tool_call", "name": "search_web", "status": "done"}     # Tool finished
data: {"type": "done"}                                      # Stream complete
```

### Frontend: AsyncGenerator Consumer

```typescript
async function* streamChat(messages, context, authToken): AsyncGenerator<ChatEvent> {
    const response = await fetch("/api/v1/chat", { method: "POST", body: ... });
    const reader = response.body.getReader();

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        // Parse SSE lines and yield events
        for (const line of lines) {
            if (line.startsWith("data: ")) {
                yield JSON.parse(line.slice(6));
            }
        }
    }
}
```

### Visual States During Streaming

| State | UI Element | When |
|-------|-----------|------|
| Thinking | Bouncing dots animation | After user sends message, before any response |
| Tool running | Blue pill with pulse dot + label | During tool execution ("Searching trusted sources...") |
| Streaming text | Text appearing incrementally | As Claude's response arrives |

---

## Natural Response Style

### System Prompt Rules for Tone

```
- Write like you're explaining to a smart friend, NOT a lawyer/expert
- Keep answers SHORT — 2-4 sentences for simple questions, a short paragraph for complex
- Use plain English. Avoid jargon unless the user uses it first
- When you must use a technical term, explain it in parentheses
- Lead with the practical answer, then add detail only if needed
- Use bullet points sparingly — only when listing 3+ distinct items
- One response per question. Don't repeat yourself
```

### Paragraph Spacing

The frontend markdown renderer splits responses into `<p>` tags on double newlines, giving visual breathing room between ideas:

```typescript
html = html
    .split(/\n\n+/)
    .map(p => `<p>${p}</p>`)
    .join("");
```

### Bold for Emphasis

Claude is encouraged to use `**bold**` for key terms, which renders as `<strong>`:

```typescript
html = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
```

---

## Source Citations

Sources are extracted from Claude's response and rendered as clickable pill-shaped chips at the bottom of each message.

### How It Works

1. **Claude includes sources** — The system prompt tells Claude to put sources at the end: `Source: 5 U.S.C. § 552(a)(6)(A)(i)`

2. **Frontend extracts them** — Regex strips source lines from the body text:
```typescript
body = text.replace(/Source[s]?:\s*(.+?)$/gim, (_, src) => {
    sources.push(src);
    return "";
});
```

3. **Renders as chips** — Sources become clickable rounded pills:
```html
<div class="chat-source-row">
    <a href="https://..." class="chat-source-chip">5 U.S.C. § 552</a>
</div>
```

### Chip Styling

```css
.chat-source-chip {
    font-size: 0.7rem;
    color: var(--primary);
    background: var(--primary-light);
    padding: 0.2rem 0.6rem;
    border-radius: 12px;
    text-decoration: none;
    border: 1px solid transparent;
}

.chat-source-chip:hover {
    border-color: var(--primary);
}
```

### Smart Linking

- Statute references → link to Cornell Law Institute
- URLs → link directly
- Database sources → display as non-clickable chip

---

## Context-Aware System Prompt

The system prompt dynamically adapts based on which page the user is on:

```python
def build_system_prompt(context):
    base = "You are the assistant for [Platform Name]..."

    if context.page == "draft":
        base += "User is actively creating something. Help them refine it."
    elif context.page == "request_detail":
        base += "User is viewing item {id}. Help with status and next steps."
    elif context.page == "dashboard":
        base += "User is managing their items. Help with overview and actions."
    elif context.page == "data":
        base += "User is exploring data. Help interpret and suggest actions."

    return base
```

The frontend detects the current page via `usePathname()` and sends it as `context.page`.

---

## Platform Integration

The chat is an **expert in the platform itself** — it guides users through features rather than giving generic advice.

### System Prompt Pattern

```
## YOUR PLATFORM'S FEATURES

**Feature 1 (url/path)**
- What it does
- When to direct users here
- What to say: "Head to **Feature 1** and..."

**Feature 2 (url/path)**
- What it does
- When to direct users here

## RULES
- NEVER give generic advice when the platform has a feature for it
- ALWAYS frame guidance in terms of what the platform can do
- Direct users to specific features by name
```

---

## Authentication & User Data

### Flow

1. User signs in via Supabase Auth → gets JWT
2. Frontend reads JWT from session: `getAccessToken()`
3. Passes as `Authorization: Bearer <token>` to chat endpoint
4. Backend decodes JWT to extract `user_id`
5. Tools that access user data filter by `user_id`

### Without Auth

Chat still works — it just can't access personal data. Tools that require auth return a friendly message asking the user to sign in.

### Data Isolation

- JWT contains unique `user_id`
- All user-data queries filter by `user_id`
- Database has Row Level Security (RLS) as a second layer of protection

---

## Frontend Component

### ChatPanel.tsx

Persistent floating panel rendered in root `layout.tsx`:

```tsx
// layout.tsx
<body>
    <Nav />
    {children}
    <Footer />
    <ChatPanel />  {/* Always present */}
</body>
```

### States

| State | Description |
|-------|-------------|
| Open (default) | 400x560px panel, bottom-right corner |
| Minimized | 56px circle bubble icon |
| Mobile | Full-screen overlay (< 768px) |

### Keyboard Shortcuts

- `Cmd+K` / `Ctrl+K` — toggle open/close
- `Esc` — close
- `Enter` — send message

### Welcome Screen

Shows on first open with:
- Greeting + description of capabilities
- 4 suggestion buttons for common questions
- Clicking a suggestion auto-sends that question

---

## Adapting for Another Platform

To use this architecture for a different domain:

### 1. Replace Tools

Swap tool implementations in `chat_tools.py` with your domain:

```python
# Instead of lookup_exemption → lookup_product
# Instead of lookup_agency → lookup_vendor
# Instead of search_muckrock → search_your_domain_api
```

### 2. Update Trusted Domains

Change the Tier 2 whitelist:

```python
# Our FOIA domains:
["justice.gov", "foia.gov", "muckrock.com", "rcfp.org"]

# Your domains:
["your-authority.com", "your-regulator.gov", ...]
```

### 3. Replace Verified Reference Data

Swap hardcoded verified data:

```python
# Our FOIA exemptions → Your domain's key definitions/rules
EXEMPTIONS = { ... }  →  YOUR_REFERENCE_DATA = { ... }
```

### 4. Customize System Prompt

Update three sections:
- **Platform features** — describe your tool's features
- **Communication style** — adjust tone for your audience
- **Fallback resources** — list your domain's authoritative sources

### 5. Update Context Detection

Map your pages to context types:

```python
if context.page == "your_creation_page":
    # Help create things
elif context.page == "your_management_page":
    # Help manage things
```

### What Stays the Same

- 4-tier escalation pattern
- SSE streaming architecture
- Tool execution loop with auto-escalation
- Safety rules (read-only, anti-hallucination)
- Frontend ChatPanel component structure
- Source citation rendering
