"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PatternGraph from "@/components/PatternGraph";
import PatternDetailDrawer from "@/components/PatternDetailDrawer";
import PatternThemeGalaxy from "@/components/PatternThemeGalaxy";
import PatternCardGrid from "@/components/PatternCardGrid";
import {
  fetchPatterns,
  fetchPersonaCatalog,
  fetchMyPersonas,
  fetchSignalFeed,
  fetchSignalsGlobalStats,
  saveMyPersonas,
  slugifyEntity,
  type Persona,
  type Signal,
  type SignalPattern,
  type SignalsGlobalStats,
} from "@/lib/signals-api";

// Source labels + colors live in lib/signal-sources.ts so they can be
// imported by both SignalsDashboard and PatternGraph without a circular
// module dependency. Re-exported here for backward-compat with anything
// that still imports SOURCE_COLORS / SOURCE_LABELS from this file.
import {
  ALL_SOURCES,
  SOURCE_COLORS,
  SOURCE_LABELS,
  SOURCE_LONG_LABELS,
  signalKind,
} from "@/lib/signal-sources";

export { SOURCE_COLORS, SOURCE_LABELS };

// ── Category taxonomy (mirrors backend/app/data/signal_categories.py) ──────

const CATEGORY_LABELS: Record<string, string> = {
  // Enforcement & oversight
  agency_enforcement:        "Agency enforcement",
  agency_warnings:           "Agency warnings",
  oversight_findings:        "Oversight findings",
  securities_litigation:     "Securities litigation",
  campaign_finance:          "Campaign finance",
  tax_enforcement:           "Tax enforcement",
  // Recalls & safety
  drug_recalls:              "Drug recalls",
  food_recalls:              "Food recalls",
  device_recalls:            "Device recalls",
  vehicle_recalls:           "Vehicle recalls",
  consumer_product_recalls:  "Consumer product recalls",
  workplace_safety:          "Workplace safety",
  // Courts & legal
  court_opinions:            "Court opinions",
  government_litigation:     "Government litigation",
  foia_logs:                 "FOIA logs",
  // Spending & policy
  federal_contracts:         "Federal contracts",
  regulatory_dockets:        "Regulatory dockets",
  legislation:               "Legislation",
  executive_actions:         "Executive actions",
  lobbying_ethics:           "Lobbying & ethics",
};

const ALL_CATEGORIES = Object.keys(CATEGORY_LABELS);

// Time-range presets for the feed filter
const TIME_RANGES: { days: number; label: string }[] = [
  { days: 1, label: "Last 24h" },
  { days: 7, label: "Last 7 days" },
  { days: 30, label: "Last 30 days" },
  { days: 90, label: "Last 90 days" },
];

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
  // Always include the absolute date — without it, two "Tuesday" headers
  // from different weeks look identical and the order looks scrambled.
  const datePart = d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: Math.abs(diffDays) > 300 ? "numeric" : undefined,
  });
  if (diffDays === 0) return `Today · ${datePart}`;
  if (diffDays === 1) return `Yesterday · ${datePart}`;
  // Recent past week (positive diff only) → weekday + date.
  // Future dates (negative diff) and >7 days old → just the absolute date,
  // no weekday — a weekday name on a future date looks like a recent past
  // date and was the source of the Thursday/Tuesday/Monday confusion.
  if (diffDays > 0 && diffDays < 7) {
    const weekday = d.toLocaleDateString("en-US", { weekday: "long" });
    return `${weekday} · ${datePart}`;
  }
  return datePart;
}

export function fmtRelative(iso: string | null | undefined): string {
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
  stats,
}: {
  stats: SignalsGlobalStats | null;
}) {
  // Tier 1 — global truth for the product. Same numbers no matter what
  // personas / filters / time ranges the user picks. Matches the admin
  // health dashboard's totals.
  return (
    <div className="signals-stats">
      <div className="signals-stat">
        <div className="signals-stat-label">Signals</div>
        <div className="signals-stat-number">
          {stats ? stats.total_signals.toLocaleString() : "—"}
        </div>
        <div className="signals-stat-foot">all time</div>
      </div>
      <div className="signals-stat">
        <div className="signals-stat-label">Patterns</div>
        <div className="signals-stat-number">
          {stats ? stats.total_patterns_visible : "—"}
        </div>
        <div className="signals-stat-foot">visible</div>
      </div>
      <div className="signals-stat">
        <div className="signals-stat-label">Sources</div>
        <div className="signals-stat-number">
          {stats ? stats.sources_enabled : "—"}
        </div>
        <div className="signals-stat-foot">live</div>
      </div>
      <div className="signals-stat">
        <div className="signals-stat-label">Last updated</div>
        <div className="signals-stat-number signals-stat-number-soft">
          {stats ? fmtRelative(stats.last_ingested_at) : "—"}
        </div>
        <div className="signals-stat-foot">last ingest</div>
      </div>
    </div>
  );
}

