"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import AuthGuard from "@/components/AuthGuard";
import {
  fetchPatterns,
  fetchPersonaCatalog,
  fetchMyPersonas,
  saveMyPersonas,
  type Persona,
  type SignalPattern,
  type PatternEvidenceSignal,
} from "@/lib/signals-api";

const PATTERN_TYPE_LABELS: Record<string, string> = {
  compounding_risk: "Compounding risk",
  coordinated_activity: "Coordinated activity",
  trend_shift: "Trend shift",
  convergence: "Convergence",
};

const SOURCE_LABELS: Record<string, string> = {
  gao_protests: "GAO",
  epa_echo: "EPA ECHO",
  fda_warning_letters: "FDA",
  dhs_foia_log: "DHS FOIA",
};

// Plain-English action verb shown as the prefix on every evidence row.
// Tells the user what kind of document/event this signal actually is.
const SIGNAL_KIND_LABEL: Record<string, string> = {
  gao_protests: "GAO bid protest decision",
  epa_echo: "EPA enforcement action",
  fda_warning_letters: "FDA Warning Letter",
  dhs_foia_log: "DHS FOIA request",
};

// "FOIA request filed" sources are FOIA logs (we know who filed the request).
// "Agency action" sources are documents/actions agencies publish themselves.
const FOIA_REQUEST_SOURCES = new Set(["dhs_foia_log"]);
function signalKind(source: string): "request" | "action" {
  return FOIA_REQUEST_SOURCES.has(source) ? "request" : "action";
}

// One-line explainer per kind, shown above the evidence group
function groupExplainer(kind: "action" | "request", count: number): string {
  if (kind === "action") {
    return count === 1
      ? "One agency document used as evidence for this pattern. Click to read it."
      : "Each row is a separate document the agency itself published. Click any row for details.";
  }
  return count === 1
    ? "One row from a public agency FOIA log — a request someone filed against the agency."
    : "Each row is one request someone filed against the agency, pulled from the agency's public FOIA log. Click any row for details.";
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function fmtShortDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return iso;
  }
}

/** Convert "company:smithfield-foods" → { type: "company", display: "Smithfield Foods" } */
function parseEntitySlug(slug: string): { type: string; rawSlug: string; display: string } {
  const [type, rawSlug] = slug.split(":");
  const display = (rawSlug || "")
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  return { type: type || "entity", rawSlug: rawSlug || "", display };
}

