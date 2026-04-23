"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import PatternGraph from "@/components/PatternGraph";
import {
  fetchPatternDetail,
  type PatternDetail,
} from "@/lib/signals-api";

const PATTERN_TYPE_LABELS: Record<string, string> = {
  compounding_risk: "Compounding risk",
  coordinated_activity: "Coordinated activity",
  trend_shift: "Trend shift",
  convergence: "Convergence",
};

const SOURCE_LABELS: Record<string, string> = {
  gao_protests: "GAO Bid Protest",
  epa_echo: "EPA ECHO",
  fda_warning_letters: "FDA Warning Letter",
  dhs_foia_log: "DHS FOIA Log",
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

function PatternDetailInner() {
  const params = useParams();
  const id = (params.id as string) || "";

  const [data, setData] = useState<PatternDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    fetchPatternDetail(id)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <main className="signals-container">
        <p className="signals-empty">Loading pattern…</p>
      </main>
    );
  }

  if (error || !data || !data.pattern) {
    return (
      <main className="signals-container">
        <Link href="/signals/patterns" className="signals-back-link">
          ← Back to patterns
        </Link>
        <p className="signals-empty">{error || "Pattern not found."}</p>
      </main>
    );
  }

  const { pattern, signals } = data;
  const typeLabel = PATTERN_TYPE_LABELS[pattern.pattern_type] || pattern.pattern_type;
  const paragraphs = pattern.narrative.split(/\n\n+/).filter(Boolean);
  const sortedSignals = [...signals].sort(
    (a, b) => new Date(a.signal_date).getTime() - new Date(b.signal_date).getTime(),
  );

  function scrollToSignal(signalId: string) {
    const el = document.getElementById(`signal-${signalId}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("signals-diagram-timeline-item-flash");
      setTimeout(() => el.classList.remove("signals-diagram-timeline-item-flash"), 1500);
    }
  }

  return (
    <main className="signals-container">
      <Link href="/signals/patterns" className="signals-back-link">
        ← Back to all patterns
      </Link>

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
    </main>
  );
}

export default function PatternDetailPage() {
  return <PatternDetailInner />;
}
