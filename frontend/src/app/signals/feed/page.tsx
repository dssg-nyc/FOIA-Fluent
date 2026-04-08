"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import AuthGuard from "@/components/AuthGuard";
import {
  fetchPersonaCatalog,
  fetchSignalFeed,
  fetchMyPersonas,
  saveMyPersonas,
  slugifyEntity,
  type Persona,
  type Signal,
} from "@/lib/signals-api";

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

const FOIA_REQUEST_SOURCES = new Set(["dhs_foia_log"]);
const ALL_SOURCES = ["epa_echo", "fda_warning_letters", "dhs_foia_log", "gao_protests"];

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

function fmtShortDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return iso;
  }
}

function dayKey(iso: string): string {
  try {
    return new Date(iso).toISOString().slice(0, 10);
  } catch {
    return iso;
  }
}

function dayLabel(key: string): string {
  try {
    const d = new Date(key + "T00:00:00Z");
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setUTCDate(today.getUTCDate() - 1);
    if (d.getTime() === today.getTime()) return "Today";
    if (d.getTime() === yesterday.getTime()) return "Yesterday";
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  } catch {
    return key;
  }
}

const LAST_SEEN_KEY = "signals.lastSeenAt";

function readLastSeen(): number {
  if (typeof window === "undefined") return 0;
  const raw = window.localStorage.getItem(LAST_SEEN_KEY);
  return raw ? parseInt(raw, 10) || 0 : 0;
}

function writeLastSeen() {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LAST_SEEN_KEY, String(Date.now()));
}

// ── Detail pane ──────────────────────────────────────────────────────────────

function SignalDetailPane({ signal }: { signal: Signal | null }) {
  if (!signal) {
    return (
      <aside className="signals-detail-pane signals-detail-pane-empty">
        <div className="signals-detail-empty-inner">
          <span className="signals-detail-empty-icon">←</span>
          <p>Select a signal from the list to read the full details.</p>
        </div>
      </aside>
    );
  }

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
    <aside className="signals-detail-pane">
      <div className="signals-detail-meta">
        <span className="signals-source-badge">{sourceLabel}</span>
        <span className={`signals-kind-label signals-kind-${kind}`}>{kindLabel}</span>
        <span className="signals-card-date">{fmtDate(signal.signal_date)}</span>
      </div>

      <h2 className="signals-detail-title">{signal.title}</h2>

      {signal.requester && (
        <p className="signals-card-requester">
          Filed by <strong>{signal.requester}</strong>
        </p>
      )}

      {signal.summary && <p className="signals-detail-summary">{signal.summary}</p>}

      {allEntities.length > 0 && (
        <div className="signals-detail-section">
          <div className="signals-detail-section-label">🔗 Related entities</div>
          <div className="signals-card-tags">
            {allEntities.slice(0, 12).map((e) => (
              <Link
                key={`${e.type}:${e.slug}`}
                href={`/signals/entity/${e.type}/${e.slug}`}
                className="signals-entity-tag signals-entity-tag-link"
                title={`See every signal mentioning ${e.label}`}
              >
                {e.label}
              </Link>
            ))}
          </div>
        </div>
      )}

      {signal.persona_tags.length > 0 && (
        <div className="signals-detail-section">
          <div className="signals-detail-section-label">🎯 Relevant for</div>
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
          className="signals-detail-source-button"
        >
          View original source ↗
        </a>
      )}
    </aside>
  );
}

// ── Compact row ──────────────────────────────────────────────────────────────

