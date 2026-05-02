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
  entity_slugs?: string[];
  persona_tags: string[];
  category_tags?: string[];
  priority: number;
  requester: string;
  metadata: Record<string, unknown>;
}

export interface SignalFeedResponse {
  signals: Signal[];
  count: number;
  personas_filter: string[];
}

export interface SignalsGlobalStats {
  total_signals: number;
  total_patterns_visible: number;
  sources_enabled: number;
  last_ingested_at: string | null;
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

// ── Phase 1.5: Entity resolution ──────────────────────────────────────────────

export interface EntityBio {
  entity_type: string;
  entity_slug: string;
  display_name: string;
  bio: string;
  signal_count: number;
}

export async function fetchRelatedSignals(signalId: string): Promise<{ signals: Signal[]; count: number }> {
  const res = await fetch(`${API_URL}/api/v1/signals/${signalId}/related`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Related signals error: ${res.status}`);
  return res.json();
}

export async function fetchEntity(entityType: string, entitySlug: string): Promise<EntityBio> {
  const res = await fetch(
    `${API_URL}/api/v1/signals/entity/${entityType}/${entitySlug}`,
    { cache: "no-store" },
  );
  if (!res.ok) throw new Error(`Entity error: ${res.status}`);
  return res.json();
}

export async function fetchEntitySignals(
  entityType: string,
  entitySlug: string,
  limit = 100,
): Promise<{ signals: Signal[]; count: number }> {
  const res = await fetch(
    `${API_URL}/api/v1/signals/entity/${entityType}/${entitySlug}/signals?limit=${limit}`,
    { cache: "no-store" },
  );
  if (!res.ok) throw new Error(`Entity signals error: ${res.status}`);
  return res.json();
}

/** Slugify an entity name client-side, matching the backend normalization rules. */
export function slugifyEntity(name: string): string {
  if (!name) return "";
  return name
    .toLowerCase()
    .replace(/\b(inc|incorporated|corp|corporation|llc|llp|lp|ltd|limited|plc|gmbh|nv)\b\.?/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ── Phase 3.5: Patterns Feed ──────────────────────────────────────────────────

export interface PatternEvidenceSignal {
  id: string;
  source: string;
  source_id: string;
  title: string;
  summary?: string;
  signal_date: string;
  requester?: string;
  source_url?: string;
  entities?: SignalEntities;
  entity_slugs?: string[];
}

/** Phase 3 structured narrative — populated for new patterns. Legacy patterns
 * still ship a plain string in `narrative`; the renderer detects the shape
 * via `parseNarrative()` below. */
export interface PatternNarrativeStruct {
  story: string;
  why_it_matters: string;
  evidence: string;
}

export interface SignalPattern {
  id: string;
  title: string;
  /** Phase 3 short headline subtitle (90-130 chars). Empty string for legacy
   * rows. The cluster card renders this as a second line under the title. */
  subtitle?: string;
  /** Phase 3: stored as JSON-encoded `PatternNarrativeStruct` for new rows;
   * stays a free-text string for legacy rows. Always typed as string here —
   * use `parseNarrative()` to read it. */
  narrative: string;
  /** Phase 3 pattern confidence — `low` rows are filtered server-side. */
  confidence?: "high" | "medium";
  pattern_type: string;
  signal_ids: string[];
  entity_slugs: string[];
  persona_tags: string[];
  non_obviousness_score: number;
  generated_at: string;
  visible: boolean;
  evidence_signals?: PatternEvidenceSignal[];
}

/** Read the narrative as either the new structured object or the legacy
 * plain-text string. Returns the structured form when JSON parsing succeeds
 * AND all three required keys are present; otherwise the original string. */
export function parseNarrative(
  raw: string,
): PatternNarrativeStruct | string {
  const trimmed = (raw || "").trim();
  if (!trimmed.startsWith("{")) return trimmed;
  try {
    const parsed = JSON.parse(trimmed);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.story === "string" &&
      typeof parsed.why_it_matters === "string" &&
      typeof parsed.evidence === "string"
    ) {
      return parsed as PatternNarrativeStruct;
    }
  } catch {
    /* fall through */
  }
  return trimmed;
}

export interface PatternDetail {
  pattern: SignalPattern;
  signals: Signal[];
}

export async function fetchPatterns(personas?: string[], limit = 50): Promise<{ patterns: SignalPattern[]; count: number }> {
  const params = new URLSearchParams();
  if (personas && personas.length > 0) params.set("personas", personas.join(","));
  params.set("limit", String(limit));
  const res = await fetch(`${API_URL}/api/v1/signals/patterns?${params}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Patterns error: ${res.status}`);
  return res.json();
}

export async function fetchPatternDetail(patternId: string): Promise<PatternDetail> {
  const res = await fetch(`${API_URL}/api/v1/signals/patterns/${patternId}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Pattern detail error: ${res.status}`);
  return res.json();
}

// ── Phase 2: public marketing landing sample ──────────────────────────────────

export interface PublicSample {
  signals_by_persona: Record<string, Signal[]>;
  patterns: SignalPattern[];
  source_counts: Record<string, number>;
  total_signals: number;
}

export async function fetchPublicSample(): Promise<PublicSample> {
  const res = await fetch(`${API_URL}/api/v1/signals/sample`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Sample error: ${res.status}`);
  return res.json();
}

export async function fetchSignalsGlobalStats(): Promise<SignalsGlobalStats> {
  const res = await fetch(`${API_URL}/api/v1/signals/stats`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Stats error: ${res.status}`);
  return res.json();
}
