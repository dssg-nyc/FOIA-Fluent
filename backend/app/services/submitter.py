"""Submission orchestrator: the state machine that drives automated FOIA filing.

State machine:
    queued --(30-min QA hold; cron ticks at sends_at)--> submitting
    submitting --(channel handler succeeds)--> succeeded
    submitting --(channel handler fails)--> failed
    queued --(user cancels within QA window)--> cancelled

Phase 1 channels:
    - email: send via Resend to agency's FOIA email
    - (foia_gov_api, playwright, computer_use, pdf_mail: deferred)

Concurrency safety:
    - `execute_submission` uses an atomic UPDATE ... WHERE status = 'queued'
      to guard against double-execution if two cron ticks overlap.
    - `cancel_submission` uses the same guard so a cron tick mid-cancel can't
      race past the cancellation.
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

from app.config import settings
from app.models.submissions import (
    QueueSubmissionResponse,
    SubmissionChannel,
    SubmissionLogEntry,
    SubmissionRun,
)

logger = logging.getLogger(__name__)

QA_HOLD_MINUTES = 30


# ── Supabase helpers ────────────────────────────────────────────────────────

def _get_supabase():
    if not settings.supabase_url or not settings.supabase_service_key:
        return None
    from supabase import create_client
    return create_client(settings.supabase_url, settings.supabase_service_key)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row_to_run(row: dict) -> SubmissionRun:
    # Normalize log entries into typed entries
    raw_log = row.get("log") or []
    log_entries: list[SubmissionLogEntry] = []
    for entry in raw_log:
        if isinstance(entry, dict):
            try:
                log_entries.append(SubmissionLogEntry(**entry))
            except Exception:
                continue
    return SubmissionRun(
        id=row["id"],
        request_id=row["request_id"],
        user_id=row["user_id"],
        channel=row["channel"],
        status=row["status"],
        queued_at=row["queued_at"],
        sends_at=row.get("sends_at"),
        submitted_at=row.get("submitted_at"),
        completed_at=row.get("completed_at"),
        agency_tracking_number=row.get("agency_tracking_number"),
        receipt=row.get("receipt") or {},
        log=log_entries,
        error=row.get("error"),
        cancel_reason=row.get("cancel_reason"),
    )


# ── Channel selection ───────────────────────────────────────────────────────

def _pick_channel(
    agency: dict,
    override: Optional[str] = None,
) -> Optional[SubmissionChannel]:
    """Pick the best filing channel for an agency.

    Priority:
      1. Explicit override (if supported in Phase 1)
      2. agency.submission_channels list, highest priority first,
         filtered to Phase 1 supported types
      3. agency.foia_email as implicit "email" channel (covers ~100%
         of federal agencies even without structured channel metadata)
    """
    supported = {"email"}  # Phase 1 only

    if override and override in supported:
        endpoint = (agency or {}).get("foia_email") or ""
        if endpoint:
            return SubmissionChannel(type=override, endpoint=endpoint, priority=1)

    raw_channels = (agency or {}).get("submission_channels") or []
    # Sort by priority ascending (1 = preferred)
    raw_channels = sorted(
        raw_channels,
        key=lambda c: c.get("priority", 999) if isinstance(c, dict) else 999,
    )
    for c in raw_channels:
        if not isinstance(c, dict):
            continue
        ctype = c.get("type")
        if ctype in supported and c.get("endpoint"):
            return SubmissionChannel(
                type=ctype,
                endpoint=c["endpoint"],
                priority=c.get("priority", 1),
                notes=c.get("notes", ""),
            )

    # Implicit email fallback
    foia_email = (agency or {}).get("foia_email") or ""
    if foia_email:
        return SubmissionChannel(type="email", endpoint=foia_email, priority=99)

    return None


# ── Request + agency loading ────────────────────────────────────────────────

def _load_request(request_id: str, user_id: str) -> Optional[dict]:
    supabase = _get_supabase()
    if not supabase:
        return None
    try:
        r = (
            supabase.table("tracked_requests")
            .select("*")
            .eq("id", request_id)
            .eq("user_id", user_id)
            .single()
            .execute()
        )
        return r.data or None
    except Exception as e:
        logger.warning(f"load_request failed for {request_id}: {e}")
        return None


def _load_agency_profile(abbreviation: str) -> dict:
    """Best-effort agency lookup by abbreviation. Returns empty dict if
    unavailable — the caller can still fall back to inline agency metadata
    from the tracked_request."""
    if not abbreviation:
        return {}
    supabase = _get_supabase()
    if not supabase:
        return {}
    try:
        r = (
            supabase.table("agency_profiles")
            .select("*")
            .eq("abbreviation", abbreviation)
            .single()
            .execute()
        )
        return r.data or {}
    except Exception:
        return {}


def _resolve_agency_contact(tracked_request: dict) -> dict:
    """Combine the tracked_request's agency JSONB with the richer
    agency_profiles row. The profile wins if present."""
    inline = tracked_request.get("agency") or {}
    abbrev = inline.get("abbreviation") or ""
    profile = _load_agency_profile(abbrev)
    merged = dict(inline)
    for k, v in (profile or {}).items():
        if v not in (None, "", [], {}):
            merged[k] = v
    return merged


# ── Channel preview (UI hint before user clicks Confirm) ────────────────────

def preview_channel(request_id: str, user_id: str) -> Optional[dict]:
    """Return the channel the submitter *would* use if the user confirmed now.

    Returned dict shape:
      {
        "supported": true,                          # email channel available
        "channel": {type, endpoint, priority},      # the picked channel (if supported)
        "agency_name": "Environmental Protection Agency",
        "agency_abbreviation": "EPA",
        "foia_website": "https://www.epa.gov/foia", # always populated so the
                                                     # portal-only UI can link out
        "submission_notes": "..."                   # agency-specific guidance
      }

    When `supported=false`, the frontend should render a portal-only variant
    of the AutoFile card pointing the user at `foia_website`.
    """
    req = _load_request(request_id, user_id)
    if not req:
        return None

    agency = _resolve_agency_contact(req)
    channel = _pick_channel(agency)

    return {
        "supported": channel is not None,
        "channel": (
            {
                "type": channel.type,
                "endpoint": channel.endpoint,
                "priority": channel.priority,
            }
            if channel
            else None
        ),
        "agency_name": (agency or {}).get("name", ""),
        "agency_abbreviation": (agency or {}).get("abbreviation", ""),
        "foia_website": (agency or {}).get("foia_website", ""),
        "submission_notes": (agency or {}).get("submission_notes", ""),
    }


# ── Queue a submission ──────────────────────────────────────────────────────

def queue_submission(
    *,
    request_id: str,
    user_id: str,
    channel_override: Optional[str] = None,
    send_immediately: bool = False,
) -> Optional[QueueSubmissionResponse]:
    """Create a `submission_runs` row in `queued` state. The cron picks it up
    at `sends_at` and calls `execute_submission`."""
    supabase = _get_supabase()
    if not supabase:
        logger.error("queue_submission: supabase unavailable")
        return None

    req = _load_request(request_id, user_id)
    if not req:
        logger.warning(f"queue_submission: request {request_id} not found for user {user_id}")
        return None

    agency = _resolve_agency_contact(req)
    channel = _pick_channel(agency, override=channel_override)
    if not channel:
        logger.warning(f"queue_submission: no supported channel for request {request_id}")
        return None

    now = datetime.now(timezone.utc)
    sends_at = now if send_immediately else now + timedelta(minutes=QA_HOLD_MINUTES)

    row_in = {
        "request_id": request_id,
        "user_id": user_id,
        "channel": channel.type,
        "status": "queued",
        "queued_at": now.isoformat(),
        "sends_at": sends_at.isoformat(),
        "log": [
            SubmissionLogEntry(
                ts=now,
                action="queued",
                detail={
                    "channel": channel.type,
                    "endpoint": channel.endpoint,
                    "sends_at": sends_at.isoformat(),
                    "immediate": send_immediately,
                },
            ).model_dump(mode="json"),
        ],
    }

    try:
        res = supabase.table("submission_runs").insert(row_in).execute()
        if not res.data:
            return None
        run = _row_to_run(res.data[0])
    except Exception as e:
        logger.exception(f"queue_submission insert failed: {e}")
        return None

    agency_label = agency.get("name") or agency.get("abbreviation") or "agency"
    channel_summary = f"{_pretty_channel(channel.type)} · {channel.endpoint} ({agency_label})"
    seconds_until_send = max(0, int((sends_at - now).total_seconds()))

    return QueueSubmissionResponse(
        run=run,
        channel_summary=channel_summary,
        seconds_until_send=seconds_until_send,
    )


def _pretty_channel(c: str) -> str:
    return {
        "email": "Email",
        "foia_gov_api": "FOIA.gov API",
        "portal": "Agency portal",
        "mail": "Postal mail",
    }.get(c, c)


# ── Cancel ──────────────────────────────────────────────────────────────────

def cancel_submission(
    *,
    run_id: str,
    user_id: str,
    reason: str = "",
) -> Optional[SubmissionRun]:
    supabase = _get_supabase()
    if not supabase:
        return None
    try:
        # Atomic: only cancel if still queued. If cron already picked it up,
        # the WHERE clause mismatches and no row is updated.
        res = (
            supabase.table("submission_runs")
            .update(
                {
                    "status": "cancelled",
                    "completed_at": _now_iso(),
                    "cancel_reason": reason or "user cancelled",
                }
            )
            .eq("id", run_id)
            .eq("user_id", user_id)
            .eq("status", "queued")
            .execute()
        )
        if res.data:
            _append_log(
                run_id,
                SubmissionLogEntry(
                    ts=datetime.now(timezone.utc),
                    action="cancelled",
                    detail={"reason": reason},
                ),
            )
            return _row_to_run(res.data[0])
    except Exception as e:
        logger.exception(f"cancel_submission failed for {run_id}: {e}")
    return None


# ── Get / list ──────────────────────────────────────────────────────────────

def get_run(run_id: str, user_id: str) -> Optional[SubmissionRun]:
    supabase = _get_supabase()
    if not supabase:
        return None
    try:
        r = (
            supabase.table("submission_runs")
            .select("*")
            .eq("id", run_id)
            .eq("user_id", user_id)
            .single()
            .execute()
        )
        return _row_to_run(r.data) if r.data else None
    except Exception:
        return None


def list_runs_for_request(request_id: str, user_id: str) -> list[SubmissionRun]:
    supabase = _get_supabase()
    if not supabase:
        return []
    try:
        r = (
            supabase.table("submission_runs")
            .select("*")
            .eq("request_id", request_id)
            .eq("user_id", user_id)
            .order("queued_at", desc=True)
            .execute()
        )
        return [_row_to_run(row) for row in (r.data or [])]
    except Exception:
        return []


# ── Log append helper ──────────────────────────────────────────────────────

def _append_log(run_id: str, entry: SubmissionLogEntry) -> None:
    """Append one entry to the run's log JSONB. Supabase PostgREST doesn't
    support JSON append natively, so we read-modify-write. Acceptable here
    because runs only get one writer (the cron or an HTTP handler)."""
    supabase = _get_supabase()
    if not supabase:
        return
    try:
        current = (
            supabase.table("submission_runs")
            .select("log")
            .eq("id", run_id)
            .single()
            .execute()
        )
        existing = (current.data or {}).get("log") or []
        existing.append(entry.model_dump(mode="json"))
        supabase.table("submission_runs").update({"log": existing}).eq("id", run_id).execute()
    except Exception as e:
        logger.warning(f"append_log failed for {run_id}: {e}")


# ── Execute (the filing step) ───────────────────────────────────────────────

def execute_submission(run_id: str) -> Optional[SubmissionRun]:
    """Transition a queued run to submitting and dispatch to the channel
    handler. Intended to be called by `scripts/process_submission_queue.py`
    (cron) but safe to call manually for testing.

    Idempotent: the atomic UPDATE guard means a second concurrent call is a
    no-op.
    """
    supabase = _get_supabase()
    if not supabase:
        return None

    # Atomic transition: queued → submitting. Only the winning call proceeds.
    try:
        res = (
            supabase.table("submission_runs")
            .update({"status": "submitting", "submitted_at": _now_iso()})
            .eq("id", run_id)
            .eq("status", "queued")
            .execute()
        )
        if not res.data:
            logger.info(f"execute_submission: {run_id} not in queued state, skipping")
            return None
        run_row = res.data[0]
    except Exception as e:
        logger.exception(f"execute_submission transition failed for {run_id}: {e}")
        return None

    run = _row_to_run(run_row)

    try:
        if run.channel == "email":
            return _send_via_email(run)
        # Phase 2+ channels fall through to failure below
        _mark_failed(run.id, f"Channel '{run.channel}' not implemented in Phase 1")
        return get_run(run.id, run.user_id)
    except Exception as e:
        logger.exception(f"execute_submission handler failed for {run_id}: {e}")
        _mark_failed(run.id, str(e))
        return get_run(run.id, run.user_id)


def _send_via_email(run: SubmissionRun) -> Optional[SubmissionRun]:
    """Email channel handler: fetch request + agency, send via Resend, log."""
    from app.services.email_sender import send_foia_request_email

    req = _load_request(run.request_id, run.user_id)
    if not req:
        _mark_failed(run.id, "Request not found during execute")
        return get_run(run.id, run.user_id)

    agency = _resolve_agency_contact(req)
    channel = _pick_channel(agency)
    if not channel or channel.type != "email":
        _mark_failed(run.id, "No email channel available for this agency")
        return get_run(run.id, run.user_id)

    title = (req.get("title") or "").strip() or "Records Request"
    letter_text = req.get("letter_text") or ""
    requester_name = req.get("requester_name") or ""

    subject = f"FOIA Request: {title}"

    _append_log(
        run.id,
        SubmissionLogEntry(
            ts=datetime.now(timezone.utc),
            action="email_preparing",
            detail={"to": channel.endpoint, "subject": subject},
        ),
    )

    try:
        result = send_foia_request_email(
            request_id=run.request_id,
            agency_email=channel.endpoint,
            subject=subject,
            letter_text=letter_text,
            requester_name=requester_name,
        )
    except Exception as e:
        _append_log(
            run.id,
            SubmissionLogEntry(
                ts=datetime.now(timezone.utc),
                level="error",
                action="email_send_failed",
                detail={"error": str(e)[:500]},
            ),
        )
        _mark_failed(run.id, f"Email send failed: {e}")
        return get_run(run.id, run.user_id)

    # Success — update run, log communication, mark request as submitted
    supabase = _get_supabase()
    if not supabase:
        _mark_failed(run.id, "Supabase unavailable during success path")
        return get_run(run.id, run.user_id)

    try:
        supabase.table("submission_runs").update(
            {
                "status": "succeeded",
                "completed_at": _now_iso(),
                "receipt": {
                    "message_id": result.message_id,
                    "reply_to": result.reply_to,
                    "subject": result.subject,
                    "to": channel.endpoint,
                },
            }
        ).eq("id", run.id).execute()
        _append_log(
            run.id,
            SubmissionLogEntry(
                ts=datetime.now(timezone.utc),
                action="email_sent",
                detail={
                    "message_id": result.message_id,
                    "reply_to": result.reply_to,
                },
            ),
        )
    except Exception as e:
        logger.exception(f"mark-succeeded failed for {run.id}: {e}")

    # Log the outgoing communication
    try:
        supabase.table("communications").insert(
            {
                "request_id": run.request_id,
                "direction": "outgoing",
                "comm_type": "initial_request",
                "subject": subject,
                "body": letter_text,
                "date": date.today().isoformat(),
            }
        ).execute()
    except Exception as e:
        logger.warning(f"communications insert failed: {e}")

    # Update tracked_request status + confirmation
    try:
        supabase.table("tracked_requests").update(
            {
                "status": "awaiting_response",
                "submission_method": "email",
                "submitted_at": _now_iso(),
                "filed_date": date.today().isoformat(),
            }
        ).eq("id", run.request_id).eq("user_id", run.user_id).execute()
    except Exception as e:
        logger.warning(f"tracked_request status update failed: {e}")

    return get_run(run.id, run.user_id)


def _mark_failed(run_id: str, reason: str) -> None:
    supabase = _get_supabase()
    if not supabase:
        return
    try:
        supabase.table("submission_runs").update(
            {
                "status": "failed",
                "completed_at": _now_iso(),
                "error": reason[:1000],
            }
        ).eq("id", run_id).execute()
    except Exception as e:
        logger.exception(f"mark_failed failed for {run_id}: {e}")


# ── Inbound (agency reply) handler ──────────────────────────────────────────

def handle_inbound_reply(payload: dict) -> Optional[dict]:
    """Called by the /submissions/inbound webhook. Parses the Resend inbound
    payload, matches the `reply-{request_id}` address, and logs an incoming
    communication on the matching tracked_request."""
    from app.services.email_sender import parse_inbound_payload

    parsed = parse_inbound_payload(payload)
    if not parsed:
        logger.info("inbound: payload did not match reply-{id} pattern")
        return None

    supabase = _get_supabase()
    if not supabase:
        return None

    # Confirm the request exists before writing
    try:
        req_check = (
            supabase.table("tracked_requests")
            .select("id,user_id,status")
            .eq("id", parsed.request_id)
            .single()
            .execute()
        )
        if not req_check.data:
            logger.info(f"inbound: no tracked_request for {parsed.request_id}")
            return None
    except Exception:
        return None

    # Log as an incoming communication
    try:
        supabase.table("communications").insert(
            {
                "request_id": parsed.request_id,
                "direction": "incoming",
                "comm_type": "response",
                "subject": parsed.subject[:500],
                "body": parsed.text_body or parsed.html_body or "",
                "date": date.today().isoformat(),
            }
        ).execute()
    except Exception as e:
        logger.exception(f"inbound insert failed: {e}")
        return None

    # Advance request status if still awaiting
    try:
        supabase.table("tracked_requests").update({"status": "responded"}).eq(
            "id", parsed.request_id
        ).in_("status", ["awaiting_response", "submitted"]).execute()
    except Exception:
        pass

    return {
        "request_id": parsed.request_id,
        "from": parsed.from_address,
        "subject": parsed.subject,
    }


# ── Cron entrypoint ─────────────────────────────────────────────────────────

def process_queue_tick() -> dict:
    """Pick up all runs where sends_at <= now and status = queued. Runs
    synchronously. Safe to call from cron every minute."""
    supabase = _get_supabase()
    if not supabase:
        return {"error": "no supabase"}

    try:
        ready = (
            supabase.table("submission_runs")
            .select("id")
            .eq("status", "queued")
            .lte("sends_at", _now_iso())
            .execute()
        )
    except Exception as e:
        logger.exception(f"queue tick read failed: {e}")
        return {"error": str(e)}

    ids = [r["id"] for r in (ready.data or [])]
    results = {"picked_up": len(ids), "succeeded": 0, "failed": 0}
    for rid in ids:
        run = execute_submission(rid)
        if run and run.status == "succeeded":
            results["succeeded"] += 1
        elif run and run.status == "failed":
            results["failed"] += 1
    return results
