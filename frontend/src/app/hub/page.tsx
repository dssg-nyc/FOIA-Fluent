"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import {
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import {
  fetchGlobalStats,
  fetchAgencies,
  GlobalStats,
  AgencyStats,
  AgencyPageResponse,
} from "@/lib/hub-api";

// ── Helpers ────────────────────────────────────────────────────────────────────

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

function pct(n: number): string {
  return `${n.toFixed(1)}%`;
}

function days(n: number): string {
  if (!n) return "—";
  return `${Math.round(n)}d`;
}

function muckrockUrl(absoluteUrl: string): string {
  if (!absoluteUrl) return "https://www.muckrock.com/agency/";
  return absoluteUrl.startsWith("http")
    ? absoluteUrl
    : `https://www.muckrock.com${absoluteUrl}`;
}

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

function AgencyRow({ agency, rank }: { agency: AgencyStats; rank?: number }) {
  return (
    <tr>
      {rank !== undefined && (
        <td className="hub-td hub-td-rank">{rank}</td>
      )}
      <td className="hub-td hub-td-name">
        <Link href={`/hub/federal/${agency.slug}`} className="hub-agency-link">
          {agency.name}
        </Link>
      </td>
      <td className="hub-td hub-td-num">{agency.number_requests.toLocaleString()}</td>
      <td className="hub-td hub-td-num">
        <span style={{ color: scoreColor(agency.success_rate) }}>
          {pct(agency.success_rate)}
        </span>
      </td>
      <td className="hub-td hub-td-num">{days(agency.average_response_time)}</td>
      <td className="hub-td hub-td-num">{pct(agency.fee_rate)}</td>
      <td className="hub-td hub-td-num">
        <span className={agency.has_portal ? "hub-portal-yes" : "hub-portal-no"}>
          {agency.has_portal ? "Yes" : "No"}
        </span>
      </td>
      <td className="hub-td hub-td-score">
        <ScoreBadge score={agency.transparency_score} />
      </td>
    </tr>
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

export default function DataHubPage() {
  const [globalStats, setGlobalStats] = useState<GlobalStats | null>(null);
  const [agencies, setAgencies] = useState<AgencyPageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [dirLoading, setDirLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("transparency_score");
  const [page, setPage] = useState(1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load global stats on mount
  useEffect(() => {
    fetchGlobalStats()
      .then(setGlobalStats)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  // Load agency directory
  const loadAgencies = useCallback(
    (pg: number, s: string, sort: string) => {
      setDirLoading(true);
      fetchAgencies({ search: s || undefined, sort_by: sort, page: pg, page_size: 25 })
        .then(setAgencies)
        .catch(console.error)
        .finally(() => setDirLoading(false));
    },
    []
  );

  useEffect(() => {
    loadAgencies(page, search, sortBy);
  }, [page, sortBy, loadAgencies]);

  // Real-time search with 300ms debounce
  function handleSearchChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setSearch(val);
    setPage(1);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      loadAgencies(1, val, sortBy);
    }, 300);
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setPage(1);
    loadAgencies(1, search, sortBy);
  }

  // Pie chart data for overall outcomes
  const pieData = globalStats
    ? [
        { name: "Completed", value: globalStats.total_completed, color: "#000000" },
        { name: "Rejected", value: globalStats.total_rejected, color: "#dc2626" },
        { name: "No Responsive Docs", value: globalStats.total_no_docs, color: "#d97706" },
        { name: "Partial", value: globalStats.total_partial, color: "#f59e0b" },
        { name: "Appealing", value: globalStats.total_appeal, color: "#475569" },
        { name: "Withdrawn", value: globalStats.total_withdrawn, color: "#94a3b8" },
        { name: "In Progress", value: globalStats.total_in_progress, color: "#1863dc" },
      ].filter((d) => d.value > 0)
    : [];

  // Top agencies for ranked list visualization
  const topAgencies = globalStats?.top_agencies.slice(0, 10) ?? [];
  const maxTopScore = Math.max(...topAgencies.map((a) => a.transparency_score), 100);

  if (loading) {
    return (
      <main>
        <div className="hub-container">
          <div className="hub-loading">
            <div className="spinner" />
            <p>Loading transparency data…</p>
          </div>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main>
        <div className="hub-container">
          <div className="hub-error">
            <p>Could not load hub data. The cache may be empty — run the refresh script first.</p>
            <p className="hub-error-detail">{error}</p>
          </div>
        </div>
      </main>
    );
  }

  const gs = globalStats!;

  return (
    <main>
      <div className="hub-container">

        {/* ── Tabs ── */}
        <div className="hub-tabs">
          <Link href="/hub" className="hub-tab hub-tab-active">Federal</Link>
          <Link href="/hub/states" className="hub-tab">State & Local</Link>
          <Link href="/hub/insights" className="hub-tab">Insights</Link>
        </div>

        {/* ── Header ── */}
        <div className="header">
          <h1>The federal transparency benchmark</h1>
          <p className="hub-header-subtitle">
            Live FOIA performance data for{" "}
            <strong>{gs.total_agencies.toLocaleString()}</strong> federal agencies — success rates, response times, and exemption patterns sourced from MuckRock&apos;s public records database.
          </p>
          <div className="hub-header-cta">
            <Link href="/draft" className="hub-cta-primary">
              Draft a FOIA Request
            </Link>
            <a href="#agency-directory" className="hub-cta-secondary">
              Browse Agencies
            </a>
          </div>
        </div>

        {/* ── Key Stats ── */}
        <div className="hub-stats-grid">
          <StatCard
            label="Overall Success Rate"
            value={`${gs.overall_success_rate}%`}
            sub="Requests fully completed"
            accent={scoreColor(gs.overall_success_rate)}
          />
          <StatCard
            label="Total FOIA Requests"
            value={gs.total_requests.toLocaleString()}
            sub={`${gs.total_completed.toLocaleString()} completed`}
          />
          <StatCard
            label="Median Response Time"
            value={`${Math.round(gs.median_response_time)} days`}
            sub="Across all agencies"
          />
          <StatCard
            label="Agencies with Portal"
            value={`${gs.portal_coverage_pct}%`}
            sub="Electronic submission available"
          />
        </div>

        {/* ── Charts Row ── */}
        <div className="hub-charts-row">

          {/* Outcome Donut */}
          <div className="hub-chart-card">
            <h3 className="hub-chart-title">Overall Request Outcomes</h3>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={90}
                  paddingAngle={2}
                  dataKey="value"
                  animationDuration={1200}
                  animationEasing="ease-out"
                >
                  {pieData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value) => [Number(value).toLocaleString(), ""]}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="hub-chart-legend">
              {pieData.map((d) => (
                <span key={d.name} className="hub-legend-item">
                  <span
                    className="hub-legend-dot"
                    style={{ background: d.color }}
                  />
                  {d.name}: {d.value.toLocaleString()}
                </span>
              ))}
            </div>
          </div>

          {/* Top 10 Ranked List */}
          <div className="hub-chart-card hub-chart-card-wide">
            <h3 className="hub-chart-title">Top 10 Most Transparent Agencies</h3>
            <div className="ranked-bar-list">
              {topAgencies.map((agency, i) => (
                <Link
                  key={agency.id}
                  href={`/hub/federal/${agency.slug}`}
                  className="ranked-bar-item"
                >
                  <div className="ranked-bar-header">
                    <span className="ranked-bar-rank">{i + 1}</span>
                    <span className="ranked-bar-name">{agency.name}</span>
                    <span className="ranked-bar-score">{agency.transparency_score.toFixed(1)}</span>
                  </div>
                  <div className="ranked-bar-track">
                    <div
                      className="ranked-bar-fill"
                      style={{ width: `${(agency.transparency_score / maxTopScore) * 100}%` }}
                    />
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </div>

        {/* ── Top / Bottom Tables ── */}
        <p className="hub-score-explainer">
          <strong>Transparency Score</strong> (0–100): weighted composite of success rate (40%), response speed (30%), fee rate (15%), and electronic portal availability (15%).
        </p>
        <div className="hub-tables-row">
          <div className="hub-ranking-card">
            <h3 className="hub-ranking-title hub-ranking-title-good">
              Most Transparent
            </h3>
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
                {gs.top_agencies.slice(0, 10).map((a, i) => (
                  <tr key={a.id}>
                    <td className="hub-td hub-td-rank">{i + 1}</td>
                    <td className="hub-td hub-td-name">
                      <Link href={`/hub/federal/${a.slug}`} className="hub-agency-link">
                        {a.name}
                      </Link>
                    </td>
                    <td className="hub-td hub-td-score">
                      <ScoreBadge score={a.transparency_score} />
                    </td>
                    <td className="hub-td hub-td-num" style={{ color: scoreColor(a.success_rate) }}>
                      {pct(a.success_rate)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="hub-ranking-card">
            <h3 className="hub-ranking-title hub-ranking-title-bad">
              Least Transparent
            </h3>
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
                {gs.bottom_agencies.slice(0, 10).map((a, i) => (
                  <tr key={a.id}>
                    <td className="hub-td hub-td-rank">{i + 1}</td>
                    <td className="hub-td hub-td-name">
                      <Link href={`/hub/federal/${a.slug}`} className="hub-agency-link">
                        {a.name}
                      </Link>
                    </td>
                    <td className="hub-td hub-td-score">
                      <ScoreBadge score={a.transparency_score} />
                    </td>
                    <td className="hub-td hub-td-num" style={{ color: scoreColor(a.success_rate) }}>
                      {pct(a.success_rate)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Agency Directory ── */}
        <section className="hub-directory" id="agency-directory">
          <div className="hub-directory-header">
            <h2 className="hub-directory-title">Agency Directory</h2>
            <form onSubmit={handleSearch} className="hub-search-row">
              <input
                type="text"
                placeholder="Search agencies…"
                value={search}
                onChange={handleSearchChange}
                className="hub-search-input"
              />
              <select
                value={sortBy}
                onChange={(e) => { setSortBy(e.target.value); setPage(1); }}
                className="hub-sort-select"
              >
                {SORT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    Sort: {o.label}
                  </option>
                ))}
              </select>
              <button type="submit" className="hub-search-btn">
                Search
              </button>
            </form>
          </div>

          {dirLoading ? (
            <div className="hub-dir-loading">
              <div className="spinner" style={{ width: 20, height: 20 }} />
            </div>
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
                      <th className="hub-th hub-th-num">Transparency Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {agencies?.agencies.map((a) => (
                      <AgencyRow key={a.id} agency={a} />
                    ))}
                    {agencies?.agencies.length === 0 && (
                      <tr>
                        <td colSpan={7} className="hub-td hub-td-empty">
                          No agencies found.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {agencies && agencies.total > 25 && (
                <div className="hub-pagination">
                  <button
                    className="hub-page-btn"
                    disabled={page === 1}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    ← Prev
                  </button>
                  <span className="hub-page-info">
                    Page {page} of {Math.ceil(agencies.total / 25)}
                    {" "}({agencies.total.toLocaleString()} agencies)
                  </span>
                  <button
                    className="hub-page-btn"
                    disabled={page >= Math.ceil(agencies.total / 25)}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next →
                  </button>
                </div>
              )}
            </>
          )}
        </section>

        {/* Footer note */}
        <p className="hub-footer-note">
          Data sourced from{" "}
          <a
            href="https://www.muckrock.com"
            target="_blank"
            rel="noopener noreferrer"
          >
            MuckRock
          </a>
          . Refreshed weekly.
        </p>
      </div>
    </main>
  );
}
