"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  forceCenter,
  forceCollide,
  forceManyBody,
  forceSimulation,
  type Simulation,
  type SimulationNodeDatum,
} from "d3-force";
import type { SignalPattern } from "@/lib/signals-api";

/** Theme metadata is the central source of truth for human-readable labels +
 * blurbs + colors per `pattern_type`. Adding a new pattern type = one entry
 * here + one in the backend `PATTERN_TYPES` constant. */
export const PATTERN_TYPE_THEMES: Record<
  string,
  { label: string; blurb: string; color: string }
> = {
  coordinated_activity: {
    label: "Coordinated activity",
    blurb: "Multiple actions happening together",
    color: "#2b66c9",
  },
  compounding_risk: {
    label: "Compounding risk",
    blurb: "Stacking pressures on the same target",
    color: "#a03737",
  },
  trend_shift: {
    label: "Trend shifts",
    blurb: "Sudden changes in volume or direction",
    color: "#1f8562",
  },
  regulatory_cascade: {
    label: "Regulatory cascades",
    blurb: "One agency's move triggers another's",
    color: "#6d4fc0",
  },
  convergence: {
    label: "Convergences",
    blurb: "Different sources telling the same story",
    color: "#c17a2a",
  },
  oversight_to_action: {
    label: "Oversight → action",
    blurb: "Inspector General audits that led to enforcement",
    color: "#147a92",
  },
  recall_to_litigation: {
    label: "Recall → litigation",
    blurb: "Product recalls that turned into court fights",
    color: "#b84775",
  },
};

interface ThemeBubble extends SimulationNodeDatum {
  id: string; // pattern_type
  label: string;
  blurb: string;
  color: string;
  count: number;
  radius: number;
}

interface Props {
  patterns: SignalPattern[];
  onThemeSelect: (patternType: string) => void;
  height?: number;
  /** When set, that theme stays highlighted (e.g. while the drawer for a
   * pattern of that type is open). */
  selectedTheme?: string | null;
}

