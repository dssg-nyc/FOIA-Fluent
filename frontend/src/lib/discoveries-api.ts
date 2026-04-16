import { getAccessToken } from "@/lib/supabase";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// ── Types ──────────────────────────────────────────────────────────────────────

export type DiscoveryStatus = "saved" | "reviewed" | "useful" | "not_useful";

export interface DiscoveredDocument {
  id: string;
  user_id: string;
  source: string;
  source_id: string | null;
  title: string;
  description: string;
  url: string;
  document_date: string | null;
  page_count: number | null;
  agency: string;
  status: DiscoveryStatus;
  note: string;
  tags: string[];
  tracked_request_id: string | null;
  discovered_via_query: string | null;
  saved_at: string;
}

export interface SaveDiscoveryPayload {
  source: string;
  source_id?: string | null;
  title: string;
  description?: string;
  url: string;
  document_date?: string | null;
  page_count?: number | null;
  agency?: string;
  discovered_via_query?: string | null;
  tracked_request_id?: string | null;
  tags?: string[];
  note?: string;
}

export interface UpdateDiscoveryPayload {
  status?: DiscoveryStatus;
  note?: string;
  tags?: string[];
  tracked_request_id?: string | null;
}

export interface DiscoveryListResponse {
  discoveries: DiscoveredDocument[];
  count: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

async function authHeaders(): Promise<HeadersInit> {
  const token = await getAccessToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

// ── API ────────────────────────────────────────────────────────────────────────

export async function saveDiscovery(payload: SaveDiscoveryPayload): Promise<DiscoveredDocument> {
  const res = await fetch(`${API_URL}/api/v1/discoveries`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Save discovery failed: ${res.status}`);
  return res.json();
}

export async function fetchMyDiscoveries(filters?: {
  status?: DiscoveryStatus;
  tag?: string;
  tracked_request_id?: string;
  query?: string;
}): Promise<DiscoveryListResponse> {
  const params = new URLSearchParams();
  if (filters?.status) params.set("status", filters.status);
  if (filters?.tag) params.set("tag", filters.tag);
  if (filters?.tracked_request_id) params.set("tracked_request_id", filters.tracked_request_id);
  if (filters?.query) params.set("query", filters.query);

  const url = `${API_URL}/api/v1/discoveries${params.toString() ? `?${params}` : ""}`;
  const res = await fetch(url, {
    headers: await authHeaders(),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`List discoveries failed: ${res.status}`);
  return res.json();
}

export async function updateDiscovery(
  id: string,
  payload: UpdateDiscoveryPayload,
): Promise<DiscoveredDocument> {
  const res = await fetch(`${API_URL}/api/v1/discoveries/${id}`, {
    method: "PATCH",
    headers: await authHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Update discovery failed: ${res.status}`);
  return res.json();
}

export async function deleteDiscovery(id: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/v1/discoveries/${id}`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(`Delete discovery failed: ${res.status}`);
}
