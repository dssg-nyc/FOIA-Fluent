"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  fetchEntity,
  fetchEntitySignals,
  type EntityBio,
  type Signal,
} from "@/lib/signals-api";

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

function EntityPageInner() {
  const params = useParams();
  const entityType = (params.type as string) || "";
  const entitySlug = (params.slug as string) || "";

  const [bio, setBio] = useState<EntityBio | null>(null);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!entityType || !entitySlug) return;
    Promise.all([
      fetchEntity(entityType, entitySlug),
      fetchEntitySignals(entityType, entitySlug, 200),
    ])
      .then(([b, s]) => {
        setBio(b);
        setSignals(s.signals);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [entityType, entitySlug]);

  // Group signals by source so the user can see cross-source breakdown at a glance
  const sourceCounts: Record<string, number> = {};
  for (const s of signals) {
    sourceCounts[s.source] = (sourceCounts[s.source] || 0) + 1;
  }
  const sourceList = Object.entries(sourceCounts).sort((a, b) => b[1] - a[1]);

  return (
    <main className="signals-container">
      <Link href="/signals/feed" className="signals-back-link">
        ← Back to feed
      </Link>

      {loading && <p className="signals-empty">Loading entity…</p>}
      {error && <p className="signals-empty">Error: {error}</p>}

      {!loading && !error && bio && (
        <>
          <header className="signals-entity-header">
            <span className="signals-eyebrow">{entityType.replace("_", " ")}</span>
            <h1 className="signals-entity-title">{bio.display_name}</h1>
            {bio.bio && <p className="signals-entity-bio">{bio.bio}</p>}
            <div className="signals-entity-meta">
              <span className="signals-entity-stat">
                <strong>{bio.signal_count}</strong>{" "}
                {bio.signal_count === 1 ? "signal" : "signals"} on file
              </span>
              {sourceList.length > 1 && (
                <span className="signals-entity-stat">
                  across <strong>{sourceList.length}</strong> sources
                </span>
              )}
            </div>
            {sourceList.length > 0 && (
              <div className="signals-entity-source-row">
                {sourceList.map(([source, count]) => (
                  <span key={source} className="signals-source-badge">
                    {SOURCE_LABELS[source] || source} · {count}
                  </span>
                ))}
              </div>
            )}
          </header>

          {signals.length === 0 ? (
            <p className="signals-empty">No signals on file for this entity.</p>
          ) : (
            <div className="signals-feed">
              <h2 className="signals-day-heading">Timeline</h2>
              <div className="signals-day-cards">
                {signals.map((s) => {
                  const sourceLabel = SOURCE_LABELS[s.source] || s.source;
                  const kind = FOIA_REQUEST_SOURCES.has(s.source) ? "request" : "action";
                  const kindLabel =
                    kind === "request" ? "FOIA request filed" : "Agency action";
                  return (
                    <article key={s.id} className="signals-card">
                      <div className="signals-card-meta">
                        <span className="signals-source-badge">{sourceLabel}</span>
                        <span className={`signals-kind-label signals-kind-${kind}`}>
                          {kindLabel}
                        </span>
                        <span className="signals-card-date">
                          {fmtDate(s.signal_date)}
                        </span>
                      </div>
                      <h3 className="signals-card-title">{s.title}</h3>
                      {s.requester && (
                        <p className="signals-card-requester">
                          Filed by <strong>{s.requester}</strong>
                        </p>
                      )}
                      {s.summary && (
                        <p className="signals-card-summary">{s.summary}</p>
                      )}
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
                    </article>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </main>
  );
}

export default function EntityPage() {
  return <EntityPageInner />;
}
