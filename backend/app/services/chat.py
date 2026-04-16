"""Chat orchestrator — manages Claude tool_use with 4-tier accuracy system.

Tier 1: Instant lookup (local verified data)
Tier 2: Trusted web search (scoped domains)
Tier 3: Research agent (broad search + MuckRock)
Tier 4: Graceful fallback with resource links

READ-ONLY: No tool may modify any database record.
"""
import json
import logging
from typing import AsyncGenerator, Optional

import anthropic

from app.config import settings
from app.data.federal_foia_statute import FOIA_STATUTE
from app.models.chat import ChatContext, ChatMessage
from app.services import chat_tools

logger = logging.getLogger(__name__)

# ── Tool definitions for Claude API ──────────────────────────────────────────

TOOLS = [
    {
        "name": "lookup_exemption",
        "description": "Look up a specific FOIA exemption by number (1-9, 7A-7F). Returns the exemption name, legal citation, and detailed description. Use this for any question about what an exemption means or covers.",
        "input_schema": {
            "type": "object",
            "properties": {
                "exemption_number": {
                    "type": "string",
                    "description": "The exemption number, e.g. '5', '7(C)', '6'",
                }
            },
            "required": ["exemption_number"],
        },
    },
    {
        "name": "lookup_agency",
        "description": "Look up a federal agency's FOIA profile, contact info, and transparency statistics. Returns submission details, success rates, response times, and portal availability.",
        "input_schema": {
            "type": "object",
            "properties": {
                "agency_name": {
                    "type": "string",
                    "description": "Agency name or abbreviation, e.g. 'FBI', 'Department of Education', 'EPA'",
                }
            },
            "required": ["agency_name"],
        },
    },
    {
        "name": "search_web",
        "description": "Search trusted FOIA sources (justice.gov, foia.gov, muckrock.com, rcfp.org, eff.org, congress.gov) for information. Use for legal questions, procedural guidance, and FOIA policy. Returns results with source URLs.",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Search query about FOIA law, procedure, or policy",
                }
            },
            "required": ["query"],
        },
    },
    {
        "name": "search_web_broad",
        "description": "Broader web search when trusted sources don't have the answer. Use as a fallback after search_web returns no useful results. Returns results with source URLs.",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Search query",
                }
            },
            "required": ["query"],
        },
    },
    {
        "name": "search_requests",
        "description": "List or search the user's tracked FOIA requests. Pass an empty query to get ALL requests with summary stats (total count, status breakdown, overdue count). Can also filter by status. Always try this first when a user asks about their requests.",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Keyword to search, or empty string to list all requests",
                },
                "status_filter": {
                    "type": "string",
                    "description": "Filter by status: draft, submitted, awaiting_response, responded, partial, denied, appealed, fulfilled. Leave empty for all.",
                },
            },
            "required": [],
        },
    },
    {
        "name": "get_request_detail",
        "description": "Get full details of a specific tracked request including its communication history and AI analyses. Use this when the user asks about a specific request by name or when you need to see the full context of a request.",
        "input_schema": {
            "type": "object",
            "properties": {
                "request_id": {
                    "type": "string",
                    "description": "The UUID of the request to look up",
                }
            },
            "required": ["request_id"],
        },
    },
    {
        "name": "get_hub_stats",
        "description": "Get transparency statistics from the Transparency Hub. Can search for a specific agency or return top-ranked agencies by transparency score.",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Agency name to search for, or empty for overall top agencies",
                }
            },
            "required": [],
        },
    },
    {
        "name": "search_muckrock",
        "description": "Search MuckRock for similar FOIA requests that others have filed. Shows request outcomes, which helps predict how an agency might respond. Use when users ask about success rates for specific types of requests.",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Description of the type of FOIA request to search for",
                }
            },
            "required": ["query"],
        },
    },
    {
        "name": "search_my_discoveries",
        "description": "Search the user's saved discoveries library — documents they bookmarked from the Discover & Draft search. Returns metadata + the AI-generated description for each match. Use when the user asks about their saved research broadly, e.g. 'what did I save about EPA enforcement?', 'show me the documents I bookmarked this week', 'find the FDA inspection records I saved'. Filters by free-text query, status (saved/reviewed/useful/not_useful), tag, and recency window. For deep questions about the contents of ONE specific document, use read_saved_document instead.",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Free-text search across title, description, and note fields.",
                },
                "status": {
                    "type": "string",
                    "description": "Filter by status: saved | reviewed | useful | not_useful. Empty for all.",
                },
                "tag": {
                    "type": "string",
                    "description": "Filter by a single tag. Empty for all.",
                },
                "days": {
                    "type": "integer",
                    "description": "How many days back to look (default 30).",
                },
            },
            "required": [],
        },
    },
    {
        "name": "read_saved_document",
        "description": "Look up ONE specific saved document and return the AI-generated summary, the user's own note, AND (when possible) the FULL extracted text content fetched live from the source URL. Use when the user asks about the actual contents of a specific document they've saved — e.g. 'summarize that document', 'what does the EPA NOV say'. IMPORTANT: If you have the document's id from a previous search_my_discoveries call, ALWAYS pass it as document_id — this guarantees an exact match and prevents lookup failures.",
        "input_schema": {
            "type": "object",
            "properties": {
                "document_id": {
                    "type": "string",
                    "description": "The document's UUID from a previous search_my_discoveries result. Preferred — guarantees exact match.",
                },
                "title_or_url": {
                    "type": "string",
                    "description": "Fallback: the document's title (fuzzy match) or exact source URL. Only use if you don't have the document_id.",
                },
            },
            "required": [],
        },
    },
    {
        "name": "get_recent_signals",
        "description": "Get recent items from the Live FOIA Signals feed — realtime intelligence pulled from GAO bid protests, EPA ECHO enforcement, FDA Warning Letters, and DHS FOIA logs. Filter by persona (journalist, pharma_analyst, hedge_fund, environmental), keyword, and recency window. Use when a user asks 'what's new', 'what FOIA signals broke this week', or anything about realtime/live intelligence.",
        "input_schema": {
            "type": "object",
            "properties": {
                "persona": {
                    "type": "string",
                    "description": "Optional persona filter: journalist, pharma_analyst, hedge_fund, or environmental. Empty for all.",
                },
                "query": {
                    "type": "string",
                    "description": "Optional keyword to match in title or summary",
                },
                "days": {
                    "type": "integer",
                    "description": "How many days back to look (default 7)",
                },
            },
            "required": [],
        },
    },
]

