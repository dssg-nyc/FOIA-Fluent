import asyncio
import json
import logging

import anthropic
from tavily import AsyncTavilyClient

from app.services.agency_profiles import get_agency_profile, get_agency_summary
from app.data.federal_foia_statute import FOIA_STATUTE
from app.models.draft import AgencyInfo, SimilarRequest
from app.services.agency_intel import AgencyIntelAgent

logger = logging.getLogger(__name__)

AGENCY_IDENTIFY_PROMPT = """You are a FOIA expert. Given a description of records someone wants, identify the correct federal agency to send a FOIA request to.

You may ONLY recommend agencies from the list below. Do NOT invent or guess agency names, URLs, or contact information.

FEDERAL AGENCIES:
{agency_list}

You MUST respond with valid JSON only. No other text.

Return this exact format:
{{
  "primary": {{
    "abbreviation": "AGENCY_CODE",
    "reasoning": "Why this agency is the best match"
  }},
  "alternatives": [
    {{
      "abbreviation": "AGENCY_CODE",
      "reasoning": "Why this agency might also hold relevant records"
    }}
  ]
}}

Rules:
- Pick the single BEST matching agency as primary
- Always prefer a specific sub-agency over its parent department when available (e.g., prefer "ICE" over "DHS", "FBI" over "DOJ", "FDA" over "HHS")
- List 0-2 alternatives if records might also be held by other agencies
- Use ONLY abbreviation codes from the list above (e.g. "ICE", "EPA", "FBI")
- If the user's request spans multiple agencies, pick the most relevant as primary and list others as alternatives
- If the user asks about an agency NOT in this list (e.g. a sub-component we don't have listed), use the closest parent agency that IS in the list and note in your reasoning that the user should verify whether there is a more specific component office to contact directly. Add this guidance to your reasoning — never refuse or return an error."""

DRAFT_PROMPT = """You are a FOIA request drafting expert. Generate a formal, legally sound FOIA request letter optimized for success.

CRITICAL RULES — ANTI-HALLUCINATION:
- You may ONLY cite statutes and regulations provided in the VERIFIED LEGAL CONTEXT below
- Do NOT cite any statute, regulation, case law, or legal authority from your training data
- Do NOT invent agency addresses, office names, or contact information
- Use ONLY the agency information provided in the AGENCY INFORMATION section
- If the context doesn't contain a relevant legal citation, say so — never guess

=== VERIFIED LEGAL CONTEXT ===

STATUTE: {statute_title} ({statute_citation})

{statute_sections}

=== AGENCY INFORMATION ===

Agency: {agency_name} ({agency_abbreviation})
FOIA Regulation: {agency_regulation}
FOIA Website: {agency_website}
FOIA Email: {agency_email}
Submission Notes: {agency_notes}
CFR Regulation Summary: {agency_cfr_summary}
Exemption Tendencies: {agency_exemption_tendencies}
Routing Notes: {agency_routing_notes}

VERBATIM CFR REGULATION TEXT (from eCFR — use this as the authoritative source for this agency's FOIA procedures, deadlines, and fee schedules):
{agency_cfr_text}

=== SIMILAR PAST REQUESTS ON THIS TOPIC (from MuckRock) ===

{similar_requests_context}

=== AGENCY FOIA INTELLIGENCE (from MuckRock) ===

{agency_intel_context}

=== END CONTEXT ===

Generate a FOIA request letter that includes:
1. Proper salutation to the agency's FOIA office
2. Clear statement this is a request under the Freedom of Information Act, citing {statute_citation}
3. Specific, narrow description of records sought based on the user's description
   - Use date ranges when possible
   - Name specific record types (emails, memos, reports, etc.)
   - Reference specific programs, offices, or individuals when relevant
4. Format preference as specified by the requester
5. {fee_waiver_instruction}
6. {expedited_instruction}
7. Requester identification and contact information
8. Reference to the {time_limit_days}-business-day response requirement

LEARN FROM SIMILAR REQUESTS:
- If similar requests were denied, avoid the language/scope that led to denial
- If similar requests succeeded, mirror their approach to records description
- Anticipate exemptions this agency commonly invokes and pre-emptively narrow scope

The tone should be professional, direct, and cooperative.

You MUST respond with valid JSON only:
{{
  "letter_text": "The complete letter ready to send (use \\n for line breaks)",
  "statute_cited": "{statute_citation}",
  "key_elements": ["list of what the letter includes, e.g. 'Fee waiver request', 'Expedited processing'"],
  "tips": ["practical tips for submitting this request"],
  "submission_info": "How and where to submit based on agency info above",
  "drafting_strategy": {{
    "summary": "2-3 sentence overview of your drafting approach and what informed it",
    "learned_from_successes": "What you learned from successful similar requests and how it shaped this draft (or 'No successful requests found to reference' if none)",
    "avoided_from_denials": "What patterns from denied requests you avoided and why (or 'No denied requests found to reference' if none)",
    "scope_decisions": "How you decided on the scope and specificity of the records description — why you chose certain date ranges, record types, or narrowing strategies",
    "exemption_awareness": "Which exemptions this agency commonly invokes and how you wrote the request to minimize exemption risk"
  }}
}}"""


