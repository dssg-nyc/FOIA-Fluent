"""Insights endpoints — public, no authentication required.

GET /api/v1/hub/insights
    Comprehensive FOIA insights: trends, exemptions, costs, staffing, news.
"""
from fastapi import APIRouter

from app.models.insights import InsightsOverview
from app.services import insights as insights_service

router = APIRouter(prefix="/hub/insights", tags=["insights"])


@router.get("", response_model=InsightsOverview)
def get_insights():
    """Full FOIA insights overview with all sections."""
    return insights_service.get_insights_overview()
