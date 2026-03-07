import asyncio
import logging

import httpx

from app.models.search import SearchResult, DiscoveryStep, DiscoveryResponse
from app.services.documentcloud import DocumentCloudClient
from app.services.tavily_search import TavilySearchClient
from app.services.query_interpreter import QueryInterpreter

logger = logging.getLogger(__name__)


class DiscoveryPipeline:
    """3-step discovery pipeline:

    Step 1: Has someone already filed a FOIA request for this?
            → Search MuckRock via Tavily
    Step 2: Is this information already publicly available?
            → Search DocumentCloud + gov sites via Tavily
    Step 3: Recommendation — file a new request or use what was found.
    """

    def __init__(
        self,
        http_client: httpx.AsyncClient,
        tavily_api_key: str,
        anthropic_api_key: str,
    ):
        self.dc_client = DocumentCloudClient(http_client)
        self.tavily = TavilySearchClient(tavily_api_key) if tavily_api_key else None
        self.interpreter = (
            QueryInterpreter(anthropic_api_key) if anthropic_api_key else None
        )

    async def discover(self, user_query: str) -> DiscoveryResponse:
        # Step 0: Claude interprets the query
        if self.interpreter:
            try:
                interpreted = await self.interpreter.interpret(user_query)
            except Exception as e:
                logger.error(f"Query interpretation failed: {e}")
                interpreted = self._fallback_interpretation(user_query)
        else:
            interpreted = self._fallback_interpretation(user_query)

        intent = interpreted.get("intent", user_query)
        agencies = interpreted.get("agencies", [])
        record_types = interpreted.get("record_types", [])
        foia_queries = interpreted.get("foia_queries", [user_query])
        doc_queries = interpreted.get("document_queries", [user_query])
        public_queries = interpreted.get("public_records_queries", [user_query])

        # Step 1 + Step 2 run in parallel
        step1_task = self._step1_foia_requests(foia_queries)
        step2_task = self._step2_public_documents(doc_queries, public_queries)

        step1_results, step2_results = await asyncio.gather(
            step1_task, step2_task
        )

        # Build steps
        step1 = DiscoveryStep(
            step=1,
            title="Existing FOIA Requests",
            description="Searching for similar FOIA requests that have already been filed",
            results=step1_results,
            found=len(step1_results) > 0,
        )

        step2 = DiscoveryStep(
            step=2,
            title="Publicly Available Documents",
            description="Searching for documents, reports, and data already in the public domain",
            results=step2_results,
            found=len(step2_results) > 0,
        )

        # Generate recommendation
        recommendation = self._generate_recommendation(
            step1, step2, agencies, record_types
        )

        return DiscoveryResponse(
            query=user_query,
            intent=intent,
            agencies=agencies,
            record_types=record_types,
            steps=[step1, step2],
            recommendation=recommendation,
        )

    async def _step1_foia_requests(
        self, queries: list[str]
    ) -> list[SearchResult]:
        """Search for existing FOIA requests on MuckRock."""
        if not self.tavily:
            return []
        try:
            return await self.tavily.search_foia_requests(queries)
        except Exception as e:
            logger.error(f"FOIA request search failed: {e}")
            return []

    async def _step2_public_documents(
        self, doc_queries: list[str], public_queries: list[str]
    ) -> list[SearchResult]:
        """Search for publicly available documents and data."""
        tasks = []

        # DocumentCloud API (direct, more reliable)
        tasks.append(self._search_documentcloud(doc_queries))

        # Tavily for gov sites and news
        if self.tavily:
            tasks.append(self.tavily.search_public_records(public_queries))

        results_lists = await asyncio.gather(*tasks)
        all_results = [r for results in results_lists for r in results]
        return self._deduplicate(all_results)

    async def _search_documentcloud(
        self, queries: list[str]
    ) -> list[SearchResult]:
        """Run the top query against DocumentCloud API directly."""
        if not queries:
            return []
        try:
            results, _ = await self.dc_client.search(
                queries[0], page=1, per_page=10
            )
            return results
        except Exception as e:
            logger.error(f"DocumentCloud search failed: {e}")
            return []

    def _generate_recommendation(
        self,
        step1: DiscoveryStep,
        step2: DiscoveryStep,
        agencies: list[str],
        record_types: list[str],
    ) -> str:
        if step1.found and step2.found:
            return (
                f"Found {len(step1.results)} existing FOIA request(s) and "
                f"{len(step2.results)} public document(s). Review these first — "
                f"the information you need may already be available. "
                f"If not, we can help you file a targeted FOIA request."
            )
        elif step1.found:
            return (
                f"Found {len(step1.results)} existing FOIA request(s) that may "
                f"be relevant. Check their status — if fulfilled, the documents "
                f"may already be available. If denied or pending, we can help "
                f"you file your own request using lessons from these cases."
            )
        elif step2.found:
            return (
                f"No existing FOIA requests found, but {len(step2.results)} "
                f"public document(s) may be relevant. If these don't contain "
                f"what you need, we can help you draft a FOIA request to "
                f"{', '.join(agencies[:3]) if agencies else 'the relevant agency'}."
            )
        else:
            agency_text = (
                f" to {', '.join(agencies[:3])}"
                if agencies
                else ""
            )
            record_text = (
                f" for {', '.join(record_types[:3])}"
                if record_types
                else ""
            )
            return (
                f"No existing requests or public documents found. "
                f"This likely requires a new FOIA request{agency_text}{record_text}. "
                f"We can help you draft an optimized request."
            )

    def _deduplicate(self, results: list[SearchResult]) -> list[SearchResult]:
        seen: set[str] = set()
        unique: list[SearchResult] = []
        for r in results:
            normalized = r.url.rstrip("/").lower()
            if normalized not in seen:
                seen.add(normalized)
                unique.append(r)
        return unique

    def _fallback_interpretation(self, query: str) -> dict:
        """Basic fallback when Claude is unavailable."""
        return {
            "intent": query,
            "foia_queries": [query],
            "document_queries": [query],
            "public_records_queries": [query],
            "agencies": [],
            "record_types": [],
        }