# ── System prompt ────────────────────────────────────────────────────────────

def build_system_prompt(context: ChatContext, user_id: Optional[str] = None) -> str:
    """Build context-aware system prompt with anti-hallucination rules."""

    # Core statute sections for reference
    statute_text = ""
    for key, section in FOIA_STATUTE["sections"].items():
        statute_text += f"\n{section['cite']}: {section['text'][:200]}..."

    base = f"""You are the FOIA Fluent assistant — you help everyday people understand and use the Freedom of Information Act using the FOIA Fluent platform.

## THE FOIA FLUENT PLATFORM — YOU ARE AN EXPERT IN THIS TOOL

FOIA Fluent has 3 main features. ALWAYS guide users through these instead of giving generic FOIA advice:

**1. Discover & Draft (foiafluent.com/draft)**
- Users describe what records they want in plain English
- Our AI identifies the right agency, researches similar requests on MuckRock, and generates a legally optimized FOIA letter
- The draft includes proper legal citations, fee waiver requests, and format preferences
- When a user wants to file a request, ALWAYS say: "Let's draft that — head to the **Discover & Draft** tab and describe what records you're looking for. I can help you refine your description."

**2. My Requests (foiafluent.com/dashboard)**
- After drafting, users save and track their requests here
- They can log when they submit, track deadlines (auto-calculated at 20 business days), record agency responses, and upload documents
- Our AI analyzes agency responses to check if exemptions are valid and recommends next steps (accept, appeal, follow up)
- It also generates follow-up and appeal letters automatically
- When a user has filed a request, say: "Log it in **My Requests** so we can track your deadline and help if the agency responds with a denial."

**3. Transparency Hub (foiafluent.com/hub)**
- Transparency data on 1,600+ federal and state agencies
- Transparency scores, success rates, response times, exemption patterns
- Insights tab with FOIA trends from FY 2008-2024
- When a user asks about an agency's track record, use the lookup_agency or get_hub_stats tools AND mention they can explore more in the Transparency Hub.

## HOW TO GUIDE USERS THROUGH THE TOOL

- If someone wants to file a request → direct them to Discover & Draft
- If someone has already filed → direct them to My Requests to track it
- If someone got a response → tell them to upload it in My Requests for AI analysis
- If someone got denied → explain they can generate an appeal letter in My Requests
- If someone is researching → use your tools, but also point them to the Transparency Hub
- NEVER tell users to email agencies directly when they could use our draft tool instead
- ALWAYS frame advice in terms of what FOIA Fluent can do for them

## HOW TO COMMUNICATE

- Write like you're explaining to a smart friend, NOT a lawyer
- Keep answers SHORT — 2-4 sentences for simple questions, a short paragraph for complex ones
- Use plain English. Avoid legal jargon unless the user uses it first
- When you must use a legal term, explain it in parentheses
- Lead with the practical answer, then add detail only if needed
- Use bullet points sparingly — only when listing 3+ distinct items

## ACCURACY RULES

1. **NEVER guess.** Every fact about FOIA law, agencies, or statistics MUST come from a tool result or the verified statute below. If unsure, use a tool. If tools don't help, say you don't know and point them to a resource.

2. **Cite sources briefly.** Put citations at the end of your response in a small line, not inline after every sentence.

3. **Tiered lookup:**
   - First check verified statute/exemption data
   - Then search_web (trusted domains)
   - Then search_web_broad if needed
   - If nothing: "I don't have a verified answer, but you can check [resource]"

4. **READ-ONLY.** You cannot create, modify, or delete any user data.

5. **One response per question.** Don't repeat yourself. Give the answer once, clearly.

## VERIFIED FOIA STATUTE (5 U.S.C. § 552)
{statute_text}

## FOIA EXEMPTIONS
You have the lookup_exemption tool for detailed info. Quick reference:
- Ex. 1: National security | Ex. 2: Internal rules | Ex. 3: Other statutes
- Ex. 4: Trade secrets | Ex. 5: Deliberative process | Ex. 6: Personal privacy
- Ex. 7(A-F): Law enforcement | Ex. 8: Financial institutions | Ex. 9: Geological data

## KEY DEADLINES (from statute)
- Agencies must respond within 20 business days of receipt [5 U.S.C. § 552(a)(6)(A)(i)]
- 10-day extension allowed for "unusual circumstances" [5 U.S.C. § 552(a)(6)(B)(i)]
- Fee waiver appeals: 20 business days
- Administrative appeals: 20 business days
"""

    # Add page-specific context
    if context.page == "draft":
        base += "\n## CURRENT CONTEXT: User is on the Discover & Draft page.\nThey're actively working on a FOIA request. Help them describe their records clearly, pick the right agency, and refine their scope. They can type their request description in the search box on this page and our AI will draft it."
        if context.draft_data:
            base += f"\nCurrent draft info: {json.dumps(context.draft_data)[:500]}"

    elif context.page == "request_detail" and context.request_id:
        base += f"\n## CURRENT CONTEXT: User is viewing a tracked request (ID: {context.request_id}).\nThey may need help understanding an agency response, deciding whether to appeal, or writing a follow-up. Use search_requests to pull up the request details. Remind them they can upload agency responses for AI analysis and generate appeal/follow-up letters directly from this page."

    elif context.page == "dashboard":
        base += "\n## CURRENT CONTEXT: User is on the My Requests dashboard.\nThey're managing their tracked FOIA requests. Help them understand statuses, deadlines, and next steps. If they want to file a new request, direct them to Discover & Draft."

    elif context.page in ("hub", "states", "insights"):
        base += "\n## CURRENT CONTEXT: User is browsing the Transparency Hub.\nHelp them understand transparency data, agency scores, and FOIA trends. Use get_hub_stats and lookup_agency for data. If they want to file a request based on what they see, direct them to Discover & Draft."

    # Add fallback resources
    base += """

## FALLBACK RESOURCES (suggest these if you can't find an answer)
- Federal FOIA questions: https://www.foia.gov
- State public records: https://www.rcfp.org/open-government-guide/
- Filing help: https://www.muckrock.com/about/muckrock-101/
- FOIA exemptions guide: https://www.justice.gov/oip/doj-guide-freedom-information-act-0
- Legal questions: https://www.eff.org/issues/transparency
"""
    return base


