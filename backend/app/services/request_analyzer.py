"""Claude-powered analysis of an existing FOIA request letter.

Unlike drafter.py (which writes a new letter), this service takes an already-written
letter and assesses its quality against the same legal + research context the drafter uses:
verified statute text, agency CFR regulation, similar MuckRock outcomes, and agency intel.

Output is a DraftingStrategy — the same shape as what the drafter produces — so the
detail page can display it under "Analysis of Your Request" instead of "How We Built This Draft".
"""
import asyncio
import json
import logging

import anthropic

from app.data.federal_foia_statute import FOIA_STATUTE
from app.models.draft import AgencyInfo, AgencyIntel, DraftingStrategy, SimilarRequest
from app.services.agency_profiles import get_agency_profile
from app.services.agency_intel import AgencyIntelAgent
from app.services.drafter import FOIADrafter, _build_statute_sections

logger = logging.getLogger(__name__)

ANALYZE_LETTER_PROMPT = """\
You are a FOIA expert reviewing an existing FOIA request letter. Your job is to assess its
strength, identify risks, and give the requester actionable guidance — not to rewrite it.

CRITICAL RULES — ANTI-HALLUCINATION:
- Assess exemption risk ONLY using the exemptions defined in VERIFIED LEGAL CONTEXT below
- Do NOT cite any legal authority not provided here
- Use ONLY the agency information in AGENCY INFORMATION — never invent addresses or offices

=== VERIFIED LEGAL CONTEXT ===

STATUTE: {statute_title} ({statute_citation})

{statute_sections}

=== AGENCY INFORMATION ===

Agency: {agency_name} ({agency_abbreviation})
FOIA Regulation: {agency_regulation}
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

=== LETTER TO REVIEW ===

{letter_text}

=== END LETTER ===

Analyze the letter above and return ONLY a JSON object with this exact structure:
{{
  "summary": "2-3 sentence overall assessment: what the letter does well and its main risks",
  "learned_from_successes": "How this letter compares to successful similar MuckRock requests — what it does well that mirrors winning approaches (or 'No successful similar requests found for comparison' if none)",
  "avoided_from_denials": "Whether the letter avoids patterns from denied similar requests — and any remaining risks the requester should know about (or 'No denied requests found for comparison' if none)",
  "scope_decisions": "Assessment of scope calibration — is it too broad (risks Exemption 7(E) or fee issues), too narrow (may miss relevant records), or well-calibrated? Note specific date ranges, record types, or program references that strengthen or weaken it",
  "exemption_awareness": "Which exemptions this agency commonly invokes and whether this letter minimizes exposure to each — note any language that could invite exemption claims"
}}"""


def _parse_json(text: str) -> dict:
    text = text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else text[3:]
        if text.endswith("```"):
            text = text[:-3].strip()
    return json.loads(text)


class RequestAnalyzer:
    """Analyzes an existing FOIA letter and runs the full research pipeline.

    Produces the same output shape as FOIADrafter.generate_draft() so it can
    be stored in and displayed from TrackedRequest identically.
    """

    def __init__(self, anthropic_api_key: str, tavily_api_key: str = ""):
        self.client = anthropic.AsyncAnthropic(api_key=anthropic_api_key)
        self._drafter = FOIADrafter(anthropic_api_key, tavily_api_key)

    async def analyze_import(
        self,
        letter_text: str,
        description: str,
        agency: AgencyInfo,
    ) -> dict:
        """Run full research pipeline + letter analysis.

        Returns a dict with the same keys as FOIADrafter.generate_draft():
        similar_requests, agency_intel, drafting_strategy (as DraftingStrategy),
        statute_cited, key_elements, tips, submission_info.
        """
        # Run research concurrently — same pipeline as new-request drafting
        tasks = [self._drafter.research_similar_requests(agency.name, description)]
        if self._drafter.intel_agent:
            tasks.append(
                self._drafter.intel_agent.research_agency(agency.abbreviation, agency.name)
            )

        results = await asyncio.gather(*tasks)
        similar: list[SimilarRequest] = results[0]
        intel: AgencyIntel = results[1] if len(results) > 1 else AgencyIntel()

        # Build analysis context
        similar_context = self._drafter._format_similar_requests(similar)
        agency_intel_context = (
            self._drafter.intel_agent.format_for_prompt(intel)
            if self._drafter.intel_agent and intel
            else "No agency-level FOIA intelligence available."
        )
        statute_sections = _build_statute_sections()
        agency_data = get_agency_profile(agency.abbreviation) or {}

        system_prompt = ANALYZE_LETTER_PROMPT.format(
            statute_title=FOIA_STATUTE["title"],
            statute_citation=FOIA_STATUTE["citation"],
            statute_sections=statute_sections,
            agency_name=agency.name,
            agency_abbreviation=agency.abbreviation,
            agency_regulation=agency.foia_regulation,
            agency_cfr_summary=agency_data.get("cfr_summary", "See agency FOIA regulation above."),
            agency_exemption_tendencies=agency_data.get("exemption_tendencies", "No agency-specific exemption data available."),
            agency_routing_notes=agency_data.get("routing_notes", "Submit to the agency FOIA office listed above."),
            agency_cfr_text=agency_data.get("cfr_text", "") or "CFR text not yet loaded — run seed_agency_profiles.py before deployment.",
            similar_requests_context=similar_context,
            agency_intel_context=agency_intel_context,
            letter_text=letter_text,
        )

        message = await self.client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=2000,
            system="You are a FOIA expert. Return only valid JSON.",
            messages=[{"role": "user", "content": system_prompt}],
        )

        parsed = _parse_json(message.content[0].text)

        drafting_strategy = DraftingStrategy(
            summary=parsed.get("summary", ""),
            learned_from_successes=parsed.get("learned_from_successes", ""),
            avoided_from_denials=parsed.get("avoided_from_denials", ""),
            scope_decisions=parsed.get("scope_decisions", ""),
            exemption_awareness=parsed.get("exemption_awareness", ""),
        )

        # Derive submission info from agency profile
        submission_parts = []
        if agency.foia_website:
            submission_parts.append(f"Portal: {agency.foia_website}")
        if agency.foia_email:
            submission_parts.append(f"Email: {agency.foia_email}")
        if agency.submission_notes:
            submission_parts.append(agency.submission_notes)
        submission_info = " | ".join(submission_parts) if submission_parts else ""

        return {
            "similar_requests": similar,
            "agency_intel": intel,
            "drafting_strategy": drafting_strategy,
            "statute_cited": FOIA_STATUTE["citation"],
            "key_elements": [],
            "tips": [],
            "submission_info": submission_info,
        }
