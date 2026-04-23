"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from "d3-force";
import type {
  SignalPattern,
  Signal,
  PatternEvidenceSignal,
} from "@/lib/signals-api";

// ── Types ───────────────────────────────────────────────────────────────────

type AnySignal = Signal | PatternEvidenceSignal;

interface GraphNode extends SimulationNodeDatum {
  id: string;
  kind: "signal" | "entity";
  label: string;
  patternId?: string;
  patternIds?: string[];
  source?: string;
  signal?: AnySignal;
  entityType?: string;
  entitySlug?: string;
  degree?: number;
}

interface GraphLink extends SimulationLinkDatum<GraphNode> {
  weight: number;
  isBridge?: boolean;
  patternId?: string;
}

// ── Palette ─────────────────────────────────────────────────────────────────
// Muted, Cohere-friendly cluster palette. Same hue range as before but at
// lower saturation/lightness so the graph reads as product UI, not a demo.
const CLUSTER_PALETTE = [
  "#2b66c9", // desaturated primary blue
  "#1f8562", // muted emerald
  "#6d4fc0", // dusty violet
  "#c17a2a", // ochre
  "#147a92", // deep teal
  "#b84775", // soft rose
  "#5a8a33", // moss
  "#a03737", // brick
];

const SOURCE_COLORS: Record<string, string> = {
  gao_protests: "#2b66c9",
  epa_echo: "#1f8562",
  fda_warning_letters: "#6d4fc0",
  dhs_foia_log: "#c17a2a",
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function parseEntitySlug(slug: string): { type: string; rawSlug: string; display: string } {
  const [type, rawSlug] = slug.split(":");
  const display = (rawSlug || "")
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  return { type: type || "entity", rawSlug: rawSlug || "", display };
}

function patternColor(index: number): string {
  return CLUSTER_PALETTE[index % CLUSTER_PALETTE.length];
}

function buildCentroids(
  patternIds: string[],
  width: number,
  height: number,
): Map<string, { x: number; y: number }> {
  const m = new Map<string, { x: number; y: number }>();
  const n = patternIds.length;
  const cx = width / 2;
  const cy = height / 2;
  if (n === 0) return m;
  if (n === 1) {
    m.set(patternIds[0], { x: cx, y: cy });
    return m;
  }
  // Larger radius to give clusters breathing room.
  const radius = Math.min(width, height) * 0.36;
  patternIds.forEach((pid, i) => {
    const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
    m.set(pid, { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius });
  });
  return m;
}

function clusterForce(
  centroids: Map<string, { x: number; y: number }>,
  strength: number,
) {
  let nodes: GraphNode[] = [];
  function force(alpha: number) {
    const s = strength * alpha;
    for (const n of nodes) {
      const ids =
        n.patternIds && n.patternIds.length > 0
          ? n.patternIds
          : n.patternId
          ? [n.patternId]
          : [];
      if (ids.length === 0) continue;
      let tx = 0;
      let ty = 0;
      let k = 0;
      for (const pid of ids) {
        const c = centroids.get(pid);
        if (!c) continue;
        tx += c.x;
        ty += c.y;
        k += 1;
      }
      if (k === 0) continue;
      tx /= k;
      ty /= k;
      n.vx = (n.vx ?? 0) + (tx - (n.x ?? 0)) * s;
      n.vy = (n.vy ?? 0) + (ty - (n.y ?? 0)) * s;
    }
  }
  (force as unknown as { initialize: (ns: GraphNode[]) => void }).initialize = (
    ns: GraphNode[],
  ) => {
    nodes = ns;
  };
  return force;
}

// ── Graph construction ──────────────────────────────────────────────────────

function buildDetailGraph(
  pattern: SignalPattern,
  signals: AnySignal[],
): { nodes: GraphNode[]; links: GraphLink[] } {
  const patternId = pattern.id;
  const entityDegree = new Map<string, number>();
  const entityDisplay = new Map<string, { type: string; display: string; rawSlug: string }>();

  for (const sig of signals) {
    const slugs: string[] = (sig.entity_slugs as string[] | undefined) || [];
    for (const slug of slugs) {
      entityDegree.set(slug, (entityDegree.get(slug) ?? 0) + 1);
      if (!entityDisplay.has(slug)) entityDisplay.set(slug, parseEntitySlug(slug));
    }
  }
  for (const slug of pattern.entity_slugs || []) {
    if (!entityDisplay.has(slug)) {
      entityDisplay.set(slug, parseEntitySlug(slug));
      entityDegree.set(slug, entityDegree.get(slug) ?? 0);
    }
  }

  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];

  for (const sig of signals) {
    nodes.push({
      id: `sig:${sig.id}`,
      kind: "signal",
      label: sig.title,
      patternId,
      source: sig.source,
      signal: sig,
    });
  }

  for (const [slug, ed] of entityDisplay.entries()) {
    nodes.push({
      id: `ent:${slug}`,
      kind: "entity",
      label: ed.display,
      patternId,
      entityType: ed.type,
      entitySlug: ed.rawSlug,
      degree: entityDegree.get(slug) ?? 0,
    });
  }

  const maxDegree = Math.max(1, ...Array.from(entityDegree.values()));
  for (const sig of signals) {
    const slugs: string[] = (sig.entity_slugs as string[] | undefined) || [];
    for (const slug of slugs) {
      const deg = entityDegree.get(slug) ?? 1;
      links.push({
        source: `sig:${sig.id}`,
        target: `ent:${slug}`,
        weight: deg / maxDegree,
        patternId,
      });
    }
  }

  return { nodes, links };
}

