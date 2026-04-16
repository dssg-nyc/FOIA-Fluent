import { getAccessToken } from "@/lib/supabase";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export interface SavedSearch {
  id: string;
  user_id: string;
  query: string;
  interpretation: Record<string, unknown>;
  name: string;
  last_run_at: string | null;
  last_result_count: number;
  created_at: string;
  result_snapshot: Record<string, unknown> | null;
  snapshot_at: string | null;
}

export interface SaveSearchPayload {
  query: string;
  interpretation?: Record<string, unknown>;
  name?: string;
  result_count?: number;
  result_snapshot?: Record<string, unknown>;
}

export interface SavedSearchListResponse {
  searches: SavedSearch[];
  count: number;
}

async function authHeaders(): Promise<HeadersInit> {
  const token = await getAccessToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

export async function saveSearch(payload: SaveSearchPayload): Promise<SavedSearch> {
  const res = await fetch(`${API_URL}/api/v1/saved-searches`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Save search failed: ${res.status}`);
  return res.json();
}

export async function fetchSavedSearches(limit = 20): Promise<SavedSearchListResponse> {
  const res = await fetch(`${API_URL}/api/v1/saved-searches?limit=${limit}`, {
    headers: await authHeaders(),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Fetch saved searches failed: ${res.status}`);
  return res.json();
}

export async function fetchSavedSearch(id: string): Promise<SavedSearch> {
  const res = await fetch(`${API_URL}/api/v1/saved-searches/${id}`, {
    headers: await authHeaders(),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Fetch saved search failed: ${res.status}`);
  return res.json();
}

export async function deleteSavedSearch(id: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/v1/saved-searches/${id}`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(`Delete saved search failed: ${res.status}`);
}