export default function PatternThemeGalaxy({
  patterns,
  onThemeSelect,
  height,
  selectedTheme = null,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const simulationRef = useRef<Simulation<ThemeBubble, undefined> | null>(null);
  const [width, setWidth] = useState(() =>
    typeof window !== "undefined" ? Math.min(960, window.innerWidth) : 960,
  );
  const [mobile, setMobile] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth < 768 : false,
  );
  const [tick, setTick] = useState(0);
  const [hovered, setHovered] = useState<string | null>(null);

  const canvasHeight = height ?? (mobile ? 420 : 560);

  useEffect(() => {
    function update() {
      const w = containerRef.current?.clientWidth ?? 960;
      setWidth(w);
      setMobile(window.innerWidth < 768);
    }
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // Group patterns by pattern_type and pick the theme metadata. Only types
  // that actually have ≥1 pattern get a bubble — empty themes don't render.
  // Seeding (x, y) here rather than in a post-mount useEffect: if x/y stayed
  // undefined through the first render, every bubble would paint at the
  // canvas center, then jump outward when the simulation kicked in. Seeding
  // up-front means the first paint already shows them in a ring.
  const bubbles = useMemo<ThemeBubble[]>(() => {
    const byType = new Map<string, SignalPattern[]>();
    for (const p of patterns) {
      const t = p.pattern_type || "unknown";
      if (!byType.has(t)) byType.set(t, []);
      byType.get(t)!.push(p);
    }

    const out: ThemeBubble[] = [];
    for (const [t, ps] of byType.entries()) {
      const theme =
        PATTERN_TYPE_THEMES[t] ?? {
          label: t.replace(/_/g, " "),
          blurb: "Other patterns",
          color: "#5a8a33",
        };
      const radius = Math.max(95, Math.min(135, 70 + Math.sqrt(ps.length) * 14));
      out.push({
        id: t,
        label: theme.label,
        blurb: theme.blurb,
        color: theme.color,
        count: ps.length,
        radius,
      });
    }
    // Stable order: most populous theme first, alphabetical tiebreaker.
    out.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

    // Ring seed. Starting from -π/2 puts the largest theme at the top.
    const cx = width / 2;
    const cy = canvasHeight / 2;
    const r = Math.min(width, canvasHeight) * 0.3;
    out.forEach((b, i) => {
      const angle = (i / out.length) * Math.PI * 2 - Math.PI / 2;
      b.x = cx + Math.cos(angle) * r;
      b.y = cy + Math.sin(angle) * r;
    });
    return out;
  }, [patterns, width, canvasHeight]);

  // Simulation — center + collide only. No links between bubbles, so the
  // layout is effectively a stable cloud arranged around the canvas center.
  // Bubbles are pre-seeded in their useMemo (above) so we don't need a
  // separate seeding step here.
  useEffect(() => {
    if (bubbles.length === 0) return;
    const cx = width / 2;
    const cy = canvasHeight / 2;

    const sim = forceSimulation<ThemeBubble>(bubbles)
      .force("center", forceCenter<ThemeBubble>(cx, cy).strength(0.06))
      .force("charge", forceManyBody<ThemeBubble>().strength(-180))
      .force(
        "collide",
        forceCollide<ThemeBubble>().radius((d) => d.radius + 14),
      )
      .alphaMin(0.04); // settle fast — these don't need to keep wiggling

    // Clamp positions to the canvas bounds on each tick so bubbles never
    // drift outside the viewBox (was happening for "Coordinated activity"
    // when forceCharge pushed it past the top edge).
    sim.on("tick", () => {
      for (const b of bubbles) {
        if (b.x === undefined || b.y === undefined) continue;
        const margin = b.radius + 8;
        if (b.x < margin) b.x = margin;
        if (b.x > width - margin) b.x = width - margin;
        if (b.y < margin) b.y = margin;
        if (b.y > canvasHeight - margin) b.y = canvasHeight - margin;
      }
      setTick((t) => (t + 1) % 1000);
    });
    simulationRef.current = sim;
    sim.alpha(0.9).restart();

    return () => {
      sim.stop();
      simulationRef.current = null;
    };
  }, [bubbles, width, canvasHeight]);

  if (bubbles.length === 0) {
    return (
      <div className="signals-dashboard-empty">
        No patterns yet. The AI analyst runs daily.
      </div>
    );
  }

  // The currently-active theme: explicit `selectedTheme` prop wins over
  // hover, so the drawer's open-state lock isn't broken when the mouse moves.
  const focusedTheme = hovered ?? selectedTheme;

  return (
    <div ref={containerRef} className="pattern-theme-galaxy">
      <svg
        className="pattern-theme-galaxy-svg"
        viewBox={`0 0 ${width} ${canvasHeight}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ height: `${canvasHeight}px` }}
      >
        <defs>
          <filter
            id="pattern-theme-shadow"
            x="-50%"
            y="-50%"
            width="200%"
            height="200%"
          >
            <feDropShadow dx="0" dy="2" stdDeviation="3" floodOpacity="0.14" />
          </filter>
        </defs>

        {/* tick is read so the SVG repaints as the simulation moves nodes */}
        <g data-tick={tick}>
          {bubbles.map((b) => {
            const dim = focusedTheme && focusedTheme !== b.id;
            const isActive = focusedTheme === b.id;
            const cx = b.x ?? width / 2;
            const cy = b.y ?? canvasHeight / 2;
            return (
              <g
                key={b.id}
                className="pattern-theme-bubble"
                onMouseEnter={() => setHovered(b.id)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => onThemeSelect(b.id)}
                style={{
                  cursor: "pointer",
                  opacity: dim ? 0.35 : 1,
                  transition: "opacity 0.18s",
                }}
              >
                <circle
                  cx={cx}
                  cy={cy}
                  r={b.radius}
                  fill={b.color}
                  fillOpacity={isActive ? 0.18 : 0.1}
                  stroke={b.color}
                  strokeWidth={isActive ? 2.5 : 1.5}
                  filter="url(#pattern-theme-shadow)"
                />
                <text
                  x={cx}
                  y={cy - 6}
                  textAnchor="middle"
                  fontFamily="var(--font-display)"
                  fontSize={mobile ? 14 : 16}
                  fontWeight={500}
                  fill="var(--foreground)"
                  style={{ pointerEvents: "none" }}
                >
                  {b.label}
                </text>
                <text
                  x={cx}
                  y={cy + 14}
                  textAnchor="middle"
                  fontFamily="var(--font-body)"
                  fontSize={mobile ? 11 : 12}
                  fill="var(--muted)"
                  style={{ pointerEvents: "none" }}
                >
                  {b.count} {b.count === 1 ? "pattern" : "patterns"}
                </text>
              </g>
            );
          })}
        </g>
      </svg>

      {/* Hovered-theme blurb pill, anchored bottom-center. When a theme is
          focused, the pill takes the theme's color as a left-edge accent so
          it visually ties back to the bubble the user is pointing at. */}
      {(() => {
        const focused = focusedTheme
          ? bubbles.find((b) => b.id === focusedTheme)
          : null;
        return (
          <div
            className={`pattern-theme-galaxy-blurb${
              focused ? " pattern-theme-galaxy-blurb-visible" : ""
            }`}
            style={
              focused
                ? ({
                    ["--blurb-accent" as string]: focused.color,
                  } as React.CSSProperties)
                : undefined
            }
          >
            {focused ? (
              <>
                <span className="pattern-theme-galaxy-blurb-label">
                  {focused.label}
                </span>
                <span className="pattern-theme-galaxy-blurb-text">
                  {focused.blurb}
                </span>
              </>
            ) : (
              "Hover a bubble to see what it groups"
            )}
          </div>
        );
      })()}

    </div>
  );
}
