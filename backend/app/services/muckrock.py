import httpx

from app.models.search import (
    FOIARequestResult,
    PaginatedResponse,
    AgencyResult,
    AgencyListResponse,
)


class MuckRockClient:
    """Async client for the MuckRock public API.

    Uses a shared httpx.AsyncClient passed from FastAPI lifespan
    for connection pooling. No authentication required for read-only endpoints.
    """

    def __init__(self, http_client: httpx.AsyncClient):
        self.client = http_client

    async def search_requests(
        self, query: str, page: int = 1, page_size: int = 20
    ) -> PaginatedResponse:
        response = await self.client.get(
            "/foia/",
            params={
                "q": query,
                "page": page,
                "page_size": min(page_size, 50),
                "format": "json",
            },
        )
        response.raise_for_status()
        data = response.json()

        results = []
        for item in data.get("results", []):
            results.append(
                FOIARequestResult(
                    id=item["id"],
                    title=item.get("title", ""),
                    slug=item.get("slug", ""),
                    status=item.get("status", ""),
                    agency=item.get("agency", 0),
                    datetime_submitted=item.get("datetime_submitted"),
                    date_due=item.get("date_due"),
                    datetime_done=item.get("datetime_done"),
                    tracking_id=item.get("tracking_id", ""),
                    username=item.get("username", ""),
                    absolute_url=item.get("absolute_url", ""),
                )
            )

        return PaginatedResponse(
            count=data.get("count", 0),
            next=data.get("next"),
            previous=data.get("previous"),
            results=results,
            query=query,
        )

    async def get_request(self, request_id: int) -> dict:
        response = await self.client.get(
            f"/foia/{request_id}/",
            params={"format": "json"},
        )
        response.raise_for_status()
        return response.json()

    async def search_agencies(
        self, query: str, page: int = 1, page_size: int = 20
    ) -> AgencyListResponse:
        response = await self.client.get(
            "/agency/",
            params={
                "search": query,
                "page": page,
                "page_size": min(page_size, 50),
                "format": "json",
            },
        )
        response.raise_for_status()
        data = response.json()

        results = []
        for item in data.get("results", []):
            results.append(
                AgencyResult(
                    id=item["id"],
                    name=item.get("name", ""),
                    slug=item.get("slug", ""),
                    status=item.get("status", ""),
                    jurisdiction=item.get("jurisdiction", 0),
                    average_response_time=item.get("average_response_time", 0),
                    fee_rate=item.get("fee_rate", 0.0),
                    success_rate=item.get("success_rate", 0.0),
                    number_requests=item.get("number_requests", 0),
                    number_requests_completed=item.get(
                        "number_requests_completed", 0
                    ),
                    number_requests_rejected=item.get(
                        "number_requests_rejected", 0
                    ),
                    absolute_url=item.get("absolute_url", ""),
                    has_portal=item.get("has_portal", False),
                )
            )

        return AgencyListResponse(
            count=data.get("count", 0),
            next=data.get("next"),
            previous=data.get("previous"),
            results=results,
        )
