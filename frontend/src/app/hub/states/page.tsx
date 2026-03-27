"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import {
  ComposableMap,
  Geographies,
  Geography,
  ZoomableGroup,
} from "react-simple-maps";
import {
  fetchStateMapData,
  fetchJurisdictionAgencies,
  StateMapData,
  JurisdictionSummary,
} from "@/lib/jurisdiction-api";
import { AgencyPageResponse } from "@/lib/hub-api";

const GEO_URL = "/data/us-states-10m.json";

// FIPS code → state slug mapping
const FIPS_TO_SLUG: Record<string, string> = {
  "01": "alabama", "02": "alaska", "04": "arizona", "05": "arkansas",
  "06": "california", "08": "colorado", "09": "connecticut", "10": "delaware",
  "11": "district-of-columbia", "12": "florida", "13": "georgia", "15": "hawaii",
  "16": "idaho", "17": "illinois", "18": "indiana", "19": "iowa",
  "20": "kansas", "21": "kentucky", "22": "louisiana", "23": "maine",
  "24": "maryland", "25": "massachusetts", "26": "michigan", "27": "minnesota",
  "28": "mississippi", "29": "missouri", "30": "montana", "31": "nebraska",
  "32": "nevada", "33": "new-hampshire", "34": "new-jersey", "35": "new-mexico",
  "36": "new-york", "37": "north-carolina", "38": "north-dakota", "39": "ohio",
  "40": "oklahoma", "41": "oregon", "42": "pennsylvania", "44": "rhode-island",
  "45": "south-carolina", "46": "south-dakota", "47": "tennessee", "48": "texas",
  "49": "utah", "50": "vermont", "51": "virginia", "53": "washington",
  "54": "west-virginia", "55": "wisconsin", "56": "wyoming",
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function scoreColor(score: number): string {
  if (score >= 65) return "var(--green)";
  if (score >= 45) return "#d97706";
  return "var(--red)";
}

function mapFillColor(score: number): string {
  if (!score) return "#e5e7eb";
  if (score >= 65) return "#86efac";
  if (score >= 50) return "#bef264";
  if (score >= 40) return "#fde68a";
  if (score >= 25) return "#fed7aa";
  return "#fecaca";
}

function scoreLabel(score: number): string {
  if (score >= 65) return "Transparent";
  if (score >= 45) return "Moderate";
  return "Restrictive";
}

function pct(n: number): string {
  return `${n.toFixed(1)}%`;
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
  const router = useRouter();
  const [data, setData] = useState<StateMapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hoveredState, setHoveredState] = useState<JurisdictionSummary | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  // Directory state
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("transparency_score");

  useEffect(() => {
    fetchStateMapData()
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  // Pie chart data
  const pieData = data
    ? [
        { name: "Completed", value: data.total_completed, color: "#059669" },
        { name: "Rejected", value: data.total_rejected, color: "#dc2626" },
        { name: "No Responsive Docs", value: data.total_no_docs, color: "#d97706" },
        { name: "Partial", value: data.total_partial, color: "#f59e0b" },
        { name: "Appealing", value: data.total_appeal, color: "#7c3aed" },
        { name: "Withdrawn", value: data.total_withdrawn, color: "#6b7280" },
        { name: "In Progress", value: data.total_in_progress, color: "#3b82f6" },
      ].filter((d) => d.value > 0)
    : [];

  // Bar chart data for top states
  const topBarData = data?.top_states.slice(0, 10).map((s) => ({
    name: s.name.length > 22 ? s.name.slice(0, 20) + "…" : s.name,
    score: parseFloat(s.transparency_score.toFixed(1)),
    slug: s.slug,
  })) ?? [];

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

  if (error || !data) {
    return (
      <main>
        <div className="hub-container">
          <div className="hub-error">
            <p>Could not load hub data. The cache may be empty — run the refresh script first.</p>
            {error && <p className="hub-error-detail">{error}</p>}
          </div>
        </div>
      </main>
    );
  }

  const statesBySlug: Record<string, JurisdictionSummary> = {};
  data.states.forEach((s) => { statesBySlug[s.slug] = s; });

  // Filtered/sorted states for directory
  const filteredStates = data.states
    .filter((s) => !search || s.name.toLowerCase().includes(search.toLowerCase()) || s.abbrev.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const av = a[sortBy as keyof JurisdictionSummary];
      const bv = b[sortBy as keyof JurisdictionSummary];
      if (typeof av === "string" && typeof bv === "string") {
        return sortBy === "name" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      const asc = sortBy === "name" || sortBy === "average_response_time" || sortBy === "fee_rate";
      return asc ? Number(av) - Number(bv) : Number(bv) - Number(av);
    });

  const lastRefreshed = data.last_refreshed
    ? new Date(data.last_refreshed).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
    : "—";

  return (
    <main>
      <div className="hub-container">

        {/* ── Header ── */}
        <div className="header">
          <h1>FOIA Transparency Hub</h1>
          <p className="hub-header-subtitle">
            <span className="hub-scope-badge">State & Local</span>
            {" "}transparency data across{" "}
            <strong>{data.states.length}</strong> state jurisdictions and{" "}
            <strong>{data.total_state_agencies.toLocaleString()}</strong> agencies, sourced
            from MuckRock&apos;s public FOIA database. Updated weekly.
          </p>
          {data.last_refreshed && (
            <p className="hub-refresh-note">Last updated: {lastRefreshed}</p>
          )}
          <div className="hub-header-cta">
            <Link href="/draft" className="hub-cta-primary">
              Draft a FOIA Request
            </Link>
            <a href="#state-directory" className="hub-cta-secondary">
              Browse Agencies
            </a>
            <Link href="/hub" className="hub-cta-secondary">
              Federal Agency Data
            </Link>
          </div>
        </div>

        {/* ── Key Stats ── */}
        <div className="hub-stats-grid">
          <StatCard
            label="Overall Success Rate"
            value={`${data.overall_success_rate}%`}
            sub="Requests fully completed"
            accent={scoreColor(data.overall_success_rate)}
          />
          <StatCard
            label="Total FOIA Requests"
            value={data.total_requests.toLocaleString()}
            sub={`${data.total_completed.toLocaleString()} completed`}
          />
          <StatCard
            label="Median Response Time"
            value={`${Math.round(data.median_response_time)} days`}
            sub="Across all state agencies"
          />
          <StatCard
            label="Agencies with Portal"
            value={`${data.portal_coverage_pct}%`}
            sub="Electronic submission available"
          />
        </div>

        {/* ── Choropleth Map ── */}
        <div className="hub-section">
          <div className="states-map-container">
            <ComposableMap projection="geoAlbersUsa" style={{ width: "100%", height: "auto" }}>
              <ZoomableGroup>
                <Geographies geography={GEO_URL}>
                  {({ geographies }) =>
                    geographies.map((geo) => {
                      const fips = geo.id;
                      const slug = FIPS_TO_SLUG[fips] || "";
                      const stateData = statesBySlug[slug];
                      const score = stateData?.transparency_score || 0;

                      return (
                        <Geography
                          key={geo.rsmKey}
                          geography={geo}
                          fill={mapFillColor(score)}
                          stroke="#fff"
                          strokeWidth={0.5}
                          style={{
                            default: { outline: "none" },
                            hover: { outline: "none", fill: "#93c5fd", cursor: "pointer" },
                            pressed: { outline: "none" },
                          }}
                          onMouseEnter={(e) => {
                            if (stateData) {
                              setHoveredState(stateData);
                              setTooltipPos({ x: e.clientX, y: e.clientY });
                            }
                          }}
                          onMouseMove={(e) => setTooltipPos({ x: e.clientX, y: e.clientY })}
                          onMouseLeave={() => setHoveredState(null)}
                          onClick={() => { if (slug) router.push(`/hub/states/${slug}`); }}
                        />
                      );
                    })
                  }
                </Geographies>
              </ZoomableGroup>
            </ComposableMap>

            {hoveredState && (
              <div className="states-tooltip" style={{ left: tooltipPos.x + 12, top: tooltipPos.y - 60 }}>
                <div className="states-tooltip-name">{hoveredState.name} ({hoveredState.abbrev})</div>
                <div className="states-tooltip-score" style={{ color: scoreColor(hoveredState.transparency_score) }}>
                  Score: {hoveredState.transparency_score.toFixed(1)} — {scoreLabel(hoveredState.transparency_score)}
                </div>
                <div className="states-tooltip-row">Success Rate: {hoveredState.overall_success_rate.toFixed(1)}%</div>
                <div className="states-tooltip-row">Avg Response: {Math.round(hoveredState.average_response_time)}d</div>
                <div className="states-tooltip-row">Agencies: {hoveredState.total_agencies}</div>
              </div>
            )}

            {/* Legend inside map container */}
            <div className="states-legend" style={{ marginTop: "0.75rem" }}>
              <span className="states-legend-item"><span className="states-legend-dot" style={{ background: "#fecaca" }} /> Restrictive</span>
              <span className="states-legend-item"><span className="states-legend-dot" style={{ background: "#fed7aa" }} /> Below Avg</span>
              <span className="states-legend-item"><span className="states-legend-dot" style={{ background: "#fde68a" }} /> Moderate</span>
              <span className="states-legend-item"><span className="states-legend-dot" style={{ background: "#bef264" }} /> Above Avg</span>
              <span className="states-legend-item"><span className="states-legend-dot" style={{ background: "#86efac" }} /> Transparent</span>
            </div>
          </div>
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
                >
                  {pieData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => [Number(value).toLocaleString(), ""]} />
              </PieChart>
            </ResponsiveContainer>
            <div className="hub-chart-legend">
              {pieData.map((d) => (
                <span key={d.name} className="hub-legend-item">
                  <span className="hub-legend-dot" style={{ background: d.color }} />
                  {d.name}: {d.value.toLocaleString()}
                </span>
              ))}
            </div>
          </div>

          {/* Top 10 States Bar Chart */}
          <div className="hub-chart-card hub-chart-card-wide">
            <h3 className="hub-chart-title">Top 10 Most Transparent States</h3>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart
                layout="vertical"
                data={topBarData}
                margin={{ top: 4, right: 24, left: 8, bottom: 4 }}
              >
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
        </div>

        {/* ── Top / Bottom Tables ── */}
        <p className="hub-score-explainer">
          <strong>Transparency Score</strong> (0–100): weighted composite of success rate (40%), response speed (30%), fee rate (15%), and electronic portal availability (15%).
        </p>
        <div className="hub-tables-row">
          <div className="hub-ranking-card">
            <h3 className="hub-ranking-title hub-ranking-title-good">Most Transparent</h3>
            <table className="hub-table">
              <thead>
                <tr>
                  <th className="hub-th">#</th>
                  <th className="hub-th">State</th>
                  <th className="hub-th hub-th-num">Score</th>
                  <th className="hub-th hub-th-num">Success</th>
                </tr>
              </thead>
              <tbody>
                {data.top_states.slice(0, 10).map((s, i) => (
                  <tr key={s.id}>
                    <td className="hub-td hub-td-rank">{i + 1}</td>
                    <td className="hub-td hub-td-name">
                      <Link href={`/hub/states/${s.slug}`} className="hub-agency-link">
                        {s.name}
                      </Link>
                    </td>
                    <td className="hub-td hub-td-score"><ScoreBadge score={s.transparency_score} /></td>
                    <td className="hub-td hub-td-num" style={{ color: scoreColor(s.overall_success_rate) }}>
                      {pct(s.overall_success_rate)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="hub-ranking-card">
            <h3 className="hub-ranking-title hub-ranking-title-bad">Least Transparent</h3>
            <table className="hub-table">
              <thead>
                <tr>
                  <th className="hub-th">#</th>
                  <th className="hub-th">State</th>
                  <th className="hub-th hub-th-num">Score</th>
                  <th className="hub-th hub-th-num">Success</th>
                </tr>
              </thead>
              <tbody>
                {data.bottom_states.slice(0, 10).map((s, i) => (
                  <tr key={s.id}>
                    <td className="hub-td hub-td-rank">{i + 1}</td>
                    <td className="hub-td hub-td-name">
                      <Link href={`/hub/states/${s.slug}`} className="hub-agency-link">
                        {s.name}
                      </Link>
                    </td>
                    <td className="hub-td hub-td-score"><ScoreBadge score={s.transparency_score} /></td>
                    <td className="hub-td hub-td-num" style={{ color: scoreColor(s.overall_success_rate) }}>
                      {pct(s.overall_success_rate)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── State Directory ── */}
        <section className="hub-directory" id="state-directory">
          <div className="hub-directory-header">
            <h2 className="hub-directory-title">State Directory</h2>
            <div className="hub-search-row">
              <input
                type="text"
                placeholder="Search states…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="hub-search-input"
              />
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="hub-sort-select"
              >
                {SORT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>Sort: {o.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="hub-table-wrapper">
            <table className="hub-table hub-dir-table">
              <thead>
                <tr>
                  <th className="hub-th">State</th>
                  <th className="hub-th hub-th-num">Agencies</th>
                  <th className="hub-th hub-th-num">Requests</th>
                  <th className="hub-th hub-th-num">Success</th>
                  <th className="hub-th hub-th-num">Avg Response</th>
                  <th className="hub-th hub-th-num">Fee Rate</th>
                  <th className="hub-th hub-th-num">Transparency Score</th>
                </tr>
              </thead>
              <tbody>
                {filteredStates.map((s) => (
                  <tr key={s.id} className="hub-table-row-clickable" onClick={() => router.push(`/hub/states/${s.slug}`)}>
                    <td className="hub-td hub-td-name">
                      <strong>{s.name}</strong>{" "}
                      <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>{s.abbrev}</span>
                    </td>
                    <td className="hub-td hub-td-num">{s.total_agencies}</td>
                    <td className="hub-td hub-td-num">{s.total_requests.toLocaleString()}</td>
                    <td className="hub-td hub-td-num" style={{ color: scoreColor(s.overall_success_rate) }}>
                      {pct(s.overall_success_rate)}
                    </td>
                    <td className="hub-td hub-td-num">
                      {s.average_response_time ? `${Math.round(s.average_response_time)}d` : "—"}
                    </td>
                    <td className="hub-td hub-td-num">{s.fee_rate ? pct(s.fee_rate) : "—"}</td>
                    <td className="hub-td hub-td-score"><ScoreBadge score={s.transparency_score} /></td>
                  </tr>
                ))}
                {filteredStates.length === 0 && (
                  <tr><td colSpan={7} className="hub-td hub-td-empty">No states found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── Resources ── */}
        <section className="hub-resources">
          <h2 className="hub-resources-title">FOIA Resources</h2>
          <p className="hub-resources-subtitle">Guides, tools, and references for filing effective FOIA requests.</p>
          <div className="hub-resources-grid">
            {[
              {
                title: "DOJ Guide to the Freedom of Information Act",
                source: "DOJ",
                description: "The official comprehensive guide covering FOIA exemptions, procedures, and agency obligations.",
                url: "https://www.justice.gov/oip/doj-guide-freedom-information-act-0",
              },
              {
                title: "Reporters Committee FOIA Wiki",
                source: "RCFP",
                description: "Detailed state and federal FOIA law summaries, appeal procedures, and requester rights.",
                url: "https://www.rcfp.org/open-government-guide/",
              },
              {
                title: "MuckRock — How to File a FOIA Request",
                source: "MuckRock",
                description: "Step-by-step guide for filing requests, tracking responses, and appealing denials.",
                url: "https://www.muckrock.com/about/muckrock-101/",
              },
              {
                title: "FOIA.gov — National FOIA Portal",
                source: "GSA",
                description: "Submit requests to any federal agency and track status through the official government portal.",
                url: "https://www.foia.gov/",
              },
              {
                title: "OMB Fee Guidelines for FOIA",
                source: "OMB",
                description: "Official guidance on fee categories, fee waivers, and how agencies must calculate FOIA fees.",
                url: "https://www.justice.gov/oip/foia-resources#s5",
              },
              {
                title: "EFF FOIA Litigation Guide",
                source: "EFF",
                description: "When and how to sue an agency for FOIA non-compliance, written for non-lawyers.",
                url: "https://www.eff.org/issues/transparency",
              },
            ].map((r) => (
              <a
                key={r.title}
                href={r.url}
                target="_blank"
                rel="noopener noreferrer"
                className="hub-resource-card"
              >
                <div className="hub-resource-header">
                  <span className="hub-resource-source">{r.source}</span>
                  <span className="hub-resource-arrow">↗</span>
                </div>
                <div className="hub-resource-title">{r.title}</div>
                <p className="hub-resource-desc">{r.description}</p>
              </a>
            ))}
          </div>
        </section>

        {/* Footer note */}
        <p className="hub-footer-note">
          Data sourced from{" "}
          <a href="https://www.muckrock.com" target="_blank" rel="noopener noreferrer">MuckRock</a>. Refreshed weekly.
        </p>
      </div>
    </main>
  );
}
