"""User profile — sender info used when filing FOIA requests.

Kept separate from auth.users because Supabase's auth schema isn't meant to be
mutated and we want to store fields (phone, mailing_address, etc.) that aren't
populated by OAuth providers.
"""
from typing import Optional

from pydantic import BaseModel


class UserProfile(BaseModel):
    full_name: str = ""
    organization: str = ""
    email: str = ""
    phone: str = ""
    mailing_address: str = ""
    requester_category: str = "other"


class UpdateUserProfilePayload(BaseModel):
    full_name: Optional[str] = None
    organization: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    mailing_address: Optional[str] = None
    requester_category: Optional[str] = None
