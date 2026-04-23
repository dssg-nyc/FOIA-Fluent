"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import PatternGraph from "@/components/PatternGraph";
import {
  fetchPatterns,
  fetchPersonaCatalog,
  fetchMyPersonas,
  fetchSignalFeed,
  saveMyPersonas,
  slugifyEntity,
  type Persona,
  type Signal,
  type SignalPattern,
} from "@/lib/signals-api";

// ── Constants (duplicated from feed/patterns pages for now) ────────────────

const SOURCE_LABELS: Record<string, string> = {
  gao_protests: "GAO",
  epa_echo: "EPA ECHO",
  fda_warning_letters: "FDA",
  dhs_foia_log: "DHS FOIA",
};

const SOURCE_LONG_LABELS: Record<string, string> = {
  gao_protests: "GAO Bid Protest",
  epa_echo: "EPA ECHO",
  fda_warning_letters: "FDA Warning Letter",
  dhs_foia_log: "DHS FOIA Log",
};

const SOURCE_COLORS: Record<string, string> = {
  gao_protests: "#2b66c9",
  epa_echo: "#1f8562",
  fda_warning_letters: "#6d4fc0",
  dhs_foia_log: "#c17a2a",
};

const ALL_SOURCES = ["epa_echo", "fda_warning_letters", "gao_protests", "dhs_foia_log"];

const FOIA_REQUEST_SOURCES = new Set(["dhs_foia_log"]);
function signalKind(source: string): "request" | "action" {
  return FOIA_REQUEST_SOURCES.has(source) ? "request" : "action";
}

// ── Formatting ─────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

function dayKey(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "unknown";
  return d.toISOString().slice(0, 10);
}

function dayLabel(key: string): string {
  if (key === "unknown") return "Undated";
  const d = new Date(`${key}T12:00:00`);
  const today = new Date();
  const diffDays = Math.floor(
    (today.setHours(0, 0, 0, 0) - new Date(`${key}T00:00:00`).getTime()) / (1000 * 60 * 60 * 24),
  );
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return d.toLocaleDateString("en-US", { weekday: "long" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: diffDays > 300 ? "numeric" : undefined });
}

function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (isNaN(t)) return "—";
  const diff = Date.now() - t;
  if (diff < 60_000) return "just now";
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ── Stat strip ─────────────────────────────────────────────────────────────

function StatStrip({
  signals,
  patterns,
}: {
  signals: Signal[];
  patterns: SignalPattern[];
}) {
  const sourcesActive = new Set(signals.map((s) => s.source)).size;
  const mostRecent = signals[0]?.ingested_at || signals[0]?.signal_date;
  return (
    <div className="signals-stats">
      <div className="signals-stat">
        <div className="signals-stat-label">Signals</div>
        <div className="signals-stat-number">{signals.length.toLocaleString()}</div>
      </div>
      <div className="signals-stat">
        <div className="signals-stat-label">Patterns</div>
        <div className="signals-stat-number">{patterns.length}</div>
      </div>
      <div className="signals-stat">
        <div className="signals-stat-label">Sources</div>
        <div className="signals-stat-number">
          {sourcesActive}
          <span className="signals-stat-denom"> / {ALL_SOURCES.length}</span>
        </div>
      </div>
      <div className="signals-stat">
        <div className="signals-stat-label">Last updated</div>
        <div className="signals-stat-number signals-stat-number-soft">
          {fmtRelative(mostRecent)}
        </div>
      </div>
    </div>
  );
}

// ── Persona control ────────────────────────────────────────────────────────

