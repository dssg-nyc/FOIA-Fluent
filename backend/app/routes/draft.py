from fastapi import APIRouter, HTTPException

from app.models.draft import (
    AgencyIdentifyRequest,
    AgencyIdentifyResponse,
    DraftRequest,
    DraftResponse,
)
from app.services.drafter import FOIADrafter
from app.config import settings

router = APIRouter(tags=["draft"])


@router.post("/draft/identify-agency", response_model=AgencyIdentifyResponse)
async def identify_agency(body: AgencyIdentifyRequest):
    """Identify the best federal agency for a FOIA request."""
    drafter = FOIADrafter(
        anthropic_api_key=settings.anthropic_api_key,
        tavily_api_key=settings.tavily_api_key,
    )
    try:
        return await drafter.identify_agency(body.description, body.agencies_hint)
    except Exception as e:
        raise HTTPException(
            status_code=502,
            detail=f"Agency identification failed: {str(e)}",
        )


@router.post("/draft/generate", response_model=DraftResponse)
async def generate_draft(body: DraftRequest):
    """Generate an optimized FOIA request letter."""
    drafter = FOIADrafter(
        anthropic_api_key=settings.anthropic_api_key,
        tavily_api_key=settings.tavily_api_key,
    )
    try:
        return await drafter.generate_draft(
            description=body.description,
            agency=body.agency,
            requester_name=body.requester_name,
            requester_organization=body.requester_organization,
            fee_waiver=body.fee_waiver,
            expedited_processing=body.expedited_processing,
            preferred_format=body.preferred_format,
        )
    except Exception as e:
        raise HTTPException(
            status_code=502,
            detail=f"Draft generation failed: {str(e)}",
        )
