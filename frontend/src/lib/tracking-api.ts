import type { SimilarRequest, DraftingStrategy, AgencyIntel } from "@/lib/api";

export type { SimilarRequest, DraftingStrategy, AgencyIntel };

import { getAccessToken } from "@/lib/supabase";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface AgencyInfo {
  name: string;
  abbreviation: string;
  foia_website: string;
  foia_email: string;
  jurisdiction: string;
  description: string;
  foia_regulation: string;
  submission_notes: string;
  cfr_available: boolean;
}

export interface DiscoveryResult {
  title: string;
  url: string;
  source: string;
  description?: string;
  agency?: string;
  date?: string;
  status?: string;
}

export interface TrackedRequest {
  id: string;
  title: string;
  description: string;
  agency: AgencyInfo;
  letter_text: string;
  requester_name: string;
  requester_organization: string;
  requester_email?: string;
  requester_phone?: string;
  requester_address?: string;
  status: string;
  filed_date: string | null;
  due_date: string | null;
  created_at: string;
  updated_at: string;
  // Research context
  statute_cited: string;
  key_elements: string[];
  tips: string[];
  submission_info: string;
  similar_requests: SimilarRequest[];
  drafting_strategy: DraftingStrategy;
  agency_intel: AgencyIntel;
  discovery_results: DiscoveryResult[];
}

export interface Communication {
  id: string;
  request_id: string;
  direction: string;       // "outgoing" | "incoming"
  comm_type: string;
  subject: string;
  body: string;
  date: string;
  created_at: string;
}

export interface ExemptionValidity {
  exemption: string;
  assessment: string;      // "valid" | "questionable" | "invalid"
  reasoning: string;
}

export interface ResponseAnalysis {
  request_id: string;
  communication_id?: string;
  response_complete: boolean;
  exemptions_cited: string[];
  exemptions_valid: ExemptionValidity[];
  missing_records: string[];
  grounds_for_appeal: string[];
  recommended_action: string;  // "accept" | "follow_up" | "appeal" | "negotiate_scope"
  summary: string;
  analyzed_at: string;
}

export interface DeadlineInfo {
  request_id: string;
  filed_date: string;
  due_date: string;
  business_days_elapsed: number;
  business_days_remaining: number;
  is_overdue: boolean;
  status_label: string;
}

export interface TrackedRequestDetail {
  request: TrackedRequest;
  communications: Communication[];
  deadline: DeadlineInfo | null;
  analysis: ResponseAnalysis | null;      // latest (backward compat)
  analyses: ResponseAnalysis[];           // all, oldest first
}

export interface GeneratedLetter {
  letter_type: string;
  letter_text: string;
  comm_id: string;
}

// ── Payloads ───────────────────────────────────────────────────────────────────

export interface TrackRequestPayload {
  title: string;
  description: string;
  agency: AgencyInfo;
  letter_text: string;
  requester_name: string;
  requester_organization?: string;
  filed_date?: string;
  // Research context
  statute_cited?: string;
  key_elements?: string[];
  tips?: string[];
  submission_info?: string;
  similar_requests?: SimilarRequest[];
  drafting_strategy?: DraftingStrategy;
  agency_intel?: AgencyIntel;
  discovery_results?: DiscoveryResult[];
}

export interface UpdateRequestPayload {
  title?: string;
  status?: string;
  filed_date?: string;
  description?: string;
  // Review-before-file fields
  letter_text?: string;
  requester_name?: string;
  requester_organization?: string;
  requester_email?: string;
  requester_phone?: string;
  requester_address?: string;
}

export interface AddCommunicationPayload {
  direction: string;
  comm_type: string;
  subject?: string;
  body: string;
  date: string;
}

export interface UpdateCommunicationPayload {
  subject?: string;
  body?: string;
  date?: string;
  direction?: string;
  comm_type?: string;
}

export interface AnalyzeResponsePayload {
  response_text: string;
  response_date: string;
}

export interface GenerateLetterPayload {
  letter_type: "follow_up" | "appeal";
  context?: string;
}

export interface ImportRequestPayload {
  title: string;
  description: string;
  agency_abbreviation: string;
  letter_text: string;
  requester_name: string;
  requester_organization?: string;
  filed_date?: string;
  existing_response?: string;
}

// ── API calls ──────────────────────────────────────────────────────────────────

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const token = await getAccessToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options?.headers as Record<string, string>),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  const res = await fetch(`${API_URL}/api/v1${path}`, {
    ...options,
    headers,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `Request failed: ${res.status}`);
  }
  return res.json();
}

export async function trackRequest(
  payload: TrackRequestPayload
): Promise<TrackedRequestDetail> {
  return apiFetch("/tracking/requests", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function listRequests(): Promise<TrackedRequestDetail[]> {
  return apiFetch("/tracking/requests");
}

export async function getRequest(id: string): Promise<TrackedRequestDetail> {
  return apiFetch(`/tracking/requests/${id}`);
}

export async function updateRequest(
  id: string,
  payload: UpdateRequestPayload
): Promise<TrackedRequestDetail> {
  return apiFetch(`/tracking/requests/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function deleteRequest(id: string): Promise<void> {
  await apiFetch(`/tracking/requests/${id}`, { method: "DELETE" });
}

export async function addCommunication(
  id: string,
  payload: AddCommunicationPayload
): Promise<Communication> {
  return apiFetch(`/tracking/requests/${id}/communications`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateCommunication(
  requestId: string,
  commId: string,
  payload: UpdateCommunicationPayload
): Promise<Communication> {
  return apiFetch(`/tracking/requests/${requestId}/communications/${commId}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function deleteCommunication(
  requestId: string,
  commId: string
): Promise<void> {
  await apiFetch(`/tracking/requests/${requestId}/communications/${commId}`, {
    method: "DELETE",
  });
}

export async function analyzeResponse(
  id: string,
  payload: AnalyzeResponsePayload,
  files: File[] = []
): Promise<ResponseAnalysis> {
  const token = await getAccessToken();
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const form = new FormData();
  form.append("response_text", payload.response_text);
  form.append("response_date", payload.response_date);
  for (const file of files) {
    form.append("files", file);
  }

  const res = await fetch(`${API_URL}/api/v1/tracking/requests/${id}/analyze-response`, {
    method: "POST",
    headers,
    body: form,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `Request failed: ${res.status}`);
  }
  return res.json();
}

export async function generateLetter(
  id: string,
  payload: GenerateLetterPayload
): Promise<GeneratedLetter> {
  return apiFetch(`/tracking/requests/${id}/generate-letter`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function importRequest(
  payload: ImportRequestPayload
): Promise<TrackedRequestDetail> {
  return apiFetch("/tracking/requests/import", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
