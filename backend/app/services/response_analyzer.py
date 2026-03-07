"""Claude-powered analysis of agency FOIA responses.

Given the original request letter and the agency's response, Claude assesses:
- Whether the response is complete relative to the request
- Whether cited exemptions are properly applied under 5 U.S.C. 552
- What records appear to be missing
- Whether there are grounds for an administrative appeal
- What the recommended next action is
"""
import json
import logging
from datetime import datetime, timezone

import anthropic

from app.data.federal_foia_statute import FOIA_STATUTE
from app.models.tracking import ResponseAnalysis, TrackedRequest

logger = logging.getLogger(__name__)

ANALYSIS_PROMPT = """\
You are a FOIA legal analyst. Analyze the agency's response to a FOIA request.

=== VERIFIED LEGAL CONTEXT ===
You must assess exemption claims ONLY against the exemptions defined below.
Do not reference any other legal authority.

EXEMPTIONS UNDER {citation}:
{exemption_text}

APPEAL RIGHTS:
{appeal_text}

=== ORIGINAL REQUEST ===
{original_request}

=== AGENCY RESPONSE ===
{agency_response}

=== ANALYSIS INSTRUCTIONS ===
Assess the agency's response and return a JSON object with this exact structure:

{{
  "response_complete": <true if the response fully addresses all records requested, false otherwise>,
  "exemptions_cited": [<list of exemption codes cited by agency, e.g. "(b)(6)", "(b)(7)(C)">],
  "exemptions_valid": [
    {{
      "exemption": "<exemption code>",
      "assessment": "valid" | "questionable" | "invalid",
      "reasoning": "<one sentence explanation>"
    }}
  ],
  "missing_records": [<list of record categories that appear to be missing or unaddressed>],
  "grounds_for_appeal": [<specific legal grounds if there are basis for appeal, empty list if none>],
  "recommended_action": "accept" | "follow_up" | "appeal" | "negotiate_scope",
  "summary": "<2-3 sentence plain-language summary of the response and recommended path forward>"
}}

Return ONLY the JSON object, no other text.
"""


def _parse_json(text: str) -> dict:
    text = text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else text[3:]
        if text.endswith("```"):
            text = text[:-3].strip()
    return json.loads(text)


def _build_exemption_text() -> str:
    exemptions = FOIA_STATUTE["sections"].get("exemptions", {})
    lines = []
    for code, data in exemptions.items():
        lines.append(f"Exemption {code}: {data.get('text', '')[:200]}")
    return "\n".join(lines)


def _build_appeal_text() -> str:
    appeal = FOIA_STATUTE["sections"].get("appeal_rights", {})
    return appeal.get("text", "Administrative appeals must be filed within 90 days of denial.")


class ResponseAnalyzer:
    def __init__(self, anthropic_api_key: str):
        self.client = anthropic.AsyncAnthropic(api_key=anthropic_api_key)

    async def analyze(
        self, request: TrackedRequest, response_text: str, response_date: str
    ) -> ResponseAnalysis:
        system_prompt = ANALYSIS_PROMPT.format(
            citation=FOIA_STATUTE["citation"],
            exemption_text=_build_exemption_text(),
            appeal_text=_build_appeal_text(),
            original_request=request.letter_text,
            agency_response=response_text,
        )

        message = await self.client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=2000,
            system="You are a FOIA legal analyst. Return only valid JSON.",
            messages=[{"role": "user", "content": system_prompt}],
        )

        parsed = _parse_json(message.content[0].text)

        return ResponseAnalysis(
            request_id=request.id,
            response_complete=parsed.get("response_complete", False),
            exemptions_cited=parsed.get("exemptions_cited", []),
            exemptions_valid=parsed.get("exemptions_valid", []),
            missing_records=parsed.get("missing_records", []),
            grounds_for_appeal=parsed.get("grounds_for_appeal", []),
            recommended_action=parsed.get("recommended_action", "follow_up"),
            summary=parsed.get("summary", ""),
            analyzed_at=datetime.now(timezone.utc).isoformat(),
        )
