"use client";

import PatternGraph from "@/components/PatternGraph";
import {
  parseNarrative,
  type Signal,
  type SignalPattern,
} from "@/lib/signals-api";

const PATTERN_TYPE_LABELS: Record<string, string> = {
  compounding_risk: "Compounding risk",
  coordinated_activity: "Coordinated activity",
  trend_shift: "Trend shift",
  convergence: "Convergence",
  regulatory_cascade: "Regulatory cascade",
  recall_to_litigation: "Recall to litigation",
  oversight_to_action: "Oversight to action",
};

const SOURCE_LABELS: Record<string, string> = {
  gao_protests: "GAO Bid Protest",
  epa_echo: "EPA ECHO",
  fda_warning_letters: "FDA Warning Letter",
  dhs_foia_log: "DHS FOIA Log",
  sec_litigation: "SEC Litigation",
  fda_recalls: "FDA Recall",
  fsis_recalls: "USDA FSIS Recall",
  cpsc_recalls: "CPSC Recall",
  nhtsa_recalls: "NHTSA Recall",
  doj_press: "DOJ Press",
  whitehouse_actions: "White House",
  ig_reports: "IG Report",
  cigie_reports: "CIGIE",
  congress_bills: "Congress.gov",
  courtlistener_opinions: "CourtListener",
  regulations_gov: "Regulations.gov",
  sam_gov: "SAM.gov",
  senate_lda: "Senate LDA",
  fec_enforcement: "FEC",
};

const FOIA_REQUEST_SOURCES = new Set(["dhs_foia_log"]);

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

/** Count the unique entities that appear in 2+ of these signals. The graph
 * draws an edge from a signal to every entity it cites; the bridges between
 * signals are the entities that show up more than once. */
function countSharedEntities(signals: Signal[]): number {
  const tally = new Map<string, number>();
  for (const s of signals) {
    for (const slug of s.entity_slugs || []) {
      tally.set(slug, (tally.get(slug) ?? 0) + 1);
    }
  }
  let shared = 0;
  for (const n of tally.values()) if (n >= 2) shared += 1;
  return shared;
}

interface Props {
  pattern: SignalPattern;
  signals: Signal[];
  // Render in compact (drawer) or full-page mode. Affects only spacing
  // wrappers; the inner content is identical.
  variant?: "page" | "drawer";
  /** When provided, clicking an entity in the graph layers the entity view
   * on top of the pattern view in the same drawer instead of navigating
   * to the standalone entity page. The drawer reads URL params and the
   * dashboard sets this callback only in drawer mode. */
  onEntitySelect?: (entityType: string, entitySlug: string) => void;
}

