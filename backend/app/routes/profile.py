"""User profile routes — sender info used when filing FOIA requests.

GET  /api/v1/profile    — fetch the current user's profile (empty fields if none saved yet)
PUT  /api/v1/profile    — upsert a partial profile update
"""
from fastapi import APIRouter, Depends

from app.middleware.auth import get_current_user_id
from app.models.profile import UpdateUserProfilePayload, UserProfile
from app.services import user_profile_service

router = APIRouter(prefix="/profile", tags=["profile"])


@router.get("", response_model=UserProfile)
def get_profile_route(user_id: str = Depends(get_current_user_id)):
    return user_profile_service.get_profile(user_id)


@router.put("", response_model=UserProfile)
def update_profile_route(
    payload: UpdateUserProfilePayload,
    user_id: str = Depends(get_current_user_id),
):
    return user_profile_service.upsert_profile(user_id, payload)