function CompactRow({
  signal,
  selected,
  unread,
  onClick,
}: {
  signal: Signal;
  selected: boolean;
  unread: boolean;
  onClick: () => void;
}) {
  const sourceLabel = SOURCE_LABELS[signal.source] || signal.source;
  const persona = signal.persona_tags[0] || "";
  const isHighPriority = signal.priority >= 2;

  // Build a meaningful headline. Prefer the AI summary (it's a real sentence
  // explaining what happened) and fall back to the bare title if no summary.
  // The original title becomes the secondary "subject" line.
  const headline = signal.summary?.trim() || signal.title;
  const subject =
    signal.summary && signal.summary.trim() && signal.summary.trim() !== signal.title
      ? signal.title
      : "";

  return (
    <button
      type="button"
      className={`signals-row ${selected ? "signals-row-selected" : ""} ${
        unread ? "signals-row-unread" : ""
      }`}
      onClick={onClick}
    >
      <span className="signals-row-priority">
        {isHighPriority && (
          <span className="signals-row-priority-dot" aria-label="High priority" />
        )}
      </span>
      <span className="signals-row-headline">{headline}</span>
      {subject && <span className="signals-row-subject">{subject}</span>}
      <span className="signals-row-meta-strip">
        <span className="signals-row-source">{sourceLabel}</span>
        {persona && (
          <>
            <span className="signals-row-meta-dot">·</span>
            <span className="signals-row-persona">{persona.replace("_", " ")}</span>
          </>
        )}
        <span className="signals-row-meta-dot">·</span>
        <span className="signals-row-date">{fmtShortDate(signal.signal_date)}</span>
      </span>
    </button>
  );
}

// ── Main feed ───────────────────────────────────────────────────────────────