function PersonaPills({
  personas,
  selected,
  onToggle,
}: {
  personas: Persona[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  if (personas.length === 0) {
    return <span className="signals-dashboard-loading">Loading personas…</span>;
  }
  return (
    <div className="signals-persona-control">
      {personas.map((p) => {
        const active = selected.includes(p.id);
        return (
          <button
            key={p.id}
            type="button"
            className={`signals-persona-chip ${active ? "signals-persona-chip-active" : ""}`}
            onClick={() => onToggle(p.id)}
            title={p.description}
          >
            {p.name}
          </button>
        );
      })}
    </div>
  );
}

// ── Source filter ──────────────────────────────────────────────────────────

function SourceFilter({
  signals,
  active,
  onToggle,
}: {
  signals: Signal[];
  active: Set<string>;
  onToggle: (source: string) => void;
}) {
  const counts: Record<string, number> = {};
  for (const s of signals) counts[s.source] = (counts[s.source] || 0) + 1;
  return (
    <div className="signals-source-filter">
      {ALL_SOURCES.map((src) => {
        const count = counts[src] || 0;
        const isActive = active.has(src);
        const dimmed = active.size > 0 && !isActive;
        return (
          <button
            key={src}
            type="button"
            className={`signals-source-pill ${isActive ? "signals-source-pill-active" : ""} ${
              dimmed ? "signals-source-pill-dim" : ""
            }`}
            onClick={() => onToggle(src)}
            style={{
              "--source-color": SOURCE_COLORS[src],
            } as React.CSSProperties}
          >
            <span className="signals-source-pill-dot" aria-hidden="true" />
            <span className="signals-source-pill-label">{SOURCE_LABELS[src]}</span>
            <span className="signals-source-pill-count">{count}</span>
          </button>
        );
      })}
    </div>
  );
}

// ── Pattern compact card ──────────────────────────────────────────────────

function PatternCompactCard({ pattern }: { pattern: SignalPattern }) {
  const evidence = pattern.evidence_signals || [];
  const sourceCounts: Record<string, number> = {};
  for (const e of evidence) sourceCounts[e.source] = (sourceCounts[e.source] || 0) + 1;
  const sourceBadges = Object.entries(sourceCounts);
  const firstSentence = (pattern.narrative.split(/\n\n+/)[0] || "")
    .split(/(?<=[.?!])\s+/)[0]
    .trim();
  return (
    <Link
      href={`/signals/patterns/${pattern.id}`}
      className="signals-pattern-compact"
    >
      <div className="signals-pattern-compact-head">
        <span className="signals-pattern-compact-score">
          {pattern.non_obviousness_score}/10
        </span>
        <span className="signals-pattern-compact-date">
          {fmtRelative(pattern.generated_at)}
        </span>
      </div>
      <h3 className="signals-pattern-compact-title">{pattern.title}</h3>
      {firstSentence && (
        <p className="signals-pattern-compact-teaser">{firstSentence}</p>
      )}
      <div className="signals-pattern-compact-footer">
        <span className="signals-pattern-compact-sources">
          {sourceBadges.map(([src, count], i) => (
            <span key={src} className="signals-pattern-compact-source">
              {i > 0 && " · "}
              <span
                className="signals-pattern-compact-source-dot"
                style={{ background: SOURCE_COLORS[src] }}
                aria-hidden="true"
              />
              {SOURCE_LABELS[src]} {count}
            </span>
          ))}
        </span>
        <span className="signals-pattern-compact-open">Open →</span>
      </div>
    </Link>
  );
}

// ── Feed row ───────────────────────────────────────────────────────────────

function FeedRow({
  signal,
  active,
  onClick,
}: {
  signal: Signal;
  active: boolean;
  onClick: () => void;
}) {
  const sourceLabel = SOURCE_LABELS[signal.source] || signal.source;
  const headline = signal.summary?.trim() || signal.title;
  return (
    <button
      type="button"
      className={`signals-feed-row ${active ? "signals-feed-row-active" : ""}`}
      onClick={onClick}
      style={{
        "--source-color": SOURCE_COLORS[signal.source] || "var(--border-cool)",
      } as React.CSSProperties}
    >
      <span className="signals-feed-row-source">{sourceLabel}</span>
      <span className="signals-feed-row-headline">{headline}</span>
      <span className="signals-feed-row-time">{fmtRelative(signal.signal_date)}</span>
    </button>
  );
}

// ── Detail drawer ──────────────────────────────────────────────────────────

function SignalDetailDrawer({
  signal,
  onClose,
}: {
  signal: Signal | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!signal) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [signal, onClose]);

  if (!signal) return null;
  const kind = signalKind(signal.source);
  const kindLabel = kind === "request" ? "FOIA request filed" : "Agency action";
  const sourceLabel = SOURCE_LONG_LABELS[signal.source] || signal.source;

  const allEntities: Array<{ label: string; type: string; slug: string }> = [];
  for (const c of signal.entities?.companies || []) {
    const slug = slugifyEntity(c);
    if (slug) allEntities.push({ label: c, type: "company", slug });
  }
  for (const a of signal.entities?.agencies || []) {
    const slug = slugifyEntity(a);
    if (slug) allEntities.push({ label: a, type: "agency", slug });
  }
  for (const p of signal.entities?.people || []) {
    const slug = slugifyEntity(p);
    if (slug) allEntities.push({ label: p, type: "person", slug });
  }
  for (const l of signal.entities?.locations || []) {
    const slug = slugifyEntity(l);
    if (slug) allEntities.push({ label: l, type: "location", slug });
  }

  return (
    <>
      <div className="signals-drawer-overlay" onClick={onClose} aria-hidden="true" />
      <aside
        className="signals-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Signal details"
      >
        <button
          type="button"
          className="signals-drawer-close"
          onClick={onClose}
          aria-label="Close detail panel"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        <div className="signals-drawer-inner">
          <div className="signals-drawer-meta">
            <span className="signals-source-badge">{sourceLabel}</span>
            <span className={`signals-kind-label signals-kind-${kind}`}>{kindLabel}</span>
            <span className="signals-drawer-date">{fmtDate(signal.signal_date)}</span>
          </div>

          <h2 className="signals-drawer-title">{signal.title}</h2>

          {signal.requester && (
            <p className="signals-drawer-requester">
              Filed by <strong>{signal.requester}</strong>
            </p>
          )}

          {signal.summary && <p className="signals-drawer-summary">{signal.summary}</p>}

          {allEntities.length > 0 && (
            <div className="signals-drawer-section">
              <div className="signals-drawer-section-label">Related entities</div>
              <div className="signals-card-tags">
                {allEntities.slice(0, 12).map((e) => (
                  <Link
                    key={`${e.type}:${e.slug}`}
                    href={`/signals/entity/${e.type}/${e.slug}`}
                    className="signals-entity-tag signals-entity-tag-link"
                  >
                    {e.label}
                  </Link>
                ))}
              </div>
            </div>
          )}

          {signal.persona_tags.length > 0 && (
            <div className="signals-drawer-section">
              <div className="signals-drawer-section-label">Relevant for</div>
              <div className="signals-card-tags">
                {signal.persona_tags.map((p) => (
                  <span key={p} className="signals-persona-tag">
                    {p.replace("_", " ")}
                  </span>
                ))}
              </div>
            </div>
          )}

          {signal.source_url && (
            <a
              href={signal.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="signals-drawer-link"
            >
              View original source ↗
            </a>
          )}
        </div>
      </aside>
    </>
  );
}

// ── Dashboard ──────────────────────────────────────────────────────────────

export default function SignalsDashboard() {
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [patterns, setPatterns] = useState<SignalPattern[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<"newest" | "priority">("newest");
  const [activeSignal, setActiveSignal] = useState<Signal | null>(null);

  // Load personas
  useEffect(() => {
    Promise.all([
      fetchPersonaCatalog(),
      fetchMyPersonas().catch(() => ({ persona_ids: [] })),
    ])
      .then(([cat, mine]) => {
        setPersonas(cat.personas);
        setSelected(mine.persona_ids);
      })
      .catch((e) => setError(e.message));
  }, []);

  // Load patterns + signals whenever personas change
  useEffect(() => {
    setLoading(true);
    const personaArg = selected.length > 0 ? selected : undefined;
    Promise.all([
      fetchPatterns(personaArg),
      fetchSignalFeed(personaArg, 30, 200),
    ])
      .then(([p, s]) => {
        setPatterns(p.patterns);
        setSignals(s.signals);
      })
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

  function toggleSource(src: string) {
    setSourceFilter((prev) => {
      const next = new Set(prev);
      if (next.has(src)) next.delete(src);
      else next.add(src);
      return next;
    });
  }

  // Filter + sort signals for the feed
  const filteredSignals = useMemo(() => {
    let out = signals;
    if (sourceFilter.size > 0) {
      out = out.filter((s) => sourceFilter.has(s.source));
    }
    if (sort === "priority") {
      out = [...out].sort((a, b) => {
        if ((b.priority || 0) !== (a.priority || 0)) return (b.priority || 0) - (a.priority || 0);
        return new Date(b.signal_date).getTime() - new Date(a.signal_date).getTime();
      });
    }
    return out;
  }, [signals, sourceFilter, sort]);

  const visibleSourcesForGalaxy = sourceFilter.size > 0 ? sourceFilter : undefined;

  const sortedPatterns = useMemo(
    () => [...patterns].sort((a, b) => b.non_obviousness_score - a.non_obviousness_score),
    [patterns],
  );

  // Group signals by day for the feed. Preserves the existing order within
  // each group (backend returns signal_date desc).
  const grouped = useMemo(() => {
    const m = new Map<string, Signal[]>();
    for (const s of filteredSignals) {
      const k = dayKey(s.signal_date);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(s);
    }
    return Array.from(m.entries());
  }, [filteredSignals]);

  return (
    <main className="signals-dashboard">
      {/* Header */}
      <header className="signals-dashboard-head">
        <div className="signals-dashboard-head-main">
          <span className="signals-eyebrow">Live FOIA Signals</span>
          <h1 className="signals-dashboard-title">
            The federal record, in real time.
          </h1>
          <p className="signals-dashboard-sub">
            AI reads every new government record the moment it&rsquo;s public and
            surfaces the patterns that connect them.
          </p>
        </div>
        <PersonaPills
          personas={personas}
          selected={selected}
          onToggle={togglePersona}
        />
      </header>

      {/* Stat strip */}
      <StatStrip signals={signals} patterns={sortedPatterns} />

      {/* Galaxy hero */}
      <section className="signals-dashboard-section">
        <div className="signals-dashboard-section-head">
          <div className="signals-dashboard-section-labels">
            <span className="signals-eyebrow">Pattern galaxy</span>
            <span className="signals-dashboard-section-hint">
              {sortedPatterns.length === 0
                ? "No patterns match the current filters."
                : `${sortedPatterns.length} ${sortedPatterns.length === 1 ? "pattern" : "patterns"} detected — click any cluster to open.`}
            </span>
          </div>
          <SourceFilter
            signals={signals}
            active={sourceFilter}
            onToggle={toggleSource}
          />
        </div>

        {loading && signals.length === 0 ? (
          <div className="signals-dashboard-skeleton signals-dashboard-skeleton-galaxy">
            Loading patterns…
          </div>
        ) : sortedPatterns.length > 0 ? (
          <PatternGraph
            mode="galaxy"
            patterns={sortedPatterns}
            visibleSources={visibleSourcesForGalaxy}
          />
        ) : (
          <div className="signals-dashboard-empty">
            No patterns yet for this filter. The AI analyst runs daily.
          </div>
        )}

        {/* Pattern cards (scrollable strip beneath galaxy) */}
        {sortedPatterns.length > 0 && (
          <div className="signals-pattern-compact-wrap">
            <div className="signals-pattern-compact-wrap-head">
              <span className="signals-eyebrow">All patterns ({sortedPatterns.length})</span>
              <span className="signals-dashboard-section-hint">Scroll to browse · click to open</span>
            </div>
            <div className="signals-pattern-compact-scroll">
              {sortedPatterns.map((p) => (
                <PatternCompactCard key={p.id} pattern={p} />
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Feed */}
      <section className="signals-dashboard-section">
        <div className="signals-dashboard-section-head">
          <div className="signals-dashboard-section-labels">
            <span className="signals-eyebrow">Live feed</span>
            <span className="signals-dashboard-section-hint">
              {filteredSignals.length.toLocaleString()}{" "}
              {filteredSignals.length === 1 ? "signal" : "signals"} · last 30 days
            </span>
          </div>
          <div className="signals-feed-sort">
            <button
              type="button"
              className={`signals-feed-sort-btn ${sort === "newest" ? "signals-feed-sort-btn-active" : ""}`}
              onClick={() => setSort("newest")}
            >
              Newest
            </button>
            <button
              type="button"
              className={`signals-feed-sort-btn ${sort === "priority" ? "signals-feed-sort-btn-active" : ""}`}
              onClick={() => setSort("priority")}
            >
              Priority
            </button>
          </div>
        </div>

        {loading && signals.length === 0 ? (
          <div className="signals-dashboard-skeleton">Loading signals…</div>
        ) : filteredSignals.length === 0 ? (
          <div className="signals-dashboard-empty">
            No signals match the current filters.
          </div>
        ) : (
          <div className="signals-feed-scroll">
            {sort === "newest" ? (
              grouped.map(([day, rows]) => (
                <div key={day} className="signals-feed-group">
                  <div className="signals-feed-day-header">
                    <span className="signals-feed-day-label">{dayLabel(day)}</span>
                    <span className="signals-feed-day-count">
                      {rows.length} {rows.length === 1 ? "signal" : "signals"}
                    </span>
                  </div>
                  <div className="signals-feed">
                    {rows.map((s) => (
                      <FeedRow
                        key={s.id}
                        signal={s}
                        active={activeSignal?.id === s.id}
                        onClick={() => setActiveSignal(s)}
                      />
                    ))}
                  </div>
                </div>
              ))
            ) : (
              <div className="signals-feed">
                {filteredSignals.map((s) => (
                  <FeedRow
                    key={s.id}
                    signal={s}
                    active={activeSignal?.id === s.id}
                    onClick={() => setActiveSignal(s)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {error && <p className="signals-dashboard-error">Error: {error}</p>}

      <SignalDetailDrawer signal={activeSignal} onClose={() => setActiveSignal(null)} />
    </main>
  );
}