export default function PatternDetailContent({
  pattern,
  signals,
  variant = "page",
  onEntitySelect,
}: Props) {
  const typeLabel = PATTERN_TYPE_LABELS[pattern.pattern_type] || pattern.pattern_type;
  const narrative = parseNarrative(pattern.narrative);
  const sortedSignals = [...signals].sort(
    (a, b) => new Date(a.signal_date).getTime() - new Date(b.signal_date).getTime(),
  );

  // Caption above the graph: tells the reader what they're about to look at.
  const sharedEntityCount = countSharedEntities(signals);
  const captionParts: string[] = [
    `${signals.length} ${signals.length === 1 ? "government action" : "government actions"}`,
  ];
  if (sharedEntityCount > 0) {
    captionParts.push(
      `${sharedEntityCount} shared ${sharedEntityCount === 1 ? "entity" : "entities"}`,
    );
  }
  const caption = captionParts.join(" · tied together by ");

  function scrollToSignal(signalId: string) {
    // Prefer an in-content anchor; if none (e.g. drawer body), no-op silently.
    const el = document.getElementById(`signal-${signalId}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("signals-diagram-timeline-item-flash");
      setTimeout(() => el.classList.remove("signals-diagram-timeline-item-flash"), 1500);
    }
  }

  const wrapperClass =
    variant === "drawer"
      ? "signals-pattern-detail-content signals-pattern-detail-content-drawer"
      : "signals-pattern-detail-content";

  // Confidence pill. `high` is the default and renders nothing — only
  // `medium` gets a "tentative" badge so readers know to read it cautiously.
  const isTentative = pattern.confidence === "medium";

  return (
    <div className={wrapperClass}>
      <header className="signals-entity-header">
        <div className="signals-pattern-meta">
          <span className="signals-pattern-type">{typeLabel}</span>
          {isTentative && (
            <span
              className="signals-pattern-tentative-pill"
              title="Marked as medium confidence — based on 2 signals or claims that are partly inferential."
            >
              Tentative
            </span>
          )}
          <span className="signals-pattern-date">
            Generated {fmtDate(pattern.generated_at)}
          </span>
        </div>
        <h1 className="signals-entity-title">{pattern.title}</h1>
        {pattern.subtitle && (
          <p className="signals-pattern-subtitle">{pattern.subtitle}</p>
        )}

        {pattern.persona_tags.length > 0 && (
          <div className="signals-card-tags signals-pattern-detail-tags">
            {pattern.persona_tags.map((p) => (
              <span key={p} className="signals-persona-tag">
                {p.replace("_", " ")}
              </span>
            ))}
          </div>
        )}
      </header>

      {/* Caption + always-visible legend so a non-expert knows what the
          graph means. The legend is intentionally NOT collapsible — it costs
          two lines of vertical space and pays back in comprehension. */}
      <div className="signals-pattern-graph-caption">
        <span className="signals-pattern-graph-caption-text">
          Showing <strong>{caption}</strong>
        </span>
      </div>
      <div className="signals-pattern-graph-legend signals-pattern-graph-legend-open">
        <div className="signals-pattern-graph-legend-title">How to read this</div>
        <ul>
          <li>
            <span className="signals-pattern-graph-legend-dot signals-pattern-graph-legend-dot-signal" />
            <span>
              <strong>Colored dot</strong>: one government action. Each dot
              corresponds to a card in the timeline below. Color shows which
              source the action came from.
            </span>
          </li>
          <li>
            <span className="signals-pattern-graph-legend-dot signals-pattern-graph-legend-dot-entity" />
            <span>
              <strong>Filled circle</strong>: a shared entity (a company,
              agency, or person) that two or more actions reference. Click
              one to see every signal about that entity.
            </span>
          </li>
        </ul>
      </div>

      <PatternGraph
        mode="detail"
        pattern={pattern}
        signals={signals}
        onSignalClick={scrollToSignal}
        onEntitySelect={onEntitySelect}
        height={variant === "drawer" ? 360 : undefined}
      />

      {/* Structured narrative — three labeled sections for new patterns. */}
      {typeof narrative !== "string" ? (
        <section className="signals-pattern-narrative signals-pattern-narrative-structured">
          <div className="signals-pattern-narrative-section">
            <h3 className="signals-pattern-narrative-label">The story</h3>
            <p className="signals-pattern-narrative-story">{narrative.story}</p>
          </div>
          <div className="signals-pattern-narrative-section">
            <h3 className="signals-pattern-narrative-label">Why it matters</h3>
            <p className="signals-pattern-section-body">{narrative.why_it_matters}</p>
          </div>
          <div className="signals-pattern-narrative-section">
            <h3 className="signals-pattern-narrative-label">The evidence</h3>
            <p className="signals-pattern-section-body">{narrative.evidence}</p>
          </div>
        </section>
      ) : (
        // Legacy free-text narrative — render paragraphs as-is for back-compat.
        narrative.split(/\n\n+/).filter(Boolean).length > 0 && (
          <section className="signals-pattern-narrative">
            {narrative
              .split(/\n\n+/)
              .filter(Boolean)
              .map((para, i) => (
                <p key={i} className="signals-pattern-section-body">
                  {para}
                </p>
              ))}
          </section>
        )
      )}

      <ol className="signals-diagram-timeline">
        {sortedSignals.map((s) => {
          const sourceLabel = SOURCE_LABELS[s.source] || s.source;
          const kind = FOIA_REQUEST_SOURCES.has(s.source) ? "request" : "action";
          const kindLabel = kind === "request" ? "FOIA request filed" : "Agency action";
          return (
            <li
              key={s.id}
              id={`signal-${s.id}`}
              className="signals-diagram-timeline-item"
            >
              <div className="signals-diagram-timeline-date">
                {fmtShortDate(s.signal_date)}
              </div>
              <div className="signals-diagram-timeline-dot" aria-hidden="true" />
              <div className="signals-diagram-timeline-card">
                <div className="signals-card-meta">
                  <span className="signals-source-badge">{sourceLabel}</span>
                  <span className={`signals-kind-label signals-kind-${kind}`}>
                    {kindLabel}
                  </span>
                  <span className="signals-card-date">{fmtDate(s.signal_date)}</span>
                </div>
                <h4 className="signals-card-title">{s.title}</h4>
                {s.requester && (
                  <p className="signals-card-requester">
                    Filed by <strong>{s.requester}</strong>
                  </p>
                )}
                {s.summary && <p className="signals-card-summary">{s.summary}</p>}
                {s.source_url && (
                  <a
                    href={s.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="signals-card-link"
                  >
                    View source ↗
                  </a>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
