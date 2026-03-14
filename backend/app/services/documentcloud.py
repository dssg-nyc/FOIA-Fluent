import httpx

from app.models.search import SearchResult

DOCUMENTCLOUD_API = "https://api.www.documentcloud.org/api"


class DocumentCloudClient:
    """Async client for the DocumentCloud public API.

    Full-text search across public-interest documents.
    No authentication required for public documents.
    """

    def __init__(self, http_client: httpx.AsyncClient):
        self.client = http_client

    async def search(
        self, query: str, page: int = 1, per_page: int = 10
    ) -> tuple[list[SearchResult], int]:
        """Search DocumentCloud for public documents.

        Returns (results, total_count).
        """
        response = await self.client.get(
            f"{DOCUMENTCLOUD_API}/documents/search/",
            params={
                "q": query,
                "page": page,
                "per_page": min(per_page, 25),
            },
        )
        response.raise_for_status()
        data = response.json()

        results = []
        for doc in data.get("results", []):
            results.append(
                SearchResult(
                    id=f"dc-{doc['id']}",
                    title=doc.get("title", "Untitled"),
                    status="document",
                    source="documentcloud",
                    url=doc.get("canonical_url", ""),
                    date=doc.get("created_at", "")[:10] if doc.get("created_at") else None,
                    description=doc.get("description", "") or "",
                    agency=doc.get("organization", {}).get("name", "") if isinstance(doc.get("organization"), dict) else "",
                    page_count=doc.get("page_count"),
                )
            )

        return results, data.get("count", 0)
