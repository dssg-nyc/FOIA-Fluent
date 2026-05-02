"use client";

import { useMemo, useRef, useState } from "react";
import {
  MultiSelectDropdown,
  SingleSelectDropdown,
  fmtRelative,
} from "@/components/SignalsDashboard";
import { SOURCE_COLORS, SOURCE_LABELS } from "@/lib/signal-sources";
import { PATTERN_TYPE_THEMES } from "@/components/PatternThemeGalaxy";
import {
  parseNarrative,
  type SignalPattern,
} from "@/lib/signals-api";

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "newest", label: "Newest" },
  { value: "signals", label: "Most signals" },
];

type SortKey = "newest" | "signals";

interface Props {
  /** All patterns the dashboard knows about (already filtered by persona). */
  patterns: SignalPattern[];
  /** Pattern type filter — shared with the galaxy so both views stay in sync. */
  typeFilter: Set<string>;
  onToggleType: (patternType: string) => void;
  onClearTypes: () => void;
  /** Card-level interactions. Hover sync is bidirectional with the galaxy. */
  hoveredPatternId: string | null;
  onHoverPattern: (patternId: string | null) => void;
  selectedPatternId: string | null;
  onSelectPattern: (patternId: string) => void;
}

export default function PatternCardGrid({
  patterns,
  typeFilter,
  onToggleType,
  onClearTypes,
  hoveredPatternId,
  onHoverPattern,
  selectedPatternId,
  onSelectPattern,
}: Props) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("newest");

  // ── Type-filter options with live counts (drives the dropdown labels) ──
  const typeOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of patterns)
      counts.set(p.pattern_type, (counts.get(p.pattern_type) ?? 0) + 1);
    return Array.from(counts.entries())
      .map(([id, count]) => ({
        id,
        label: PATTERN_TYPE_THEMES[id]?.label ?? id.replace(/_/g, " "),
        count,
      }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }, [patterns]);

  // ── Apply search + type → sort. Pure client-side. ──────────────────────
  const filteredPatterns = useMemo(() => {
    const q = search.trim().toLowerCase();
    let out = patterns.filter((p) => {
      if (typeFilter.size > 0 && !typeFilter.has(p.pattern_type)) return false;
      if (!q) return true;
      const haystack = `${p.title || ""} ${p.subtitle || ""}`.toLowerCase();
      return haystack.includes(q);
    });
    out = [...out];
    out.sort((a, b) => {
      switch (sort) {
        case "signals":
          return (
            (b.evidence_signals?.length ?? 0) -
            (a.evidence_signals?.length ?? 0)
          );
        case "newest":
        default:
          return (
            new Date(b.generated_at).getTime() -
            new Date(a.generated_at).getTime()
          );
      }
    });
    return out;
  }, [patterns, search, typeFilter, sort]);

  // Card refs are kept for potential future deep-linking, but auto-scroll on
  // hover was removed: hovering a galaxy node was scrolling the page toward
  // the card grid mid-mouse-move, which felt like the page was fighting the
  // user. The visual highlight (dim/un-dim) below is enough by itself.
  const cardRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  const activeFilterCount =
    (search.trim() ? 1 : 0) + (typeFilter.size > 0 ? 1 : 0);

  return (
    <div className="signals-pattern-grid-section">
      {/* Toolbar — sticky as the user scrolls the card grid below it. */}
      <div className="signals-pattern-grid-toolbar">
        <div className="signals-pattern-grid-toolbar-row">
          <div className="signals-pattern-grid-search">
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
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search title or subtitle…"
              className="signals-pattern-grid-search-input"
            />
            {search && (
              <button
                type="button"
                className="signals-pattern-grid-search-clear"
                onClick={() => setSearch("")}
                aria-label="Clear search"
              >
                ×
              </button>
            )}
          </div>

          <MultiSelectDropdown
            label="Theme"
            options={typeOptions}
            selected={typeFilter}
            onToggle={onToggleType}
            onClear={onClearTypes}
          />
          <SingleSelectDropdown
            label="Sort"
            value={sort}
            options={SORT_OPTIONS}
            onChange={(v) => setSort(v)}
          />

          <span className="signals-pattern-grid-count">
            {filteredPatterns.length}{" "}
            {filteredPatterns.length === 1 ? "pattern" : "patterns"}
          </span>
        </div>

        {activeFilterCount > 0 && (
          <div className="signals-pattern-grid-active-filters">
            <span className="signals-pattern-grid-active-label">
              Active filters:
            </span>
            {search.trim() && (
              <button
                type="button"
                className="signals-pattern-grid-chip"
                onClick={() => setSearch("")}
              >
                &ldquo;{search.trim()}&rdquo; <span aria-hidden="true">×</span>
              </button>
            )}
            {Array.from(typeFilter).map((t) => (
              <button
                key={t}
                type="button"
                className="signals-pattern-grid-chip"
                onClick={() => onToggleType(t)}
              >
                {PATTERN_TYPE_THEMES[t]?.label ?? t}{" "}
                <span aria-hidden="true">×</span>
              </button>
            ))}
            <button
              type="button"
              className="signals-pattern-grid-clear-all"
              onClick={() => {
                setSearch("");
                onClearTypes();
              }}
            >
              Clear all
            </button>
          </div>
        )}
      </div>

      {/* Card grid */}
      {filteredPatterns.length === 0 ? (
        <div className="signals-dashboard-empty">
          No patterns match the current filters.
        </div>
      ) : (
        <div className="signals-pattern-grid">
          {filteredPatterns.map((p) => {
            const theme = PATTERN_TYPE_THEMES[p.pattern_type] ?? {
              label: p.pattern_type,
              color: "#5a8a33",
            };
            const sourceCounts = new Map<string, number>();
            for (const ev of p.evidence_signals ?? []) {
              sourceCounts.set(
                ev.source,
                (sourceCounts.get(ev.source) ?? 0) + 1,
              );
            }
            const isSelected = selectedPatternId === p.id;
            const isHovered = hoveredPatternId === p.id;
            const isDimmed =
              hoveredPatternId !== null &&
              hoveredPatternId !== p.id &&
              !isSelected;

            const subtitle = p.subtitle?.trim();
            // Backward compat: legacy patterns have no subtitle, so we fall
            // back to the first sentence of the narrative for the grey line.
            let subtitleFallback = "";
            if (!subtitle) {
              const narrative = parseNarrative(p.narrative);
              if (typeof narrative !== "string") {
                subtitleFallback = narrative.story;
              } else {
                subtitleFallback =
                  narrative.split(/(?<=[.?!])\s+/)[0]?.trim() ?? "";
              }
            }

            return (
              <button
                key={p.id}
                type="button"
                ref={(el) => {
                  if (el) cardRefs.current.set(p.id, el);
                  else cardRefs.current.delete(p.id);
                }}
                className={[
                  "signals-pattern-card-v2",
                  isSelected ? "signals-pattern-card-v2-selected" : "",
                  isHovered ? "signals-pattern-card-v2-hovered" : "",
                  isDimmed ? "signals-pattern-card-v2-dimmed" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                style={{
                  // CSS custom prop for the left-edge stripe. Keeps the
                  // theme color in one place rather than a nested element.
                  ["--pattern-card-color" as string]: theme.color,
                }}
                onClick={() => onSelectPattern(p.id)}
                onMouseEnter={() => onHoverPattern(p.id)}
                onMouseLeave={() => onHoverPattern(null)}
              >
                <div className="signals-pattern-card-v2-head">
                  <span className="signals-pattern-card-v2-type">
                    {theme.label}
                  </span>
                </div>
                <h3 className="signals-pattern-card-v2-title">{p.title}</h3>
                {(subtitle || subtitleFallback) && (
                  <p className="signals-pattern-card-v2-subtitle">
                    {subtitle || subtitleFallback}
                  </p>
                )}
                <div className="signals-pattern-card-v2-foot">
                  <span className="signals-pattern-card-v2-sources">
                    {Array.from(sourceCounts.entries())
                      .slice(0, 5)
                      .map(([src, n]) => (
                        <span
                          key={src}
                          className="signals-pattern-card-v2-source-dot"
                          style={{ background: SOURCE_COLORS[src] ?? "#999" }}
                          title={`${SOURCE_LABELS[src] ?? src} · ${n} ${
                            n === 1 ? "signal" : "signals"
                          }`}
                          aria-hidden="true"
                        />
                      ))}
                  </span>
                  <span className="signals-pattern-card-v2-meta">
                    {(p.evidence_signals?.length ?? 0)} signals ·{" "}
                    {fmtRelative(p.generated_at)}
                  </span>
                </div>
                {p.confidence === "medium" && (
                  <span className="signals-pattern-card-v2-tentative">
                    Tentative
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
