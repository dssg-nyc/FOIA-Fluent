"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import {
  fetchJurisdictionDetail,
  fetchJurisdictionAgencies,
  JurisdictionDetail,
} from "@/lib/jurisdiction-api";
import { AgencyPageResponse } from "@/lib/hub-api";

// ── Helpers (same as federal) ──────────────────────────────────────────────────

function scoreColor(score: number): string {
  if (score >= 65) return "var(--green)";
  if (score >= 45) return "#d97706";
  return "var(--red)";
}

function scoreLabel(score: number): string {
  if (score >= 65) return "Transparent";
  if (score >= 45) return "Moderate";
  return "Restrictive";
}

function pct(n: number, decimals = 1): string {
  return `${n.toFixed(decimals)}%`;
}

function days(n: number): string {
  if (!n) return "—";
  return `${Math.round(n)} days`;
}

function ScoreGauge({ score }: { score: number }) {
  const color = scoreColor(score);
  const label = scoreLabel(score);
  return (
    <div className="hub-gauge">
      <div className="hub-gauge-track">
        <div
          className="hub-gauge-fill"
          style={{ width: `${Math.min(score, 100)}%`, background: color }}
        />
      </div>
      <div className="hub-gauge-row">
        <span className="hub-gauge-score" style={{ color }}>
          {score.toFixed(0)}/100
        </span>
        <span className="hub-gauge-label" style={{ color }}>
          {label}
        </span>
      </div>
    </div>
  );
}

function ScoreBadge({ score }: { score: number }) {
  return (
    <span
      className="hub-score-badge"
      style={{ background: `${scoreColor(score)}18`, color: scoreColor(score) }}
    >
      {score.toFixed(0)}
    </span>
  );
}

