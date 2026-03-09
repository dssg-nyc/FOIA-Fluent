"""JWT authentication middleware for Supabase Auth.

Validates the Supabase JWT from the Authorization: Bearer header.
Extracts the user_id (sub claim) for use in route handlers.

Usage in route handlers:
    from app.middleware.auth import get_current_user_id

    @router.get("/something")
    async def my_endpoint(user_id: str = Depends(get_current_user_id)):
        ...

Local dev behavior:
    If SUPABASE_URL is not configured, get_current_user_id returns a fixed
    dev user ID so the app works without authentication during development.
"""
import logging
from typing import Optional

import jwt
from fastapi import Header, HTTPException
from jwt import PyJWKClient

from app.config import settings

logger = logging.getLogger(__name__)

# JWKS endpoint for Supabase JWT validation
# Supabase publishes public keys at this URL
_jwks_client: Optional[PyJWKClient] = None

# Fixed user ID for local dev (when Supabase is not configured)
DEV_USER_ID = "00000000-0000-0000-0000-000000000000"


def _get_jwks_client() -> Optional[PyJWKClient]:
    global _jwks_client
    if _jwks_client is not None:
        return _jwks_client
    if not settings.supabase_url:
        return None
    try:
        jwks_url = f"{settings.supabase_url}/auth/v1/.well-known/jwks.json"
        _jwks_client = PyJWKClient(jwks_url, cache_keys=True)
        return _jwks_client
    except Exception as e:
        logger.warning(f"JWKS client init failed: {e}")
        return None


async def get_current_user_id(
    authorization: str = Header(default="", alias="Authorization"),
) -> str:
    """FastAPI dependency that extracts and validates the Supabase JWT.

    Returns the user's UUID (sub claim) from the token.
    In local dev (no Supabase configured), returns a fixed dev user ID.

    Raises HTTP 401 if the token is missing or invalid (deployed mode only).
    """
    # Local dev: no Supabase configured → skip auth
    if not settings.supabase_url:
        return DEV_USER_ID

    if not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=401,
            detail="Missing or invalid Authorization header. Expected: Bearer <token>",
        )

    token = authorization.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Empty token")

    jwks = _get_jwks_client()
    if not jwks:
        # Supabase URL is set but JWKS not available — fail secure
        raise HTTPException(status_code=503, detail="Auth service unavailable")

    try:
        signing_key = jwks.get_signing_key_from_jwt(token)
        payload = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            audience="authenticated",
            options={"verify_exp": True},
        )
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="Token missing user ID")
        return user_id
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {e}")
