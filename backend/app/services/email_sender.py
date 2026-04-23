"""Thin wrapper over Resend for outbound FOIA filing emails.

Sending addresses follow the pattern:
    "<User Name> via FOIA Fluent <reply-{request_id}@{RESEND_FROM_DOMAIN}>"

The Reply-To is identical, so agency replies flow back to Resend's inbound
webhook, which we route into /api/v1/submissions/inbound where we match the
`reply-{request_id}` prefix and log the reply into the request's
communications log.

Phase 1 design notes:
- No tracking pixels, no marketing styling. Plain email that looks like a
  professional FOIA request.
- Short visible "Filed via FOIA Fluent" footer for transparency (our identity
  is not hidden — agencies correspond with the user whose info is in the
  letter body, but they know the transport).
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Optional

from app.config import settings

logger = logging.getLogger(__name__)


def _reply_address(request_id: str) -> str:
    """Per-request inbound address. Resend routes `reply-*@domain` → webhook."""
    return f"reply-{request_id}@{settings.resend_from_domain}"


@dataclass
class OutboundEmailResult:
    """Result of a Resend send. Includes the Resend message id (stored in the
    run's receipt) and the reply-to address used (stored so we know which
    inbound webhooks belong to which run)."""
    message_id: str
    reply_to: str
    subject: str


def send_foia_request_email(
    *,
    request_id: str,
    agency_email: str,
    subject: str,
    letter_text: str,
    requester_name: str,
) -> OutboundEmailResult:
    """Send a drafted FOIA request to an agency.

    Raises an exception on Resend API failure — the submitter's caller
    catches and writes the failure into the submission_runs log.
    """
    if not settings.resend_api_key:
        raise RuntimeError("RESEND_API_KEY not configured")
    if not agency_email:
        raise ValueError("Agency email is required")

    import resend
    resend.api_key = settings.resend_api_key

    reply_to = _reply_address(request_id)
    display_name = (requester_name or "FOIA Fluent user").strip()
    from_header = f'"{display_name} via FOIA Fluent" <{reply_to}>'

    body_text = _format_letter_body(letter_text=letter_text)
    body_html = _format_letter_html(letter_text=letter_text)

    params: dict = {
        "from": from_header,
        "to": [agency_email],
        "reply_to": reply_to,
        "subject": subject[:200],
        "text": body_text,
        "html": body_html,
        "headers": {
            # Makes thread matching on the agency side a bit more robust;
            # agencies that reply will quote this header back.
            "X-FOIA-Request-Id": request_id,
        },
    }

    logger.info(
        "sending FOIA email",
        extra={
            "request_id": request_id,
            "agency_email": agency_email,
            "reply_to": reply_to,
        },
    )

    response = resend.Emails.send(params)
    # Resend returns either {"id": "..."} or a dict with more fields. We only
    # need the id for the audit log.
    message_id = (
        response.get("id") if isinstance(response, dict) else getattr(response, "id", None)
    )
    if not message_id:
        raise RuntimeError(f"Resend returned unexpected response: {response!r}")

    return OutboundEmailResult(
        message_id=message_id,
        reply_to=reply_to,
        subject=params["subject"],
    )


# ── Body formatting ─────────────────────────────────────────────────────────

FOOTER_TEXT = (
    "—\n"
    "This request was filed via FOIA Fluent (foiafluent.com), an open-source\n"
    "civic AI platform. Replies to this address will be forwarded to the\n"
    "requester and logged in their request record."
)

FOOTER_HTML = (
    '<hr style="margin:24px 0;border:none;border-top:1px solid #e5e7eb"/>'
    '<p style="font-size:12px;color:#6e6e7a;line-height:1.5;margin:0">'
    'This request was filed via '
    '<a href="https://foiafluent.com" style="color:#1863dc;text-decoration:none">'
    'FOIA Fluent</a>, an open-source civic AI platform. Replies to this '
    'address will be forwarded to the requester and logged in their request '
    'record.</p>'
)


def _format_letter_body(*, letter_text: str) -> str:
    """Plain-text body = the drafter's letter + a short identification footer."""
    letter_text = (letter_text or "").strip()
    return f"{letter_text}\n\n\n{FOOTER_TEXT}"


def _format_letter_html(*, letter_text: str) -> str:
    """HTML body that preserves the drafter's line breaks without adding
    marketing chrome. One wrapper div, whitespace preserved, footer below."""
    letter_text = (letter_text or "").strip()
    # Escape minimally (the drafter's output is our own content, not user HTML)
    import html
    safe = html.escape(letter_text)
    return (
        '<div style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\','
        'Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.55;'
        'color:#111;max-width:680px">'
        f'<pre style="font-family:inherit;white-space:pre-wrap;word-wrap:break-word;margin:0">{safe}</pre>'
        f'{FOOTER_HTML}'
        '</div>'
    )


# ── Inbound webhook parsing ─────────────────────────────────────────────────

@dataclass
class InboundEmail:
    request_id: str
    from_address: str
    subject: str
    text_body: str
    html_body: Optional[str]
    received_at: str  # ISO 8601
    raw_payload: dict


def parse_inbound_payload(payload: dict) -> Optional[InboundEmail]:
    """Extract request_id + content from a Resend inbound webhook payload.

    Returns None if the `to` address doesn't match our `reply-{uuid}@domain`
    pattern (e.g. spam sent to a random address on our domain).

    Payload shape (Resend inbound):
      {
        "from": { "email": "...", "name": "..." },
        "to": [{ "email": "reply-abc@foiafluent.com" }],
        "subject": "...",
        "text": "...",
        "html": "...",
        "date": "2026-01-01T00:00:00Z",
        ...
      }
    """
    import re

    to_list = payload.get("to") or []
    for entry in to_list:
        email = (entry.get("email") if isinstance(entry, dict) else str(entry)) or ""
        m = re.match(r"^reply-([0-9a-f-]{36})@", email, re.IGNORECASE)
        if m:
            request_id = m.group(1)
            from_field = payload.get("from") or {}
            from_address = (
                from_field.get("email") if isinstance(from_field, dict) else str(from_field)
            ) or ""
            return InboundEmail(
                request_id=request_id,
                from_address=from_address,
                subject=payload.get("subject") or "",
                text_body=payload.get("text") or "",
                html_body=payload.get("html"),
                received_at=payload.get("date") or "",
                raw_payload=payload,
            )

    return None