const SORT_OPTIONS = [
  { value: "transparency_score", label: "Transparency Score" },
  { value: "success_rate", label: "Success Rate" },
  { value: "number_requests", label: "Total Requests" },
  { value: "average_response_time", label: "Response Time" },
  { value: "fee_rate", label: "Fee Rate" },
  { value: "name", label: "Name (A–Z)" },
];

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function StateDetailPage() {
  const params = useParams();
  const router = useRouter();
  const slug = params.slug as string;

  const [detail, setDetail] = useState<JurisdictionDetail | null>(null);
  const [agencies, setAgencies] = useState<AgencyPageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dirLoading, setDirLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("transparency_score");
  const [page, setPage] = useState(1);

  useEffect(() => {
    Promise.all([
      fetchJurisdictionDetail(slug),
      fetchJurisdictionAgencies(slug, { page: 1, page_size: 25 }),
    ])
      .then(([d, a]) => { setDetail(d); setAgencies(a); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [slug]);

  const loadAgencies = useCallback(
    (pg: number, s: string, sort: string) => {
      setDirLoading(true);
      fetchJurisdictionAgencies(slug, {
        search: s || undefined, sort_by: sort, page: pg, page_size: 25,
      })
        .then(setAgencies)
        .catch(console.error)
        .finally(() => setDirLoading(false));
    },
    [slug]
  );

  useEffect(() => {
    if (!loading) loadAgencies(page, search, sortBy);
  }, [page, sortBy]);

  if (loading) {
    return (
      <main><div className="hub-container">
        <div className="hub-loading"><div className="spinner" /><p>Loading state data…</p></div>
      </div></main>
    );
  }

  if (error || !detail) {
    return (
      <main><div className="hub-container">
        <div className="hub-error">
          <p>State not found in the transparency hub cache.</p>
          {error && <p className="hub-error-detail">{error}</p>}
          <Link href="/hub/states" className="hub-back-link">← Back to State Map</Link>
        </div>
      </div></main>
    );
  }

  const j = detail.jurisdiction;

  // Outcome pie data
  const outcomePieData = [
    { name: "Completed", value: Math.round((j.total_requests * j.overall_success_rate) / 100) || 0, color: "#059669" },
    { name: "Rejected", value: detail.total_no_docs, color: "#dc2626" },
    { name: "No Responsive Docs", value: detail.total_no_docs, color: "#d97706" },
    { name: "Partial", value: detail.total_partial, color: "#f59e0b" },
    { name: "Appealing", value: detail.total_appeal, color: "#7c3aed" },
    { name: "Withdrawn", value: detail.total_withdrawn, color: "#6b7280" },
    { name: "In Progress", value: detail.total_in_progress, color: "#3b82f6" },
  ].filter((d) => d.value > 0);

  // Top agencies bar chart
  const topBarData = detail.top_agencies.slice(0, 10).map((a) => ({
    name: a.name.length > 22 ? a.name.slice(0, 20) + "…" : a.name,
    score: parseFloat(a.transparency_score.toFixed(1)),
    slug: a.slug,
  }));

  // Score breakdown
  const componentData = [
    { name: "Success Rate", value: parseFloat(((j.overall_success_rate || 0) / 100 * 40).toFixed(1)), max: 40 },
    { name: "Response Speed", value: parseFloat((Math.max(0, 1 - Math.min((j.average_response_time || 60) / 120, 1)) * 30).toFixed(1)), max: 30 },
    { name: "Fee Rate", value: parseFloat(((1 - Math.min((j.fee_rate || 0) / 100, 1)) * 15).toFixed(1)), max: 15 },
    { name: "Portal", value: j.portal_coverage_pct > 50 ? 15 : 0, max: 15 },
  ];

  const totalPages = agencies ? Math.ceil(agencies.total / agencies.page_size) : 1;

  return (
    <main>
      <div className="hub-container">

        {/* Back */}
        <Link href="/hub/states" className="hub-back-link">
          ← State & Local Hub
        </Link>

        {/* ── Header ── */}
        <div className="hub-detail-header">
          <div>
            <h1 className="hub-detail-name">{j.name} ({j.abbrev})</h1>
            <p className="hub-detail-jurisdiction">
              FOIA transparency data for {j.total_agencies} agencies in {j.name}
            </p>
          </div>
        </div>

        {/* ── Key Stats Bar ── */}
        <div className="hub-detail-stats">
          <div className="hub-detail-stat">
            <div className="hub-detail-stat-value">{j.total_agencies}</div>
            <div className="hub-detail-stat-label">Agencies</div>
          </div>
          <div className="hub-detail-stat">
            <div className="hub-detail-stat-value">{j.total_requests.toLocaleString()}</div>
            <div className="hub-detail-stat-label">Total Requests</div>
          </div>
          <div className="hub-detail-stat">
            <div className="hub-detail-stat-value" style={{ color: scoreColor(j.overall_success_rate) }}>
              {pct(j.overall_success_rate)}
            </div>
            <div className="hub-detail-stat-label">Success Rate</div>
          </div>
          <div className="hub-detail-stat">
            <div className="hub-detail-stat-value">{days(j.average_response_time)}</div>
            <div className="hub-detail-stat-label">Avg Response Time</div>
          </div>
          <div className="hub-detail-stat">
            <div className="hub-detail-stat-value">{pct(j.portal_coverage_pct)}</div>
            <div className="hub-detail-stat-label">Portal Coverage</div>
          </div>
        </div>

        {/* ── Score + Percentile ── */}
        <div className="hub-score-section">
          <div className="hub-score-left">
            <h3 className="hub-section-title">Transparency Score</h3>
            <ScoreGauge score={j.transparency_score} />
            {detail.percentile > 0 && (
              <p className="hub-percentile-note">
                Better than <strong>{detail.percentile.toFixed(0)}%</strong> of states
              </p>
            )}
          </div>
          <div className="hub-score-right">
            <h3 className="hub-section-title">Score Breakdown</h3>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart layout="vertical" data={componentData} margin={{ top: 4, right: 32, left: 8, bottom: 4 }}>
                <XAxis type="number" domain={[0, 40]} tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11 }} />
                <Tooltip
                  formatter={(v, _name, props) => [
                    `${Number(v).toFixed(1)} / ${(props.payload as { max?: number })?.max ?? "?"}`,
                    "Points",
                  ]}
                />
                <Bar dataKey="value" fill="var(--primary)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* ── Charts Row (pie + bar side by side) ── */}
        <div className="hub-charts-row">
          {/* Outcome Donut */}
          <div className="hub-chart-card">
            <h3 className="hub-chart-title">Request Outcomes</h3>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={outcomePieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={90}
                  paddingAngle={2}
                  dataKey="value"
                >
                  {outcomePieData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(v) => [Number(v).toLocaleString(), ""]} />
              </PieChart>
            </ResponsiveContainer>
            <div className="hub-chart-legend">
              {outcomePieData.map((d) => (
                <span key={d.name} className="hub-legend-item">
                  <span className="hub-legend-dot" style={{ background: d.color }} />
                  {d.name}: {d.value.toLocaleString()}
                </span>
              ))}
            </div>
          </div>

          {/* Top Agencies Bar Chart */}
          {topBarData.length > 0 && (
            <div className="hub-chart-card hub-chart-card-wide">
              <h3 className="hub-chart-title">Top Agencies in {j.name}</h3>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart layout="vertical" data={topBarData} margin={{ top: 4, right: 24, left: 8, bottom: 4 }}>
                  <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v) => [`${Number(v).toFixed(1)}/100`, "Transparency Score"]} />
                  <Bar dataKey="score" radius={[0, 4, 4, 0]}>
                    {topBarData.map((entry, i) => (
                      <Cell key={i} fill={scoreColor(entry.score)} fillOpacity={0.85} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* ── Top / Bottom Tables ── */}
        <div className="hub-tables-row">
          {detail.top_agencies.length > 0 && (
            <div className="hub-ranking-card">
              <h3 className="hub-ranking-title hub-ranking-title-good">Most Transparent</h3>
              <table className="hub-table">
                <thead>
                  <tr>
                    <th className="hub-th">#</th>
                    <th className="hub-th">Agency</th>
                    <th className="hub-th hub-th-num">Score</th>
                    <th className="hub-th hub-th-num">Success</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.top_agencies.slice(0, 10).map((a, i) => (
                    <tr key={a.id}>
                      <td className="hub-td hub-td-rank">{i + 1}</td>
                      <td className="hub-td hub-td-name">
                        <Link href={`/hub/${a.slug}`} className="hub-agency-link">{a.name}</Link>
                      </td>
                      <td className="hub-td hub-td-score"><ScoreBadge score={a.transparency_score} /></td>
                      <td className="hub-td hub-td-num" style={{ color: scoreColor(a.success_rate) }}>{pct(a.success_rate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {detail.bottom_agencies.length > 0 && (
            <div className="hub-ranking-card">
              <h3 className="hub-ranking-title hub-ranking-title-bad">Least Transparent</h3>
              <table className="hub-table">
                <thead>
                  <tr>
                    <th className="hub-th">#</th>
                    <th className="hub-th">Agency</th>
                    <th className="hub-th hub-th-num">Score</th>
                    <th className="hub-th hub-th-num">Success</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.bottom_agencies.slice(0, 10).map((a, i) => (
                    <tr key={a.id}>
                      <td className="hub-td hub-td-rank">{i + 1}</td>
                      <td className="hub-td hub-td-name">
                        <Link href={`/hub/${a.slug}`} className="hub-agency-link">{a.name}</Link>
                      </td>
                      <td className="hub-td hub-td-score"><ScoreBadge score={a.transparency_score} /></td>
                      <td className="hub-td hub-td-num" style={{ color: scoreColor(a.success_rate) }}>{pct(a.success_rate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── Agency Directory ── */}
        <section className="hub-directory" id="agency-directory">
          <div className="hub-directory-header">
            <h2 className="hub-directory-title">Agency Directory — {j.name}</h2>
            <div className="hub-search-row">
              <input
                type="text"
                placeholder="Search agencies…"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                className="hub-search-input"
              />
              <select
                value={sortBy}
                onChange={(e) => { setSortBy(e.target.value); setPage(1); }}
                className="hub-sort-select"
              >
                {SORT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>Sort: {o.label}</option>
                ))}
              </select>
              <button
                className="hub-search-btn"
                onClick={() => loadAgencies(1, search, sortBy)}
              >
                Search
              </button>
            </div>
          </div>

          {dirLoading ? (
            <div className="hub-dir-loading"><div className="spinner" style={{ width: 20, height: 20 }} /></div>
          ) : (
            <>
              <div className="hub-table-wrapper">
                <table className="hub-table hub-dir-table">
                  <thead>
                    <tr>
                      <th className="hub-th">Agency</th>
                      <th className="hub-th hub-th-num">Requests</th>
                      <th className="hub-th hub-th-num">Success</th>
                      <th className="hub-th hub-th-num">Avg Response</th>
                      <th className="hub-th hub-th-num">Fee Rate</th>
                      <th className="hub-th hub-th-num">Portal</th>
                      <th className="hub-th hub-th-num">Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {agencies?.agencies.map((a) => (
                      <tr key={a.id} className="hub-table-row-clickable" onClick={() => router.push(`/hub/${a.slug}`)}>
                        <td className="hub-td hub-td-name"><strong>{a.name}</strong></td>
                        <td className="hub-td hub-td-num">{a.number_requests.toLocaleString()}</td>
                        <td className="hub-td hub-td-num" style={{ color: scoreColor(a.success_rate) }}>{pct(a.success_rate)}</td>
                        <td className="hub-td hub-td-num">{a.average_response_time ? `${Math.round(a.average_response_time)}d` : "—"}</td>
                        <td className="hub-td hub-td-num">{a.fee_rate ? pct(a.fee_rate) : "—"}</td>
                        <td className="hub-td hub-td-num">
                          <span className={a.has_portal ? "hub-portal-yes" : "hub-portal-no"}>{a.has_portal ? "Yes" : "No"}</span>
                        </td>
                        <td className="hub-td hub-td-score"><ScoreBadge score={a.transparency_score} /></td>
                      </tr>
                    ))}
                    {agencies?.agencies.length === 0 && (
                      <tr><td colSpan={7} className="hub-td hub-td-empty">No agencies found.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {agencies && agencies.total > 25 && (
                <div className="hub-pagination">
                  <button className="hub-page-btn" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>← Prev</button>
                  <span className="hub-page-info">Page {page} of {totalPages} ({agencies.total.toLocaleString()} agencies)</span>
                  <button className="hub-page-btn" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next →</button>
                </div>
              )}
            </>
          )}
        </section>

        {/* ── CTA ── */}
        <div className="hub-cta">
          <p>Want to file a FOIA request with a {j.name} agency?</p>
          <Link href="/draft" className="hub-cta-btn">Draft a Request →</Link>
        </div>

        <p className="hub-footer-note">
          Data sourced from{" "}
          <a href="https://www.muckrock.com" target="_blank" rel="noopener noreferrer">MuckRock</a>. Refreshed weekly.
        </p>
      </div>
    </main>
  );
}
