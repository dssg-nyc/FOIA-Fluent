const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export interface SearchResult {
  id: string;
  title: string;
  status: string;
  source: string;
  url: string;
  date: string | null;
  description: string;
  agency: string;
  filed_by: string;
  page_count: number | null;
}

export interface DiscoveryStep {
  step: number;
  title: string;
  description: string;
  results: SearchResult[];
  found: boolean;
}

export interface DiscoveryResponse {
  query: string;
  intent: string;
  agencies: string[];
  record_types: string[];
  steps: DiscoveryStep[];
  recommendation: string;
}

// Draft types
export interface AgencyInfo {
  name: string;
  abbreviation: string;
  foia_website: string;
  foia_email: string;
  jurisdiction: string;
  description: string;
  foia_regulation: string;
  submission_notes: string;
}

export interface AgencyIdentifyResponse {
  agency: AgencyInfo;
  alternatives: AgencyInfo[];
  reasoning: string;
}

export interface DraftRequest {
  description: string;
  agency: AgencyInfo;
  requester_name: string;
  requester_organization: string;
  fee_waiver: boolean;
  expedited_processing: boolean;
  preferred_format: string;
}

export interface SimilarRequest {
  title: string;
  status: string;
  url: string;
  description: string;
}

export interface DraftingStrategy {
  summary: string;
  learned_from_successes: string;
  avoided_from_denials: string;
  scope_decisions: string;
  exemption_awareness: string;
}

export interface AgencyIntel {
  agency_abbreviation: string;
  denial_patterns: SimilarRequest[];
  success_patterns: SimilarRequest[];
  exemption_patterns: SimilarRequest[];
  cached_at: string;
}

export interface DraftResponse {
  letter_text: string;
  agency: AgencyInfo;
  statute_cited: string;
  key_elements: string[];
  tips: string[];
  submission_info: string;
  similar_requests: SimilarRequest[];
  drafting_strategy: DraftingStrategy;
  agency_intel: AgencyIntel;
}

// API functions
export async function discover(query: string): Promise<DiscoveryResponse> {
  const res = await fetch(`${API_URL}/api/v1/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: "Unknown error" }));
    throw new Error(error.detail || `API error: ${res.status}`);
  }

  return res.json();
}

export async function identifyAgency(
  description: string,
  agencies_hint: string[] = []
): Promise<AgencyIdentifyResponse> {
  const res = await fetch(`${API_URL}/api/v1/draft/identify-agency`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ description, agencies_hint }),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: "Unknown error" }));
    throw new Error(error.detail || `API error: ${res.status}`);
  }

  return res.json();
}

export async function generateDraft(
  request: DraftRequest
): Promise<DraftResponse> {
  const res = await fetch(`${API_URL}/api/v1/draft/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: "Unknown error" }));
    throw new Error(error.detail || `API error: ${res.status}`);
  }

  return res.json();
}
