"""Chat endpoint — SSE streaming with tool use.

POST /api/v1/chat
    Streamed FOIA research assistant with 4-tier accuracy system.
"""
from typing import Optional

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from app.models.chat import ChatRequest
from app.services.chat import stream_chat

router = APIRouter(prefix="/chat", tags=["chat"])


@router.post("")
async def chat(body: ChatRequest, request: Request):
    """Stream a chat response with tool use."""
    # Extract user_id from auth header if present (optional — chat works without auth)
    user_id = None
    auth_header = request.headers.get("authorization", "")
    if auth_header.startswith("Bearer "):
        try:
            from app.middleware.auth import get_current_user_id
            # Pass full header value — the function expects "Bearer <token>"
            user_id = await get_current_user_id(auth_header)
        except Exception:
            pass  # Chat works without auth, just can't search user's requests

    return StreamingResponse(
        stream_chat(body.messages, body.context, user_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