def _parse_json(text: str) -> dict:
    """Parse JSON from Claude's response, stripping markdown code blocks."""
    text = text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else text[3:]
        if text.endswith("```"):
            text = text[:-3].strip()
    return json.loads(text)


def _build_statute_sections() -> str:
    """Format statute sections for the prompt."""
    lines = []
    for section in FOIA_STATUTE["sections"].values():
        lines.append(f"[{section['cite']}]\n{section['text']}\n")
    lines.append("EXEMPTIONS:")
    for exemption in FOIA_STATUTE["exemptions"].values():
        lines.append(f"[{exemption['cite']}] {exemption['name']}: {exemption['text']}\n")
    return "\n".join(lines)


class FOIADrafter:
    """Drafts optimized FOIA request letters using verified legal context,
    agency-specific rules, and MuckRock outcome intelligence."""

    def __init__(self, anthropic_api_key: str, tavily_api_key: str = ""):
        self.client = anthropic.AsyncAnthropic(api_key=anthropic_api_key)
        self.tavily = AsyncTavilyClient(api_key=tavily_api_key) if tavily_api_key else None
        self.intel_agent = AgencyIntelAgent(tavily_api_key) if tavily_api_key else None

    async def identify_agency(
        self, description: str, agencies_hint: list[str] | None = None
    ) -> dict:
        """Identify the best federal agency to receive a FOIA request."""
        prompt = AGENCY_IDENTIFY_PROMPT.format(agency_list=get_agency_summary())

        user_msg = description
        if agencies_hint:
            user_msg += f"\n\nHint: The following agencies were identified during discovery: {', '.join(agencies_hint)}"

        # Haiku — bounded classification task (pick 1 of ~100 agencies); no
        # reasoning gain from Sonnet, ~3× cheaper.
        message = await self.client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=1000,
            system=prompt,
            messages=[{"role": "user", "content": user_msg}],
        )

        parsed = _parse_json(message.content[0].text)

        # Resolve abbreviations to full agency info (Supabase-first via get_agency_profile)
        primary_abbr = parsed["primary"]["abbreviation"]
        primary_data = get_agency_profile(primary_abbr) or {}

        primary_agency = AgencyInfo(
            name=primary_data.get("name", primary_abbr),
            abbreviation=primary_abbr,
            foia_website=primary_data.get("foia_website", ""),
            foia_email=primary_data.get("foia_email", ""),
            jurisdiction=primary_data.get("jurisdiction", "federal"),
            description=primary_data.get("description", ""),
            foia_regulation=primary_data.get("foia_regulation", ""),
            submission_notes=primary_data.get("submission_notes", ""),
            cfr_available=bool(primary_data.get("cfr_text", "")),
        )

        alternatives = []
        for alt in parsed.get("alternatives", []):
            alt_abbr = alt["abbreviation"]
            alt_data = get_agency_profile(alt_abbr) or {}
            if alt_data:
                alternatives.append(AgencyInfo(
                    name=alt_data.get("name", alt_abbr),
                    abbreviation=alt_abbr,
                    foia_website=alt_data.get("foia_website", ""),
                    foia_email=alt_data.get("foia_email", ""),
                    jurisdiction=alt_data.get("jurisdiction", "federal"),
                    description=alt_data.get("description", ""),
                    foia_regulation=alt_data.get("foia_regulation", ""),
                    submission_notes=alt_data.get("submission_notes", ""),
                    cfr_available=bool(alt_data.get("cfr_text", "")),
                ))

        reasoning = parsed["primary"].get("reasoning", "")
        if alternatives:
            alt_reasons = [
                f"{a['abbreviation']}: {a.get('reasoning', '')}"
                for a in parsed.get("alternatives", [])
            ]
            reasoning += " Also consider: " + "; ".join(alt_reasons)

        return {
            "agency": primary_agency,
            "alternatives": alternatives,
            "reasoning": reasoning,
        }

    async def research_similar_requests(
        self, agency_name: str, description: str,
        foia_queries: list[str] | None = None,
    ) -> list[SimilarRequest]:
        """Search MuckRock for similar FOIA requests to learn from.

        If foia_queries are provided (from QueryInterpreter), uses those
        short targeted queries. Otherwise falls back to agency_name + description.
        """
        if not self.tavily:
            return []

        if foia_queries:
            queries = [f"{agency_name} {q}" for q in foia_queries[:3]]
        else:
            queries = [f"{agency_name} {description}"]

        try:
            tasks = [
                self.tavily.search(
                    query=q,
                    max_results=5,
                    search_depth="advanced",
                    include_domains=["muckrock.com"],
                )
                for q in queries
            ]
            responses = await asyncio.gather(*tasks)

            seen_urls: set[str] = set()
            results = []
            for response in responses:
                for item in response.get("results", []):
                    url = item.get("url", "")
                    if "muckrock.com" not in url:
                        continue
                    normalized = url.rstrip("/").lower()
                    if normalized in seen_urls:
                        continue
                    seen_urls.add(normalized)

                    title = item.get("title", "")
                    content = item.get("content", "")
                    combined = (title + " " + content).lower()
                    status = ""
                    status_keywords = [
                        ("completed", "completed"),
                        ("partially completed", "partially completed"),
                        ("rejected", "rejected"),
                        ("no responsive documents", "no responsive documents"),
                        ("no responsive", "no responsive documents"),
                        ("fix required", "fix required"),
                        ("payment required", "payment required"),
                        ("appealing", "appealing"),
                        ("abandoned", "abandoned"),
                        ("processing", "processing"),
                        ("acknowledged", "acknowledged"),
                        ("submitted", "submitted"),
                        ("filed", "submitted"),
                    ]
                    for keyword, label in status_keywords:
                        if keyword in combined:
                            status = label
                            break

                    results.append(SimilarRequest(
                        title=title.replace(" - MuckRock", "").strip(),
                        status=status,
                        url=url,
                        description=content[:300],
                    ))
            return results
        except Exception as e:
            logger.error(f"MuckRock research failed: {e}")
            return []

    async def generate_draft(
        self,
        description: str,
        agency: AgencyInfo,
        requester_name: str,
        requester_organization: str = "",
        fee_waiver: bool = False,
        expedited_processing: bool = False,
        preferred_format: str = "electronic",
        similar_requests_prefetched: list[SimilarRequest] | None = None,
    ) -> dict:
        """Generate a FOIA request letter using verified legal context and MuckRock intelligence."""

        # Step 1: Run research agents in parallel
        # Skip similar_requests fetch if pre-fetched from discovery (same agency)
        tasks = []
        if similar_requests_prefetched is None:
            tasks.append(self.research_similar_requests(agency.name, description))
        if self.intel_agent:
            tasks.append(
                self.intel_agent.research_agency(agency.abbreviation, agency.name)
            )

        results = await asyncio.gather(*tasks)

        if similar_requests_prefetched is not None:
            similar = similar_requests_prefetched
            intel = results[0] if results else {}
        else:
            similar = results[0]
            intel = results[1] if len(results) > 1 else {}

        # Step 2: Build context for Claude
        similar_context = self._format_similar_requests(similar)
        agency_intel_context = (
            self.intel_agent.format_for_prompt(intel) if self.intel_agent and intel
            else "No agency-level FOIA intelligence available."
        )
        statute_sections = _build_statute_sections()

        fee_waiver_instruction = (
            f"Fee waiver request under {FOIA_STATUTE['sections']['fee_waiver']['cite']}, "
            f"with justification that disclosure serves the public interest"
            if fee_waiver
            else "Standard fee acknowledgment (willing to pay reasonable fees up to a stated limit)"
        )

        expedited_instruction = (
            f"Expedited processing request under {FOIA_STATUTE['sections']['expedited_processing']['cite']}, "
            f"with demonstration of compelling need"
            if expedited_processing
            else "No expedited processing request"
        )

        # Pull extended agency fields — Supabase first, Python dict fallback
        agency_data = get_agency_profile(agency.abbreviation) or {}

        system_prompt = DRAFT_PROMPT.format(
            statute_title=FOIA_STATUTE["title"],
            statute_citation=FOIA_STATUTE["citation"],
            statute_sections=statute_sections,
            agency_name=agency.name,
            agency_abbreviation=agency.abbreviation,
            agency_regulation=agency.foia_regulation,
            agency_website=agency.foia_website,
            agency_email=agency.foia_email,
            agency_notes=agency.submission_notes,
            agency_cfr_summary=agency_data.get("cfr_summary", "See agency FOIA regulation above."),
            agency_exemption_tendencies=agency_data.get("exemption_tendencies", "No agency-specific exemption data available."),
            agency_routing_notes=agency_data.get("routing_notes", "Submit to the agency FOIA office listed above."),
            agency_cfr_text=agency_data.get("cfr_text", "") or "CFR text not yet loaded — run seed_agency_profiles.py before deployment.",
            similar_requests_context=similar_context,
            agency_intel_context=agency_intel_context,
            fee_waiver_instruction=fee_waiver_instruction,
            expedited_instruction=expedited_instruction,
            time_limit_days="20",
        )

        user_msg = (
            f"RECORDS NEEDED: {description}\n\n"
            f"REQUESTER: {requester_name}"
        )
        if requester_organization:
            user_msg += f", {requester_organization}"
        user_msg += f"\nPREFERRED FORMAT: {preferred_format}"
        if fee_waiver:
            user_msg += "\nREQUESTING FEE WAIVER: Yes"
        if expedited_processing:
            user_msg += "\nREQUESTING EXPEDITED PROCESSING: Yes"

        message = await self.client.messages.create(
            model="claude-sonnet-4-6",
            # Letter (~1k tokens) + 5-field drafting_strategy + key_elements +
            # tips + submission_info routinely exceeds 3k. 8k gives comfortable
            # headroom on Sonnet 4.6 without being wasteful.
            max_tokens=8000,
            system=system_prompt,
            messages=[{"role": "user", "content": user_msg}],
        )

        if message.stop_reason == "max_tokens":
            raise RuntimeError(
                "Drafter response truncated at max_tokens. Output JSON is "
                "incomplete and cannot be parsed. Consider raising max_tokens "
                "or shortening the drafting_strategy sub-fields."
            )

        parsed = _parse_json(message.content[0].text)

        return {
            "letter_text": parsed.get("letter_text", ""),
            "agency": agency,
            "statute_cited": parsed.get("statute_cited", FOIA_STATUTE["citation"]),
            "key_elements": parsed.get("key_elements", []),
            "tips": parsed.get("tips", []),
            "submission_info": parsed.get("submission_info", ""),
            "similar_requests": similar,
            "drafting_strategy": parsed.get("drafting_strategy", {}),
            "agency_intel": intel,
        }

    def _format_similar_requests(self, similar: list[SimilarRequest]) -> str:
        """Format similar MuckRock requests for Claude's context."""
        if not similar:
            return "No similar past requests found on MuckRock."

        completed = [s for s in similar if s.status in ("completed", "partially completed")]
        denied = [s for s in similar if s.status in ("rejected", "no responsive documents")]
        other = [s for s in similar if s not in completed and s not in denied]

        lines = [f"Found {len(similar)} similar FOIA requests on MuckRock:\n"]

        if completed:
            lines.append(f"SUCCESSFUL ({len(completed)}):")
            for s in completed:
                lines.append(f"  - \"{s.title}\" (Status: {s.status})")
                if s.description:
                    lines.append(f"    Context: {s.description[:200]}")

        if denied:
            lines.append(f"\nDENIED/NO RECORDS ({len(denied)}):")
            for s in denied:
                lines.append(f"  - \"{s.title}\" (Status: {s.status})")
                if s.description:
                    lines.append(f"    Context: {s.description[:200]}")

        if other:
            lines.append(f"\nOTHER ({len(other)}):")
            for s in other:
                lines.append(f"  - \"{s.title}\" (Status: {s.status})")

        lines.append(
            "\nUse these outcomes to inform the request: mirror successful request "
            "language, avoid patterns that led to denials, and anticipate likely exemptions."
        )
        return "\n".join(lines)