function EvidenceRow({ signal }: { signal: PatternEvidenceSignal }) {
  const [expanded, setExpanded] = useState(false);
  const kindLabel = SIGNAL_KIND_LABEL[signal.source] || SOURCE_LABELS[signal.source] || signal.source;

  // Build the one-line headline:
  //   "FDA Warning Letter to Gram Peptides"
  //   "DHS FOIA request from Reuters"
  //   "EPA enforcement action against Wynona School"
  let headline = kindLabel;
  if (signal.requester) {
    headline = `${kindLabel} from ${signal.requester}`;
  } else if (signal.title) {
    // Use the title as the recipient, e.g. "FDA Warning Letter to Gram Peptides"
    const verb = signalKind(signal.source) === "request" ? "from" : "to";
    headline = `${kindLabel} ${verb} ${signal.title}`;
  }

  const entityList: string[] = [];
  if (signal.entities?.companies) entityList.push(...signal.entities.companies.slice(0, 4));
  if (signal.entities?.regulations) entityList.push(...signal.entities.regulations.slice(0, 3));

  return (
    <li className="signals-evidence-row">
      <button
        type="button"
        className="signals-evidence-row-toggle"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        <span className="signals-evidence-row-meta">
          <span className="signals-pattern-evidence-badge">
            {SOURCE_LABELS[signal.source] || signal.source}
          </span>
          <span className="signals-pattern-evidence-date">{fmtShortDate(signal.signal_date)}</span>
        </span>
        <span className="signals-evidence-row-headline">{headline}</span>
        <span className="signals-evidence-row-arrow" aria-hidden="true">
          {expanded ? "▾" : "▸"}
        </span>
      </button>

      {expanded && (
        <div className="signals-evidence-row-detail">
          {signal.summary && (
            <p className="signals-evidence-row-summary">{signal.summary}</p>
          )}
          {entityList.length > 0 && (
            <div className="signals-evidence-row-entities">
              {entityList.map((e) => (
                <span key={e} className="signals-entity-tag">
                  {e}
                </span>
              ))}
            </div>
          )}
          {signal.source_url && (
            <a
              href={signal.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="signals-card-link"
            >
              View source ↗
            </a>
          )}
        </div>
      )}
    </li>
  );
}

function PatternCard({ pattern }: { pattern: SignalPattern }) {
  const [showAllEvidence, setShowAllEvidence] = useState(false);

  const typeLabel = PATTERN_TYPE_LABELS[pattern.pattern_type] || pattern.pattern_type;
  const paragraphs = pattern.narrative.split(/\n\n+/).filter(Boolean);
  const insightPara = paragraphs[0] || "";

  const evidence: PatternEvidenceSignal[] = pattern.evidence_signals || [];

  // Split evidence by kind so the user sees the agency actions vs FOIA requests
  // breakdown explicitly, with the actual signals listed under each.
  const agencyActions = evidence.filter((e) => signalKind(e.source) === "action");
  const foiaRequests = evidence.filter((e) => signalKind(e.source) === "request");

  // Compact count summary for the headline ("8 agency actions + 2 FOIA requests")
  const countParts: string[] = [];
  if (agencyActions.length > 0) {
    countParts.push(
      `${agencyActions.length} agency ${agencyActions.length === 1 ? "action" : "actions"}`,
    );
  }
  if (foiaRequests.length > 0) {
    countParts.push(
      `${foiaRequests.length} FOIA ${foiaRequests.length === 1 ? "request" : "requests"}`,
    );
  }
  const countSummary = countParts.join(" + ") || `${evidence.length} signals`;

  // Source breakdown row (e.g. "EPA ECHO 15")
  const sourceCounts: Record<string, number> = {};
  for (const e of evidence) {
    sourceCounts[e.source] = (sourceCounts[e.source] || 0) + 1;
  }
  const sourceBadges = Object.entries(sourceCounts).map(([source, count]) => ({
    label: SOURCE_LABELS[source] || source,
    count,
  }));

  // How many to show before "Show all"
  const PREVIEW = 4;
  const visibleActions = showAllEvidence ? agencyActions : agencyActions.slice(0, PREVIEW);
  const visibleRequests = showAllEvidence ? foiaRequests : foiaRequests.slice(0, PREVIEW);
  const hiddenCount =
    Math.max(0, agencyActions.length - visibleActions.length) +
    Math.max(0, foiaRequests.length - visibleRequests.length);

  const entityChips = (pattern.entity_slugs || []).map(parseEntitySlug);

  return (
    <article className="signals-pattern-card">
      {/* meta row */}
      <div className="signals-pattern-meta">
        <span className="signals-pattern-type">{typeLabel}</span>
        <span className="signals-pattern-date">
          {fmtDate(pattern.generated_at)} · {countSummary}
        </span>
      </div>

      {/* title */}
      <h2 className="signals-pattern-title">{pattern.title}</h2>

      {/* THE INSIGHT */}
      <div className="signals-pattern-section">
        <div className="signals-pattern-section-label">⚡ The insight</div>
        <p className="signals-pattern-section-body">{insightPara}</p>
      </div>

      {/* WHAT LINKS THESE SIGNALS */}
      {entityChips.length > 0 && (
        <div className="signals-pattern-section">
          <div className="signals-pattern-section-label">🔗 What links these signals</div>
          <div className="signals-pattern-bridge">
            {entityChips.map((e) => {
              const label = `${e.type}: ${e.display}`;
              if (!e.rawSlug) {
                return (
                  <span key={label} className="signals-pattern-bridge-chip">
                    {e.display}
                  </span>
                );
              }
              return (
                <Link
                  key={label}
                  href={`/signals/entity/${e.type}/${e.rawSlug}`}
                  className="signals-pattern-bridge-chip signals-pattern-bridge-chip-link"
                  title={`Open the ${e.display} entity page`}
                >
                  {e.display}
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* EVIDENCE — grouped by kind */}
      {evidence.length > 0 && (
        <div className="signals-pattern-section">
          <div className="signals-pattern-section-label">
            📋 Evidence
            {sourceBadges.length > 0 && (
              <span className="signals-pattern-source-summary">
                {sourceBadges.map((s, i) => (
                  <span key={s.label}>
                    {i > 0 && " · "}
                    {s.label} {s.count}
                  </span>
                ))}
              </span>
            )}
          </div>

          {agencyActions.length > 0 && (
            <div className="signals-pattern-evidence-group">
              <div className="signals-pattern-evidence-group-label">
                ⚖️ Agency actions ({agencyActions.length})
              </div>
              <p className="signals-pattern-evidence-group-explainer">
                {groupExplainer("action", agencyActions.length)}
              </p>
              <ul className="signals-pattern-evidence-list">
                {visibleActions.map((e) => (
                  <EvidenceRow key={e.id} signal={e} />
                ))}
              </ul>
            </div>
          )}

          {foiaRequests.length > 0 && (
            <div className="signals-pattern-evidence-group">
              <div className="signals-pattern-evidence-group-label">
                📨 FOIA requests filed ({foiaRequests.length})
              </div>
              <p className="signals-pattern-evidence-group-explainer">
                {groupExplainer("request", foiaRequests.length)}
              </p>
              <ul className="signals-pattern-evidence-list">
                {visibleRequests.map((e) => (
                  <EvidenceRow key={e.id} signal={e} />
                ))}
              </ul>
            </div>
          )}

          {hiddenCount > 0 && (
            <button
              type="button"
              className="signals-pattern-toggle"
              onClick={() => setShowAllEvidence(true)}
            >
              Show {hiddenCount} more →
            </button>
          )}
          {showAllEvidence && evidence.length > PREVIEW * 2 && (
            <button
              type="button"
              className="signals-pattern-toggle"
              onClick={() => setShowAllEvidence(false)}
            >
              ← Collapse
            </button>
          )}
        </div>
      )}

      {/* persona tags + detail link */}
      <div className="signals-pattern-footer">
        <div className="signals-card-tags">
          {pattern.persona_tags.map((p) => (
            <span key={p} className="signals-persona-tag">
              {p.replace("_", " ")}
            </span>
          ))}
        </div>
        <Link href={`/signals/patterns/${pattern.id}`} className="signals-pattern-detail-link">
          Open full breakdown →
        </Link>
      </div>
    </article>
  );
}

function SignalsPatternsInner() {
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [patterns, setPatterns] = useState<SignalPattern[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([fetchPersonaCatalog(), fetchMyPersonas().catch(() => ({ persona_ids: [] }))])
      .then(([cat, mine]) => {
        setPersonas(cat.personas);
        setSelected(mine.persona_ids);
      })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchPatterns(selected.length > 0 ? selected : undefined)
      .then((res) => setPatterns(res.patterns))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [selected]);

  function togglePersona(id: string) {
    setSelected((prev) => {
      const next = prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id];
      saveMyPersonas(next).catch(() => {});
      return next;
    });
  }

  const sortedPatterns = useMemo(
    () => [...patterns].sort((a, b) => b.non_obviousness_score - a.non_obviousness_score),
    [patterns],
  );

  return (
    <main className="signals-container">
      <div className="signals-sub-nav">
        <Link href="/signals/feed" className="signals-sub-nav-link">
          Live feed
        </Link>
        <Link
          href="/signals/patterns"
          className="signals-sub-nav-link signals-sub-nav-link-active"
        >
          Patterns
        </Link>
      </div>

      <header className="signals-header">
        <span className="signals-eyebrow">AI intelligence briefing</span>
        <h1 className="signals-page-title">Patterns</h1>
        <p className="signals-page-sub">
          Connections across <strong>agency actions</strong> (enforcement orders, warning letters,
          decisions) and <strong>FOIA requests</strong>. Updated daily.
        </p>
      </header>

      <div className="signals-persona-row">
        {personas.length === 0 ? (
          <span className="signals-persona-loading">Loading personas…</span>
        ) : (
          personas.map((p) => {
            const active = selected.includes(p.id);
            return (
              <button
                key={p.id}
                className={`signals-persona-pill ${active ? "signals-persona-pill-active" : ""}`}
                onClick={() => togglePersona(p.id)}
                title={p.description}
              >
                {p.name}
              </button>
            );
          })
        )}
      </div>

      {loading && <p className="signals-empty">Looking for patterns…</p>}
      {error && <p className="signals-empty">Error: {error}</p>}

      {!loading && !error && sortedPatterns.length === 0 && (
        <p className="signals-empty">
          No patterns match the selected personas yet. The AI analyst runs daily and only
          surfaces patterns it can verify against shared entities or clear clusters.
        </p>
      )}

      {!loading && !error && sortedPatterns.length > 0 && (
        <div className="signals-pattern-list">
          {sortedPatterns.map((p) => (
            <PatternCard key={p.id} pattern={p} />
          ))}
        </div>
      )}
    </main>
  );
}

export default function SignalsPatternsPage() {
  return (
    <AuthGuard>
      <SignalsPatternsInner />
    </AuthGuard>
  );
}
