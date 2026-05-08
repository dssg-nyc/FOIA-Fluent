"""Single source of truth for "what is this user allowed to do?".

The product has two phases:
  - Phase 1 (now): email wall — any signed-in user gets full access.
  - Phase 2 (later): paywall — only users with an active Stripe
    subscription get full access.

Both phases use the same `AccessLevel` enum. Routes that need gating
add `Depends(require_paid)` (Phase 2) or check `get_user_access_level`
themselves; the only thing that flips between phases is what counts as
"high enough" — no route shape changes.

Today the helper returns 'free' for any user_id and 'guest' for None.
Phase 2 will read user_profiles.subscription_status.
"""
from __future__ import annotations

from typing import Literal

AccessLevel = Literal["guest", "free", "paid"]


def get_user_access_level(user_id: str | None) -> AccessLevel:
    """Effective access level for a user.

    - `guest`: not signed in (no JWT)
    - `free`:  signed in, no active subscription
    - `paid`:  signed in with `user_profiles.subscription_status='active'`

    Phase 1 stub: every signed-in user is `free`. The user_profiles row
    is created automatically by the auth.users trigger but isn't read
    here yet — Phase 2 wires the lookup in.
    """
    if not user_id:
        return "guest"
    return "free"
