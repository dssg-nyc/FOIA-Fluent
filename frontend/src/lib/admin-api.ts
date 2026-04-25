/**
 * Admin API client. All calls require the X-Admin-Secret header.
 *
 * The secret is stored in localStorage under `foia_admin_secret`. If missing,
 * the admin page prompts for it via a tiny form on first visit.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const SECRET_KEY = "foia_admin_secret";

export function getAdminSecret(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(SECRET_KEY);
}

export function setAdminSecret(secret: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(SECRET_KEY, secret);
}

export function clearAdminSecret(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(SECRET_KEY);
}

async function adminFetch<T>(path: string): Promise<T> {
  const secret = getAdminSecret();
  if (!secret) throw new Error("No admin secret set");
  const res = await fetch(`${API_URL}/api/v1/admin${path}`, {
    headers: { "X-Admin-Secret": secret },
    cache: "no-store",
  });
  if (res.status === 403) {
    throw new Error("Invalid admin secret (403)");
  }
  if (!res.ok) {
    throw new Error(`Admin API error: ${res.status}`);
  }
  return res.json();
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface SignalsSourceHealth {
  source_id: string;
  label: string;
  family: string;
  fetch_strategy: string;
  cadence_minutes: number;
  enabled: boolean;
  max_items_per_run: number;
  max_claude_calls_per_day: number;
  last_run_at: string | null;
  last_run_status: string | null;
  last_run_error: string | null;
  runs_succeeded_7d: number;
  runs_failed_7d: number;
  items_fetched_7d: number;
  items_inserted_7d: number;
  items_skipped_dup_7d: number;
  items_failed_7d: number;
  items_total: number;
  claude_input_tokens_7d: number;
  claude_output_tokens_7d: number;
  cost_usd_7d: number;
  projected_monthly_cost_usd: number;
}

export interface SignalsHealthTotals {
  sources_registered: number;
  sources_enabled: number;
  runs_7d: number;
  items_inserted_7d: number;
  items_total_all_time: number;
  claude_input_tokens_7d: number;
  claude_output_tokens_7d: number;
  cost_usd_7d: number;
  projected_monthly_cost_usd: number;
  last_pattern_run_at: string | null;
  patterns_count_total: number;
}

export interface SignalsHealthResponse {
  generated_at: string;
  sources: SignalsSourceHealth[];
  totals: SignalsHealthTotals;
}

export interface SignalsRunRow {
  id: string;
  source_id: string;
  started_at: string;
  completed_at: string | null;
  status: string;
  items_fetched: number;
  items_inserted: number;
  items_skipped_dup: number;
  items_failed: number;
  claude_input_tokens: number;
  claude_output_tokens: number;
  error_message: string | null;
}

// ── Calls ──────────────────────────────────────────────────────────────────

export async function getSignalsHealth(): Promise<SignalsHealthResponse> {
  return adminFetch<SignalsHealthResponse>("/signals-health");
}

export async function getRecentRuns(
  sourceId?: string,
  limit: number = 50,
): Promise<{ runs: SignalsRunRow[] }> {
  const params = new URLSearchParams();
  if (sourceId) params.set("source_id", sourceId);
  params.set("limit", String(limit));
  return adminFetch<{ runs: SignalsRunRow[] }>(
    `/signals-health/runs?${params.toString()}`,
  );
}

export interface PatternRunResult {
  status: string;
  signals?: number;
  candidates?: number;
  patterns_inserted?: number;
  runtime_seconds?: number;
  error?: string;
}

export async function triggerPatternRun(): Promise<PatternRunResult> {
  const secret = getAdminSecret();
  if (!secret) throw new Error("No admin secret set");
  const res = await fetch(`${API_URL}/api/v1/admin/patterns/run`, {
    method: "POST",
    headers: { "X-Admin-Secret": secret },
    cache: "no-store",
  });
  if (res.status === 403) throw new Error("Invalid admin secret (403)");
  if (!res.ok) throw new Error(`Pattern run failed: ${res.status}`);
  return res.json();
}
