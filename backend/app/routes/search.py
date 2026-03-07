from fastapi import APIRouter, HTTPException, Request

from app.models.search import SearchRequest, DiscoveryResponse
from app.services.search import DiscoveryPipeline
from app.config import settings

router = APIRouter(tags=["search"])


@router.post("/search", response_model=DiscoveryResponse)
async def discover(body: SearchRequest, request: Request):
    """Run the 3-step discovery pipeline:
    1. Search for existing FOIA requests
    2. Search for publicly available documents
    3. Recommend next steps
    """
    pipeline = DiscoveryPipeline(
        http_client=request.app.state.http_client,
        tavily_api_key=settings.tavily_api_key,
        anthropic_api_key=settings.anthropic_api_key,
    )
    try:
        return await pipeline.discover(user_query=body.query)
    except Exception as e:
        raise HTTPException(
            status_code=502,
            detail=f"Discovery failed: {str(e)}",
        )
