"use client";

/**
 * Landing-page motion primitives (route "/" only).
 *
 * Hand-rolled instead of a library (rough-notation / AOS / three.js) so the
 * scroll behavior is exactly controllable and adds zero dependencies:
 *  - <Anno>        hand-drawn circle/underline that DRAWS ITSELF when the
 *                  word scrolls into view (civicsandbox-style annotation)
 *  - <Reveal>      fade+rise wrapper triggered by scroll position
 *  - <CountUp>     stat number that counts up when scrolled into view
 *  - <TiltShot>    3D-perspective screenshot that flattens as you scroll
 *  - <FloatingPapers>  decorative CSS-3D "documents" with scroll parallax
 *
 * Every effect is disabled under prefers-reduced-motion (CSS side) and all
 * observers fire once, so re-scrolling never re-janks the page.
 */

import {
  ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

function useInView<T extends HTMLElement>(threshold = 0.4): [React.RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setInView(true);
          io.disconnect();
        }
      },
      { threshold, rootMargin: "0px 0px -10% 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);
  return [ref, inView];
}

/* ── Hand-drawn annotations ──────────────────────────────────────────────── */

// Slightly wobbly shapes, rough-notation style. pathLength=1 normalizes the
// stroke so the CSS dashoffset draw works regardless of path geometry.
const CIRCLE_PATH =
  "M163 13 C79 8 20 32 23 62 C26 96 106 113 181 108 C257 103 304 83 299 52 C294 20 213 4 138 12";
const UNDERLINE_PATH =
  "M6 15 C60 8 178 7 234 11 M232 16 C180 20 92 21 10 18";

export function Anno({
  children,
  type = "underline",
  delay = 0,
}: {
  children: ReactNode;
  type?: "circle" | "underline";
  delay?: number;
}) {
  const [ref, inView] = useInView<HTMLSpanElement>(0.9);
  return (
    <span
      ref={ref}
      className={`lp-anno lp-anno-${type} ${inView ? "lp-anno-on" : ""}`}
      style={{ ["--anno-delay" as string]: `${delay}ms` }}
    >
      {children}
      {type === "circle" ? (
        <svg className="lp-anno-svg" viewBox="0 0 320 120" preserveAspectRatio="none" aria-hidden="true">
          <path d={CIRCLE_PATH} pathLength={1} />
        </svg>
      ) : (
        <svg className="lp-anno-svg" viewBox="0 0 240 24" preserveAspectRatio="none" aria-hidden="true">
          <path d={UNDERLINE_PATH} pathLength={1} />
        </svg>
      )}
    </span>
  );
}

/* ── Scroll reveal ───────────────────────────────────────────────────────── */

export function Reveal({
  children,
  delay = 0,
  className = "",
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const [ref, inView] = useInView<HTMLDivElement>(0.15);
  return (
    <div
      ref={ref}
      className={`lp-reveal ${inView ? "lp-in" : ""} ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

/* ── Stat counter ────────────────────────────────────────────────────────── */

export function CountUp({
  value,
  prefix = "",
  suffix = "",
  duration = 1400,
}: {
  value: number;
  prefix?: string;
  suffix?: string;
  duration?: number;
}) {
  const [ref, inView] = useInView<HTMLSpanElement>(0.8);
  const [display, setDisplay] = useState(0);
  const started = useRef(false);

  useEffect(() => {
    if (!inView || started.current) return;
    started.current = true;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setDisplay(value);
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
      setDisplay(Math.round(value * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, value, duration]);

  return (
    <span ref={ref}>
      {prefix}
      {display.toLocaleString("en-US")}
      {suffix}
    </span>
  );
}

/* ── 3D tilt hero shot (flattens as you scroll) ──────────────────────────── */

export function TiltShot({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  const onScroll = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // 14° tilt at top of page, easing to flat over the first ~520px of scroll.
    const p = Math.min(1, Math.max(0, window.scrollY / 520));
    const deg = 14 * (1 - p);
    el.style.transform = `perspective(1400px) rotateX(${deg}deg)`;
  }, []);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const handler = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(onScroll);
    };
    onScroll();
    window.addEventListener("scroll", handler, { passive: true });
    return () => {
      window.removeEventListener("scroll", handler);
      cancelAnimationFrame(raf);
    };
  }, [onScroll]);

  return (
    <div className="lp-tilt-wrap">
      <div ref={ref} className="lp-tilt">
        {children}
      </div>
    </div>
  );
}

/* ── Floating 3D papers (hero decoration, scroll parallax) ───────────────── */

export function FloatingPapers() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        ref.current?.style.setProperty("--sy", String(window.scrollY));
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  // Each sheet is a released record: an agency header bar, body lines, and
  // one or two blacked-out passages. The redactions are what make the
  // papers legible as documents at a glance — plain grey rules on a white
  // card had no contrast against the hero's near-white background.
  return (
    <div ref={ref} className="lp-papers" aria-hidden="true">
      <div className="lp-paper lp-paper-1">
        <span className="lp-paper-stamp" />
        <span /><span className="lp-redact" /><span /><span />
      </div>
      <div className="lp-paper lp-paper-2">
        <span className="lp-paper-stamp" />
        <span /><span /><span className="lp-redact" />
        <span /><span className="lp-redact lp-redact-short" />
      </div>
      <div className="lp-paper lp-paper-3">
        <span className="lp-paper-stamp" />
        <span /><span className="lp-redact" /><span />
      </div>
    </div>
  );
}
