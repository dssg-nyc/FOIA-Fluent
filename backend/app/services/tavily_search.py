import asyncio

from tavily import AsyncTavilyClient

from app.models.search import SearchResult


class TavilySearchClient:
    """Domain-scoped search using Tavily.

    Runs targeted searches against specific domains
    (MuckRock for FOIA requests, DocumentCloud for documents, etc.)
    """

    def __init__(self, api_key: str):
        self.client = AsyncTavilyClient(api_key=api_key)

    async def search_foia_requests(
        self, queries: list[str], max_results: int = 5
    ) -> list[SearchResult]:
        """Search MuckRock for existing FOIA requests."""
        tasks = [
            self._search(
                query=q,
                max_results=max_results,
                domains=["muckrock.com"],
                category="foia_request",
            )
            for q in queries[:3]
        ]
        results_lists = await asyncio.gather(*tasks)
        return self._deduplicate(
            [r for results in results_lists for r in results]
        )

    async def search_documents(
        self, queries: list[str], max_results: int = 5
    ) -> list[SearchResult]:
        """Search DocumentCloud and gov sites for public documents."""
        tasks = [
            self._search(
                query=q,
                max_results=max_results,
                domains=[
                    "documentcloud.org",
                    "govinfo.gov",
                    "gao.gov",
                    "oversight.gov",
                ],
                category="document",
            )
            for q in queries[:3]
        ]
        results_lists = await asyncio.gather(*tasks)
        return self._deduplicate(
            [r for results in results_lists for r in results]
        )

    async def search_public_records(
        self, queries: list[str], max_results: int = 5
    ) -> list[SearchResult]:
        """Search for publicly available government data and reports."""
        tasks = [
            self._search(
                query=q,
                max_results=max_results,
                domains=[
                    "data.gov",
                    "ice.gov",
                    "dhs.gov",
                    "justice.gov",
                    "foia.gov",
                    "aclu.org",
                    "propublica.org",
                    "reuters.com",
                ],
                category="public_record",
            )
            for q in queries[:3]
        ]
        results_lists = await asyncio.gather(*tasks)
        return self._deduplicate(
            [r for results in results_lists for r in results]
        )

    async def _search(
        self,
        query: str,
        max_results: int,
        domains: list[str],
        category: str,
    ) -> list[SearchResult]:
        try:
            response = await self.client.search(
                query=query,
                max_results=min(max_results, 10),
                search_depth="advanced",
                include_domains=domains,
            )

            results = []
            for item in response.get("results", []):
                url = item.get("url", "")
                source = "muckrock" if "muckrock.com" in url else (
                    "documentcloud" if "documentcloud.org" in url else "web"
                )
                results.append(
                    SearchResult(
                        id=f"tv-{hash(url) & 0xFFFFFFFF}",
                        title=item.get("title", ""),
                        status=category,
                        source=source,
                        url=url,
                        description=item.get("content", "")[:300],
                    )
                )
            return results
        except Exception:
            return []

    def _deduplicate(self, results: list[SearchResult]) -> list[SearchResult]:
        seen: set[str] = set()
        unique: list[SearchResult] = []
        for r in results:
            normalized = r.url.rstrip("/").lower()
            if normalized not in seen:
                seen.add(normalized)
                unique.append(r)
        return unique
