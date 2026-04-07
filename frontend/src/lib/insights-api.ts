const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export interface HeroStats {
  latest_year: number;
  total_agencies: number;
  cumulative_received: number;
  cumulative_processed: number;
  current_backlog: number;
  total_costs: number;
  total_staff_fte: number;
}

export interface VolumeTrend {
  year: number;
  received: number;
  processed: number;
  backlog: number;
}

export interface TransparencyTrend {
  year: number;
  full_grant_rate: number;
  partial_grant_rate: number;
  denial_rate: number;
}

export interface AgencyRequests {
  name: string;
  requests_received: number;
}

export interface ExemptionItem {
  code: string;
  name: string;
  count: number;
  description: string;
}

export interface ProcessingTimeTrend {
  year: number;
  median_simple: number;
  median_complex: number;
}

export interface CostStaffingTrend {
  year: number;
  total_costs: number;
  staff_fte: number;
  cost_per_request: number;
}

export interface AppealsLitigationTrend {
  year: number;
  appeals: number;
  litigation: number;
  overturn_rate: number;
}

export interface NewsDigestItem {
  title: string;
  summary: string;
  source_url: string;
  source_name: string;
  category: string;
  published_date: string | null;
}

export interface InsightsOverview {
  hero_stats: HeroStats;
  volume_trends: VolumeTrend[];
  transparency_trends: TransparencyTrend[];
  top_agencies: AgencyRequests[];
  requester_types: Record<string, number>;
  exemption_breakdown: ExemptionItem[];
  processing_times: ProcessingTimeTrend[];
  costs_staffing: CostStaffingTrend[];
  appeals_litigation: AppealsLitigationTrend[];
  news_digest: NewsDigestItem[];
  last_refreshed: string | null;
}

export async function fetchInsightsData(): Promise<InsightsOverview> {
  const res = await fetch(`${API_URL}/api/v1/hub/insights`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Insights error: ${res.status}`);
  return res.json();
}
