"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AreaChart,
  Area,
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from "recharts";
import { fetchInsightsData, InsightsOverview } from "@/lib/insights-api";

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toLocaleString();
}

function fmtDollars(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(0)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
}

const CHART_COLORS = {
  received: "#3b82f6",
  processed: "#059669",
  backlog: "#dc2626",
  fullGrant: "#059669",
  partial: "#f59e0b",
  denial: "#dc2626",
  simple: "#3b82f6",
  complex: "#dc2626",
  costs: "#8b5cf6",
  staff: "#059669",
  appeals: "#d97706",
  litigation: "#dc2626",
};

const PIE_COLORS = ["#059669", "#3b82f6", "#d97706", "#8b5cf6", "#6b7280"];

// ── Sub-components ─────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
}) {
  return (
    <div className="hub-stat-card">
      <div className="hub-stat-value" style={accent ? { color: accent } : {}}>
        {value}
      </div>
      <div className="hub-stat-label">{label}</div>
      {sub && <div className="hub-stat-sub">{sub}</div>}
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function InsightsPage() {
  const [data, setData] = useState<InsightsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchInsightsData()
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <main><div className="hub-container">
        <div className="hub-loading"><div className="spinner" /><p>Loading insights data...</p></div>
      </div></main>
    );
  }

  if (error || !data) {
    return (
      <main><div className="hub-container">
        <div className="hub-error">
          <p>Could not load insights data. The cache may be empty — run the refresh script first.</p>
          {error && <p className="hub-error-detail">{error}</p>}
        </div>
      </div></main>
    );
  }

  const hs = data.hero_stats;

  // Requester types for charts
  const requesterTotal = Object.values(data.requester_types).reduce((sum, v) => sum + v, 0);
  const requesterBarData = Object.entries(data.requester_types)
    .filter(([, v]) => v > 0)
    .map(([key, value]) => ({
      name: key,
      value,
      pct: requesterTotal > 0 ? ((value / requesterTotal) * 100).toFixed(1) : "0",
    }))
    .sort((a, b) => b.value - a.value);

  return (
    <main>
      <div className="hub-container">

        {/* ── Tabs ── */}
        <div className="hub-tabs">
          <Link href="/hub" className="hub-tab">Federal</Link>
          <Link href="/hub/states" className="hub-tab">State & Local</Link>
          <Link href="/hub/insights" className="hub-tab hub-tab-active">Insights</Link>
        </div>

        {/* ── Header ── */}
        <div className="header">
          <h1>FOIA Insights & Trends</h1>
          <p className="hub-header-subtitle">
            Historical analysis of FOIA transparency across <strong>{hs.total_agencies}</strong> federal agencies.
            Data from <strong>FOIA.gov</strong> annual reports (FY 2008–{hs.latest_year}).
          </p>
        </div>

        {/* ── 1. Hero Stats (3x2 grid) ── */}
        <div className="hub-stats-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
          <StatCard
            label="Total Requests Filed"
            value={fmt(hs.cumulative_received)}
            sub={`Cumulative FY 2008–${hs.latest_year}`}
          />
          <StatCard
            label="Total Requests Processed"
            value={fmt(hs.cumulative_processed)}
            sub={`Cumulative FY 2008–${hs.latest_year}`}
          />
          <StatCard
            label={`FY ${hs.latest_year} Backlog`}
            value={fmt(hs.current_backlog)}
            sub="Requests pending at end of fiscal year"
            accent="var(--red)"
          />
          <StatCard
            label={`FY ${hs.latest_year} Cost to Government`}
            value={fmtDollars(hs.total_costs)}
            sub="FOIA processing costs (latest year)"
          />
          <StatCard
            label={`FY ${hs.latest_year} FOIA Staff`}
            value={fmt(Math.round(hs.total_staff_fte))}
            sub="Full-time equivalents (latest year)"
          />
          <StatCard
            label="Federal Agencies"
            value={hs.total_agencies.toString()}
            sub="Reporting to FOIA.gov"
          />
        </div>

        {/* ── 2. Request Volume — FULL WIDTH (hero chart) ── */}
        <div className="hub-chart-card">
          <h3 className="hub-chart-title">Request Volume Over Time</h3>
          <ResponsiveContainer width="100%" height={340}>
            <AreaChart data={data.volume_trends} margin={{ top: 10, right: 30, left: 10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="year" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={fmt} />
              <Tooltip formatter={(v) => [Number(v).toLocaleString(), ""]} />
              <Legend />
              <Area type="monotone" dataKey="received" name="Received" stroke={CHART_COLORS.received} fill={CHART_COLORS.received} fillOpacity={0.15} />
              <Area type="monotone" dataKey="processed" name="Processed" stroke={CHART_COLORS.processed} fill={CHART_COLORS.processed} fillOpacity={0.15} />
              <Area type="monotone" dataKey="backlog" name="Backlog" stroke={CHART_COLORS.backlog} fill={CHART_COLORS.backlog} fillOpacity={0.1} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* ── 3. Transparency Trend + Denial Rate (side by side) ── */}
        <div className="hub-charts-row">
          <div className="hub-chart-card">
            <h3 className="hub-chart-title">Transparency Trend (Outcome Composition)</h3>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={data.transparency_trends} margin={{ top: 10, right: 30, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} unit="%" />
                <Tooltip formatter={(v) => [`${Number(v).toFixed(1)}%`, ""]} />
                <Legend />
                <Area type="monotone" dataKey="full_grant_rate" name="Full Grant" stroke={CHART_COLORS.fullGrant} fill={CHART_COLORS.fullGrant} fillOpacity={0.2} stackId="1" />
                <Area type="monotone" dataKey="partial_grant_rate" name="Partial" stroke={CHART_COLORS.partial} fill={CHART_COLORS.partial} fillOpacity={0.2} stackId="1" />
                <Area type="monotone" dataKey="denial_rate" name="Denial" stroke={CHART_COLORS.denial} fill={CHART_COLORS.denial} fillOpacity={0.2} stackId="1" />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="hub-chart-card">
            <h3 className="hub-chart-title">Denial vs. Full Grant Rate</h3>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={data.transparency_trends} margin={{ top: 10, right: 30, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} unit="%" />
                <Tooltip formatter={(v) => [`${Number(v).toFixed(1)}%`, ""]} />
                <Legend />
                <Line type="monotone" dataKey="full_grant_rate" name="Full Grant Rate" stroke={CHART_COLORS.fullGrant} strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="denial_rate" name="Denial Rate" stroke={CHART_COLORS.denial} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* ── 4. Most Requested Agencies — FULL WIDTH ── */}
        <div className="hub-chart-card">
          <h3 className="hub-chart-title">Most Requested Agencies (FY {hs.latest_year})</h3>
          <ResponsiveContainer width="100%" height={420}>
            <BarChart layout="vertical" data={data.top_agencies} margin={{ top: 4, right: 30, left: 8, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={fmt} />
              <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 12 }} />
              <Tooltip formatter={(v) => [Number(v).toLocaleString(), "Requests"]} />
              <Bar dataKey="requests_received" fill="#1B4F72" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* ── 5. Exemptions + Processing Times (side by side) ── */}
        <div className="hub-charts-row">
          {data.exemption_breakdown.length > 0 && (
            <div className="hub-chart-card">
              <h3 className="hub-chart-title">Most Cited Exemptions (FY {hs.latest_year})</h3>
              <ResponsiveContainer width="100%" height={350}>
                <BarChart layout="vertical" data={data.exemption_breakdown.slice(0, 10)} margin={{ top: 4, right: 24, left: 8, bottom: 4 }}>
                  <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={fmt} />
                  <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 10 }} />
                  <Tooltip
                    formatter={(v, _name, props) => [
                      `${Number(v).toLocaleString()} times cited`,
                      (props.payload as { description?: string })?.description || "",
                    ]}
                  />
                  <Bar dataKey="count" fill="#d97706" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="hub-chart-card">
            <h3 className="hub-chart-title">Processing Times (Median Days)</h3>
            <ResponsiveContainer width="100%" height={350}>
              <LineChart data={data.processing_times} margin={{ top: 10, right: 30, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} unit="d" />
                <Tooltip formatter={(v) => [`${Number(v).toFixed(1)} days`, ""]} />
                <Legend />
                <Line type="monotone" dataKey="median_simple" name="Simple Requests" stroke={CHART_COLORS.simple} strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="median_complex" name="Complex Requests" stroke={CHART_COLORS.complex} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* ── 6. Costs & Staffing + Appeals & Litigation (side by side) ── */}
        <div className="hub-charts-row">
          <div className="hub-chart-card">
            <h3 className="hub-chart-title">FOIA Costs Over Time</h3>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={data.costs_staffing} margin={{ top: 10, right: 30, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={fmtDollars} />
                <Tooltip formatter={(v, name) => [
                  name === "Cost/Request" ? fmtDollars(Number(v)) : fmtDollars(Number(v)),
                  "",
                ]} />
                <Legend />
                <Line type="monotone" dataKey="total_costs" name="Total Costs" stroke={CHART_COLORS.costs} strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="cost_per_request" name="Cost/Request" stroke={CHART_COLORS.staff} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="hub-chart-card">
            <h3 className="hub-chart-title">Appeals & Litigation Over Time</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={data.appeals_litigation} margin={{ top: 10, right: 30, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={fmt} />
                <Tooltip formatter={(v) => [Number(v).toLocaleString(), ""]} />
                <Legend />
                <Bar dataKey="appeals" name="Appeals" fill={CHART_COLORS.appeals} radius={[4, 4, 0, 0]} />
                <Bar dataKey="litigation" name="Litigation Cases" fill={CHART_COLORS.litigation} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* ── Section 10: News Digest — grouped by category ── */}
        {data.news_digest.length > 0 && (() => {
          const CATEGORY_META: Record<string, { label: string; icon: string; color: string }> = {
            court_case: { label: "Court Cases & Litigation", icon: "\u2696\ufe0f", color: "#dc2626" },
            investigation: { label: "Investigations & Oversight", icon: "\ud83d\udd0d", color: "#7c3aed" },
            policy: { label: "Policy & Legislation", icon: "\ud83d\udcdc", color: "#1B4F72" },
            report: { label: "Reports & Analysis", icon: "\ud83d\udcca", color: "#059669" },
            news: { label: "News & Updates", icon: "\ud83d\udcf0", color: "#d97706" },
          };
          const CATEGORY_ORDER = ["court_case", "investigation", "policy", "report", "news"];

          // Group items by category
          const grouped: Record<string, typeof data.news_digest> = {};
          for (const item of data.news_digest) {
            const cat = item.category || "news";
            if (!grouped[cat]) grouped[cat] = [];
            grouped[cat].push(item);
          }

          return (
            <section className="insights-digest">
              <h2 className="hub-resources-title">FOIA News & Developments</h2>
              <p className="hub-resources-subtitle">
                Curated from {new Set(data.news_digest.map(d => d.source_name)).size} sources across government transparency and press freedom organizations.
              </p>

              {CATEGORY_ORDER.filter(cat => grouped[cat]?.length).map(cat => {
                const meta = CATEGORY_META[cat] || CATEGORY_META.news;
                const items = grouped[cat];
                return (
                  <div key={cat} className="insights-digest-category">
                    <h3 className="insights-digest-category-title" style={{ borderLeftColor: meta.color }}>
                      {meta.icon} {meta.label}
                      <span className="insights-digest-count">{items.length}</span>
                    </h3>
                    <div className="insights-digest-list">
                      {items.map((item, i) => (
                        <a
                          key={i}
                          href={item.source_url || "#"}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="insights-digest-item"
                        >
                          <div className="insights-digest-item-header">
                            <span className="insights-digest-source">{item.source_name}</span>
                            {item.published_date && (
                              <span className="insights-digest-date">{item.published_date}</span>
                            )}
                          </div>
                          <div className="insights-digest-item-title">{item.title}</div>
                          <p className="insights-digest-item-summary">{item.summary}</p>
                        </a>
                      ))}
                    </div>
                  </div>
                );
              })}
            </section>
          );
        })()}

        {/* ── Resources ── */}
        <section className="hub-resources">
          <h2 className="hub-resources-title">FOIA Resources</h2>
          <p className="hub-resources-subtitle">Guides, tools, and references for filing effective FOIA requests.</p>
          <div className="hub-resources-grid">
            {[
              { title: "FOIA.gov Annual Reports", source: "FOIA.gov", description: "Official annual FOIA statistics for all federal agencies — the source data behind these insights.", url: "https://www.foia.gov/data.html" },
              { title: "DOJ Guide to the Freedom of Information Act", source: "DOJ", description: "The official comprehensive guide covering FOIA exemptions, procedures, and agency obligations.", url: "https://www.justice.gov/oip/doj-guide-freedom-information-act-0" },
              { title: "Reporters Committee FOIA Wiki", source: "RCFP", description: "Detailed state and federal FOIA law summaries, appeal procedures, and requester rights.", url: "https://www.rcfp.org/open-government-guide/" },
              { title: "MuckRock — How to File a FOIA Request", source: "MuckRock", description: "Step-by-step guide for filing requests, tracking responses, and appealing denials.", url: "https://www.muckrock.com/about/muckrock-101/" },
            ].map((r) => (
              <a key={r.title} href={r.url} target="_blank" rel="noopener noreferrer" className="hub-resource-card">
                <div className="hub-resource-header">
                  <span className="hub-resource-source">{r.source}</span>
                  <span className="hub-resource-arrow">&#8599;</span>
                </div>
                <div className="hub-resource-title">{r.title}</div>
                <p className="hub-resource-desc">{r.description}</p>
              </a>
            ))}
          </div>
        </section>

        <p className="hub-footer-note">
          Data sourced from <a href="https://www.foia.gov" target="_blank" rel="noopener noreferrer">FOIA.gov</a> annual reports and{" "}
          <a href="https://www.muckrock.com" target="_blank" rel="noopener noreferrer">MuckRock</a>.
        </p>
      </div>
    </main>
  );
}
