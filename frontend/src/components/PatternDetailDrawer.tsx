"use client";

import { useEffect, useState } from "react";
import EntityDetailContent from "@/components/EntityDetailContent";
import PatternDetailContent from "@/components/PatternDetailContent";
import {
  fetchPatternDetail,
  type PatternDetail,
} from "@/lib/signals-api";

/** A side panel that can show either a pattern detail OR an entity detail.
 *
 * Inputs are URL-derived (the dashboard reads `?pattern=` and `?entity=`
 * from `searchParams` and forwards them here). When BOTH are set, the entity
 * view sits on top of the pattern view and the panel's back-arrow pops
 * back to the pattern. When only one is set, the back-arrow is the close X.
 *
 * The whole point of this component: clicking an entity from inside the
 * pattern graph used to navigate to a separate /signals/entity/... page,
 * which broke "Back" because the dashboard page had to remount and
 * rehydrate state. Now everything happens within the same /signals page,
 * driven entirely by query params. Browser back/forward works for free.
 */
interface Props {
  patternId: string | null;
  entityType: string | null;
  entitySlug: string | null;
  /** Close the whole drawer (e.g. user clicked the × or pressed Esc). */
  onClose: () => void;
  /** Pop the entity off the stack so the pattern is visible again. Only
   * called when an entity is on top of a pattern. */
  onPopEntity: () => void;
  /** Push an entity onto the stack (e.g. user clicked an entity node in the
   * pattern's detail graph). */
  onEntitySelect: (entityType: string, entitySlug: string) => void;
}

export default function PatternDetailDrawer({
  patternId,
  entityType,
  entitySlug,
  onClose,
  onPopEntity,
  onEntitySelect,
}: Props) {
  const [data, setData] = useState<PatternDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch pattern detail when patternId changes. We always fetch the pattern
  // even when an entity is layered on top, so popping back to the pattern
  // view is instant.
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

  // ESC closes (or pops, if an entity is on top).
  useEffect(() => {
    if (!patternId && !entitySlug) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (entitySlug && patternId) onPopEntity();
      else onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [patternId, entitySlug, onClose, onPopEntity]);

  // Drawer is open if either layer is active.
  if (!patternId && !entitySlug) return null;

  const showingEntity = !!(entityType && entitySlug);

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
        aria-label={showingEntity ? "Entity details" : "Pattern details"}
      >
        <button
          type="button"
          className="signals-drawer-close"
          onClick={onClose}
          aria-label="Close"
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
          {showingEntity && entityType && entitySlug ? (
            <>
              {patternId && (
                <button
                  type="button"
                  className="signals-drawer-back-pill"
                  onClick={onPopEntity}
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
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                  Back to pattern
                </button>
              )}
              <EntityDetailContent
                entityType={entityType}
                entitySlug={entitySlug}
                variant="drawer"
              />
            </>
          ) : loading ? (
            <p className="signals-empty">Loading pattern…</p>
          ) : error ? (
            <p className="signals-empty">{error}</p>
          ) : data?.pattern ? (
            <PatternDetailContent
              pattern={data.pattern}
              signals={data.signals}
              variant="drawer"
              onEntitySelect={onEntitySelect}
            />
          ) : null}
        </div>
      </aside>
    </>
  );
}
