"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PatternGraph from "@/components/PatternGraph";
import PatternDetailDrawer from "@/components/PatternDetailDrawer";
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

// ── Constants (mirrors backend/app/data/signals_sources.py registry) ──────
// Order here drives the filter-pill order on the dashboard. Group by family
// for visual grouping in the chip row.

const SOURCE_LABELS: Record<string, string> = {
  // Enforcement & oversight
  gao_protests:           "GAO Protests",
  epa_echo:               "EPA ECHO",
  fda_warning_letters:    "FDA Warnings",
  oversight_ig_reports:   "IG Reports",
  gao_reports:            "GAO Reports",
  osha_news:              "OSHA",
  irs_news:               "IRS",
  sec_press_releases:     "SEC",
  ftc_press_releases:     "FTC",
  fec_enforcement:        "FEC",
  // Recalls & safety
  fda_drug_recalls:       "Drug Recalls",
  fda_food_recalls:       "Food Recalls",
  fda_device_recalls:     "Device Recalls",
  cpsc_recalls:           "CPSC Recalls",
  nhtsa_recalls:          "NHTSA Recalls",
  // Courts & legal
  courtlistener_opinions: "Court Opinions",
  // Research & policy
  dhs_foia_log:           "DHS FOIA",
  congress_gov:           "Congress.gov",
  regulations_gov:        "Reg Dockets",
};

const SOURCE_LONG_LABELS: Record<string, string> = {
  gao_protests:           "GAO Bid Protest Decision",
  epa_echo:               "EPA ECHO Enforcement",
  fda_warning_letters:    "FDA Warning Letter",
  oversight_ig_reports:   "Inspector General Report",
  gao_reports:            "GAO Audit / Evaluation",
  osha_news:              "OSHA Enforcement News",
  irs_news:               "IRS News Release",
  sec_press_releases:     "SEC Press Release",
  ftc_press_releases:     "FTC Press Release",
  fec_enforcement:        "FEC Enforcement Matter",
  fda_drug_recalls:       "FDA Drug Recall",
  fda_food_recalls:       "FDA Food / Cosmetic Recall",
  fda_device_recalls:     "FDA Medical Device Recall",
  cpsc_recalls:           "CPSC Product Recall",
  nhtsa_recalls:          "NHTSA Vehicle Recall",
  courtlistener_opinions: "Federal Court Opinion",
  dhs_foia_log:           "DHS FOIA Log Entry",
  congress_gov:           "Congress.gov Bill",
  regulations_gov:        "Regulations.gov Docket",
};

// Colors clustered by family — same hue family for related sources so the
// filter row visually groups itself.
const SOURCE_COLORS: Record<string, string> = {
  // Enforcement (blues)
  gao_protests:           "#2b66c9",
  epa_echo:               "#1f8562",
  fda_warning_letters:    "#6d4fc0",
  oversight_ig_reports:   "#3a7fc1",
  gao_reports:            "#4a8fd5",
  osha_news:              "#0f6e8c",
  irs_news:               "#5575b8",
  sec_press_releases:     "#1d4ed8",
  ftc_press_releases:     "#3651a8",
  fec_enforcement:        "#5b6dad",
  // Recalls (warm reds/oranges)
  fda_drug_recalls:       "#c0392b",
  fda_food_recalls:       "#d35400",
  fda_device_recalls:     "#a93226",
  cpsc_recalls:           "#c17a2a",
  nhtsa_recalls:          "#a04020",
  // Courts (purple)
  courtlistener_opinions: "#7d3c98",
  // Research (greens)
  dhs_foia_log:           "#1f8562",
  congress_gov:           "#5d8a3e",
  regulations_gov:        "#2c8c4f",
};

const ALL_SOURCES = [
  // Enforcement & oversight
  "gao_protests", "epa_echo", "fda_warning_letters", "oversight_ig_reports",
  "gao_reports", "osha_news", "irs_news", "sec_press_releases",
  "ftc_press_releases", "fec_enforcement",
  // Recalls
  "fda_drug_recalls", "fda_food_recalls", "fda_device_recalls",
  "cpsc_recalls", "nhtsa_recalls",
  // Courts
  "courtlistener_opinions",
  // Research
  "dhs_foia_log", "congress_gov", "regulations_gov",
];

const FOIA_REQUEST_SOURCES = new Set(["dhs_foia_log"]);
function signalKind(source: string): "request" | "action" {
  return FOIA_REQUEST_SOURCES.has(source) ? "request" : "action";
}

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

function MultiSelectDropdown({
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

function SingleSelectDropdown<T extends string | number>({
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

// ── Pattern compact card ──────────────────────────────────────────────────

function PatternCompactCard({
  pattern,
  onSelect,
  active,
}: {
  pattern: SignalPattern;
  onSelect?: (id: string) => void;
  active?: boolean;
}) {
  const evidence = pattern.evidence_signals || [];
  const sourceCounts: Record<string, number> = {};
  for (const e of evidence) sourceCounts[e.source] = (sourceCounts[e.source] || 0) + 1;
  const sourceBadges = Object.entries(sourceCounts);
  const firstSentence = (pattern.narrative.split(/\n\n+/)[0] || "")
    .split(/(?<=[.?!])\s+/)[0]
    .trim();

  const className = `signals-pattern-compact${
    active ? " signals-pattern-compact-active" : ""
  }`;
  const body = (
    <>
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
    </>
  );

  if (onSelect) {
    return (
      <button
        type="button"
        className={className}
        onClick={() => onSelect(pattern.id)}
      >
        {body}
      </button>
    );
  }

  return (
    <Link href={`/signals/patterns/${pattern.id}`} className={className}>
      {body}
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
  const [activeSignal, setActiveSignal] = useState<Signal | null>(null);
  const [activePatternId, setActivePatternId] = useState<string | null>(null);

  // Stable callback identities so PatternGraph (memo'd) doesn't re-render on
  // every parent state change. Without these, the inline arrow lambdas were
  // new refs every render → React.memo bails out → graph rebuilds.
  const handlePatternSelect = useCallback(
    (pid: string) => setActivePatternId(pid),
    [],
  );
  const handleClosePatternDrawer = useCallback(
    () => setActivePatternId(null),
    [],
  );
  const handleCloseSignalDrawer = useCallback(
    () => setActiveSignal(null),
    [],
  );

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

      {/* Tier 1 — global stat strip */}
      <StatStrip stats={globalStats} />

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

        {loading && signals.length === 0 ? (
          <div className="signals-dashboard-skeleton signals-dashboard-skeleton-galaxy">
            Loading patterns…
          </div>
        ) : sortedPatterns.length > 0 ? (
          <PatternGraph
            mode="galaxy"
            patterns={sortedPatterns}
            visibleSources={visibleSourcesForGalaxy}
            onPatternSelect={handlePatternSelect}
            selectedPatternId={activePatternId}
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
                <PatternCompactCard
                  key={p.id}
                  pattern={p}
                  onSelect={handlePatternSelect}
                  active={activePatternId === p.id}
                />
              ))}
            </div>
          </div>
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
        onClose={handleClosePatternDrawer}
      />
    </main>
  );
}