function buildGalaxyGraph(
  patterns: SignalPattern[],
): {
  nodes: GraphNode[];
  links: GraphLink[];
  patternIds: string[];
  patternColorMap: Map<string, string>;
} {
  const patternIds: string[] = patterns.map((p) => p.id);
  const patternColorMap = new Map<string, string>();
  patternIds.forEach((pid, i) => patternColorMap.set(pid, patternColor(i)));

  const entityDisplay = new Map<string, { type: string; display: string; rawSlug: string }>();
  const entityPatterns = new Map<string, Set<string>>();
  const entityDegreePerPattern = new Map<string, Map<string, number>>();

  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];

  for (const p of patterns) {
    const pid = p.id;
    const perSlug = new Map<string, number>();
    const signals = p.evidence_signals || [];
    for (const sig of signals) {
      const slugs: string[] = (sig.entity_slugs as string[] | undefined) || [];
      for (const slug of slugs) {
        perSlug.set(slug, (perSlug.get(slug) ?? 0) + 1);
        if (!entityDisplay.has(slug)) entityDisplay.set(slug, parseEntitySlug(slug));
        if (!entityPatterns.has(slug)) entityPatterns.set(slug, new Set());
        entityPatterns.get(slug)!.add(pid);
      }
    }
    for (const slug of p.entity_slugs || []) {
      if (!entityDisplay.has(slug)) entityDisplay.set(slug, parseEntitySlug(slug));
      if (!entityPatterns.has(slug)) entityPatterns.set(slug, new Set());
      entityPatterns.get(slug)!.add(pid);
      if (!perSlug.has(slug)) perSlug.set(slug, 0);
    }
    entityDegreePerPattern.set(pid, perSlug);

    for (const sig of signals) {
      nodes.push({
        id: `sig:${pid}:${sig.id}`,
        kind: "signal",
        label: sig.title,
        patternId: pid,
        source: sig.source,
        signal: sig,
      });
    }
  }

  for (const [slug, ed] of entityDisplay.entries()) {
    const pids = Array.from(entityPatterns.get(slug) ?? []);
    let totalDegree = 0;
    for (const pid of pids) {
      totalDegree += entityDegreePerPattern.get(pid)?.get(slug) ?? 0;
    }
    nodes.push({
      id: `ent:${slug}`,
      kind: "entity",
      label: ed.display,
      patternIds: pids,
      entityType: ed.type,
      entitySlug: ed.rawSlug,
      degree: totalDegree,
    });
  }

  for (const p of patterns) {
    const pid = p.id;
    const signals = p.evidence_signals || [];
    const perSlug = entityDegreePerPattern.get(pid) ?? new Map<string, number>();
    const maxDegree = Math.max(1, ...Array.from(perSlug.values()));
    for (const sig of signals) {
      const slugs: string[] = (sig.entity_slugs as string[] | undefined) || [];
      for (const slug of slugs) {
        const deg = perSlug.get(slug) ?? 1;
        links.push({
          source: `sig:${pid}:${sig.id}`,
          target: `ent:${slug}`,
          weight: deg / maxDegree,
          patternId: pid,
        });
      }
    }
  }

  return { nodes, links, patternIds, patternColorMap };
}

