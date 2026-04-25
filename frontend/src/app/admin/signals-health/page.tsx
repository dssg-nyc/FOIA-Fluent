"use client";

/**
 * Admin-only signals health dashboard. Not in public nav.
 *
 * Auth: X-Admin-Secret stored in localStorage. If missing or wrong, renders
 * a single-field form that saves the secret and retries.
 */

import { useEffect, useState } from "react";
import {
  getSignalsHealth,
  getRecentRuns,
  triggerPatternRun,
  getAdminSecret,
  setAdminSecret,
  clearAdminSecret,
  type SignalsHealthResponse,
  type SignalsSourceHealth,
  type SignalsRunRow,
  type PatternRunResult,
} from "@/lib/admin-api";

function formatRelative(iso: string | null): string {
  if (!iso) return "never";
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

function statusBadge(status: string | null): { label: string; color: string } {
  switch (status) {
    case "succeeded":
      return { label: "OK", color: "#16a34a" };
    case "failed":
      return { label: "FAIL", color: "#dc2626" };
    case "skipped_cadence":
      return { label: "WAITING", color: "#6b7280" };
    case "skipped_disabled":
      return { label: "OFF", color: "#6b7280" };
    case null:
    case undefined:
      return { label: "—", color: "#9ca3af" };
    default:
      return { label: status ?? "?", color: "#6b7280" };
  }
}

export default function SignalsHealthPage() {
  const [secret, setSecretState] = useState<string | null>(null);
  const [needsSecret, setNeedsSecret] = useState(false);
  const [data, setData] = useState<SignalsHealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [runs, setRuns] = useState<SignalsRunRow[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [patternRunning, setPatternRunning] = useState(false);
  const [patternResult, setPatternResult] = useState<PatternRunResult | null>(null);

  async function handleRunPatterns() {
    setPatternRunning(true);
    setPatternResult(null);
    try {
      const result = await triggerPatternRun();
      setPatternResult(result);
      // Refetch health so the pattern stats refresh
      const fresh = await getSignalsHealth();
      setData(fresh);
    } catch (e) {
      setPatternResult({ status: "error", error: (e as Error).message });
    } finally {
      setPatternRunning(false);
    }
  }

  useEffect(() => {
    const existing = getAdminSecret();
    if (!existing) {
      setNeedsSecret(true);
    } else {
      setSecretState(existing);
    }
  }, []);

  useEffect(() => {
    if (!secret) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getSignalsHealth()
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e: Error) => {
        if (!cancelled) {
          setError(e.message);
          if (e.message.includes("403")) {
            clearAdminSecret();
            setSecretState(null);
            setNeedsSecret(true);
          }
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [secret]);

  useEffect(() => {
    if (!selected) {
      setRuns([]);
      return;
    }
    let cancelled = false;
    setRunsLoading(true);
    getRecentRuns(selected, 20)
      .then((r) => {
        if (!cancelled) setRuns(r.runs || []);
      })
      .catch(() => {
        if (!cancelled) setRuns([]);
      })
      .finally(() => {
        if (!cancelled) setRunsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  if (needsSecret) {
    return (
      <div style={styles.gate}>
        <form
          style={styles.gateForm}
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const input = form.elements.namedItem("secret") as HTMLInputElement;
            const v = input.value.trim();
            if (!v) return;
            setAdminSecret(v);
            setSecretState(v);
            setNeedsSecret(false);
          }}
        >
          <h1 style={{ margin: 0 }}>Admin access</h1>
          <p style={{ color: "#6b7280", margin: "0.5rem 0 1rem" }}>
            Enter the <code>ADMIN_SECRET</code> value from the backend
            <code> .env</code> / Railway variables.
          </p>
          <input
            name="secret"
            type="password"
            autoFocus
            placeholder="X-Admin-Secret"
            style={styles.gateInput}
          />
          <button type="submit" style={styles.gateBtn}>
            Unlock
          </button>
        </form>
      </div>
    );
  }

  if (loading) {
    return <div style={styles.wrap}>Loading health...</div>;
  }

  if (error) {
    return (
      <div style={styles.wrap}>
        <p style={{ color: "#dc2626" }}>Error: {error}</p>
        <button
          onClick={() => {
            clearAdminSecret();
            setSecretState(null);
            setNeedsSecret(true);
          }}
          style={styles.gateBtn}
        >
          Re-enter secret
        </button>
      </div>
    );
  }

  if (!data) return <div style={styles.wrap}>No data.</div>;

  const t = data.totals;

  return (
    <div style={styles.wrap}>
      <header style={styles.header}>
        <h1 style={{ margin: 0 }}>Signals health</h1>
        <small style={{ color: "#6b7280" }}>
          generated {formatRelative(data.generated_at)}
        </small>
      </header>

      <section style={styles.totals}>
        <Stat label="sources" value={`${t.sources_enabled} / ${t.sources_registered}`} />
        <Stat label="signals total" value={t.items_total_all_time.toLocaleString()} />
        <Stat label="inserted (7d)" value={String(t.items_inserted_7d)} />
        <Stat label="runs (7d)" value={String(t.runs_7d)} />
        <Stat
          label="cost (7d)"
          value={`$${t.cost_usd_7d.toFixed(3)}`}
        />
        <Stat
          label="projected monthly"
          value={`$${t.projected_monthly_cost_usd.toFixed(2)}`}
        />
      </section>

      <section style={styles.patternBox}>
        <div style={{ flex: 1 }}>
          <div style={styles.patternLabel}>pattern engine</div>
          <div style={styles.patternMeta}>
            {t.patterns_count_total.toLocaleString()} patterns generated all time
            {" · "}
            last run {formatRelative(t.last_pattern_run_at)}
          </div>
          {patternResult && (
            <div
              style={{
                marginTop: "0.4rem",
                fontSize: "0.78rem",
                color: patternResult.status === "succeeded" ? "#16a34a" : "#dc2626",
              }}
            >
              {patternResult.status === "succeeded"
                ? `✓ ${patternResult.patterns_inserted} new pattern(s) from ${patternResult.signals} signals in ${patternResult.runtime_seconds}s`
                : `error: ${patternResult.error || patternResult.status}`}
            </div>
          )}
        </div>
        <button
          onClick={handleRunPatterns}
          disabled={patternRunning}
          style={{
            ...styles.gateBtn,
            opacity: patternRunning ? 0.5 : 1,
            cursor: patternRunning ? "wait" : "pointer",
          }}
        >
          {patternRunning ? "running…" : "Run patterns now"}
        </button>
      </section>

      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>status</th>
            <th style={styles.th}>source</th>
            <th style={styles.th}>strategy</th>
            <th style={styles.th}>cadence</th>
            <th style={styles.th}>last run</th>
            <th style={styles.th}>7d ok / fail</th>
            <th style={styles.th}>total</th>
            <th style={styles.th}>items 7d</th>
            <th style={styles.th}>cost 7d</th>
            <th style={styles.th}>monthly</th>
          </tr>
        </thead>
        <tbody>
          {data.sources.map((s) => (
            <SourceRow
              key={s.source_id}
              s={s}
              expanded={selected === s.source_id}
              onToggle={() =>
                setSelected(selected === s.source_id ? null : s.source_id)
              }
              runs={selected === s.source_id ? runs : []}
              runsLoading={selected === s.source_id && runsLoading}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={styles.statCell}>
      <div style={styles.statLabel}>{label}</div>
      <div style={styles.statValue}>{value}</div>
    </div>
  );
}

function SourceRow({
  s,
  expanded,
  onToggle,
  runs,
  runsLoading,
}: {
  s: SignalsSourceHealth;
  expanded: boolean;
  onToggle: () => void;
  runs: SignalsRunRow[];
  runsLoading: boolean;
}) {
  const badge = statusBadge(s.last_run_status);
  const cadenceLabel =
    s.cadence_minutes >= 1440
      ? `${(s.cadence_minutes / 1440).toFixed(0)}d`
      : `${(s.cadence_minutes / 60).toFixed(0)}h`;

  return (
    <>
      <tr
        onClick={onToggle}
        style={{
          ...styles.tr,
          cursor: "pointer",
          background: expanded ? "#f3f4f6" : undefined,
        }}
      >
        <td style={styles.td}>
          <span
            style={{
              ...styles.badge,
              background: badge.color,
            }}
          >
            {badge.label}
          </span>
          {!s.enabled && (
            <span style={{ ...styles.badge, background: "#6b7280", marginLeft: 4 }}>
              OFF
            </span>
          )}
        </td>
        <td style={styles.td}>
          <code style={{ fontWeight: 600 }}>{s.source_id}</code>
          <div style={{ color: "#6b7280", fontSize: "0.78rem" }}>{s.label}</div>
        </td>
        <td style={styles.td}>
          <code>{s.fetch_strategy}</code>
          <div style={{ color: "#6b7280", fontSize: "0.78rem" }}>{s.family}</div>
        </td>
        <td style={styles.td}>{cadenceLabel}</td>
        <td style={styles.td}>
          {formatRelative(s.last_run_at)}
          {s.last_run_error && (
            <div
              style={{
                color: "#dc2626",
                fontSize: "0.78rem",
                marginTop: 2,
                maxWidth: 200,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={s.last_run_error}
            >
              {s.last_run_error.slice(0, 60)}
            </div>
          )}
        </td>
        <td style={styles.td}>
          <span style={{ color: "#16a34a" }}>{s.runs_succeeded_7d}</span>
          {" / "}
          <span style={{ color: s.runs_failed_7d > 0 ? "#dc2626" : "#6b7280" }}>
            {s.runs_failed_7d}
          </span>
        </td>
        <td style={styles.td}>
          <strong>{s.items_total.toLocaleString()}</strong>
          <div style={{ color: "#6b7280", fontSize: "0.78rem" }}>all time</div>
        </td>
        <td style={styles.td}>
          <strong>{s.items_inserted_7d}</strong>
          <div style={{ color: "#6b7280", fontSize: "0.78rem" }}>
            {s.items_skipped_dup_7d} dup · {s.items_failed_7d} fail
          </div>
        </td>
        <td style={styles.td}>${s.cost_usd_7d.toFixed(4)}</td>
        <td style={styles.td}>${s.projected_monthly_cost_usd.toFixed(2)}</td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={9} style={{ ...styles.td, background: "#f9fafb" }}>
            {runsLoading ? (
              <span style={{ color: "#6b7280" }}>loading runs...</span>
            ) : runs.length === 0 ? (
              <span style={{ color: "#6b7280" }}>no recent runs</span>
            ) : (
              <table style={{ ...styles.table, marginTop: 0 }}>
                <thead>
                  <tr>
                    <th style={styles.thSmall}>when</th>
                    <th style={styles.thSmall}>status</th>
                    <th style={styles.thSmall}>fetched</th>
                    <th style={styles.thSmall}>inserted</th>
                    <th style={styles.thSmall}>dup</th>
                    <th style={styles.thSmall}>fail</th>
                    <th style={styles.thSmall}>tokens (in/out)</th>
                    <th style={styles.thSmall}>error</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id}>
                      <td style={styles.tdSmall}>
                        {new Date(r.started_at).toLocaleString()}
                      </td>
                      <td style={styles.tdSmall}>
                        <code>{r.status}</code>
                      </td>
                      <td style={styles.tdSmall}>{r.items_fetched}</td>
                      <td style={styles.tdSmall}>{r.items_inserted}</td>
                      <td style={styles.tdSmall}>{r.items_skipped_dup}</td>
                      <td style={styles.tdSmall}>{r.items_failed}</td>
                      <td style={styles.tdSmall}>
                        {r.claude_input_tokens} / {r.claude_output_tokens}
                      </td>
                      <td
                        style={{
                          ...styles.tdSmall,
                          color: r.error_message ? "#dc2626" : undefined,
                          maxWidth: 280,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                        title={r.error_message || ""}
                      >
                        {r.error_message?.slice(0, 80) || ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

// Inline styles keep this page self-contained (no global-css dependencies)
const styles: Record<string, React.CSSProperties> = {
  wrap: {
    padding: "2rem",
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    color: "#111",
    maxWidth: 1400,
    margin: "0 auto",
  },
  header: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginBottom: "1.25rem",
  },
  totals: {
    display: "grid",
    gridTemplateColumns: "repeat(6, 1fr)",
    gap: "0.75rem",
    marginBottom: "1rem",
  },
  patternBox: {
    display: "flex",
    alignItems: "center",
    gap: "1rem",
    padding: "0.85rem 1rem",
    background: "#fafafa",
    border: "1px solid #e5e7eb",
    borderRadius: 8,
    marginBottom: "1.25rem",
  },
  patternLabel: {
    fontSize: "0.72rem",
    color: "#6b7280",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    fontWeight: 600,
    marginBottom: 2,
  },
  patternMeta: {
    fontSize: "0.85rem",
    color: "#374151",
  },
  statCell: {
    background: "#f3f4f6",
    borderRadius: 8,
    padding: "0.75rem 1rem",
  },
  statLabel: {
    fontSize: "0.75rem",
    color: "#6b7280",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  statValue: {
    fontSize: "1.35rem",
    fontWeight: 600,
    marginTop: 2,
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: "0.9rem",
    marginTop: "1rem",
  },
  th: {
    textAlign: "left",
    padding: "0.55rem 0.75rem",
    borderBottom: "1px solid #e5e7eb",
    color: "#6b7280",
    fontSize: "0.78rem",
    textTransform: "uppercase",
    letterSpacing: "0.03em",
    fontWeight: 500,
  },
  thSmall: {
    textAlign: "left",
    padding: "0.35rem 0.5rem",
    borderBottom: "1px solid #e5e7eb",
    color: "#6b7280",
    fontSize: "0.72rem",
    fontWeight: 500,
  },
  tr: {
    borderBottom: "1px solid #f1f5f9",
  },
  td: {
    padding: "0.65rem 0.75rem",
    verticalAlign: "top",
    fontSize: "0.88rem",
  },
  tdSmall: {
    padding: "0.35rem 0.5rem",
    fontSize: "0.78rem",
    verticalAlign: "top",
  },
  badge: {
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: 4,
    color: "white",
    fontSize: "0.7rem",
    fontWeight: 600,
    letterSpacing: "0.03em",
  },
  gate: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#f9fafb",
    padding: "1rem",
  },
  gateForm: {
    background: "white",
    padding: "2rem",
    borderRadius: 12,
    boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
    width: "100%",
    maxWidth: 400,
  },
  gateInput: {
    width: "100%",
    padding: "0.6rem 0.75rem",
    border: "1px solid #d1d5db",
    borderRadius: 6,
    fontSize: "0.9rem",
    boxSizing: "border-box",
    marginBottom: "0.75rem",
  },
  gateBtn: {
    background: "#111",
    color: "white",
    border: "none",
    padding: "0.55rem 1.25rem",
    borderRadius: 6,
    fontSize: "0.9rem",
    fontWeight: 500,
    cursor: "pointer",
  },
};
