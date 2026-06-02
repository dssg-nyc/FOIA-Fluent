"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { getUserProfile, markTourComplete } from "@/lib/tour-api";
import { TOUR_STEPS, type FollowStage, type Placement } from "@/lib/tour-steps";

function isAuthPage(pathname: string): boolean {
  return pathname === "/" || pathname === "/login" || pathname.startsWith("/auth");
}

const SPOTLIGHT_PAD = 8;
const POPOVER_GAP = 20;
const VIEWPORT_MARGIN = 14;
const ACQUIRE_TIMEOUT_MS = 6000;
const MOBILE_BREAKPOINT = 768;
const SCROLL_BOTTOM_THRESHOLD = 90;

const CARET_SIDE: Record<Placement, "top" | "bottom" | "left" | "right" | null> = {
  bottom: "top",
  top: "bottom",
  right: "left",
  left: "right",
  center: null,
};

const CONFETTI_COLORS = ["#1863dc", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6"];

/** Rotating example queries auto-typed into /draft's search textarea
 * during the tour so the user sees the "search in plain English" pitch
 * as a live demo. Five examples cycle: type → hold → backspace → next.
 * Each query showcases a different beat (environmental, immigration,
 * health, housing, tech) to imply the breadth of what plain-English
 * search can do. Cleared when the user advances or focuses the box. */
const DRAFT_DEMO_QUERIES = [
  "EPA enforcement actions against chemical plants in Louisiana in 2024",
  "ICE detention facility incident reports from 2024",
  "FDA inspection findings for Indian generic drug manufacturers",
  "HUD audits of Section 8 housing voucher fraud since 2023",
  "Federal procurement records for AI surveillance contracts since 2024",
];
const DRAFT_TYPE_INTERVAL_MS = 42;
const DRAFT_DELETE_INTERVAL_MS = 20;
const DRAFT_HOLD_AFTER_TYPE_MS = 1600;
const DRAFT_PAUSE_BEFORE_NEXT_MS = 320;
const DRAFT_TYPE_START_DELAY_MS = 650;

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function scrolledToBottom(): boolean {
  const el = document.scrollingElement || document.documentElement;
  return el.scrollHeight - el.scrollTop - el.clientHeight <= SCROLL_BOTTOM_THRESHOLD;
}

/** Tiny markdown-lite renderer for the popover body copy. Supports two
 * affordances we need to make multi-sentence steps readable:
 *   - `\n\n` → paragraph break (each paragraph keeps the .tour-body
 *     margins, so the stack reads as discrete beats)
 *   - `**bold**` → <strong> emphasis on the imperative noun
 * Anything else (single newlines, other syntax) renders as plain text.
 * Tour copy is hardcoded, so XSS isn't a concern. */
function renderBody(text: string): React.ReactNode {
  const paragraphs = text.split("\n\n");
  return paragraphs.map((para, i) => (
    <p key={i} className="tour-body">
      {para.split(/(\*\*[^*]+\*\*)/).map((seg, j) =>
        seg.startsWith("**") && seg.endsWith("**") ? (
          <strong key={j}>{seg.slice(2, -2)}</strong>
        ) : (
          <span key={j}>{seg}</span>
        ),
      )}
    </p>
  ));
}

export default function TourOverlay() {
  const pathname = usePathname();
  const router = useRouter();

  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [tourState, setTourState] = useState<"unknown" | "incomplete" | "complete">("unknown");
  const [started, setStarted] = useState(false);
  const [index, setIndex] = useState(0);
  // 0 = on the step's primary target. 1+ = the Nth stage of the follow
  // chain is active (the ring has jumped from the original target to a
  // newly-appeared selector). For single-stage follow this is just 0 → 1.
  const [followIndex, setFollowIndex] = useState(0);
  const [reachedBottom, setReachedBottom] = useState(false);
  // True for a short window (~360ms) after the spotlight target changes,
  // so the SVG rects get a CSS transition that glides them between
  // positions. Toggled off again so the per-frame live-sync loop stays
  // snappy and doesn't lag behind scroll/reflow movement.
  const [transitioning, setTransitioning] = useState(false);

  const [measured, setMeasured] = useState(false);
  const [rect, setRect] = useState<Rect | null>(null);
  const [popoverStyle, setPopoverStyle] = useState<React.CSSProperties | null>(null);
  const [resolvedPlacement, setResolvedPlacement] = useState<Placement>("bottom");
  const [viewport, setViewport] = useState({ w: 0, h: 0 });

  const hasAutoStarted = useRef(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const acquireCancel = useRef<(() => void) | null>(null);
  const targetEl = useRef<HTMLElement | null>(null);
  const prevPath = useRef(pathname);

  const step = TOUR_STEPS[index];
  const isMobile = viewport.w > 0 && viewport.w <= MOBILE_BREAKPOINT;
  const isScrollGate = step.kind === "explain" && !!step.scrollGate;
  const isInteractive = step.kind === "interactive";
  const isNavigate = step.kind === "navigate";
  const isFinale = step.kind === "finale";

  // Normalize `follow` to a chain. A single FollowStage becomes a
  // one-element array; an array stays as-is; undefined → []. Memoized
  // on the step reference so we don't churn re-renders.
  const followChain: FollowStage[] = useMemo(() => {
    if (step.kind !== "interactive" || !step.follow) return [];
    return Array.isArray(step.follow) ? step.follow : [step.follow];
  }, [step]);
  const activeStage: FollowStage | null =
    followIndex > 0 ? followChain[followIndex - 1] ?? null : null;
  const target = isFinale
    ? null
    : activeStage
      ? activeStage.appear
      : step.target;
  const activeTitle = activeStage ? activeStage.title ?? step.title : step.title;
  const activeBody = activeStage ? activeStage.body ?? step.body : step.body;
  const activePlacement: Placement = isFinale
    ? "center"
    : activeStage
      ? activeStage.placement ?? step.placement
      : step.placement;
  // Scroll-gate steps don't spotlight: the page stays in full color so the user can scroll it.
  const wantsSpotlight = !!target && !isMobile && !isScrollGate;

  // ── Viewport ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const update = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // ── Auth ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!supabase) {
      setSignedIn(false);
      return;
    }
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) setSignedIn(!!data.session);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setSignedIn(!!session);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  // ── Completion flag ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (signedIn !== true || isAuthPage(pathname) || tourState !== "unknown") return;
    let cancelled = false;
    getUserProfile()
      .then((p) => {
        if (!cancelled) setTourState(p.tour_completed_at ? "complete" : "incomplete");
      })
      .catch(() => {
        if (!cancelled) setTourState("complete");
      });
    return () => {
      cancelled = true;
    };
  }, [signedIn, pathname, tourState]);

  // ── Start ───────────────────────────────────────────────────────────────────
  const startTour = useCallback(() => {
    hasAutoStarted.current = true;
    setIndex(0);
    setFollowIndex(0);
    setReachedBottom(false);
    setMeasured(false);
    setRect(null);
    setStarted(true);
    window.dispatchEvent(new Event("foiafluent.tour-started"));
    const first = TOUR_STEPS[0];
    const firstRoute = first.kind === "navigate" ? first.gotoRoute : first.route;
    if (firstRoute && window.location.pathname !== firstRoute) router.push(firstRoute);
  }, [router]);

  useEffect(() => {
    if (tourState === "incomplete" && !hasAutoStarted.current && !isAuthPage(pathname)) startTour();
  }, [tourState, pathname, startTour]);

  useEffect(() => {
    const onReplay = () => startTour();
    window.addEventListener("foiafluent.replay-tour", onReplay);
    return () => window.removeEventListener("foiafluent.replay-tour", onReplay);
  }, [startTour]);

  // ── End / advance ─────────────────────────────────────────────────────────────
  const endTour = useCallback((markComplete: boolean) => {
    acquireCancel.current?.();
    acquireCancel.current = null;
    setStarted(false);
    setMeasured(false);
    setRect(null);
    setPopoverStyle(null);
    if (markComplete) {
      setTourState("complete");
      markTourComplete().catch(() => {});
    }
  }, []);

  const advance = useCallback((dir: 1 | -1) => {
    setMeasured(false);
    // Note: NOT clearing `rect` here. The CSS `.tour-spotlight-transitioning`
    // class wants the rect to remain mounted so the new target's
    // coordinates animate from the old position rather than appearing
    // out of thin air. The acquire loop overwrites `rect` once the new
    // target is in the DOM, and the live-sync loop tracks it from there.
    setPopoverStyle(null);
    setFollowIndex(0);
    setReachedBottom(false);
    targetEl.current = null;
    setIndex((i) => Math.max(0, Math.min(TOUR_STEPS.length - 1, i + dir)));
  }, []);

  const onPrimary = useCallback(() => {
    if (step.kind === "navigate") {
      if (pathname === step.gotoRoute) advance(1); // already here → just continue (fixes back/forward)
      else router.push(step.gotoRoute);
      return;
    }
    if (step.kind === "finale" || index >= TOUR_STEPS.length - 1) {
      endTour(true);
      return;
    }
    advance(1);
  }, [step, index, pathname, router, advance, endTour]);

  // ── Spotlight transition window — animate between targets ──────────────────
  // Open a ~360ms window every time the step or follow-stage changes
  // during which the SVG rects get a CSS transition; outside the
  // window, the rects snap to live-sync updates so they stick tight
  // through scroll/reflow.
  useEffect(() => {
    if (!started) return;
    setTransitioning(true);
    const id = window.setTimeout(() => setTransitioning(false), 380);
    return () => window.clearTimeout(id);
  }, [started, index, followIndex]);

  // ── Navigate step: pulse the target link's background so it's
  // findable in a busy nav. Class lifecycle is bound to the step —
  // enter adds, exit removes. Only navigate steps get this; explain
  // and interactive already have the spotlight ring.
  useEffect(() => {
    if (!started || step.kind !== "navigate") return;
    const el = document.querySelector(step.target) as HTMLElement | null;
    if (!el) return;
    el.classList.add("tour-target-pulse");
    return () => el.classList.remove("tour-target-pulse");
  }, [started, step]);

  // ── Keep page-specific steps on their own page (fixes back/forward landing) ──
  useEffect(() => {
    if (!started || step.kind === "navigate") return;
    if (step.route && pathname !== step.route) router.push(step.route);
  }, [started, step, pathname, router]);

  // ── Advance navigate steps on arrival ─────────────────────────────────────────
  useEffect(() => {
    const prev = prevPath.current;
    prevPath.current = pathname;
    if (!started) return;
    if (step.kind === "navigate" && pathname === step.gotoRoute && prev !== step.gotoRoute) {
      advance(1);
    }
  }, [pathname, started, step, advance]);

  // ── Draft step: cycle through 5 demo queries (type → hold → backspace
  // → next) inside the controlled textarea. The form is React-controlled
  // so a direct `.value =` would be overwritten on the next render; we
  // go through the native value setter on the HTMLTextAreaElement
  // prototype + dispatch a bubbling `input` event, which is the standard
  // pattern React's synthetic event system listens for.
  //
  // The animation stops the moment the user focuses the textarea (so
  // they can take over without fighting our typing) and on cleanup the
  // textarea is cleared — unless we detect text that doesn't look like
  // any of our demo prefixes, which means the user typed something while
  // we were idle, and we should leave that alone.
  useEffect(() => {
    if (!started || step.id !== "draft") return;
    const proto = window.HTMLTextAreaElement?.prototype;
    const nativeSetter =
      proto && Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (!nativeSetter) return;

    let cancelled = false;
    const timers: number[] = [];
    const after = (ms: number, fn: () => void) => {
      const id = window.setTimeout(fn, ms);
      timers.push(id);
    };

    const setValue = (el: HTMLTextAreaElement, value: string) => {
      nativeSetter.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };

    const getEl = () =>
      document.querySelector(".search-textarea") as HTMLTextAreaElement | null;

    // Pause the animation if the user clicks into the textarea — they
    // get to take over without us thrashing their input.
    let textareaForFocusCleanup: HTMLTextAreaElement | null = null;
    const onFocus = () => {
      cancelled = true;
      timers.forEach(window.clearTimeout);
    };

    let queryIdx = 0;
    const typeQuery = (text: string, charIdx: number) => {
      if (cancelled) return;
      const el = getEl();
      if (!el) return;
      setValue(el, text.slice(0, charIdx));
      if (charIdx >= text.length) {
        after(DRAFT_HOLD_AFTER_TYPE_MS, () => deleteQuery(text, text.length));
      } else {
        after(DRAFT_TYPE_INTERVAL_MS, () => typeQuery(text, charIdx + 1));
      }
    };

    const deleteQuery = (text: string, charIdx: number) => {
      if (cancelled) return;
      const el = getEl();
      if (!el) return;
      setValue(el, text.slice(0, charIdx));
      if (charIdx <= 0) {
        queryIdx = (queryIdx + 1) % DRAFT_DEMO_QUERIES.length;
        after(DRAFT_PAUSE_BEFORE_NEXT_MS, () =>
          typeQuery(DRAFT_DEMO_QUERIES[queryIdx], 1),
        );
      } else {
        after(DRAFT_DELETE_INTERVAL_MS, () => deleteQuery(text, charIdx - 1));
      }
    };

    after(DRAFT_TYPE_START_DELAY_MS, () => {
      const el = getEl();
      if (!el || cancelled) return;
      textareaForFocusCleanup = el;
      el.addEventListener("focus", onFocus);
      typeQuery(DRAFT_DEMO_QUERIES[0], 1);
    });

    return () => {
      cancelled = true;
      timers.forEach(window.clearTimeout);
      textareaForFocusCleanup?.removeEventListener("focus", onFocus);
      const el = getEl();
      // Clear only if the current value still looks like one of our demo
      // queries — i.e., the user hasn't replaced it with their own text.
      if (
        el &&
        el.value.length > 0 &&
        DRAFT_DEMO_QUERIES.some((q) => q.startsWith(el.value))
      ) {
        setValue(el, "");
      }
    };
  }, [started, step]);

  // ── Scroll-gate: note when the user reaches the bottom (copy swaps; manual Next) ─
  useEffect(() => {
    if (!started || !isScrollGate) return;
    // Two failure modes the original `check()`-on-mount approach hit:
    //   1. The Insights page renders charts incrementally — on mount the
    //      document is still short, scrolledToBottom() returns true, and
    //      reachedBottom flips on before the user touches anything.
    //   2. A genuinely short page (no scrollbar) would have the user
    //      stuck if we only counted scroll events.
    // Solution: count only real scroll events for tall pages, but after a
    // grace window fall back to "if there's nothing to scroll, advance".
    let scrolledOnce = false;
    const onScroll = () => {
      scrolledOnce = true;
      if (scrolledToBottom()) setReachedBottom(true);
    };
    const fallbackId = window.setTimeout(() => {
      if (scrolledOnce) return;
      const el = document.scrollingElement || document.documentElement;
      const scrollable = el.scrollHeight - el.clientHeight > 50;
      if (!scrollable) setReachedBottom(true);
    }, 1500);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.clearTimeout(fallbackId);
      window.removeEventListener("scroll", onScroll);
    };
  }, [started, isScrollGate, index]);

  // ── Follow-along chain: each stage watches for its `appear` selector.
  // When it lands in the DOM, advance to the next stage so the ring +
  // copy jump onto it. Multi-stage chains (e.g. galaxy theme → pattern
  // → drawer) walk through one stage per appearance.
  useEffect(() => {
    if (!started) return;
    if (followIndex >= followChain.length) return;
    const nextStage = followChain[followIndex];
    if (!nextStage) return;
    const id = setInterval(() => {
      if (document.querySelector(nextStage.appear)) {
        setFollowIndex((i) => i + 1);
      }
    }, 250);
    return () => clearInterval(id);
  }, [started, followChain, followIndex]);

  // ── Acquire the target (find it, scroll into view, first measure) ─────────────
  useEffect(() => {
    if (!started) return;
    acquireCancel.current?.();
    acquireCancel.current = null;

    if (!wantsSpotlight) {
      setMeasured(true);
      setRect(null);
      targetEl.current = null;
      return;
    }

    const startTs = performance.now();
    let aborted = false;
    let raf = 0;

    const settle = (el: HTMLElement) => {
      targetEl.current = el;
      const r0 = el.getBoundingClientRect();
      if (r0.top < 0 || r0.bottom > window.innerHeight) {
        el.scrollIntoView({ block: "center", behavior: "auto" });
      }
      requestAnimationFrame(() => {
        if (aborted) return;
        const r = el.getBoundingClientRect();
        setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
        setMeasured(true);
      });
    };

    const tick = () => {
      if (aborted) return;
      const el = document.querySelector(target as string) as HTMLElement | null;
      if (el && el.getBoundingClientRect().width > 0) {
        settle(el);
        return;
      }
      if (performance.now() - startTs > ACQUIRE_TIMEOUT_MS) {
        setRect(null);
        setMeasured(true);
        return;
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    const cancel = () => {
      aborted = true;
      cancelAnimationFrame(raf);
    };
    acquireCancel.current = cancel;
    return cancel;
  }, [started, index, target, wantsSpotlight, pathname]);

  // ── Live sync: keep the ring glued to the element every frame (handles reflow) ─
  useEffect(() => {
    if (!started || !wantsSpotlight || !measured) return;
    let on = true;
    let raf = 0;
    const loop = () => {
      if (!on) return;
      let el = targetEl.current;
      if (!el || !document.contains(el)) {
        el = document.querySelector(target as string) as HTMLElement | null;
        targetEl.current = el;
      }
      if (el) {
        const r = el.getBoundingClientRect();
        setRect((prev) =>
          prev &&
          Math.abs(prev.top - r.top) < 0.5 &&
          Math.abs(prev.left - r.left) < 0.5 &&
          Math.abs(prev.width - r.width) < 0.5 &&
          Math.abs(prev.height - r.height) < 0.5
            ? prev
            : { top: r.top, left: r.left, width: r.width, height: r.height },
        );
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      on = false;
      cancelAnimationFrame(raf);
    };
  }, [started, wantsSpotlight, measured, target]);

  // ── Position popover ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!started || !measured) return;
    const pop = popoverRef.current;
    if (!pop) return;
    const vw = viewport.w || window.innerWidth;
    const vh = viewport.h || window.innerHeight;

    if (!rect || !wantsSpotlight || isFinale || isScrollGate || activePlacement === "center") {
      setPopoverStyle(null);
      return;
    }

    const pw = pop.offsetWidth;
    const ph = pop.offsetHeight;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let placement: Placement = activePlacement;

    if (placement === "bottom" && rect.top + rect.height + POPOVER_GAP + ph > vh) placement = "top";
    else if (placement === "top" && rect.top - POPOVER_GAP - ph < 0) placement = "bottom";
    if (placement === "right" && rect.left + rect.width + POPOVER_GAP + pw > vw) placement = "left";
    else if (placement === "left" && rect.left - POPOVER_GAP - pw < 0) placement = "right";

    let top = 0;
    let left = 0;
    switch (placement) {
      case "top":
        top = rect.top - POPOVER_GAP - ph;
        left = cx - pw / 2;
        break;
      case "bottom":
        top = rect.top + rect.height + POPOVER_GAP;
        left = cx - pw / 2;
        break;
      case "left":
        left = rect.left - POPOVER_GAP - pw;
        top = cy - ph / 2;
        break;
      case "right":
        left = rect.left + rect.width + POPOVER_GAP;
        top = cy - ph / 2;
        break;
      default:
        top = cy - ph / 2;
        left = cx - pw / 2;
    }
    left = Math.max(VIEWPORT_MARGIN, Math.min(left, vw - pw - VIEWPORT_MARGIN));
    top = Math.max(VIEWPORT_MARGIN, Math.min(top, vh - ph - VIEWPORT_MARGIN));
    setResolvedPlacement(placement);
    setPopoverStyle({ top, left });
  }, [started, measured, rect, index, wantsSpotlight, viewport, activePlacement, isFinale, isScrollGate]);

  // ── Keyboard ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!started) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        endTour(true);
      } else if (e.key === "ArrowRight" || e.key === "Enter") {
        e.preventDefault();
        onPrimary();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (index > 0) advance(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [started, onPrimary, advance, endTour, index]);

  // ── Confetti ───────────────────────────────────────────────────────────────────
  // Mix three shape variants (square / circle / ribbon) so the finale
  // reads as celebratory variety, not a mechanical grid of squares.
  // The shape is deterministic via index so the same piece keeps its
  // shape across re-renders during the animation lifetime.
  const confetti = useMemo(() => {
    if (!isFinale || !started) return [];
    const shapes = ["square", "circle", "ribbon"] as const;
    return Array.from({ length: 64 }, (_, i) => {
      const shape = shapes[i % shapes.length];
      const size = 6 + Math.round(Math.random() * 6);
      return {
        id: i,
        shape,
        left: Math.random() * 100,
        delay: Math.random() * 0.6,
        duration: 2.4 + Math.random() * 1.8,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        // Ribbons are taller than they are wide for visual contrast.
        width: shape === "ribbon" ? Math.max(3, Math.round(size * 0.45)) : size,
        height: shape === "ribbon" ? size + 6 : size,
        rotate: Math.round(Math.random() * 360),
      };
    });
  }, [isFinale, started]);

  // ── Render gates ────────────────────────────────────────────────────────────
  if (!started) return null;
  if (isAuthPage(pathname) || signedIn !== true) return null;

  const showDim = !isInteractive && !isScrollGate; // explain/navigate/finale dim; interactive & scroll-gate don't
  const dimPointer = isNavigate ? "none" : "auto";
  const showPopover = measured;
  const centered = isFinale || (!isScrollGate && (!measured || !rect || !wantsSpotlight || activePlacement === "center"));
  const padded =
    rect && wantsSpotlight && !isFinale
      ? {
          x: Math.max(rect.left - SPOTLIGHT_PAD, 0),
          y: Math.max(rect.top - SPOTLIGHT_PAD, 0),
          w: rect.width + SPOTLIGHT_PAD * 2,
          h: rect.height + SPOTLIGHT_PAD * 2,
        }
      : null;
  const caretSide = !centered && !isScrollGate ? CARET_SIDE[resolvedPlacement] : null;
  const primaryLabel = isNavigate ? "Take me there" : isFinale ? "Finish" : "Next";
  const bodyText =
    isScrollGate && reachedBottom
      ? "That's the whole page.\n\nClick **Next** to continue."
      : activeBody;
  const popoverClass = isScrollGate
    ? "tour-popover tour-popover-dock"
    : `tour-popover${centered ? " tour-popover-center" : ""}${isFinale ? " tour-popover-finale" : ""}`;

  // Next button is gated on the user actually doing the thing the step
  // asks for: scroll to the bottom (scrollGate) or walk through every
  // follow stage (interactive chain). Steps without an action gate
  // (navigate, plain explain, finale) always allow Next.
  const canAdvance = isScrollGate
    ? reachedBottom
    : step.kind === "interactive" && followChain.length > 0
      ? followIndex >= followChain.length
      : true;

  // Action hint pill — pulled from the active stage if we're following,
  // otherwise from the step itself. Rendered only while the user still
  // owes the engine an action (i.e., when Next is hidden anyway).
  const stepActionHint =
    step.kind === "interactive" ? step.actionHint : undefined;
  const actionHintText = activeStage ? activeStage.actionHint : stepActionHint;
  const showActionHint =
    step.kind === "interactive" && !!actionHintText && !canAdvance;

  return (
    <div className="tour-root" role="dialog" aria-modal="true" aria-label="Product tour">
      {showDim && (
        <svg
          className={`tour-backdrop${transitioning ? " tour-spotlight-transitioning" : ""}`}
          width="100%"
          height="100%"
          style={{ pointerEvents: dimPointer }}
        >
          <defs>
            <mask id="tour-mask">
              <rect x="0" y="0" width="100%" height="100%" fill="white" />
              {padded && (
                <rect x={padded.x} y={padded.y} width={padded.w} height={padded.h} rx="12" fill="black" />
              )}
            </mask>
          </defs>
          <rect
            x="0"
            y="0"
            width="100%"
            height="100%"
            fill="rgba(15,18,28,0.55)"
            mask="url(#tour-mask)"
            style={{ pointerEvents: dimPointer }}
          />
          {padded && (
            <>
              {/* Soft outer halo — wider, lower-opacity stroke renders
                  behind the main ring so the spotlight reads as "lit"
                  rather than a flat outline. */}
              <rect
                x={padded.x}
                y={padded.y}
                width={padded.w}
                height={padded.h}
                rx="12"
                fill="none"
                stroke="var(--primary)"
                strokeWidth="9"
                strokeOpacity="0.18"
                pointerEvents="none"
              />
              <rect
                x={padded.x}
                y={padded.y}
                width={padded.w}
                height={padded.h}
                rx="12"
                fill="none"
                stroke="var(--primary)"
                strokeWidth="2.5"
                pointerEvents="none"
              />
            </>
          )}
        </svg>
      )}

      {isInteractive && padded && (
        <svg
          className={`tour-ring-only${transitioning ? " tour-spotlight-transitioning" : ""}`}
          width="100%"
          height="100%"
          style={{ pointerEvents: "none" }}
        >
          {/* Outer halo + main ring, same pattern as the dim spotlight. */}
          <rect
            x={padded.x}
            y={padded.y}
            width={padded.w}
            height={padded.h}
            rx="12"
            fill="none"
            stroke="var(--primary)"
            strokeWidth="9"
            strokeOpacity="0.18"
          />
          <rect
            x={padded.x}
            y={padded.y}
            width={padded.w}
            height={padded.h}
            rx="12"
            fill="none"
            stroke="var(--primary)"
            strokeWidth="2.5"
          />
        </svg>
      )}

      {isFinale && (
        <div className="tour-confetti" aria-hidden="true">
          {confetti.map((c) => (
            <span
              key={c.id}
              className={`tour-confetti-piece tour-confetti-piece-${c.shape}`}
              style={{
                left: `${c.left}%`,
                width: c.width,
                height: c.height,
                background: c.color,
                animationDelay: `${c.delay}s`,
                animationDuration: `${c.duration}s`,
                transform: `rotate(${c.rotate}deg)`,
              }}
            />
          ))}
        </div>
      )}

      {showPopover && (
        <div
          ref={popoverRef}
          className={popoverClass}
          style={isScrollGate || centered ? undefined : popoverStyle ?? { visibility: "hidden" }}
        >
          {caretSide && <span className={`tour-caret tour-caret-${caretSide}`} />}
          {isFinale ? (
            <div className="tour-step-count">🎉 Done</div>
          ) : (
            <div
              className="tour-step-dots"
              role="progressbar"
              aria-valuemin={1}
              aria-valuemax={TOUR_STEPS.length}
              aria-valuenow={index + 1}
              aria-label={`Step ${index + 1} of ${TOUR_STEPS.length}`}
            >
              {TOUR_STEPS.map((_, i) => (
                <span
                  key={i}
                  className={`tour-step-dot ${
                    i < index
                      ? "tour-step-dot-done"
                      : i === index
                        ? "tour-step-dot-current"
                        : ""
                  }`}
                />
              ))}
            </div>
          )}
          <h3 className="tour-title">{activeTitle}</h3>
          {renderBody(bodyText)}
          {isScrollGate && !reachedBottom && <p className="tour-scroll-hint">↓ Scroll down to explore</p>}
          {showActionHint && <p className="tour-action-hint">{actionHintText}</p>}
          <div className="tour-bar">
            <div className="tour-bar-fill" style={{ width: `${((index + 1) / TOUR_STEPS.length) * 100}%` }} />
          </div>
          <div className="tour-actions">
            {!isFinale ? (
              <button className="tour-skip" onClick={() => endTour(true)}>
                Skip tour
              </button>
            ) : (
              <span />
            )}
            <div className="tour-btn-group">
              {index > 0 && !isFinale && (
                <button className="tour-back" onClick={() => advance(-1)}>
                  Back
                </button>
              )}
              {canAdvance && (
                <button className="tour-next" onClick={onPrimary}>
                  {primaryLabel}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
