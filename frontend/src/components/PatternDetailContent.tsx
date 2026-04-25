"use client";

import PatternGraph from "@/components/PatternGraph";
import type { Signal, SignalPattern } from "@/lib/signals-api";

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

interface Props {
  pattern: SignalPattern;
  signals: Signal[];
  // Render in compact (drawer) or full-page mode. Affects only spacing
  // wrappers; the inner content is identical.
  variant?: "page" | "drawer";
}

export default function PatternDetailContent({ pattern, signals, variant = "page" }: Props) {
  const typeLabel = PATTERN_TYPE_LABELS[pattern.pattern_type] || pattern.pattern_type;
  const paragraphs = pattern.narrative.split(/\n\n+/).filter(Boolean);
  const sortedSignals = [...signals].sort(
    (a, b) => new Date(a.signal_date).getTime() - new Date(b.signal_date).getTime(),
  );

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

  return (
    <div className={wrapperClass}>
      <header className="signals-entity-header">
        <div className="signals-pattern-meta">
          <span className="signals-pattern-type">{typeLabel}</span>
          <span className="signals-pattern-date">
            Generated {fmtDate(pattern.generated_at)}
          </span>
        </div>
        <h1 className="signals-entity-title">{pattern.title}</h1>

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

      <PatternGraph
        mode="detail"
        pattern={pattern}
        signals={signals}
        onSignalClick={scrollToSignal}
        height={variant === "drawer" ? 360 : undefined}
      />

      {paragraphs.length > 0 && (
        <section className="signals-pattern-narrative">
          {paragraphs.map((para, i) => (
            <p key={i} className="signals-pattern-section-body">
              {para}
            </p>
          ))}
        </section>
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
