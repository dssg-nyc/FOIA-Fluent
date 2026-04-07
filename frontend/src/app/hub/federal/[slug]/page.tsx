"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
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
import { fetchAgencyDetail, AgencyDetail } from "@/lib/hub-api";

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

function pct(n: number, decimals = 1): string {
  return `${n.toFixed(decimals)}%`;
}

function days(n: number): string {
  if (!n) return "—";
  return `${Math.round(n)} days`;
}

function muckrockUrl(absoluteUrl: string): string {
  if (!absoluteUrl) return "https://www.muckrock.com/agency/";
  return absoluteUrl.startsWith("http")
    ? absoluteUrl
    : `https://www.muckrock.com${absoluteUrl}`;
}

// ── Score gauge ────────────────────────────────────────────────────────────────

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

// ── Pattern card ───────────────────────────────────────────────────────────────

function PatternCard({
  item,
  type,
}: {
  item: { title: string; status: string; url: string; description: string };
  type: "denial" | "success" | "exemption";
}) {
  const colors = {
    denial: { bg: "#fef2f2", border: "#fecaca", label: "#dc2626" },
    success: { bg: "#f0fdf4", border: "#bbf7d0", label: "#059669" },
    exemption: { bg: "#fefce8", border: "#fde68a", label: "#92400e" },
  };
  const c = colors[type];
  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className="hub-pattern-card"
      style={{ background: c.bg, borderColor: c.border }}
    >
      <div className="hub-pattern-title">{item.title}</div>
      {item.status && (
        <span className="hub-pattern-status" style={{ color: c.label }}>
          {item.status}
        </span>
      )}
      {item.description && (
        <p className="hub-pattern-desc">{item.description.slice(0, 180)}</p>
      )}
    </a>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function AgencyDetailPage() {
  const { slug } = useParams() as { slug: string };
  const [detail, setDetail] = useState<AgencyDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    fetchAgencyDetail(slug, "Federal")
      .then(setDetail)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [slug]);

  if (loading) {
    return (
      <main>
        <div className="container">
          <div className="hub-loading">
            <div className="spinner" />
            <p>Loading agency data…</p>
          </div>
        </div>
      </main>
    );
  }

  if (error || !detail) {
    return (
      <main>
        <div className="container">
          <div className="hub-error">
            <p>Agency not found in the transparency hub cache.</p>
            {error && <p className="hub-error-detail">{error}</p>}
            <Link href="/hub" className="hub-back-link">
              ← Back to Data Hub
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const { stats, percentile } = detail;

  const outcomePieData = [
    { name: "Completed", value: stats.number_requests_completed, color: "#000000" },
    { name: "Rejected", value: stats.number_requests_rejected, color: "#dc2626" },
    { name: "No Responsive Docs", value: stats.number_requests_no_docs, color: "#d97706" },
    { name: "Partial", value: stats.number_requests_partial, color: "#f59e0b" },
    { name: "Appealing", value: stats.number_requests_appeal + stats.number_requests_lawsuit, color: "#475569" },
    { name: "Withdrawn", value: stats.number_requests_withdrawn, color: "#94a3b8" },
    { name: "In Progress", value: stats.number_requests_ack + stats.number_requests_resp + stats.number_requests_fix + stats.number_requests_pay, color: "#1863dc" },
  ].filter((d) => d.value > 0);

  // Score component breakdown — rates are 0–100 percentages from MuckRock
  const componentData = [
    {
      name: "Success Rate",
      value: parseFloat(((stats.success_rate || 0) / 100 * 40).toFixed(1)),
      max: 40,
    },
    {
      name: "Response Speed",
      value: parseFloat(
        (
          Math.max(0, 1 - Math.min((stats.average_response_time || 60) / 120, 1)) *
          30
        ).toFixed(1)
      ),
      max: 30,
    },
    {
      name: "Fee Rate",
      value: parseFloat(
        ((1 - Math.min((stats.fee_rate || 0) / 100, 1)) * 15).toFixed(1)
      ),
      max: 15,
    },
    {
      name: "Portal",
      value: stats.has_portal ? 15 : 0,
      max: 15,
    },
  ];

  return (
    <main>
      <div className="hub-container">

        {/* Back */}
        <Link href="/hub" className="hub-back-link">
          ← Transparency Hub
        </Link>

        {/* ── Header ── */}
        <div className="hub-detail-header">
          <div>
            <h1 className="hub-detail-name">{stats.name}</h1>
            {stats.jurisdiction && (
              <p className="hub-detail-jurisdiction">{stats.jurisdiction}</p>
            )}
          </div>
          <a
            href={muckrockUrl(stats.absolute_url)}
            target="_blank"
            rel="noopener noreferrer"
            className="hub-muckrock-link"
          >
            View on MuckRock ↗
          </a>
        </div>

        {/* ── Key Stats Bar ── */}
        <div className="hub-detail-stats">
          <div className="hub-detail-stat">
            <div className="hub-detail-stat-value">
              {stats.number_requests.toLocaleString()}
            </div>
            <div className="hub-detail-stat-label">Total Requests</div>
          </div>
          <div className="hub-detail-stat">
            <div
              className="hub-detail-stat-value"
              style={{ color: scoreColor(stats.success_rate) }}
            >
              {pct(stats.success_rate)}
            </div>
            <div className="hub-detail-stat-label">Success Rate</div>
          </div>
          <div className="hub-detail-stat">
            <div className="hub-detail-stat-value">
              {days(stats.average_response_time)}
            </div>
            <div className="hub-detail-stat-label">Avg Response Time</div>
          </div>
          <div className="hub-detail-stat">
            <div className="hub-detail-stat-value">{pct(stats.fee_rate)}</div>
            <div className="hub-detail-stat-label">Fee Rate</div>
          </div>
          <div className="hub-detail-stat">
            <div
              className="hub-detail-stat-value"
              style={{ color: stats.has_portal ? "var(--green)" : "var(--muted)" }}
            >
              {stats.has_portal ? "Yes" : "No"}
            </div>
            <div className="hub-detail-stat-label">Electronic Portal</div>
          </div>
        </div>

        {/* ── Score + Percentile ── */}
        <div className="hub-score-section">
          <div className="hub-score-left">
            <h3 className="hub-section-title">Transparency Score</h3>
            <ScoreGauge score={stats.transparency_score} />
            {percentile > 0 && (
              <p className="hub-percentile-note">
                Better than{" "}
                <strong>{percentile.toFixed(0)}%</strong> of agencies
              </p>
            )}
          </div>
          <div className="hub-score-right">
            <h3 className="hub-section-title">Score Breakdown</h3>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart
                layout="vertical"
                data={componentData}
                margin={{ top: 4, right: 32, left: 8, bottom: 4 }}
              >
                <XAxis type="number" domain={[0, 40]} tick={{ fontSize: 11 }} />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={110}
                  tick={{ fontSize: 11 }}
                />
                <Tooltip
                  formatter={(v, _name, props) => [
                    `${Number(v).toFixed(1)} / ${(props.payload as {max?: number})?.max ?? "?"}`,
                    "Points",
                  ]}
                />
                <Bar dataKey="value" fill="var(--primary)" radius={[0, 4, 4, 0]} animationDuration={1200} animationEasing="ease-out" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* ── Outcome Breakdown ── */}
        <div className="hub-outcome-section">
          <h3 className="hub-section-title">Request Outcomes</h3>
          <div className="hub-outcome-row">
            <ResponsiveContainer width={200} height={200}>
              <PieChart>
                <Pie
                  data={outcomePieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={80}
                  paddingAngle={2}
                  dataKey="value"
                  animationDuration={1200}
                  animationEasing="ease-out"
                >
                  {outcomePieData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(v) => [Number(v).toLocaleString(), ""]}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="hub-outcome-legend">
              {outcomePieData.map((d) => (
                <div key={d.name} className="hub-outcome-item">
                  <span
                    className="hub-legend-dot"
                    style={{ background: d.color }}
                  />
                  <span className="hub-outcome-label">{d.name}</span>
                  <span className="hub-outcome-count">
                    {d.value.toLocaleString()}
                  </span>
                  <span className="hub-outcome-pct">
                    (
                    {pct(
                      (d.value / Math.max(stats.number_requests, 1)) * 100,
                      0
                    )}
                    )
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Request Patterns ── */}
        {(detail.success_patterns.length > 0 ||
          detail.denial_patterns.length > 0 ||
          detail.exemption_patterns.length > 0) && (
          <div className="hub-patterns-section">
            <h3 className="hub-section-title">Request Patterns</h3>
            <p className="hub-patterns-note">
              Sample requests from MuckRock showing common outcomes. Click any
              card to view the full request.
            </p>

            {detail.success_patterns.length > 0 && (
              <div className="hub-pattern-group">
                <h4 className="hub-pattern-group-title hub-pattern-group-title-success">
                  Successful Requests
                </h4>
                <div className="hub-pattern-grid">
                  {detail.success_patterns.map((p, i) => (
                    <PatternCard key={i} item={p} type="success" />
                  ))}
                </div>
              </div>
            )}

            {detail.denial_patterns.length > 0 && (
              <div className="hub-pattern-group">
                <h4 className="hub-pattern-group-title hub-pattern-group-title-denial">
                  Common Denials
                </h4>
                <div className="hub-pattern-grid">
                  {detail.denial_patterns.map((p, i) => (
                    <PatternCard key={i} item={p} type="denial" />
                  ))}
                </div>
              </div>
            )}

            {detail.exemption_patterns.length > 0 && (
              <div className="hub-pattern-group">
                <h4 className="hub-pattern-group-title hub-pattern-group-title-exemption">
                  Exemptions Invoked
                </h4>
                <div className="hub-pattern-grid">
                  {detail.exemption_patterns.map((p, i) => (
                    <PatternCard key={i} item={p} type="exemption" />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── CTA ── */}
        <div className="hub-cta">
          <p>
            Want to file a FOIA request with this agency?
          </p>
          <Link href={`/?agency=${encodeURIComponent(stats.name)}`} className="hub-cta-btn">
            Draft a Request →
          </Link>
        </div>

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
