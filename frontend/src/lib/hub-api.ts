const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export interface AgencyStats {
  id: number;
  name: string;
  slug: string;
  jurisdiction: string;
  absolute_url: string;
  average_response_time: number;
  fee_rate: number;
  success_rate: number;
  number_requests: number;
  number_requests_completed: number;
  number_requests_rejected: number;
  number_requests_no_docs: number;
  number_requests_ack: number;
  number_requests_resp: number;
  number_requests_fix: number;
  number_requests_appeal: number;
  number_requests_pay: number;
  number_requests_partial: number;
  number_requests_lawsuit: number;
  number_requests_withdrawn: number;
  has_portal: boolean;
  transparency_score: number;
  refreshed_at: string;
}

export interface GlobalStats {
  total_agencies: number;
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
  top_agencies: AgencyStats[];
  bottom_agencies: AgencyStats[];
  last_refreshed: string | null;
}

export interface AgencyDetail {
  stats: AgencyStats;
  percentile: number;
  denial_patterns: Array<{ title: string; status: string; url: string; description: string }>;
  success_patterns: Array<{ title: string; status: string; url: string; description: string }>;
  exemption_patterns: Array<{ title: string; status: string; url: string; description: string }>;
}

export interface AgencyPageResponse {
  agencies: AgencyStats[];
  total: number;
  page: number;
  page_size: number;
  last_refreshed: string | null;
}

export async function fetchGlobalStats(): Promise<GlobalStats> {
  const res = await fetch(`${API_URL}/api/v1/hub/stats`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Hub stats error: ${res.status}`);
  return res.json();
}

export async function fetchAgencies(params: {
  search?: string;
  sort_by?: string;
  min_requests?: number;
  page?: number;
  page_size?: number;
}): Promise<AgencyPageResponse> {
  const q = new URLSearchParams();
  if (params.search) q.set("search", params.search);
  if (params.sort_by) q.set("sort_by", params.sort_by);
  if (params.min_requests !== undefined) q.set("min_requests", String(params.min_requests));
  if (params.page) q.set("page", String(params.page));
  if (params.page_size) q.set("page_size", String(params.page_size));

  const res = await fetch(`${API_URL}/api/v1/hub/agencies?${q}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Hub agencies error: ${res.status}`);
  return res.json();
}

export async function fetchAgencyDetail(slug: string, jurisdiction?: string): Promise<AgencyDetail> {
  const q = jurisdiction ? `?jurisdiction=${encodeURIComponent(jurisdiction)}` : "";
  const res = await fetch(`${API_URL}/api/v1/hub/agencies/${slug}${q}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Hub agency error: ${res.status}`);
  return res.json();
}
