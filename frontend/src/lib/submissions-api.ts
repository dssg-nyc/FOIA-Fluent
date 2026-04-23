import { getAccessToken } from "@/lib/supabase";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// ── Types ──────────────────────────────────────────────────────────────────

export type SubmissionChannelType =
  | "foia_gov_api"
  | "email"
  | "portal"
  | "mail";

export type SubmissionStatus =
  | "queued"
  | "submitting"
  | "awaiting_user"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface SubmissionLogEntry {
  ts: string;
  level?: "info" | "warn" | "error";
  action: string;
  detail: Record<string, unknown>;
}

export interface SubmissionRun {
  id: string;
  request_id: string;
  user_id: string;
  channel: SubmissionChannelType;
  status: SubmissionStatus;
  queued_at: string;
  sends_at: string | null;
  submitted_at: string | null;
  completed_at: string | null;
  agency_tracking_number: string | null;
  receipt: Record<string, unknown>;
  log: SubmissionLogEntry[];
  error: string | null;
  cancel_reason: string | null;
}

export interface QueueSubmissionPayload {
  request_id: string;
  channel_override?: SubmissionChannelType;
  send_immediately?: boolean;
}

export interface QueueSubmissionResponse {
  run: SubmissionRun;
  channel_summary: string;
  seconds_until_send: number;
}

export interface ChannelPreview {
  supported: boolean;
  channel: {
    type: SubmissionChannelType;
    endpoint: string;
    priority: number;
  } | null;
  agency_name: string;
  agency_abbreviation: string;
  foia_website: string;
  submission_notes: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

async function authHeaders(): Promise<HeadersInit> {
  const token = await getAccessToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

// ── API ────────────────────────────────────────────────────────────────────

export async function queueSubmission(
  payload: QueueSubmissionPayload,
): Promise<QueueSubmissionResponse> {
  const res = await fetch(`${API_URL}/api/v1/submissions/queue`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const detail = await safeDetail(res);
    throw new Error(detail || `Queue submission failed: ${res.status}`);
  }
  return res.json();
}

export async function cancelSubmission(
  runId: string,
  reason?: string,
): Promise<SubmissionRun> {
  const res = await fetch(`${API_URL}/api/v1/submissions/${runId}`, {
    method: "DELETE",
    headers: await authHeaders(),
    body: JSON.stringify({ reason: reason || "" }),
  });
  if (!res.ok) {
    const detail = await safeDetail(res);
    throw new Error(detail || `Cancel failed: ${res.status}`);
  }
  return res.json();
}

export async function getSubmissionRun(runId: string): Promise<SubmissionRun> {
  const res = await fetch(`${API_URL}/api/v1/submissions/${runId}`, {
    headers: await authHeaders(),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Fetch run failed: ${res.status}`);
  return res.json();
}

export async function listRunsForRequest(
  requestId: string,
): Promise<SubmissionRun[]> {
  const res = await fetch(
    `${API_URL}/api/v1/submissions/by-request/${requestId}`,
    { headers: await authHeaders(), cache: "no-store" },
  );
  if (!res.ok) throw new Error(`List runs failed: ${res.status}`);
  return res.json();
}

export async function previewChannel(
  requestId: string,
): Promise<ChannelPreview> {
  const res = await fetch(
    `${API_URL}/api/v1/submissions/channel-preview/${requestId}`,
    { headers: await authHeaders(), cache: "no-store" },
  );
  if (!res.ok) throw new Error(`Channel preview failed: ${res.status}`);
  return res.json();
}

/**
 * Subscribe to SSE updates for a single run. Returns an unsubscribe function.
 *
 * Usage:
 *   const stop = streamSubmissionRun(runId, {
 *     onUpdate: (run) => setRun(run),
 *     onError: (err) => setError(err),
 *   });
 *   // later:
 *   stop();
 */
export function streamSubmissionRun(
  runId: string,
  handlers: {
    onUpdate?: (run: SubmissionRun) => void;
    onError?: (err: Error) => void;
    onClose?: () => void;
  },
): () => void {
  let closed = false;
  let controller: AbortController | null = null;

  (async () => {
    const token = await getAccessToken();
    const url = `${API_URL}/api/v1/submissions/${runId}/stream`;
    controller = new AbortController();

    try {
      const res = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        throw new Error(`Stream failed: ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (!closed) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE frames separated by blank line
        let ix;
        while ((ix = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, ix);
          buffer = buffer.slice(ix + 2);
          const dataLine = frame
            .split("\n")
            .find((l) => l.startsWith("data: "));
          if (!dataLine) continue;
          try {
            const parsed = JSON.parse(dataLine.slice(6)) as SubmissionRun;
            handlers.onUpdate?.(parsed);
          } catch {
            /* ignore malformed frame */
          }
        }
      }
    } catch (err) {
      if (!closed) handlers.onError?.(err as Error);
    } finally {
      handlers.onClose?.();
    }
  })();

  return () => {
    closed = true;
    controller?.abort();
  };
}

async function safeDetail(res: Response): Promise<string | null> {
  try {
    const body = await res.json();
    return typeof body.detail === "string" ? body.detail : null;
  } catch {
    return null;
  }
}
