import { AgencyPageResponse } from "./hub-api";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export interface JurisdictionSummary {
  id: number;
  name: string;
  slug: string;
  abbrev: string;
  level: string;
  transparency_score: number;
  total_agencies: number;
  total_requests: number;
  overall_success_rate: number;
  average_response_time: number;
  median_response_time: number;
  fee_rate: number;
  portal_coverage_pct: number;
}

export interface StateMapData {
  states: JurisdictionSummary[];
  national_avg_score: number;
  national_avg_success_rate: number;
  national_avg_response_time: number;
  total_state_agencies: number;
  total_requests: number;
  total_completed: number;
  total_rejected: number;
  total_no_docs: number;
  total_partial: number;
  total_appeal: number;
  total_withdrawn: number;
  total_in_progress: number;
  overall_success_rate: number;
  median_response_time: number;
  portal_coverage_pct: number;
  top_states: JurisdictionSummary[];
  bottom_states: JurisdictionSummary[];
  last_refreshed: string | null;
}

export interface JurisdictionDetail {
  jurisdiction: JurisdictionSummary;
  top_agencies: Array<{
    id: number;
    name: string;
    slug: string;
    transparency_score: number;
    success_rate: number;
    average_response_time: number;
    number_requests: number;
    [key: string]: unknown;
  }>;
  bottom_agencies: Array<{
    id: number;
    name: string;
    slug: string;
    transparency_score: number;
    success_rate: number;
    average_response_time: number;
    number_requests: number;
    [key: string]: unknown;
  }>;
  total_no_docs: number;
  total_partial: number;
  total_appeal: number;
  total_withdrawn: number;
  total_in_progress: number;
  percentile: number;
}

export async function fetchStateMapData(): Promise<StateMapData> {
  const res = await fetch(`${API_URL}/api/v1/hub/jurisdictions/map`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Jurisdiction map error: ${res.status}`);
  return res.json();
}

export async function fetchJurisdictionDetail(
  slug: string
): Promise<JurisdictionDetail> {
  const res = await fetch(`${API_URL}/api/v1/hub/jurisdictions/${slug}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Jurisdiction detail error: ${res.status}`);
  return res.json();
}

export async function fetchJurisdictionAgencies(
  slug: string,
  params: {
    search?: string;
    sort_by?: string;
    min_requests?: number;
    page?: number;
    page_size?: number;
  }
): Promise<AgencyPageResponse> {
  const q = new URLSearchParams();
  if (params.search) q.set("search", params.search);
  if (params.sort_by) q.set("sort_by", params.sort_by);
  if (params.min_requests !== undefined)
    q.set("min_requests", String(params.min_requests));
  if (params.page) q.set("page", String(params.page));
  if (params.page_size) q.set("page_size", String(params.page_size));

  const res = await fetch(
    `${API_URL}/api/v1/hub/jurisdictions/${slug}/agencies?${q}`,
    { cache: "no-store" }
  );
  if (!res.ok) throw new Error(`Jurisdiction agencies error: ${res.status}`);
  return res.json();
}
