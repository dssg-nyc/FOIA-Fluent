"use client";

import { useEffect, useMemo, useState } from "react";
import AuthGuard from "@/components/AuthGuard";
import {
  fetchPersonaCatalog,
  fetchSignalFeed,
  fetchMyPersonas,
  saveMyPersonas,
  type Persona,
  type Signal,
} from "@/lib/signals-api";

const SOURCE_LABELS: Record<string, string> = {
  gao_protests: "GAO Bid Protest",
  epa_echo: "EPA ECHO",
  fda_warning_letters: "FDA Warning Letter",
  dhs_foia_log: "DHS FOIA Log",
};

// "FOIA request filed" sources are FOIA logs (we know who filed the request).
// "Agency action" sources are documents/actions agencies publish themselves.
const FOIA_REQUEST_SOURCES = new Set(["dhs_foia_log"]);
function signalKind(source: string): "request" | "action" {
  return FOIA_REQUEST_SOURCES.has(source) ? "request" : "action";
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

function SignalCard({ signal }: { signal: Signal }) {
  const sourceLabel = SOURCE_LABELS[signal.source] || signal.source;
  const entityCompanies = signal.entities?.companies?.slice(0, 4) ?? [];
  const kind = signalKind(signal.source);
  const kindLabel = kind === "request" ? "FOIA request filed" : "Agency action";

  return (
    <article className="signals-card">
      <div className="signals-card-meta">
        <span className="signals-source-badge">{sourceLabel}</span>
        <span className={`signals-kind-label signals-kind-${kind}`}>{kindLabel}</span>
        <span className="signals-card-date">{fmtDate(signal.signal_date)}</span>
      </div>
      <h3 className="signals-card-title">{signal.title}</h3>
      {signal.requester && (
        <p className="signals-card-requester">
          Filed by <strong>{signal.requester}</strong>
        </p>
      )}
      {signal.summary && <p className="signals-card-summary">{signal.summary}</p>}
      {(entityCompanies.length > 0 || signal.persona_tags.length > 0) && (
        <div className="signals-card-tags">
          {entityCompanies.map((c) => (
            <span key={c} className="signals-entity-tag">{c}</span>
          ))}
          {signal.persona_tags.map((p) => (
            <span key={p} className="signals-persona-tag">{p.replace("_", " ")}</span>
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
    </article>
  );
}

function SignalsFeedInner() {
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load persona catalog + user's saved personas on mount
  useEffect(() => {
    Promise.all([fetchPersonaCatalog(), fetchMyPersonas().catch(() => ({ persona_ids: [] }))])
      .then(([cat, mine]) => {
        setPersonas(cat.personas);
        setSelected(mine.persona_ids);
      })
      .catch((e) => setError(e.message));
  }, []);

  // Reload feed when selection changes
  useEffect(() => {
    setLoading(true);
    fetchSignalFeed(selected.length > 0 ? selected : undefined)
      .then((res) => setSignals(res.signals))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [selected]);

  function togglePersona(id: string) {
    setSelected((prev) => {
      const next = prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id];
      // Fire and forget — persist user's selection
      saveMyPersonas(next).catch(() => {});
      return next;
    });
  }

  const grouped = useMemo(() => {
    const groups: Record<string, Signal[]> = {};
    for (const s of signals) {
      const key = fmtDate(s.signal_date);
      (groups[key] ||= []).push(s);
    }
    return groups;
  }, [signals]);

  return (
    <main className="signals-container">
      <header className="signals-header">
        <span className="signals-eyebrow">Phase 1 — Beta</span>
        <h1 className="signals-page-title">Live FOIA Signals</h1>
        <p className="signals-page-sub">
          Fresh government records and enforcement actions, summarized by AI as they&rsquo;re
          released. Pick the topics that matter to your work.
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

      {loading && <p className="signals-empty">Loading signals…</p>}
      {error && <p className="signals-empty">Error: {error}</p>}

      {!loading && !error && signals.length === 0 && (
        <p className="signals-empty">
          No signals yet for the selected personas. The feed populates as the ingestion jobs run —
          check back shortly.
        </p>
      )}

      {!loading && !error && signals.length > 0 && (
        <div className="signals-feed">
          {Object.entries(grouped).map(([dateKey, group]) => (
            <section key={dateKey} className="signals-day-group">
              <h2 className="signals-day-heading">{dateKey}</h2>
              <div className="signals-day-cards">
                {group.map((s) => (
                  <SignalCard key={s.id} signal={s} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}

export default function SignalsFeedPage() {
  return (
    <AuthGuard>
      <SignalsFeedInner />
    </AuthGuard>
  );
}