function SignalsFeedInner() {
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [selectedPersonas, setSelectedPersonas] = useState<string[]>([]);
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSignalId, setSelectedSignalId] = useState<string | null>(null);
  const [lastSeenAt, setLastSeenAt] = useState(0);

  // Load persona catalog + user's saved personas + last-seen on mount
  useEffect(() => {
    setLastSeenAt(readLastSeen());
    Promise.all([fetchPersonaCatalog(), fetchMyPersonas().catch(() => ({ persona_ids: [] }))])
      .then(([cat, mine]) => {
        setPersonas(cat.personas);
        setSelectedPersonas(mine.persona_ids);
      })
      .catch((e) => setError(e.message));
  }, []);

  // Reload feed when persona selection changes
  useEffect(() => {
    setLoading(true);
    fetchSignalFeed(selectedPersonas.length > 0 ? selectedPersonas : undefined, 30, 200)
      .then((res) => setSignals(res.signals))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [selectedPersonas]);

  // Mark visited when signals are loaded
  useEffect(() => {
    if (signals.length > 0) {
      // Defer marking-as-read by ~3s so the unread highlight is visible
      const t = setTimeout(() => writeLastSeen(), 3000);
      return () => clearTimeout(t);
    }
  }, [signals]);

  function togglePersona(id: string) {
    setSelectedPersonas((prev) => {
      const next = prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id];
      saveMyPersonas(next).catch(() => {});
      return next;
    });
  }

  function toggleSource(source: string) {
    setSelectedSources((prev) =>
      prev.includes(source) ? prev.filter((s) => s !== source) : [...prev, source],
    );
  }

  // Apply source filter on top of persona-filtered signals
  const filteredSignals = useMemo(() => {
    if (selectedSources.length === 0) return signals;
    return signals.filter((s) => selectedSources.includes(s.source));
  }, [signals, selectedSources]);

  // Group by day
  const grouped = useMemo(() => {
    const groups: Array<{ day: string; signals: Signal[] }> = [];
    const map = new Map<string, Signal[]>();
    for (const s of filteredSignals) {
      const k = dayKey(s.signal_date);
      if (!map.has(k)) {
        map.set(k, []);
        groups.push({ day: k, signals: map.get(k)! });
      }
      map.get(k)!.push(s);
    }
    return groups;
  }, [filteredSignals]);

  // Counts per source for the filter rail
  const sourceCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of signals) counts[s.source] = (counts[s.source] || 0) + 1;
    return counts;
  }, [signals]);

  // Counts per day for the timeline
  const dayCounts = useMemo(() => {
    return grouped.map((g) => ({ day: g.day, count: g.signals.length }));
  }, [grouped]);

  // Currently selected signal object
  const selectedSignal = useMemo(
    () => filteredSignals.find((s) => s.id === selectedSignalId) || null,
    [filteredSignals, selectedSignalId],
  );

  function scrollToDay(day: string) {
    const el = document.getElementById(`day-${day}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <main className="signals-container signals-container-wide">
      <div className="signals-sub-nav">
        <Link
          href="/signals/feed"
          className="signals-sub-nav-link signals-sub-nav-link-active"
        >
          Live feed
        </Link>
        <Link href="/signals/patterns" className="signals-sub-nav-link">
          Patterns
        </Link>
      </div>

      <header className="signals-header">
        <span className="signals-eyebrow">Phase 1 — Beta</span>
        <h1 className="signals-page-title">Live FOIA Signals</h1>
        <p className="signals-page-sub">
          Fresh government records and enforcement actions, summarized by AI as they&rsquo;re
          released. Pick the topics that matter to your work.
        </p>
      </header>

      {/* Persona pills */}
      <div className="signals-persona-row">
        {personas.length === 0 ? (
          <span className="signals-persona-loading">Loading personas…</span>
        ) : (
          personas.map((p) => {
            const active = selectedPersonas.includes(p.id);
            return (
              <button
                key={p.id}
                className={`signals-persona-pill ${
                  active ? "signals-persona-pill-active" : ""
                }`}
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

      {!loading && !error && (
        <div className="signals-three-pane">
          {/* LEFT RAIL — date timeline + source filters */}
          <aside className="signals-rail">
            <div className="signals-rail-section">
              <div className="signals-rail-label">Sources</div>
              <ul className="signals-rail-source-list">
                {ALL_SOURCES.map((source) => {
                  const count = sourceCounts[source] || 0;
                  const active = selectedSources.includes(source);
                  return (
                    <li key={source}>
                      <button
                        type="button"
                        className={`signals-rail-source-btn ${
                          active ? "signals-rail-source-btn-active" : ""
                        }`}
                        onClick={() => toggleSource(source)}
                        disabled={count === 0}
                      >
                        <span className="signals-rail-source-name">
                          {SOURCE_LONG_LABELS[source] || source}
                        </span>
                        <span className="signals-rail-source-count">{count}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="signals-rail-section">
              <div className="signals-rail-label">Timeline</div>
              <ul className="signals-rail-timeline">
                {dayCounts.map((d) => (
                  <li key={d.day}>
                    <button
                      type="button"
                      className="signals-rail-day-btn"
                      onClick={() => scrollToDay(d.day)}
                    >
                      <span className="signals-rail-day-label">{dayLabel(d.day)}</span>
                      <span className="signals-rail-day-count">{d.count}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </aside>

          {/* MIDDLE — compact row list */}
          <section className="signals-row-list">
            {grouped.length === 0 && (
              <p className="signals-empty">
                No signals match the selected filters. Try a different persona or unselect some
                sources.
              </p>
            )}
            {grouped.map((group) => (
              <div key={group.day} id={`day-${group.day}`} className="signals-day-block">
                <div className="signals-day-sticky-header">
                  📅 {dayLabel(group.day)} · {group.signals.length}{" "}
                  {group.signals.length === 1 ? "signal" : "signals"}
                </div>
                <ul className="signals-row-ul">
                  {group.signals.map((s) => {
                    const ingested = s.ingested_at
                      ? new Date(s.ingested_at).getTime()
                      : 0;
                    const unread = lastSeenAt > 0 && ingested > lastSeenAt;
                    return (
                      <li key={s.id}>
                        <CompactRow
                          signal={s}
                          selected={selectedSignalId === s.id}
                          unread={unread}
                          onClick={() => setSelectedSignalId(s.id)}
                        />
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </section>

          {/* RIGHT — detail pane */}
          <SignalDetailPane signal={selectedSignal} />
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
