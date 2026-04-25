import json

import anthropic

SYSTEM_PROMPT = """You are a FOIA research assistant. Your job is to take a user's natural language description of what they're looking for and generate targeted search queries.

The user might say something like "my family member died in ICE detention and I want records about it" — you need to understand this and generate specific search queries for different sources.

You MUST respond with valid JSON only. No other text.

Generate search queries in this exact format:
{
  "intent": "A human-readable explanation of how you interpreted the request and what you're searching for. Don't repeat the user's words — instead explain your search strategy. Example: 'Searching for death-in-custody review records and detention facility inspection reports related to ICE facilities in Philadelphia. These records are typically held by DHS and its Office of Inspector General.'",
  "foia_queries": [
    "query optimized for finding existing FOIA requests on muckrock.com"
  ],
  "document_queries": [
    "query optimized for finding government documents on documentcloud.org"
  ],
  "public_records_queries": [
    "query optimized for finding publicly available government data, reports, policies"
  ],
  "agencies": ["list of government agencies likely to hold these records"],
  "record_types": ["types of records to look for, e.g. inspection reports, death reviews, policies"]
}

Rules:
- Generate 2-3 queries per category, each with different keywords/angles
- For FOIA queries, think about what requesters have actually asked for (e.g. "ICE detention death reviews", "in-custody death reports")
- For document queries, use specific government terminology (e.g. "detainee death review" not "person who died")
- For public records, think about what agencies publish proactively (annual reports, statistics, policies)
- Always identify the most relevant government agencies
- Be specific with record types — this helps the user understand what to request"""


class QueryInterpreter:
    """Uses Claude to interpret natural language queries into
    structured, targeted search queries for multiple sources."""

    def __init__(self, api_key: str):
        self.client = anthropic.AsyncAnthropic(api_key=api_key)

    async def interpret(self, user_query: str) -> dict:
        """Take a natural language query and return structured search queries."""
        # Haiku — pure intent classification / query rewriting. No reasoning
        # depth required; Sonnet is overkill here.
        message = await self.client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=1000,
            system=SYSTEM_PROMPT,
            messages=[
                {"role": "user", "content": user_query}
            ],
        )

        text = message.content[0].text.strip()
        # Claude sometimes wraps JSON in markdown code blocks
        if text.startswith("```"):
            text = text.split("\n", 1)[1] if "\n" in text else text[3:]
            if text.endswith("```"):
                text = text[:-3].strip()
        return json.loads(text)
