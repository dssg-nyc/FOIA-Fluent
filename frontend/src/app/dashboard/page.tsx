"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { listRequests, deleteRequest, TrackedRequestDetail } from "@/lib/tracking-api";
import AuthGuard from "@/components/AuthGuard";
import ConfirmModal from "@/components/ConfirmModal";

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  submitted: "Submitted",
  awaiting_response: "Awaiting Response",
  responded: "Responded",
  partial: "Partial",
  denied: "Denied",
  appealed: "Appealed",
  fulfilled: "Fulfilled",
};

const STATUS_COLORS: Record<string, string> = {
  draft: "status-draft",
  submitted: "status-submitted",
  awaiting_response: "status-awaiting",
  responded: "status-responded",
  partial: "status-partial",
  denied: "status-denied",
  appealed: "status-appealed",
  fulfilled: "status-fulfilled",
};

type Filter = "all" | "active" | "overdue" | "completed";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function Dashboard() {
  const [items, setItems] = useState<TrackedRequestDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null);

  const refresh = () => listRequests().then(setItems).catch((e) => setError(e.message));

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, []);

  async function handleDelete(id: string, title: string) {
    setDeleteTarget({ id, title });
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    try {
      await deleteRequest(deleteTarget.id);
      setDeleteTarget(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete");
      setDeleteTarget(null);
    }
  }

  const filtered = items.filter((item) => {
    const status = item.request.status;
    if (filter === "active")
      return ["submitted", "awaiting_response", "responded", "partial", "appealed"].includes(status);
    if (filter === "overdue") return item.deadline?.is_overdue === true;
    if (filter === "completed") return ["fulfilled", "denied"].includes(status);
    return true;
  });

  // Sort: overdue first, then by updated_at desc
  const sorted = [...filtered].sort((a, b) => {
    const aOver = a.deadline?.is_overdue ? 1 : 0;
    const bOver = b.deadline?.is_overdue ? 1 : 0;
    if (aOver !== bOver) return bOver - aOver;
    return b.request.updated_at.localeCompare(a.request.updated_at);
  });

  return (
    <AuthGuard>
    <main className="container">
      <div className="dashboard-header">
        <div>
          <h1 className="dashboard-title">Track your records requests</h1>
          <p className="dashboard-subtitle">
            Monitor deadlines, manage responses, and keep every request moving.
          </p>
        </div>
        <div className="dashboard-actions">
          <Link href="/import" className="wizard-cancel">
            Add Existing Request
          </Link>
          <Link href="/" className="draft-button">
            + New Request
          </Link>
        </div>
      </div>

      <div className="filter-tabs">
        {(["all", "active", "overdue", "completed"] as Filter[]).map((f) => (
          <button
            key={f}
            className={`filter-tab ${filter === f ? "filter-tab-active" : ""}`}
            onClick={() => setFilter(f)}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
            {f === "overdue" && items.filter((i) => i.deadline?.is_overdue).length > 0 && (
              <span className="overdue-badge">
                {items.filter((i) => i.deadline?.is_overdue).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {loading && <p className="loading-text">Loading requests...</p>}
      {error && <div className="error-message">{error}</div>}

      {!loading && sorted.length === 0 && (
        <div className="empty-state">
          <p>No requests found.</p>
          {filter === "all" ? (
            <Link href="/" className="draft-button">
              Draft your first FOIA request
            </Link>
          ) : (
            <button className="wizard-cancel" onClick={() => setFilter("all")}>
              Show all requests
            </button>
          )}
        </div>
      )}

      <ul className="dashboard-list">
        {sorted.map((item) => (
          <RequestRow key={item.request.id} item={item} onDelete={handleDelete} />
        ))}
      </ul>
      {deleteTarget && (
        <ConfirmModal
          title="Delete request"
          message={`Are you sure you want to delete "${deleteTarget.title}"? This cannot be undone.`}
          onConfirm={confirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </main>
    </AuthGuard>
  );
}

function RequestRow({ item, onDelete }: { item: TrackedRequestDetail; onDelete: (id: string, title: string) => void }) {
  const { request, deadline } = item;
  const isOverdue = deadline?.is_overdue;

  return (
    <li className={`dashboard-row ${isOverdue ? "row-overdue" : ""}`}>
      <Link href={`/requests/${request.id}`} className="dashboard-row-link">
        <div className="dashboard-row-main">
          <div className="dashboard-row-title">{request.title}</div>
          <div className="dashboard-row-meta">
            <span className="agency-tag">{request.agency.abbreviation}</span>
            <span className={`status-badge ${STATUS_COLORS[request.status] || ""}`}>
              {STATUS_LABELS[request.status] || request.status}
            </span>
          </div>
        </div>

        <div className="dashboard-row-right">
          {deadline ? (
            <div className={`deadline-label ${isOverdue ? "deadline-overdue" : "deadline-ok"}`}>
              {deadline.status_label}
            </div>
          ) : request.status === "draft" ? (
            <div className="deadline-label deadline-draft">Not yet submitted</div>
          ) : null}
          <div className="dashboard-row-date">
            Filed: {formatDate(request.filed_date)}
          </div>
        </div>
      </Link>
      <button
        className="dashboard-row-delete"
        onClick={(e) => { e.preventDefault(); onDelete(request.id, request.title); }}
        title="Delete request"
      >
        ×
      </button>
    </li>
  );
}
