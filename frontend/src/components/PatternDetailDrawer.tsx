"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import PatternDetailContent from "@/components/PatternDetailContent";
import {
  fetchPatternDetail,
  type PatternDetail,
} from "@/lib/signals-api";

interface Props {
  patternId: string | null;
  onClose: () => void;
}

export default function PatternDetailDrawer({ patternId, onClose }: Props) {
  const [data, setData] = useState<PatternDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch when patternId changes; clear stale state immediately so the
  // previous pattern doesn't flash before the new one loads.
  useEffect(() => {
    if (!patternId) {
      setData(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    setData(null);
    let cancelled = false;
    fetchPatternDetail(patternId)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [patternId]);

  // ESC closes
  useEffect(() => {
    if (!patternId) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [patternId, onClose]);

  if (!patternId) return null;

  return (
    <>
      <div
        className="signals-drawer-overlay"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className="signals-drawer signals-pattern-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Pattern details"
      >
        <button
          type="button"
          className="signals-drawer-close"
          onClick={onClose}
          aria-label="Close pattern detail panel"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        <div className="signals-drawer-inner signals-pattern-drawer-inner">
          {loading && <p className="signals-empty">Loading pattern…</p>}

          {!loading && error && (
            <p className="signals-empty">{error}</p>
          )}

          {!loading && !error && data?.pattern && (
            <>
              <Link
                href={`/signals/patterns/${data.pattern.id}`}
                className="signals-pattern-drawer-fullpage-link"
              >
                Open full page ↗
              </Link>
              <PatternDetailContent
                pattern={data.pattern}
                signals={data.signals}
                variant="drawer"
              />
            </>
          )}
        </div>
      </aside>
    </>
  );
}
