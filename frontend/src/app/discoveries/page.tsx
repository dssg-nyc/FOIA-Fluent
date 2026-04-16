"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AuthGuard from "@/components/AuthGuard";
import {
  fetchMyDiscoveries,
  updateDiscovery,
  deleteDiscovery,
  type DiscoveredDocument,
  type DiscoveryStatus,
} from "@/lib/discoveries-api";
import { listRequests, type TrackedRequestDetail } from "@/lib/tracking-api";

const SOURCE_LABELS: Record<string, string> = {
  muckrock: "MuckRock",
  documentcloud: "DocumentCloud",
  web: "Web",
};

const STATUS_LABELS: Record<DiscoveryStatus, string> = {
  saved: "Saved",
  reviewed: "Reviewed",
  useful: "Useful",
  not_useful: "Not useful",
};

const ALL_STATUSES: DiscoveryStatus[] = ["saved", "reviewed", "useful", "not_useful"];

function fmtShortDate(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return iso;
  }
}

function DiscoveriesInner() {
  const [docs, setDocs] = useState<DiscoveredDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trackedRequests, setTrackedRequests] = useState<TrackedRequestDetail[]>([]);

  // Filter state
  const [statusFilter, setStatusFilter] = useState<DiscoveryStatus[]>([]);
  const [sourceFilter, setSourceFilter] = useState<string[]>([]);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Selection
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetchMyDiscoveries(),
      listRequests().catch(() => []),
    ])
      .then(([discoveriesRes, requestsRes]) => {
        setDocs(discoveriesRes.discoveries);
        if (discoveriesRes.discoveries.length > 0) {
          setSelectedId(discoveriesRes.discoveries[0].id);
        }
        setTrackedRequests(requestsRes);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  // Counts (computed from full list, so the rail always shows totals)
  const statusCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const d of docs) m[d.status] = (m[d.status] || 0) + 1;
    return m;
  }, [docs]);

  const sourceCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const d of docs) m[d.source] = (m[d.source] || 0) + 1;
    return m;
  }, [docs]);

  const allTags = useMemo(() => {
    const s = new Set<string>();
    for (const d of docs) for (const t of d.tags) s.add(t);
    return Array.from(s).sort();
  }, [docs]);

  // Filter
  const visible = useMemo(() => {
    let arr = docs;
    if (statusFilter.length > 0) arr = arr.filter((d) => statusFilter.includes(d.status));
    if (sourceFilter.length > 0) arr = arr.filter((d) => sourceFilter.includes(d.source));
    if (tagFilter) arr = arr.filter((d) => d.tags.includes(tagFilter));
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      arr = arr.filter(
        (d) =>
          d.title.toLowerCase().includes(q) ||
          d.description.toLowerCase().includes(q) ||
          d.note.toLowerCase().includes(q),
      );
    }
    return arr;
  }, [docs, statusFilter, sourceFilter, tagFilter, searchQuery]);

  // Keep selection valid
  useEffect(() => {
    if (visible.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !visible.find((d) => d.id === selectedId)) {
      setSelectedId(visible[0].id);
    }
  }, [visible, selectedId]);

  const selected = visible.find((d) => d.id === selectedId) || null;

  function toggleStatus(s: DiscoveryStatus) {
    setStatusFilter((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s],
    );
  }
  function toggleSource(src: string) {
    setSourceFilter((prev) =>
      prev.includes(src) ? prev.filter((x) => x !== src) : [...prev, src],
    );
  }

  async function handleStatusChange(id: string, newStatus: DiscoveryStatus) {
    try {
      const updated = await updateDiscovery(id, { status: newStatus });
      setDocs((prev) => prev.map((d) => (d.id === id ? updated : d)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    }
  }

  async function handleNoteChange(id: string, note: string) {
    try {
      const updated = await updateDiscovery(id, { note });
      setDocs((prev) => prev.map((d) => (d.id === id ? updated : d)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Remove this from your library?")) return;
    try {
      await deleteDiscovery(id);
      setDocs((prev) => prev.filter((d) => d.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  }

  async function handleLinkChange(id: string, trackedRequestId: string | null) {
    try {
      const updated = await updateDiscovery(id, { tracked_request_id: trackedRequestId });
      setDocs((prev) => prev.map((d) => (d.id === id ? updated : d)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Link update failed");
    }
  }

  return (
    <main className="container-wide">
      <header className="signals-header">
        <span className="signals-eyebrow">Your research library</span>
        <h1 className="signals-page-title">My Discoveries</h1>
        <p className="signals-page-sub">
          Documents you&rsquo;ve saved from the Discover &amp; Draft search. Mark each one as
          you review it, take notes, and link them to a tracked FOIA request.
        </p>
      </header>

      {loading && <p className="signals-empty">Loading your library…</p>}
      {error && <p className="signals-empty">Error: {error}</p>}

      {!loading && !error && docs.length === 0 && (
        <div className="discoveries-empty-state">
          <h2 className="discoveries-empty-title">Nothing saved yet</h2>
          <p className="discoveries-empty-body">
            Start by running a search on the{" "}
            <Link href="/draft" className="signals-card-link">
              Discover &amp; Draft
            </Link>{" "}
            page. Click any result and hit Save to add it to your library.
          </p>
        </div>
      )}

      {!loading && !error && docs.length > 0 && (
        <div className="discover-three-pane">
          {/* LEFT RAIL */}
          <aside className="discover-rail">
            <div className="discover-rail-section">
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search your library…"
                className="discoveries-search-input"
              />
            </div>

            <div className="discover-rail-section">
              <div className="discover-rail-label">Status</div>
              <ul className="discover-rail-list">
                {ALL_STATUSES.map((s) => {
                  const count = statusCounts[s] || 0;
                  if (count === 0) return null;
                  const active = statusFilter.includes(s);
                  return (
                    <li key={s}>
                      <button
                        type="button"
                        className={`discover-rail-btn ${active ? "discover-rail-btn-active" : ""}`}
                        onClick={() => toggleStatus(s)}
                      >
                        <span className="discover-rail-btn-name">{STATUS_LABELS[s]}</span>
                        <span className="discover-rail-btn-count">{count}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>

            {Object.keys(sourceCounts).length > 1 && (
              <div className="discover-rail-section">
                <div className="discover-rail-label">Source</div>
                <ul className="discover-rail-list">
                  {Object.entries(sourceCounts).map(([src, count]) => {
                    const active = sourceFilter.includes(src);
                    return (
                      <li key={src}>
                        <button
                          type="button"
                          className={`discover-rail-btn ${active ? "discover-rail-btn-active" : ""}`}
                          onClick={() => toggleSource(src)}
                        >
                          <span className="discover-rail-btn-name">
                            {SOURCE_LABELS[src] || src}
                          </span>
                          <span className="discover-rail-btn-count">{count}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {allTags.length > 0 && (
              <div className="discover-rail-section">
                <div className="discover-rail-label">Tags</div>
                <ul className="discover-rail-list">
                  {allTags.map((t) => (
                    <li key={t}>
                      <button
                        type="button"
                        className={`discover-rail-btn ${tagFilter === t ? "discover-rail-btn-active" : ""}`}
                        onClick={() => setTagFilter(tagFilter === t ? null : t)}
                      >
                        <span className="discover-rail-btn-name">{t}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </aside>

          {/* MIDDLE — row list */}
          <section className="discover-row-list">
            <div className="discover-row-list-header">
              {visible.length} {visible.length === 1 ? "document" : "documents"}
              {(statusFilter.length > 0 ||
                sourceFilter.length > 0 ||
                tagFilter ||
                searchQuery.trim()) &&
                ` (filtered from ${docs.length})`}
            </div>
            <ul className="discover-rows">
              {visible.map((d) => (
                <li key={d.id}>
                  <DiscoveryLibraryRow
                    doc={d}
                    selected={selectedId === d.id}
                    onClick={() => setSelectedId(d.id)}
                  />
                </li>
              ))}
            </ul>
          </section>

          {/* RIGHT — detail pane */}
          <DiscoveryLibraryDetailPane
            doc={selected}
            trackedRequests={trackedRequests}
            onStatusChange={handleStatusChange}
            onNoteChange={handleNoteChange}
            onDelete={handleDelete}
            onLinkChange={handleLinkChange}
          />
        </div>
      )}
    </main>
  );
}

function DiscoveryLibraryRow({
  doc,
  selected,
  onClick,
}: {
  doc: DiscoveredDocument;
  selected: boolean;
  onClick: () => void;
}) {
  const sourceLabel = SOURCE_LABELS[doc.source] || doc.source;
  return (
    <button
      type="button"
      className={`discover-row ${selected ? "discover-row-selected" : ""}`}
      onClick={onClick}
    >
      <span className="discover-row-headline">{doc.title}</span>
      <span className="discover-row-meta">
        <span className="discover-row-source">{sourceLabel}</span>
        {doc.agency && (
          <>
            <span className="discover-row-meta-dot">·</span>
            <span>{doc.agency}</span>
          </>
        )}
        <span className="discover-row-meta-dot">·</span>
        <span>{STATUS_LABELS[doc.status]}</span>
        <span className="discover-row-meta-dot">·</span>
        <span>Saved {fmtShortDate(doc.saved_at)}</span>
      </span>
    </button>
  );
}

function DiscoveryLibraryDetailPane({
  doc,
  trackedRequests,
  onStatusChange,
  onNoteChange,
  onDelete,
  onLinkChange,
}: {
  doc: DiscoveredDocument | null;
  trackedRequests: TrackedRequestDetail[];
  onStatusChange: (id: string, status: DiscoveryStatus) => Promise<void>;
  onNoteChange: (id: string, note: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onLinkChange: (id: string, trackedRequestId: string | null) => Promise<void>;
}) {
  const [noteDraft, setNoteDraft] = useState("");
  const [noteSavedAt, setNoteSavedAt] = useState<number | null>(null);

  // Reset draft when selection changes
  useEffect(() => {
    setNoteDraft(doc?.note || "");
    setNoteSavedAt(null);
  }, [doc?.id, doc?.note]);

  if (!doc) {
    return (
      <aside className="discover-detail-pane discover-detail-pane-empty">
        <div className="discover-detail-empty-inner">
          Select a document from the list to view it.
        </div>
      </aside>
    );
  }

  const sourceLabel = SOURCE_LABELS[doc.source] || doc.source;

  async function handleSaveNote() {
    if (!doc) return;
    await onNoteChange(doc.id, noteDraft);
    setNoteSavedAt(Date.now());
    setTimeout(() => setNoteSavedAt(null), 2000);
  }

  return (
    <aside className="discover-detail-pane">
      <div className="discover-detail-meta">
        <span className="discover-detail-badge">{sourceLabel}</span>
        {doc.document_date && (
          <span className="discover-detail-date">{fmtShortDate(doc.document_date)}</span>
        )}
      </div>

      <h2 className="discover-detail-title">{doc.title}</h2>

      {(doc.agency || doc.page_count != null) && (
        <dl className="discover-detail-facts">
          {doc.agency && (
            <div className="discover-detail-fact">
              <dt>Agency</dt>
              <dd>{doc.agency}</dd>
            </div>
          )}
          {doc.page_count != null && (
            <div className="discover-detail-fact">
              <dt>Pages</dt>
              <dd>{doc.page_count}</dd>
            </div>
          )}
          {doc.discovered_via_query && (
            <div className="discover-detail-fact">
              <dt>From query</dt>
              <dd>{doc.discovered_via_query}</dd>
            </div>
          )}
        </dl>
      )}

      {doc.description && (
        <p className="discover-detail-description">{doc.description}</p>
      )}

      <div className="discover-detail-note-form">
        <label className="discover-detail-note-label">Status</label>
        <select
          className="discover-detail-note-select"
          value={doc.status}
          onChange={(e) => onStatusChange(doc.id, e.target.value as DiscoveryStatus)}
        >
          {ALL_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>

        <label className="discover-detail-note-label">Linked tracked request</label>
        <select
          className="discover-detail-note-select"
          value={doc.tracked_request_id || ""}
          onChange={(e) => onLinkChange(doc.id, e.target.value || null)}
        >
          <option value="">Not linked</option>
          {trackedRequests.map((r) => (
            <option key={r.request.id} value={r.request.id}>
              {r.request.title || `Request ${r.request.id.slice(0, 8)}`}
            </option>
          ))}
        </select>

        <label className="discover-detail-note-label">Note</label>
        <textarea
          className="discover-detail-note-textarea"
          value={noteDraft}
          onChange={(e) => setNoteDraft(e.target.value)}
          placeholder="Why this matters, what to look for, follow-ups…"
          rows={4}
        />
        <div className="discover-detail-note-actions">
          <button
            type="button"
            className={`discover-detail-btn discover-detail-btn-primary ${
              noteSavedAt ? "discover-detail-btn-just-saved" : ""
            }`}
            onClick={handleSaveNote}
            disabled={noteDraft === doc.note && !noteSavedAt}
          >
            {noteSavedAt ? (
              <span className="discover-saved-flash">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Saved
              </span>
            ) : (
              "Save note"
            )}
          </button>
          <button
            type="button"
            className="discover-detail-btn discover-detail-btn-danger"
            onClick={() => onDelete(doc.id)}
          >
            Remove from library
          </button>
        </div>
      </div>

      {doc.url && (
        <a
          href={doc.url}
          target="_blank"
          rel="noopener noreferrer"
          className="discover-detail-source-link"
        >
          Open original source ↗
        </a>
      )}
    </aside>
  );
}

export default function DiscoveriesPage() {
  return (
    <AuthGuard>
      <DiscoveriesInner />
    </AuthGuard>
  );
}
