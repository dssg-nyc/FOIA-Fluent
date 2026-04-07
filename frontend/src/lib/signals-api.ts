import { getAccessToken } from "@/lib/supabase";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface Persona {
  id: string;
  name: string;
  description: string;
  icon: string;
  display_order: number;
}

export interface SignalEntities {
  companies?: string[];
  people?: string[];
  agencies?: string[];
  locations?: string[];
  regulations?: string[];
  dollar_amounts?: string[];
}

export interface Signal {
  id: string;
  source: string;
  source_id: string;
  title: string;
  summary: string;
  body_excerpt: string;
  source_url: string;
  signal_date: string;
  ingested_at: string | null;
  agency_codes: string[];
  entities: SignalEntities;
  persona_tags: string[];
  priority: number;
  requester: string;
  metadata: Record<string, unknown>;
}

export interface SignalFeedResponse {
  signals: Signal[];
  count: number;
  personas_filter: string[];
}

export interface PersonaCatalogResponse {
  personas: Persona[];
}

export interface UserPersonasResponse {
  persona_ids: string[];
}

// ── Helpers ────────────────────────────────────────────────────────────────────

async function authHeaders(): Promise<HeadersInit> {
  const token = await getAccessToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

// ── API ────────────────────────────────────────────────────────────────────────

export async function fetchPersonaCatalog(): Promise<PersonaCatalogResponse> {
  const res = await fetch(`${API_URL}/api/v1/signals/personas`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Persona catalog error: ${res.status}`);
  return res.json();
}

export async function fetchSignalFeed(
  personas?: string[],
  days = 30,
  limit = 100,
): Promise<SignalFeedResponse> {
  const params = new URLSearchParams();
  if (personas && personas.length > 0) params.set("personas", personas.join(","));
  params.set("days", String(days));
  params.set("limit", String(limit));

  const res = await fetch(`${API_URL}/api/v1/signals/feed?${params}`, {
    headers: await authHeaders(),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Signal feed error: ${res.status}`);
  return res.json();
}

export async function fetchMyPersonas(): Promise<UserPersonasResponse> {
  const res = await fetch(`${API_URL}/api/v1/signals/me/personas`, {
    headers: await authHeaders(),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`My personas error: ${res.status}`);
  return res.json();
}

export async function saveMyPersonas(personaIds: string[]): Promise<UserPersonasResponse> {
  const res = await fetch(`${API_URL}/api/v1/signals/me/personas`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ persona_ids: personaIds }),
  });
  if (!res.ok) throw new Error(`Save personas error: ${res.status}`);
  return res.json();
}
