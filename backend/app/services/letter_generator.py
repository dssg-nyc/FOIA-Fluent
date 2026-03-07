"""Claude-powered follow-up and appeal letter generation.

Generates two types of letters:
- follow_up: When an agency misses its 20-business-day statutory deadline
- appeal: When an agency denies a request or provides an incomplete response
"""
import logging

import anthropic

from app.data.federal_foia_statute import FOIA_STATUTE
from app.models.tracking import DeadlineInfo, ResponseAnalysis, TrackedRequest

logger = logging.getLogger(__name__)

FOLLOW_UP_PROMPT = """\
You are a FOIA attorney drafting a follow-up letter for an overdue request.

=== VERIFIED LEGAL CONTEXT ===
TIME LIMIT LAW: {time_limit_cite} — {time_limit_text}
APPEAL RIGHTS: {appeal_cite} — {appeal_text}

=== ORIGINAL REQUEST DETAILS ===
Agency: {agency_name} ({agency_abbreviation})
Requester: {requester_name}{requester_org}
Deadline Status: {deadline_label}
Business Days Since Filing: {days_elapsed} of 20 statutory days

=== ORIGINAL REQUEST LETTER ===
{original_request}

=== INSTRUCTIONS ===
Draft a professional follow-up letter that:
1. References the statutory 20-business-day deadline under {time_limit_cite}
2. States clearly that the deadline has passed by {days_over} business days
3. Requests an immediate status update and estimated completion date
4. Preserves all appeal rights (mention the right to treat the non-response as a denial)
5. Is firm but professional — not threatening, but clear about legal obligations
6. Uses the exact agency contact info provided

Return ONLY the letter text (starting with the date line), no additional commentary.
"""

APPEAL_PROMPT = """\
You are a FOIA attorney drafting an administrative appeal letter.

=== VERIFIED LEGAL CONTEXT ===
APPEAL RIGHTS: {appeal_cite} — {appeal_text}
EXEMPTIONS THAT APPLY: {exemption_context}

=== ORIGINAL REQUEST DETAILS ===
Agency: {agency_name} ({agency_abbreviation})
Requester: {requester_name}{requester_org}

=== ORIGINAL REQUEST LETTER ===
{original_request}

=== RESPONSE ANALYSIS ===
Recommended Action: {recommended_action}
Summary: {analysis_summary}
Grounds for Appeal:
{grounds}

Missing Records:
{missing_records}

Exemptions Cited by Agency:
{exemption_validity}

=== ADDITIONAL CONTEXT FROM REQUESTER ===
{extra_context}

=== INSTRUCTIONS ===
Draft a professional administrative appeal letter that:
1. Addresses the appeal to the agency head (use a generic salutation if name unknown)
2. Cites the right to appeal under {appeal_cite}
3. Specifically challenges each ground for appeal identified above with legal reasoning
4. For each improperly applied exemption, explain why it does not apply
5. Identifies the missing records and why they should be provided
6. Requests a response within the statutory timeframe
7. Is well-organized with clear paragraph structure

Return ONLY the letter text (starting with the date line), no additional commentary.
"""


class LetterGenerator:
    def __init__(self, anthropic_api_key: str):
        self.client = anthropic.AsyncAnthropic(api_key=anthropic_api_key)

    async def generate_follow_up(
        self, request: TrackedRequest, deadline: DeadlineInfo
    ) -> str:
        statute = FOIA_STATUTE["sections"]
        time_limit = statute.get("time_limits", {})
        appeal = statute.get("appeal_rights", {})

        days_over = max(0, deadline.business_days_elapsed - 20)

        prompt = FOLLOW_UP_PROMPT.format(
            time_limit_cite=time_limit.get("cite", "5 U.S.C. 552(a)(6)(A)"),
            time_limit_text=time_limit.get("text", "")[:300],
            appeal_cite=appeal.get("cite", "5 U.S.C. 552(a)(6)(A)"),
            appeal_text=appeal.get("text", "")[:200],
            agency_name=request.agency.name,
            agency_abbreviation=request.agency.abbreviation,
            requester_name=request.requester_name,
            requester_org=f", {request.requester_organization}" if request.requester_organization else "",
            deadline_label=deadline.status_label,
            days_elapsed=deadline.business_days_elapsed,
            days_over=days_over,
            original_request=request.letter_text,
        )

        message = await self.client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=2000,
            system="You are a FOIA attorney. Return only the letter text.",
            messages=[{"role": "user", "content": prompt}],
        )

        return message.content[0].text.strip()

    async def generate_appeal(
        self,
        request: TrackedRequest,
        analysis: ResponseAnalysis,
        extra_context: str = "",
    ) -> str:
        statute = FOIA_STATUTE["sections"]
        appeal = statute.get("appeal_rights", {})
        exemptions = statute.get("exemptions", {})

        # Build exemption context for cited exemptions
        exemption_context = ""
        for code in analysis.exemptions_cited:
            clean = code.strip("()")
            for key, data in exemptions.items():
                if clean in key or code in key:
                    exemption_context += f"{code}: {data.get('text', '')[:150]}\n"

        grounds_text = "\n".join(f"- {g}" for g in analysis.grounds_for_appeal) or "- General incompleteness"
        missing_text = "\n".join(f"- {m}" for m in analysis.missing_records) or "- Records not provided"
        validity_text = "\n".join(
            f"- {e['exemption']}: {e['assessment']} — {e['reasoning']}"
            for e in analysis.exemptions_valid
        ) or "- No specific exemptions cited"

        prompt = APPEAL_PROMPT.format(
            appeal_cite=appeal.get("cite", "5 U.S.C. 552(a)(6)(A)(ii)"),
            appeal_text=appeal.get("text", "")[:300],
            exemption_context=exemption_context or "See FOIA statute for applicable exemptions.",
            agency_name=request.agency.name,
            agency_abbreviation=request.agency.abbreviation,
            requester_name=request.requester_name,
            requester_org=f", {request.requester_organization}" if request.requester_organization else "",
            original_request=request.letter_text,
            recommended_action=analysis.recommended_action,
            analysis_summary=analysis.summary,
            grounds=grounds_text,
            missing_records=missing_text,
            exemption_validity=validity_text,
            extra_context=extra_context or "None provided.",
        )

        message = await self.client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=2500,
            system="You are a FOIA attorney. Return only the letter text.",
            messages=[{"role": "user", "content": prompt}],
        )

        return message.content[0].text.strip()