# ── Tool execution ───────────────────────────────────────────────────────────

async def execute_tool(name: str, args: dict, user_id: Optional[str] = None) -> str:
    """Execute a tool by name and return JSON result string."""
    try:
        if name == "lookup_exemption":
            result = chat_tools.lookup_exemption(args.get("exemption_number", ""))
        elif name == "lookup_agency":
            result = chat_tools.lookup_agency(args.get("agency_name", ""))
        elif name == "search_web":
            result = await chat_tools.search_web(args.get("query", ""))
        elif name == "search_web_broad":
            result = await chat_tools.search_web_broad(args.get("query", ""))
        elif name == "search_requests":
            result = chat_tools.search_requests(user_id or "", args.get("query", ""), args.get("status_filter", ""))
        elif name == "get_request_detail":
            result = chat_tools.get_request_detail(user_id or "", args.get("request_id", ""))
        elif name == "get_hub_stats":
            result = chat_tools.get_hub_stats(args.get("query", ""))
        elif name == "search_muckrock":
            result = await chat_tools.search_muckrock(args.get("query", ""))
        elif name == "get_recent_signals":
            result = chat_tools.get_recent_signals(
                persona=args.get("persona", ""),
                query=args.get("query", ""),
                days=int(args.get("days", 7) or 7),
            )
        elif name == "search_my_discoveries":
            result = chat_tools.search_my_discoveries(
                user_id=user_id or "",
                query=args.get("query", ""),
                status=args.get("status", ""),
                tag=args.get("tag", ""),
                days=int(args.get("days", 30) or 30),
            )
        elif name == "read_saved_document":
            result = await chat_tools.read_saved_document(
                user_id=user_id or "",
                document_id=args.get("document_id", ""),
                title_or_url=args.get("title_or_url", ""),
            )
        else:
            result = {"error": f"Unknown tool: {name}"}
    except Exception as e:
        logger.error(f"Tool {name} failed: {e}")
        result = {"error": str(e)}

    return json.dumps(result, default=str)