// ── Component ───────────────────────────────────────────────────────────────

type GraphProps =
  | {
      mode: "galaxy";
      patterns: SignalPattern[];
      height?: number;
      // When set, signals from sources NOT in this set are excluded from the
      // galaxy (along with any entities that become orphaned). Used to sync
      // the galaxy with the dashboard's source filter.
      visibleSources?: Set<string>;
    }
  | {
      mode: "detail";
      pattern: SignalPattern;
      signals: Signal[];
      height?: number;
      onSignalClick?: (signalId: string) => void;
    };

export default function PatternGraph(props: GraphProps) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const simulationRef = useRef<Simulation<GraphNode, GraphLink> | null>(null);
  // Seed width + mobile from the actual window on first render so the SVG
  // never paints wider than the viewport (which would cause iOS Safari to
  // zoom the page out and break the sidebar's mobile media query).
  const [width, setWidth] = useState(() => {
    if (typeof window !== "undefined") {
      return Math.min(960, window.innerWidth);
    }
    return 960;
  });
  const [mobile, setMobile] = useState(() => {
    if (typeof window !== "undefined") {
      return window.innerWidth < 768;
    }
    return false;
  });
  const height =
    props.height ??
    (mobile
      ? props.mode === "galaxy"
        ? 520
        : 400
      : props.mode === "galaxy"
      ? 720
      : 520);
  const [tick, setTick] = useState(0);
  const [hovered, setHovered] = useState<string | null>(null);
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 });
  const panStart = useRef<{ mouseX: number; mouseY: number; startX: number; startY: number } | null>(null);
  const [isPanning, setIsPanning] = useState(false);

  // Measure container width
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

  const built = useMemo(() => {
    if (props.mode === "galaxy") {
      // Apply visibleSources filter by cloning patterns with evidence_signals
      // reduced to the allowed sources. Empty/unset set => no filtering.
      const visible = props.visibleSources;
      const filtered = !visible || visible.size === 0
        ? props.patterns
        : props.patterns.map((p) => ({
            ...p,
            evidence_signals: (p.evidence_signals || []).filter((s) =>
              visible.has(s.source),
            ),
          }));
      return buildGalaxyGraph(filtered);
    }
    return {
      ...buildDetailGraph(props.pattern, props.signals),
      patternIds: [props.pattern.id],
      patternColorMap: new Map<string, string>([[props.pattern.id, CLUSTER_PALETTE[0]]]),
    };
  }, [props]);

  // Centroid map for cluster halos + overlay cards. Stable across renders
  // since it only depends on pattern IDs + canvas size.
  const centroids = useMemo(() => {
    const ids =
      props.mode === "galaxy"
        ? (built as ReturnType<typeof buildGalaxyGraph>).patternIds
        : [props.pattern.id];
    return buildCentroids(ids, width, height);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [built, width, height]);

  useEffect(() => {
    const { nodes, links } = built;
    if (nodes.length === 0) return;

    for (const n of nodes) {
      const pid =
        n.patternId || (n.patternIds && n.patternIds[0]) || "";
      const c = centroids.get(pid);
      if (c && (n.x === undefined || n.x === 0)) {
        n.x = c.x + (Math.random() - 0.5) * 40;
        n.y = c.y + (Math.random() - 0.5) * 40;
      }
    }

    const clusterStrength = props.mode === "galaxy" ? 0.09 : 0.0;

    const sim = forceSimulation<GraphNode>(nodes)
      .force(
        "link",
        forceLink<GraphNode, GraphLink>(links)
          .id((d) => d.id)
          .distance(() => 55)
          .strength(0.35),
      )
      .force("charge", forceManyBody<GraphNode>().strength(-160))
      .force("center", forceCenter<GraphNode>(width / 2, height / 2).strength(0.02))
      .force(
        "collide",
        forceCollide<GraphNode>().radius((d) => {
          if (d.kind === "entity") return Math.max(16, Math.min(28, 12 + (d.degree ?? 0) * 1.5));
          return 10;
        }),
      );

    if (clusterStrength > 0) {
      const cf = clusterForce(centroids, clusterStrength);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sim.force("cluster", cf as any);
    }

    sim.on("tick", () => setTick((t) => (t + 1) % 1000));
    simulationRef.current = sim;
    sim.alpha(1).restart();

    return () => {
      sim.stop();
      simulationRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [built, width, height, centroids, props.mode]);

  const nodeById = useMemo(() => {
    const m = new Map<string, GraphNode>();
    for (const n of built.nodes) m.set(n.id, n);
    return m;
  }, [built]);

  // Entity nodes that should show their label at rest (without hover).
  // Galaxy: top 2 highest-degree entities per cluster.
  // Detail: top 5 overall.
  const alwaysLabeledEntities = useMemo(() => {
    const set = new Set<string>();
    if (props.mode === "galaxy") {
      const byPattern = new Map<string, GraphNode[]>();
      for (const n of built.nodes) {
        if (n.kind !== "entity") continue;
        const pids =
          n.patternIds && n.patternIds.length > 0
            ? n.patternIds
            : n.patternId
            ? [n.patternId]
            : [];
        for (const pid of pids) {
          if (!byPattern.has(pid)) byPattern.set(pid, []);
          byPattern.get(pid)!.push(n);
        }
      }
      byPattern.forEach((ents) => {
        ents.sort((a, b) => (b.degree ?? 0) - (a.degree ?? 0));
        for (const e of ents.slice(0, 2)) set.add(e.id);
      });
    } else {
      const ents = built.nodes
        .filter((n) => n.kind === "entity")
        .sort((a, b) => (b.degree ?? 0) - (a.degree ?? 0));
      for (const e of ents.slice(0, 5)) set.add(e.id);
    }
    return set;
  }, [built, props.mode]);

  // ── Hover helpers ─────────────────────────────────────────────────────────

  function hoveredClusterIds(): Set<string> | null {
    if (!hovered) return null;
    const h = nodeById.get(hovered);
    if (!h) return null;
    const ids =
      h.patternIds && h.patternIds.length > 0
        ? h.patternIds
        : h.patternId
        ? [h.patternId]
        : [];
    return new Set(ids);
  }

  function isNodeDimmed(n: GraphNode): boolean {
    if (!hovered) return false;
    if (props.mode === "galaxy") {
      const focus = hoveredClusterIds();
      if (!focus || focus.size === 0) return false;
      const nPatterns =
        n.patternIds && n.patternIds.length > 0 ? n.patternIds : [n.patternId ?? ""];
      return !nPatterns.some((p) => focus.has(p));
    }
    if (n.id === hovered) return false;
    for (const l of built.links) {
      const s = typeof l.source === "string" ? l.source : (l.source as GraphNode).id;
      const t = typeof l.target === "string" ? l.target : (l.target as GraphNode).id;
      if ((s === hovered && t === n.id) || (t === hovered && s === n.id)) return false;
    }
    return true;
  }

  function isLinkDimmed(l: GraphLink): boolean {
    if (!hovered) return false;
    const s = typeof l.source === "string" ? l.source : (l.source as GraphNode).id;
    const t = typeof l.target === "string" ? l.target : (l.target as GraphNode).id;
    if (props.mode === "galaxy") {
      const focus = hoveredClusterIds();
      if (!focus || focus.size === 0) return false;
      return !focus.has(l.patternId ?? "");
    }
    return !(s === hovered || t === hovered);
  }

  // Entity labels only appear when either the entity is hovered, or its
  // cluster is hovered. Keeps the canvas clean by default.
  function isEntityLabelVisible(n: GraphNode): boolean {
    if (!hovered) return false;
    if (n.id === hovered) return true;
    const focus = hoveredClusterIds();
    if (!focus || focus.size === 0) return false;
    const nPatterns =
      n.patternIds && n.patternIds.length > 0 ? n.patternIds : [n.patternId ?? ""];
    return nPatterns.some((p) => focus.has(p));
  }

  function signalFill(n: GraphNode): string {
    if (props.mode === "galaxy") {
      return (
        (built as ReturnType<typeof buildGalaxyGraph>).patternColorMap.get(
          n.patternId ?? "",
        ) ?? "var(--primary)"
      );
    }
    return SOURCE_COLORS[n.source ?? ""] ?? "var(--primary)";
  }

  function handleNodeClick(n: GraphNode) {
    if (props.mode === "galaxy") {
      let targetPid = n.patternId;
      if (!targetPid && n.patternIds && n.patternIds.length > 0) {
        const best = (props.patterns || [])
          .filter((p) => n.patternIds!.includes(p.id))
          .sort((a, b) => b.non_obviousness_score - a.non_obviousness_score)[0];
        targetPid = best?.id ?? n.patternIds[0];
      }
      if (targetPid) router.push(`/signals/patterns/${targetPid}`);
      return;
    }
    if (n.kind === "entity" && n.entityType && n.entitySlug) {
      router.push(`/signals/entity/${n.entityType}/${n.entitySlug}`);
      return;
    }
    if (n.kind === "signal" && n.signal) {
      const cb = (props as Extract<GraphProps, { mode: "detail" }>).onSignalClick;
      if (cb) cb(n.signal.id);
    }
  }

  // ── Pan / zoom ────────────────────────────────────────────────────────────

  function resetView() {
    setTransform({ x: 0, y: 0, k: 1 });
  }

  function zoomBy(delta: number, center?: { x: number; y: number }) {
    setTransform((prev) => {
      const nextK = Math.max(0.35, Math.min(3, prev.k * (1 + delta)));
      if (!center) return { ...prev, k: nextK };
      // Zoom around a focal point (mouse position) so it feels natural.
      const ratio = nextK / prev.k;
      return {
        k: nextK,
        x: center.x - (center.x - prev.x) * ratio,
        y: center.y - (center.y - prev.y) * ratio,
      };
    });
  }

  function onWheel(e: React.WheelEvent<SVGSVGElement>) {
    e.preventDefault();
    const rect = svgRef.current?.getBoundingClientRect();
    const cx = rect ? e.clientX - rect.left : undefined;
    const cy = rect ? e.clientY - rect.top : undefined;
    zoomBy(-e.deltaY * 0.0015, cx !== undefined && cy !== undefined ? { x: cx, y: cy } : undefined);
  }

  function onMouseDown(e: React.MouseEvent<SVGSVGElement>) {
    // Only pan if click was on empty space / background, not on a node.
    const target = e.target as Element;
    if (target.closest(".pattern-graph-node")) return;
    panStart.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      startX: transform.x,
      startY: transform.y,
    };
    setIsPanning(true);
  }

  function onMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    const ps = panStart.current;
    if (!ps) return;
    const dx = e.clientX - ps.mouseX;
    const dy = e.clientY - ps.mouseY;
    setTransform((t) => ({
      ...t,
      x: ps.startX + dx,
      y: ps.startY + dy,
    }));
  }

  function onMouseUp() {
    panStart.current = null;
    setIsPanning(false);
  }

  // ── Touch (pan + pinch zoom) ──────────────────────────────────────────────
  const touchStart = useRef<{
    midX: number;
    midY: number;
    startX: number;
    startY: number;
    distance?: number;
    startK?: number;
  } | null>(null);

  function onTouchStart(e: React.TouchEvent<SVGSVGElement>) {
    if (e.touches.length === 1) {
      const target = e.target as Element;
      if (target.closest(".pattern-graph-node")) return;
      const t = e.touches[0];
      touchStart.current = {
        midX: t.clientX,
        midY: t.clientY,
        startX: transform.x,
        startY: transform.y,
      };
    } else if (e.touches.length === 2) {
      const [a, b] = [e.touches[0], e.touches[1]];
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      touchStart.current = {
        midX: (a.clientX + b.clientX) / 2,
        midY: (a.clientY + b.clientY) / 2,
        startX: transform.x,
        startY: transform.y,
        distance: d,
        startK: transform.k,
      };
    }
  }

  function onTouchMove(e: React.TouchEvent<SVGSVGElement>) {
    const ts = touchStart.current;
    if (!ts) return;
    if (e.touches.length === 1) {
      const t = e.touches[0];
      const dx = t.clientX - ts.midX;
      const dy = t.clientY - ts.midY;
      setTransform((cur) => ({
        ...cur,
        x: ts.startX + dx,
        y: ts.startY + dy,
      }));
    } else if (
      e.touches.length === 2 &&
      ts.distance !== undefined &&
      ts.startK !== undefined
    ) {
      const [a, b] = [e.touches[0], e.touches[1]];
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const scale = d / ts.distance;
      const newK = Math.max(0.35, Math.min(3, ts.startK * scale));
      const rect = svgRef.current?.getBoundingClientRect();
      const midX = (a.clientX + b.clientX) / 2 - (rect?.left ?? 0);
      const midY = (a.clientY + b.clientY) / 2 - (rect?.top ?? 0);
      const ratio = newK / ts.startK;
      setTransform({
        k: newK,
        x: midX - (midX - ts.startX) * ratio,
        y: midY - (midY - ts.startY) * ratio,
      });
    }
  }

  function onTouchEnd(e: React.TouchEvent<SVGSVGElement>) {
    // End of pan/zoom when all fingers lift
    if (e.touches.length === 0) {
      touchStart.current = null;
    }
  }

  // Screen-space position for an SVG coordinate, applying the current transform.
  function toScreen(x: number, y: number): { x: number; y: number } {
    return {
      x: x * transform.k + transform.x,
      y: y * transform.k + transform.y,
    };
  }

  const galaxyData =
    props.mode === "galaxy" ? (built as ReturnType<typeof buildGalaxyGraph>) : null;

  // Per-cluster bounding boxes, used to size halos and position pattern cards.
  const clusterBounds = useMemo(() => {
    const bounds = new Map<
      string,
      { minX: number; minY: number; maxX: number; maxY: number; cx: number; cy: number }
    >();
    for (const n of built.nodes) {
      if (n.x === undefined || n.y === undefined) continue;
      const pids =
        n.patternIds && n.patternIds.length > 0
          ? n.patternIds
          : n.patternId
          ? [n.patternId]
          : [];
      for (const pid of pids) {
        const cur = bounds.get(pid) ?? {
          minX: Infinity,
          minY: Infinity,
          maxX: -Infinity,
          maxY: -Infinity,
          cx: 0,
          cy: 0,
        };
        cur.minX = Math.min(cur.minX, n.x);
        cur.maxX = Math.max(cur.maxX, n.x);
        cur.minY = Math.min(cur.minY, n.y);
        cur.maxY = Math.max(cur.maxY, n.y);
        cur.cx = (cur.minX + cur.maxX) / 2;
        cur.cy = (cur.minY + cur.maxY) / 2;
        bounds.set(pid, cur);
      }
    }
    return bounds;
    // Depends on `tick` so cluster bounds (and therefore halos + cluster
    // cards) track node positions as the simulation runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [built, width, height, tick]);

  return (
    <div ref={containerRef} className="pattern-graph">
      <svg
        ref={svgRef}
        className="pattern-graph-svg"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        style={{
          height: `${height}px`,
          cursor: isPanning ? "grabbing" : "grab",
        }}
      >
        <defs>
          <filter id="pattern-graph-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="1.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="pattern-graph-soft-shadow" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="1" stdDeviation="2" floodOpacity="0.12" />
          </filter>
        </defs>

        <g
          className="pattern-graph-world"
          transform={`translate(${transform.x}, ${transform.y}) scale(${transform.k})`}
        >
          {/* cluster halos (galaxy only) — a soft translucent ellipse behind each cluster */}
          {galaxyData && props.mode === "galaxy" && (
            <g className="pattern-graph-halos">
              {(props.patterns || []).map((p) => {
                const b = clusterBounds.get(p.id);
                if (!b || !isFinite(b.minX)) return null;
                const cx = b.cx;
                const cy = b.cy;
                const rx = Math.max(80, (b.maxX - b.minX) / 2 + 55);
                const ry = Math.max(70, (b.maxY - b.minY) / 2 + 50);
                const color = galaxyData.patternColorMap.get(p.id) ?? "var(--primary)";
                const focus = hoveredClusterIds();
                const dim = focus && !focus.has(p.id);
                return (
                  <ellipse
                    key={p.id}
                    cx={cx}
                    cy={cy}
                    rx={rx}
                    ry={ry}
                    fill={color}
                    opacity={dim ? 0.03 : 0.07}
                    style={{ transition: "opacity 0.2s" }}
                  />
                );
              })}
            </g>
          )}

          {/* edges */}
          <g className="pattern-graph-edges">
            {built.links.map((l, i) => {
              const s =
                typeof l.source === "string"
                  ? nodeById.get(l.source)
                  : (l.source as GraphNode);
              const t =
                typeof l.target === "string"
                  ? nodeById.get(l.target)
                  : (l.target as GraphNode);
              if (!s || !t || s.x === undefined || t.x === undefined) return null;
              const dimmed = isLinkDimmed(l);
              const strokeWidth = 0.5 + l.weight * 2.2;
              const baseOpacity = 0.22 + l.weight * 0.5;
              const stroke =
                props.mode === "galaxy"
                  ? galaxyData!.patternColorMap.get(l.patternId ?? "") ?? "var(--border-cool)"
                  : "var(--primary)";
              return (
                <line
                  key={i}
                  x1={s.x}
                  y1={s.y}
                  x2={t.x}
                  y2={t.y}
                  stroke={stroke}
                  strokeWidth={strokeWidth}
                  opacity={dimmed ? 0.05 : baseOpacity}
                  style={{ transition: "opacity 0.15s" }}
                />
              );
            })}
          </g>

          {/* nodes */}
          <g className="pattern-graph-nodes">
            {built.nodes.map((n) => {
              if (n.x === undefined || n.y === undefined) return null;
              const dimmed = isNodeDimmed(n);
              if (n.kind === "signal") {
                return (
                  <circle
                    key={n.id}
                    className="pattern-graph-node pattern-graph-node-signal"
                    cx={n.x}
                    cy={n.y}
                    r={hovered === n.id ? 6 : 4.5}
                    fill={signalFill(n)}
                    opacity={dimmed ? 0.18 : 0.9}
                    onMouseEnter={() => setHovered(n.id)}
                    onMouseLeave={() => setHovered(null)}
                    onClick={() => handleNodeClick(n)}
                    style={{ cursor: "pointer", transition: "opacity 0.15s, r 0.15s" }}
                  >
                    <title>{n.label}</title>
                  </circle>
                );
              }
              const radius = Math.max(11, Math.min(22, 9 + (n.degree ?? 0) * 1.2));
              const showLabel = alwaysLabeledEntities.has(n.id) || isEntityLabelVisible(n);
              return (
                <g
                  key={n.id}
                  className="pattern-graph-node pattern-graph-node-entity"
                  onMouseEnter={() => setHovered(n.id)}
                  onMouseLeave={() => setHovered(null)}
                  onClick={() => handleNodeClick(n)}
                  style={{ cursor: "pointer", opacity: dimmed ? 0.22 : 1, transition: "opacity 0.15s" }}
                >
                  <circle
                    cx={n.x}
                    cy={n.y}
                    r={radius}
                    fill="white"
                    stroke="var(--border-cool)"
                    strokeWidth={1.5}
                    filter="url(#pattern-graph-soft-shadow)"
                  />
                  <circle
                    cx={n.x}
                    cy={n.y}
                    r={radius - 5}
                    fill="var(--primary-light)"
                    opacity={0.8}
                  />
                  {/* Label pill on hover */}
                  {showLabel && (
                    <g transform={`translate(${n.x}, ${(n.y ?? 0) + radius + 14})`}>
                      <rect
                        x={-n.label.length * 3.2 - 8}
                        y={-10}
                        width={n.label.length * 6.4 + 16}
                        height={20}
                        rx={10}
                        ry={10}
                        fill="white"
                        stroke="var(--border-soft)"
                        strokeWidth={1}
                        filter="url(#pattern-graph-soft-shadow)"
                      />
                      <text
                        textAnchor="middle"
                        dominantBaseline="central"
                        fontSize={11}
                        fontFamily="var(--font-body)"
                        fill="var(--foreground)"
                        style={{ pointerEvents: "none" }}
                      >
                        {n.label.length > 32 ? `${n.label.slice(0, 30)}…` : n.label}
                      </text>
                    </g>
                  )}
                  <title>{`${n.label} · ${n.degree ?? 0} signals`}</title>
                </g>
              );
            })}
          </g>
        </g>
      </svg>

      {/* Cluster cards (HTML overlay, galaxy mode only) */}
      {galaxyData && props.mode === "galaxy" && (
        <div className="pattern-graph-cluster-cards">
          {(props.patterns || []).map((p) => {
            const b = clusterBounds.get(p.id);
            if (!b || !isFinite(b.minX)) return null;
            // Position the card just above the top of the cluster bounding box.
            const pos = toScreen(b.cx, b.minY - 40);
            const color = galaxyData.patternColorMap.get(p.id) ?? "var(--primary)";
            const focus = hoveredClusterIds();
            const dim = focus && !focus.has(p.id);
            const count = (p.evidence_signals || []).length;
            return (
              <button
                key={p.id}
                type="button"
                className="pattern-graph-cluster-card"
                style={{
                  left: pos.x,
                  top: pos.y,
                  borderColor: color,
                  opacity: dim ? 0.4 : 1,
                }}
                onClick={() => router.push(`/signals/patterns/${p.id}`)}
                onMouseEnter={() => {
                  // Hovering the card highlights the cluster by fake-hovering its centroid.
                  const firstNode = built.nodes.find((n) => n.patternId === p.id);
                  if (firstNode) setHovered(firstNode.id);
                }}
                onMouseLeave={() => setHovered(null)}
              >
                <span
                  className="pattern-graph-cluster-dot"
                  style={{ background: color }}
                  aria-hidden="true"
                />
                <span className="pattern-graph-cluster-title">
                  {p.title.length > 52 ? `${p.title.slice(0, 50)}…` : p.title}
                </span>
                <span className="pattern-graph-cluster-meta">
                  {count} {count === 1 ? "signal" : "signals"} · {p.non_obviousness_score}/10
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Controls */}
      <div className="pattern-graph-controls">
        <button
          type="button"
          className="pattern-graph-control-btn"
          onClick={() => zoomBy(0.2)}
          aria-label="Zoom in"
          title="Zoom in"
        >
          +
        </button>
        <button
          type="button"
          className="pattern-graph-control-btn"
          onClick={() => zoomBy(-0.2)}
          aria-label="Zoom out"
          title="Zoom out"
        >
          −
        </button>
        <button
          type="button"
          className="pattern-graph-control-btn"
          onClick={resetView}
          aria-label="Reset view"
          title="Reset view"
        >
          ↺
        </button>
      </div>

      <div className="pattern-graph-hint">
        {mobile
          ? "Drag to pan · pinch to zoom · tap a cluster"
          : "Drag to pan · scroll to zoom · hover a node to focus"}
      </div>

      {/* Legend — detail mode only (galaxy uses the cluster cards as its key) */}
      {props.mode === "detail" && (
        <div className="pattern-graph-legend">
          <span className="pattern-graph-legend-title">Sources</span>
          {Object.entries(SOURCE_COLORS).map(([k, c]) => (
            <span key={k} className="pattern-graph-legend-item">
              <span className="pattern-graph-legend-dot" style={{ background: c }} />
              {k.replace(/_/g, " ")}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