// ── Multi-select dropdown (Linear-style) ───────────────────────────────────

export function MultiSelectDropdown({
  label,
  options,
  selected,
  onToggle,
  onClear,
}: {
  label: string;
  options: { id: string; label: string; count?: number }[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const count = selected.size;

  return (
    <div className="signals-msdd" ref={ref}>
      <button
        type="button"
        className={`signals-msdd-trigger ${count > 0 ? "signals-msdd-trigger-active" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="signals-msdd-label">{label}</span>
        {count > 0 && (
          <span className="signals-msdd-counter">{count}</span>
        )}
        <svg
          width="10"
          height="6"
          viewBox="0 0 10 6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="signals-msdd-caret"
        >
          <polyline points="1 1 5 5 9 1" />
        </svg>
      </button>
      {open && (
        <div className="signals-msdd-menu" role="listbox">
          {count > 0 && (
            <div className="signals-msdd-menu-head">
              <button
                type="button"
                className="signals-msdd-clear"
                onClick={() => {
                  onClear();
                  setOpen(false);
                }}
              >
                Clear all
              </button>
            </div>
          )}
          <div className="signals-msdd-options">
            {options.map((opt) => {
              const isSel = selected.has(opt.id);
              return (
                <button
                  key={opt.id}
                  type="button"
                  className={`signals-msdd-option ${isSel ? "signals-msdd-option-active" : ""}`}
                  onClick={() => onToggle(opt.id)}
                  role="option"
                  aria-selected={isSel}
                >
                  <span className="signals-msdd-checkbox" aria-hidden="true">
                    {isSel ? "✓" : ""}
                  </span>
                  <span className="signals-msdd-option-label">{opt.label}</span>
                  {typeof opt.count === "number" && (
                    <span className="signals-msdd-option-count">{opt.count}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Single-select dropdown (used for time-range) ──────────────────────────

export function SingleSelectDropdown<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = options.find((o) => o.value === value);

  return (
    <div className="signals-msdd" ref={ref}>
      <button
        type="button"
        className="signals-msdd-trigger"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="signals-msdd-label">
          {label}: {current?.label ?? "—"}
        </span>
        <svg
          width="10"
          height="6"
          viewBox="0 0 10 6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="signals-msdd-caret"
        >
          <polyline points="1 1 5 5 9 1" />
        </svg>
      </button>
      {open && (
        <div className="signals-msdd-menu signals-msdd-menu-narrow">
          <div className="signals-msdd-options">
            {options.map((o) => (
              <button
                key={String(o.value)}
                type="button"
                className={`signals-msdd-option ${
                  o.value === value ? "signals-msdd-option-active" : ""
                }`}
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
              >
                <span className="signals-msdd-checkbox" aria-hidden="true">
                  {o.value === value ? "•" : ""}
                </span>
                <span className="signals-msdd-option-label">{o.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
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
      <span className="signals-feed-row-time">
        ingested {fmtRelative(signal.ingested_at)}
      </span>
    </button>
  );
}

// ── Card-style feed entries (Phase 2.5+) ───────────────────────────────────

/** Flatten the structured entities object into readable label + type pairs.
 *  Used by both LeadCard and CompactCard for entity chips. */
function flattenEntityChips(signal: Signal, max: number): Array<{ label: string; type: string }> {
  const out: Array<{ label: string; type: string }> = [];
  const e = signal.entities || {};
  const groups: Array<[string, string[] | undefined]> = [
    ["company", e.companies],
    ["agency", e.agencies],
    ["person", e.people],
    ["location", e.locations],
  ];
  for (const [type, list] of groups) {
    for (const label of list || []) {
      if (out.length >= max) return out;
      const trimmed = (label || "").trim();
      if (!trimmed) continue;
      out.push({ label: trimmed, type });
    }
  }
  return out;
}

function truncate(s: string | null | undefined, n: number): string {
  const t = (s || "").trim();
  if (t.length <= n) return t;
  // cut at the last word boundary before n to avoid mid-word ellipsis
  const slice = t.slice(0, n);
  const cut = slice.lastIndexOf(" ");
  return (cut > n * 0.6 ? slice.slice(0, cut) : slice).trimEnd() + "…";
}

/** Lead card — full width, generous padding. Top priority signal per day. */
function LeadCard({
  signal,
  active,
  onClick,
}: {
  signal: Signal;
  active: boolean;
  onClick: () => void;
}) {
  const sourceLabel = SOURCE_LONG_LABELS[signal.source] || SOURCE_LABELS[signal.source] || signal.source;
  const summary = truncate(signal.summary, 280) || truncate(signal.body_excerpt, 280);
  const chips = flattenEntityChips(signal, 5);
  return (
    <button
      type="button"
      className={`signals-card-lead ${active ? "signals-card-lead-active" : ""}`}
      onClick={onClick}
      style={{
        "--source-color": SOURCE_COLORS[signal.source] || "var(--border-cool)",
      } as React.CSSProperties}
    >
      <div className="signals-card-lead-head">
        <span className="signals-card-lead-source">
          <span className="signals-card-lead-dot" aria-hidden="true" />
          {sourceLabel}
        </span>
        <span className="signals-card-lead-time">
          ingested {fmtRelative(signal.ingested_at)}
        </span>
      </div>
      <h3 className="signals-card-lead-title">{signal.title}</h3>
      {summary && <p className="signals-card-lead-summary">{summary}</p>}
      {chips.length > 0 && (
        <div className="signals-card-chips">
          {chips.map((c, i) => (
            <span key={`${c.type}:${c.label}:${i}`} className={`signals-card-chip signals-card-chip-${c.type}`}>
              {c.label}
            </span>
          ))}
        </div>
      )}
    </button>
  );
}

/** Compact card — sits in a 2-col grid below the lead. Source dot + short title + mini excerpt + 2-3 entity chips. */
function CompactCard({
  signal,
  active,
  onClick,
}: {
  signal: Signal;
  active: boolean;
  onClick: () => void;
}) {
  const sourceLabel = SOURCE_LABELS[signal.source] || signal.source;
  const summary = truncate(signal.summary, 130) || truncate(signal.body_excerpt, 130);
  const chips = flattenEntityChips(signal, 3);
  return (
    <button
      type="button"
      className={`signals-card-compact ${active ? "signals-card-compact-active" : ""}`}
      onClick={onClick}
      style={{
        "--source-color": SOURCE_COLORS[signal.source] || "var(--border-cool)",
      } as React.CSSProperties}
    >
      <div className="signals-card-compact-head">
        <span className="signals-card-compact-source">
          <span className="signals-card-compact-dot" aria-hidden="true" />
          {sourceLabel}
        </span>
        <span className="signals-card-compact-time">
          ingested {fmtRelative(signal.ingested_at)}
        </span>
      </div>
      <h4 className="signals-card-compact-title">{signal.title}</h4>
      {summary && <p className="signals-card-compact-summary">{summary}</p>}
      {chips.length > 0 && (
        <div className="signals-card-chips signals-card-chips-compact">
          {chips.map((c, i) => (
            <span key={`${c.type}:${c.label}:${i}`} className={`signals-card-chip signals-card-chip-${c.type}`}>
              {c.label}
            </span>
          ))}
        </div>
      )}
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
  const [globalStats, setGlobalStats] = useState<SignalsGlobalStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();

  const [activeSignal, setActiveSignal] = useState<Signal | null>(null);
  // Drawer state lives in the URL itself — no React state, no sync effects.
  //
  // Why: when the user clicks an entity inside the drawer they navigate to
  // /signals/entity/..., which unmounts this component. Browser-back from
  // there restores /signals?pattern=<id>. Reading activePatternId directly
  // from `searchParams` means the drawer reopens automatically on remount,
  // with zero state-restoration plumbing. Earlier attempts kept it in
  // useState and synced via useEffect — that fought itself across remounts
  // because the initializer only runs once. Treating the URL as the
  // source of truth is the simpler, correct pattern.
  const activePatternId = searchParams?.get("pattern") ?? null;
  // Entity layered on top of the pattern view (in-drawer stack: pattern →
  // entity). Stored as `?entity=type:slug` so the URL is shareable. Falsy
  // when no entity is open, in which case the drawer either shows just the
  // pattern (if pattern is set) or is closed entirely.
  const entityParam = searchParams?.get("entity") ?? null;
  const [activeEntityType, activeEntitySlug] = (() => {
    if (!entityParam) return [null, null] as const;
    const i = entityParam.indexOf(":");
    if (i <= 0) return [null, null] as const;
    return [entityParam.slice(0, i), entityParam.slice(i + 1)] as const;
  })();

  // Phase 3 — single source of truth for theme view: the type filter.
  //   filter empty   → galaxy shows the 7 theme bubbles (Level 0)
  //   filter has 1+  → galaxy drills to clusters of those theme(s) (Level 1)
  //                     and the card grid filters to the same types
  // Drilled-view top-N cap so a theme with 50+ patterns doesn't recreate
  // the original cluster-card mess.
  const DRILLED_TOP_N = 12;
  const [showAllInTheme, setShowAllInTheme] = useState(false);
  const [patternTypeFilter, setPatternTypeFilter] = useState<Set<string>>(
    new Set(),
  );
  // Bidirectional Galaxy ↔ Grid hover sync.
  const [hoveredPatternId, setHoveredPatternId] = useState<string | null>(null);

  // Stable callback identities so PatternGraph (memo'd) doesn't re-render on
  // every parent state change. Without these, the inline arrow lambdas were
  // new refs every render → React.memo bails out → graph rebuilds.
  // Drawer open/close go through the router so the URL is the source of
  // truth (see comment on `activePatternId` above). `push` instead of
  // `replace` so each pattern opening is a real history entry — browser
  // back navigates between patterns intuitively.
  const handlePatternSelect = useCallback(
    (pid: string) => {
      router.push(`/signals?pattern=${encodeURIComponent(pid)}`, {
        scroll: false,
      });
    },
    [router],
  );
  const handleClosePatternDrawer = useCallback(() => {
    router.push("/signals", { scroll: false });
  }, [router]);
  // Push an entity onto the in-drawer stack. Preserves any active pattern
  // so the back-arrow inside the drawer can pop back to it.
  const handleEntitySelect = useCallback(
    (entityType: string, entitySlug: string) => {
      const params = new URLSearchParams();
      if (activePatternId) params.set("pattern", activePatternId);
      params.set("entity", `${entityType}:${entitySlug}`);
      router.push(`/signals?${params.toString()}`, { scroll: false });
    },
    [router, activePatternId],
  );
  // Pop the entity off the stack — keep the pattern if there was one.
  const handlePopEntity = useCallback(() => {
    if (activePatternId) {
      const params = new URLSearchParams();
      params.set("pattern", activePatternId);
      router.push(`/signals?${params.toString()}`, { scroll: false });
    } else {
      router.push("/signals", { scroll: false });
    }
  }, [router, activePatternId]);
  const handleCloseSignalDrawer = useCallback(
    () => setActiveSignal(null),
    [],
  );
  const handleHoverPattern = useCallback(
    (pid: string | null) => setHoveredPatternId(pid),
    [],
  );
  const togglePatternType = useCallback((t: string) => {
    setPatternTypeFilter((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  }, []);
  const clearPatternTypes = useCallback(() => {
    setPatternTypeFilter(new Set());
    setShowAllInTheme(false);
  }, []);
  // Theme-bubble click: REPLACE the filter with that one theme. Distinct
  // from the grid's add/remove toggle behavior — clicking a bubble is "go
  // to this theme", not "add to my filter".
  const handleThemeSelect = useCallback((t: string) => {
    setPatternTypeFilter(new Set([t]));
    setShowAllInTheme(false);
  }, []);

  // Galaxy view: client-side source filter (visual only; pattern data is
  // fetched once and re-rendered when this changes).
  const [galaxySourceFilter, setGalaxySourceFilter] = useState<Set<string>>(new Set());

  // Live-feed filter state (independent of the galaxy filters above).
  const [feedSearch, setFeedSearch] = useState("");
  const [feedTimeRange, setFeedTimeRange] = useState<number>(30); // days
  const [feedSourceFilter, setFeedSourceFilter] = useState<Set<string>>(new Set());
  const [feedCategoryFilter, setFeedCategoryFilter] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<"newest" | "priority">("newest");

  // Load personas + global stats once on mount
  useEffect(() => {
    Promise.all([
      fetchPersonaCatalog(),
      fetchMyPersonas().catch(() => ({ persona_ids: [] })),
      fetchSignalsGlobalStats().catch(() => null),
    ])
      .then(([cat, mine, stats]) => {
        setPersonas(cat.personas);
        setSelected(mine.persona_ids);
        if (stats) setGlobalStats(stats);
      })
      .catch((e) => setError(e.message));
  }, []);

  // Load patterns + signals whenever personas or feed time-range change
  useEffect(() => {
    setLoading(true);
    const personaArg = selected.length > 0 ? selected : undefined;
    Promise.all([
      fetchPatterns(personaArg),
      // Always pull at least 30 days of data so the galaxy stays useful even
      // when the feed is filtered to last 24h. The feed applies its own
      // time filter on the client below. Cap at 1000 — covers most realistic
      // 30-90d windows; pagination is the right move past that.
      fetchSignalFeed(personaArg, Math.max(feedTimeRange, 30), 1000),
    ])
      .then(([p, s]) => {
        setPatterns(p.patterns);
        setSignals(s.signals);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [selected, feedTimeRange]);

  function togglePersona(id: string) {
    setSelected((prev) => {
      const next = prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id];
      saveMyPersonas(next).catch(() => {});
      return next;
    });
  }

  function toggleGalaxySource(src: string) {
    setGalaxySourceFilter((prev) => {
      const next = new Set(prev);
      if (next.has(src)) next.delete(src);
      else next.add(src);
      return next;
    });
  }

  function toggleFeedSource(src: string) {
    setFeedSourceFilter((prev) => {
      const next = new Set(prev);
      if (next.has(src)) next.delete(src);
      else next.add(src);
      return next;
    });
  }

  function toggleFeedCategory(cat: string) {
    setFeedCategoryFilter((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }

  function clearAllFeedFilters() {
    setFeedSearch("");
    setFeedSourceFilter(new Set());
    setFeedCategoryFilter(new Set());
  }

  // Per-source counts within currently loaded signals — for filter dropdown
  const feedSourceCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of signals) counts[s.source] = (counts[s.source] || 0) + 1;
    return counts;
  }, [signals]);

  const feedCategoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of signals) {
      for (const c of s.category_tags || []) {
        counts[c] = (counts[c] || 0) + 1;
      }
    }
    return counts;
  }, [signals]);

  // Filter + sort signals for the feed
  const filteredSignals = useMemo(() => {
    let out = signals;

    // Time range — even though we fetched at least 30 days, let user narrow
    if (feedTimeRange < 30) {
      const cutoff = Date.now() - feedTimeRange * 24 * 60 * 60 * 1000;
      out = out.filter((s) => new Date(s.signal_date).getTime() >= cutoff);
    }

    if (feedSourceFilter.size > 0) {
      out = out.filter((s) => feedSourceFilter.has(s.source));
    }

    if (feedCategoryFilter.size > 0) {
      out = out.filter((s) =>
        (s.category_tags || []).some((c) => feedCategoryFilter.has(c)),
      );
    }

    const q = feedSearch.trim().toLowerCase();
    if (q) {
      out = out.filter((s) => {
        const hay = [
          s.title,
          s.summary,
          s.requester || "",
          ...(s.entity_slugs || []),
          ...(s.category_tags || []),
        ]
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      });
    }

    if (sort === "priority") {
      out = [...out].sort((a, b) => {
        if ((b.priority || 0) !== (a.priority || 0)) return (b.priority || 0) - (a.priority || 0);
        return new Date(b.signal_date).getTime() - new Date(a.signal_date).getTime();
      });
    }
    return out;
  }, [signals, feedSourceFilter, feedCategoryFilter, feedSearch, feedTimeRange, sort]);

  const visibleSourcesForGalaxy = galaxySourceFilter.size > 0 ? galaxySourceFilter : undefined;
  const feedFilterCount =
    (feedSearch.trim() ? 1 : 0) +
    feedSourceFilter.size +
    feedCategoryFilter.size +
    (feedTimeRange !== 30 ? 1 : 0);

  // Tier 2 — signals connecting in the visible patterns. After the galaxy
  // source filter is applied, count unique evidence signals across all
  // currently-rendered patterns.
  const signalsInGraph = useMemo(() => {
    const ids = new Set<string>();
    for (const p of patterns) {
      for (const ev of p.evidence_signals || []) {
        if (galaxySourceFilter.size > 0 && !galaxySourceFilter.has(ev.source)) continue;
        ids.add(ev.id);
      }
    }
    return ids.size;
  }, [patterns, galaxySourceFilter]);

  // Tier 3 — signals ingested in the last 24 hours (from currently loaded
  // batch). Useful as a "freshness pulse" above the feed.
  const signalsIngestedToday = useMemo(() => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    let n = 0;
    for (const s of signals) {
      const t = s.ingested_at ? new Date(s.ingested_at).getTime() : NaN;
      if (!isNaN(t) && t >= cutoff) n++;
    }
    return n;
  }, [signals]);

  // Human label for the current feed time range — used in Tier 3 meta line
  const feedTimeLabel = useMemo(() => {
    const r = TIME_RANGES.find((x) => x.days === feedTimeRange);
    return r ? r.label.toLowerCase() : `last ${feedTimeRange} days`;
  }, [feedTimeRange]);

  const sortedPatterns = useMemo(
    () => [...patterns].sort((a, b) => b.non_obviousness_score - a.non_obviousness_score),
    [patterns],
  );

  // Galaxy view derived from the type filter. Memoized so PatternGraph's
  // `patterns` prop stays referentially stable across hover-induced
  // re-renders — otherwise React.memo bails and the d3-force simulation
  // restarts on every hover, causing the canvas to jitter.
  const galaxyMode: "themes" | "drilled" =
    patternTypeFilter.size === 0 ? "themes" : "drilled";

  const drilledThemePatterns = useMemo(() => {
    if (galaxyMode === "themes") return sortedPatterns;
    return sortedPatterns.filter((p) =>
      patternTypeFilter.has(p.pattern_type),
    );
  }, [galaxyMode, sortedPatterns, patternTypeFilter]);

  const drilledGalaxyPatterns = useMemo(() => {
    if (
      drilledThemePatterns.length <= DRILLED_TOP_N ||
      showAllInTheme
    ) {
      return drilledThemePatterns;
    }
    return [...drilledThemePatterns]
      .sort(
        (a, b) =>
          (b.non_obviousness_score ?? 0) - (a.non_obviousness_score ?? 0),
      )
      .slice(0, DRILLED_TOP_N);
  }, [drilledThemePatterns, showAllInTheme]);

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
      </header>

      {/* Tier 1 — global stat strip */}
      <StatStrip stats={globalStats} />

      {/* Role picker — moved here from the header so the role of the chips
          is obvious from the description that sits right above them. */}
      <section className="signals-persona-section">
        <p className="signals-persona-section-hint">
          Pick a role to focus the feed and patterns.
        </p>
        <PersonaPills
          personas={personas}
          selected={selected}
          onToggle={togglePersona}
        />
      </section>

      {/* Galaxy hero */}
      <section className="signals-dashboard-section">
        <div className="signals-dashboard-section-head">
          <div className="signals-dashboard-section-labels">
            <span className="signals-eyebrow">Pattern galaxy</span>
            {/* Tier 2 — meta line about what's currently rendered */}
            <span className="signals-tier-meta">
              {sortedPatterns.length === 0 ? (
                "No patterns match the current filters."
              ) : (
                <>
                  <strong>{sortedPatterns.length}</strong>{" "}
                  {sortedPatterns.length === 1 ? "pattern" : "patterns"} connecting{" "}
                  <strong>{signalsInGraph.toLocaleString()}</strong>{" "}
                  {signalsInGraph === 1 ? "signal" : "signals"}
                  <span className="signals-tier-meta-soft"> · last 60 days</span>
                </>
              )}
            </span>
          </div>
        </div>
        <div className="signals-galaxy-filter-row">
          <span className="signals-galaxy-filter-label">
            Filter the {globalStats?.sources_enabled ?? ALL_SOURCES.length} sources:
          </span>
          <SourceFilter
            signals={signals}
            active={galaxySourceFilter}
            onToggle={toggleGalaxySource}
          />
        </div>

        {/* Galaxy — derived from `patternTypeFilter`:
              empty   → 7 theme bubbles (Level 0)
              1+ types → drilled clusters of those types (Level 1) */}
        {loading && signals.length === 0 ? (
          <div className="signals-dashboard-skeleton signals-dashboard-skeleton-galaxy">
            Loading patterns…
          </div>
        ) : sortedPatterns.length === 0 ? (
          <div className="signals-dashboard-empty">
            No patterns yet for this filter. The AI analyst runs daily.
          </div>
        ) : galaxyMode === "themes" ? (
          <PatternThemeGalaxy
            patterns={sortedPatterns}
            onThemeSelect={handleThemeSelect}
          />
        ) : (
          <div className="signals-galaxy-drilled">
            <button
              type="button"
              className="signals-galaxy-back-btn"
              onClick={clearPatternTypes}
            >
              ← Back to themes
            </button>
            {drilledThemePatterns.length > DRILLED_TOP_N && (
              <button
                type="button"
                className="signals-galaxy-show-all-toggle"
                onClick={() => setShowAllInTheme((v) => !v)}
                title={
                  showAllInTheme
                    ? `Showing all ${drilledThemePatterns.length} patterns in this theme`
                    : `Showing top ${DRILLED_TOP_N} of ${drilledThemePatterns.length}`
                }
              >
                {showAllInTheme
                  ? `Top ${DRILLED_TOP_N} only`
                  : `Show all ${drilledThemePatterns.length}`}
              </button>
            )}
            <PatternGraph
              mode="galaxy"
              patterns={drilledGalaxyPatterns}
              visibleSources={visibleSourcesForGalaxy}
              onPatternSelect={handlePatternSelect}
              selectedPatternId={activePatternId}
              externalHoveredPatternId={hoveredPatternId}
              onHoverPattern={handleHoverPattern}
            />
          </div>
        )}

        {/* Pattern card grid (replaces the old horizontal strip) */}
        {sortedPatterns.length > 0 && (
          <PatternCardGrid
            patterns={sortedPatterns}
            typeFilter={patternTypeFilter}
            onToggleType={togglePatternType}
            onClearTypes={clearPatternTypes}
            hoveredPatternId={hoveredPatternId}
            onHoverPattern={handleHoverPattern}
            selectedPatternId={activePatternId}
            onSelectPattern={handlePatternSelect}
          />
        )}
      </section>

      {/* Strong section break */}
      <div className="signals-section-divider" aria-hidden="true">
        <span className="signals-section-divider-label">Live feed</span>
      </div>

      {/* Feed */}
      <section className="signals-dashboard-section signals-feed-section">
        {/* Tier 3 — meta line about what's currently in the feed view */}
        <div className="signals-tier-meta signals-tier-meta-feed">
          <strong>{filteredSignals.length.toLocaleString()}</strong>{" "}
          {filteredSignals.length === 1 ? "signal" : "signals"} shown
          <span className="signals-tier-meta-soft"> · {feedTimeLabel}</span>
          {signalsIngestedToday > 0 && (
            <>
              <span className="signals-tier-meta-soft"> · </span>
              <strong>{signalsIngestedToday}</strong> added today
            </>
          )}
        </div>

        {/* Filter bar — sticky as the user scrolls the feed */}
        <div className="signals-feed-filter-bar">
          <div className="signals-feed-filter-row signals-feed-filter-row-primary">
            <div className="signals-feed-search">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="11" cy="11" r="7" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="search"
                placeholder="Search company, entity, agency…"
                value={feedSearch}
                onChange={(e) => setFeedSearch(e.target.value)}
                aria-label="Search feed"
              />
              {feedSearch && (
                <button
                  type="button"
                  className="signals-feed-search-clear"
                  onClick={() => setFeedSearch("")}
                  aria-label="Clear search"
                >
                  ✕
                </button>
              )}
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

          <div className="signals-feed-filter-row signals-feed-filter-row-secondary">
            <SingleSelectDropdown<number>
              label="Time"
              value={feedTimeRange}
              options={TIME_RANGES.map((r) => ({ value: r.days, label: r.label }))}
              onChange={setFeedTimeRange}
            />
            <MultiSelectDropdown
              label="Sources"
              selected={feedSourceFilter}
              onToggle={toggleFeedSource}
              onClear={() => setFeedSourceFilter(new Set())}
              options={ALL_SOURCES.map((s) => ({
                id: s,
                label: SOURCE_LABELS[s] || s,
                count: feedSourceCounts[s] || 0,
              }))}
            />
            <MultiSelectDropdown
              label="Categories"
              selected={feedCategoryFilter}
              onToggle={toggleFeedCategory}
              onClear={() => setFeedCategoryFilter(new Set())}
              options={ALL_CATEGORIES.map((c) => ({
                id: c,
                label: CATEGORY_LABELS[c] || c,
                count: feedCategoryCounts[c] || 0,
              }))}
            />
            <span className="signals-feed-filter-summary">
              {filteredSignals.length.toLocaleString()}{" "}
              {filteredSignals.length === 1 ? "signal" : "signals"}
            </span>
          </div>

          {feedFilterCount > 0 && (
            <div className="signals-feed-active-row">
              <span className="signals-feed-active-label">Active filters:</span>
              {feedTimeRange !== 30 && (
                <span className="signals-feed-active-chip">
                  {TIME_RANGES.find((r) => r.days === feedTimeRange)?.label}
                  <button
                    type="button"
                    onClick={() => setFeedTimeRange(30)}
                    aria-label="Reset time range"
                  >
                    ✕
                  </button>
                </span>
              )}
              {Array.from(feedSourceFilter).map((s) => (
                <span key={`src-${s}`} className="signals-feed-active-chip">
                  {SOURCE_LABELS[s] || s}
                  <button
                    type="button"
                    onClick={() => toggleFeedSource(s)}
                    aria-label={`Remove ${SOURCE_LABELS[s] || s} filter`}
                  >
                    ✕
                  </button>
                </span>
              ))}
              {Array.from(feedCategoryFilter).map((c) => (
                <span key={`cat-${c}`} className="signals-feed-active-chip">
                  {CATEGORY_LABELS[c] || c}
                  <button
                    type="button"
                    onClick={() => toggleFeedCategory(c)}
                    aria-label={`Remove ${CATEGORY_LABELS[c] || c} filter`}
                  >
                    ✕
                  </button>
                </span>
              ))}
              {feedSearch.trim() && (
                <span className="signals-feed-active-chip">
                  &ldquo;{feedSearch.trim().slice(0, 24)}
                  {feedSearch.trim().length > 24 ? "…" : ""}&rdquo;
                  <button
                    type="button"
                    onClick={() => setFeedSearch("")}
                    aria-label="Clear search"
                  >
                    ✕
                  </button>
                </span>
              )}
              <button
                type="button"
                className="signals-feed-active-clear"
                onClick={clearAllFeedFilters}
              >
                Clear all
              </button>
            </div>
          )}
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
              grouped.map(([day, rows]) => {
                // Lead card = highest-priority item in this day group, but
                // only when the priority is non-routine (>= 1). Days where
                // every item is priority 0 just render as a grid (no lead).
                const sortedByPriority = [...rows].sort(
                  (a, b) => (b.priority || 0) - (a.priority || 0),
                );
                const leadCandidate = sortedByPriority[0];
                const lead =
                  leadCandidate && (leadCandidate.priority || 0) >= 1
                    ? leadCandidate
                    : null;
                const rest = lead
                  ? rows.filter((s) => s.id !== lead.id)
                  : rows;
                return (
                  <div key={day} className="signals-feed-group">
                    <div className="signals-feed-day-header">
                      <span className="signals-feed-day-label">{dayLabel(day)}</span>
                      <span className="signals-feed-day-count">
                        {rows.length} {rows.length === 1 ? "signal" : "signals"}
                      </span>
                    </div>
                    {lead && (
                      <LeadCard
                        signal={lead}
                        active={activeSignal?.id === lead.id}
                        onClick={() => setActiveSignal(lead)}
                      />
                    )}
                    {rest.length > 0 && (
                      <div className="signals-card-grid">
                        {rest.map((s) => (
                          <CompactCard
                            key={s.id}
                            signal={s}
                            active={activeSignal?.id === s.id}
                            onClick={() => setActiveSignal(s)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            ) : (
              // Priority sort: flat 2-col grid, no day groups, no lead
              // (the user has explicitly asked to see everything ordered by
              // priority; a "lead" would be redundant).
              <div className="signals-card-grid">
                {filteredSignals.map((s) => (
                  <CompactCard
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

      <SignalDetailDrawer signal={activeSignal} onClose={handleCloseSignalDrawer} />
      <PatternDetailDrawer
        patternId={activePatternId}
        entityType={activeEntityType}
        entitySlug={activeEntitySlug}
        onClose={handleClosePatternDrawer}
        onPopEntity={handlePopEntity}
        onEntitySelect={handleEntitySelect}
      />
    </main>
  );
}