# ── Streaming chat ───────────────────────────────────────────────────────────

async def stream_chat(
    messages: list[ChatMessage],
    context: ChatContext,
    user_id: Optional[str] = None,
) -> AsyncGenerator[str, None]:
    """Stream chat response with tool use. Yields SSE-formatted lines."""

    client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
    system_prompt = build_system_prompt(context, user_id)

    # Convert messages to Claude format
    claude_messages = [{"role": m.role, "content": m.content} for m in messages]

    # Start with Haiku for speed
    model = "claude-haiku-4-5-20251001"
    max_iterations = 5  # Max tool use loops

    for iteration in range(max_iterations):
        try:
            response = await client.messages.create(
                model=model,
                max_tokens=2000,
                system=system_prompt,
                tools=TOOLS,
                messages=claude_messages,
            )
        except Exception as e:
            logger.error(f"Claude API error: {e}")
            yield f'data: {json.dumps({"type": "text", "content": "I encountered an error. Please try again."})}\n\n'
            yield f'data: {json.dumps({"type": "done"})}\n\n'
            return

        # Process response blocks
        has_tool_use = False
        tool_results = []

        for block in response.content:
            if block.type == "text":
                yield f'data: {json.dumps({"type": "text", "content": block.text})}\n\n'

            elif block.type == "tool_use":
                has_tool_use = True
                tool_name = block.name
                tool_input = block.input

                # Notify frontend about tool call
                yield f'data: {json.dumps({"type": "tool_call", "name": tool_name, "status": "running"})}\n\n'

                # Execute the tool
                result_str = await execute_tool(tool_name, tool_input, user_id)

                # If trusted search returned nothing and this was search_web, escalate to Tier 3
                result_data = json.loads(result_str)
                if tool_name == "search_web" and not result_data.get("results"):
                    # Auto-escalate to broad search
                    yield f'data: {json.dumps({"type": "tool_call", "name": "search_web_broad", "status": "researching deeper..."})}\n\n'
                    model = "claude-sonnet-4-20250514"  # Upgrade model for Tier 3
                    result_str = await execute_tool("search_web_broad", tool_input, user_id)

                yield f'data: {json.dumps({"type": "tool_call", "name": tool_name, "status": "done"})}\n\n'

                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": result_str,
                })

        if has_tool_use:
            # Add assistant response + tool results to conversation for next iteration
            claude_messages.append({"role": "assistant", "content": response.content})
            claude_messages.append({"role": "user", "content": tool_results})
        else:
            # No more tool calls — done
            break

    yield f'data: {json.dumps({"type": "done"})}\n\n'
