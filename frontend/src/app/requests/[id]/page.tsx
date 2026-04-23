"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  getRequest,
  updateRequest,
  analyzeResponse,
  generateLetter,
  addCommunication,
  updateCommunication,
  deleteCommunication,
  TrackedRequestDetail,
  Communication,
  ResponseAnalysis,
} from "@/lib/tracking-api";
import { fetchMyDiscoveries, type DiscoveredDocument } from "@/lib/discoveries-api";
import {
  queueSubmission,
  cancelSubmission,
  listRunsForRequest,
  streamSubmissionRun,
  previewChannel,
  type SubmissionRun,
  type ChannelPreview,
} from "@/lib/submissions-api";
import {
  getProfile,
  updateProfile,
  type UserProfile,
} from "@/lib/profile-api";
import AuthGuard from "@/components/AuthGuard";
import ConfirmModal from "@/components/ConfirmModal";

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  submitted: "Submitted",
  awaiting_response: "Awaiting Response",
  responded: "Responded",
  partial: "Partial Response",
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

const COMM_TYPE_LABELS: Record<string, string> = {
  initial_request: "Initial Request",
  follow_up: "Follow-Up Letter",
  response: "Agency Response",
  appeal: "Appeal Letter",
  acknowledgment: "Acknowledgment",
  other: "Note",
};

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Parse the attachment manifest prepended to comm body, e.g. "[Attachments: a.pdf, b.jpg] — included in analysis\n\n..." */
function parseAttachmentManifest(body: string): { names: string[]; rest: string } {
  const match = body.match(/^\[Attachments: ([^\]]+)\] — included in analysis\n\n?([\s\S]*)/);
  if (match) {
    return {
      names: match[1].split(",").map((s) => s.trim()),
      rest: match[2],
    };
  }
  return { names: [], rest: body };
}

export default function RequestDetail() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [detail, setDetail] = useState<TrackedRequestDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // UI state
  const [showSubmitForm, setShowSubmitForm] = useState(false);
  const [filedDate, setFiledDate] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showCommForm, setShowCommForm] = useState(false);
  const [commBody, setCommBody] = useState("");
  const [commSubject, setCommSubject] = useState("");
  const [commDate, setCommDate] = useState(new Date().toISOString().split("T")[0]);
  const [commDirection, setCommDirection] = useState<"outgoing" | "incoming">("outgoing");
  const [generating, setGenerating] = useState<string | null>(null);
  const [generatedLetter, setGeneratedLetter] = useState<{ type: string; text: string } | null>(null);
  const [copiedLetter, setCopiedLetter] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Research section expanded by default
  const [researchOpen, setResearchOpen] = useState(true);
  const [showStrategy, setShowStrategy] = useState(true);
  const [showSimilar, setShowSimilar] = useState(true);
  const [showDiscovery, setShowDiscovery] = useState(true);

  const refresh = () =>
    getRequest(id)
      .then(setDetail)
      .catch((e) => setError(e.message));

  useEffect(() => {
    getRequest(id)
      .then(setDetail)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <main className="container"><p className="loading-text">Loading...</p></main>;
  if (error || !detail) return <main className="container"><div className="error-message">{error || "Request not found"}</div></main>;

  const { request, communications, deadline, analysis, analyses } = detail;
  const status = request.status;
  const isOverdue = deadline?.is_overdue;
  const canGenerateFollowUp = deadline && isOverdue && ["awaiting_response", "submitted"].includes(status);
  const canGenerateAppeal = analysis && ["appeal", "negotiate_scope"].includes(analysis.recommended_action);
  const isResolved = ["fulfilled", "denied", "appealed"].includes(status);

  // Map communication_id → analysis for inline rendering
  const analysesByCommId = new Map<string, ResponseAnalysis>();
  for (const a of (analyses ?? [])) {
    if (a.communication_id) analysesByCommId.set(a.communication_id, a);
  }
  // Legacy: analyses without communication_id — show latest standalone
  const legacyAnalysis = analysis && !analysis.communication_id ? analysis : null;

  async function handleMarkSubmitted() {
    if (!filedDate) return;
    setActionError(null);
    try {
      await updateRequest(id, { status: "awaiting_response", filed_date: filedDate });
      await addCommunication(id, {
        direction: "outgoing",
        comm_type: "initial_request",
        subject: `FOIA Request submitted to ${request.agency.name}`,
        body: request.letter_text,
        date: filedDate,
      });
      setShowSubmitForm(false);
      await refresh();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed to update");
    }
  }

  async function handleLogComm() {
    if (!commBody.trim() && files.length === 0) return;
    setActionError(null);

    if (commDirection === "incoming") {
      // Incoming → auto-analyze via the analyze-response endpoint
      setGenerating("analyzing");
      try {
        await analyzeResponse(id, { response_text: commBody, response_date: commDate }, files);
        setShowCommForm(false);
        setCommBody("");
        setCommSubject("");
        setFiles([]);
        setCommDirection("outgoing");
        await refresh();
      } catch (e) {
        setActionError(e instanceof Error ? e.message : "Analysis failed");
      } finally {
        setGenerating(null);
      }
    } else {
      // Outgoing → just log the communication
      try {
        await addCommunication(id, {
          direction: "outgoing",
          comm_type: "follow_up",
          subject: commSubject,
          body: commBody,
          date: commDate,
        });
        setShowCommForm(false);
        setCommBody("");
        setCommSubject("");
        setCommDirection("outgoing");
        await refresh();
      } catch (e) {
        setActionError(e instanceof Error ? e.message : "Failed to log communication");
      }
    }
  }

  async function handleGenerateLetter(type: "follow_up" | "appeal") {
    setGenerating(type);
    setActionError(null);
    try {
      const result = await generateLetter(id, { letter_type: type });
      setGeneratedLetter({ type, text: result.letter_text });
      await refresh();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Letter generation failed");
    } finally {
      setGenerating(null);
    }
  }


  async function handleEditComm(commId: string, updates: { body?: string; date?: string; subject?: string }) {
    setActionError(null);
    try {
      await updateCommunication(id, commId, updates);
      await refresh();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed to update");
    }
  }

  async function handleDeleteComm(commId: string) {
    setActionError(null);
    try {
      await deleteCommunication(id, commId);
      await refresh();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed to delete");
    }
  }

  async function handleCopyLetter() {
    if (!generatedLetter) return;
    await navigator.clipboard.writeText(generatedLetter.text);
    setCopiedLetter(true);
    setTimeout(() => setCopiedLetter(false), 2000);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const dropped = Array.from(e.dataTransfer.files);
    setFiles((prev) => [...prev, ...dropped]);
  }

  function removeFile(idx: number) {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  return (
    <AuthGuard>
    <main className="container">
      {/* ── Header ── */}
      <div className="detail-header">
        <button className="back-link" onClick={() => router.push("/dashboard")}>
          ← My Requests
        </button>
        <div className="detail-header-row">
          <div>
            <h1 className="detail-title">{request.title}</h1>
            <div className="detail-meta">
              <span className="agency-tag">{request.agency.abbreviation} — {request.agency.name}</span>
              <span className={`status-badge ${STATUS_COLORS[status] || ""}`}>
                {STATUS_LABELS[status] || status}
              </span>
            </div>
          </div>
          {deadline && (
            <div className={`deadline-card ${isOverdue ? "deadline-card-overdue" : "deadline-card-ok"}`}>
              <div className="deadline-card-label">{deadline.status_label}</div>
              <div className="deadline-card-sub">Due {formatDate(deadline.due_date)}</div>
              {!isOverdue && (
                <div className="deadline-progress-bar">
                  <div
                    className="deadline-progress-fill"
                    style={{ width: `${Math.min(100, (deadline.business_days_elapsed / 20) * 100)}%` }}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {actionError && <div className="error-message">{actionError}</div>}

      {/* ── Auto-file (only while still in draft) ── */}
      {status === "draft" && !showSubmitForm && (
        <AutoFileCard
          requestId={request.id}
          agencyName={request.agency.name || request.agency.abbreviation || "the agency"}
          initialName={request.requester_name || ""}
          initialOrganization={request.requester_organization || ""}
          initialEmail={request.requester_email || ""}
          initialPhone={request.requester_phone || ""}
          initialAddress={request.requester_address || ""}
          initialLetterText={request.letter_text || ""}
          onFiled={() => {
            getRequest(request.id).then(setDetail).catch(() => {});
          }}
        />
      )}

      {/* ── Actions ── */}
      {!isResolved && (status === "draft" || showSubmitForm || canGenerateFollowUp) && (
        <div className="action-panel">
          {status === "draft" && !showSubmitForm && (
            <button className="draft-button" onClick={() => setShowSubmitForm(true)}>
              Mark as Submitted
            </button>
          )}

          {showSubmitForm && (
            <div className="action-form">
              <label className="form-label">
                Date Submitted
                <input
                  type="date"
                  className="form-input"
                  value={filedDate}
                  onChange={(e) => setFiledDate(e.target.value)}
                  max={new Date().toISOString().split("T")[0]}
                />
              </label>
              <div className="wizard-actions">
                <button
                  className="draft-button"
                  onClick={handleMarkSubmitted}
                  disabled={!filedDate}
                >
                  Confirm Submission
                </button>
                <button className="wizard-cancel" onClick={() => setShowSubmitForm(false)}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {canGenerateFollowUp && !showSubmitForm && (
            <button
              className="draft-button action-urgent"
              onClick={() => handleGenerateLetter("follow_up")}
              disabled={!!generating}
            >
              {generating === "follow_up" ? "Generating..." : "Generate Follow-Up Letter"}
            </button>
          )}

        </div>
      )}

      {/* ── Log Communication (only after at least one communication exists) ── */}
      {communications.length > 0 && (
      <div className="action-panel">
        <button
          className="wizard-cancel"
          onClick={() => { setShowCommForm(!showCommForm); setFiles([]); }}
        >
          {showCommForm ? "Cancel" : "Log Communication"}
        </button>

        {showCommForm && (
          <div className="action-form">
            <label className="form-label">
              Direction
              <select className="form-input" value={commDirection} onChange={(e) => setCommDirection(e.target.value as "outgoing" | "incoming")}>
                <option value="outgoing">Outgoing (you sent)</option>
                <option value="incoming">Incoming (agency sent)</option>
              </select>
            </label>
            <label className="form-label">
              Date
              <input
                type="date"
                className="form-input"
                value={commDate}
                onChange={(e) => setCommDate(e.target.value)}
              />
            </label>
            <label className="form-label">
              {commDirection === "incoming" ? "Paste Agency Response (optional if uploading documents)" : "Content"}
              <textarea
                className="search-textarea"
                rows={4}
                value={commBody}
                onChange={(e) => setCommBody(e.target.value)}
                placeholder={commDirection === "incoming"
                  ? "Paste the full text of the agency's response..."
                  : "Paste letter text, write a note, or describe what happened..."}
              />
            </label>

            {/* File drop zone — only for incoming (agency responses) */}
            {commDirection === "incoming" && (
              <>
                <div
                  className={`file-drop-zone ${dragging ? "file-drop-zone-active" : ""}`}
                  onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <span>Drop files here or click to attach</span>
                  <span className="file-drop-hint">PDF, images (PNG/JPG/WebP), TIFF, DOCX, TXT</span>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.tif,.tiff,.docx,.doc,.txt,.html"
                    style={{ display: "none" }}
                    onChange={(e) => {
                      if (e.target.files) setFiles((prev) => [...prev, ...Array.from(e.target.files!)]);
                      e.target.value = "";
                    }}
                  />
                </div>
                {files.length > 0 && (
                  <div className="file-chip-list">
                    {files.map((f, i) => (
                      <span key={i} className="file-chip">
                        {f.name}
                        <button type="button" className="file-chip-remove" onClick={() => removeFile(i)}>×</button>
                      </span>
                    ))}
                  </div>
                )}
              </>
            )}

            <div className="wizard-actions">
              <button
                className="draft-button"
                onClick={handleLogComm}
                disabled={(commBody.trim() === "" && files.length === 0) || !!generating}
              >
                {commDirection === "incoming"
                  ? (generating === "analyzing" ? "Analyzing..." : "Save & Analyze")
                  : "Save"}
              </button>
            </div>
          </div>
        )}
      </div>
      )}

      {/* ── Communication Timeline ── */}
      <div className="timeline-section">
        <h3>Timeline</h3>
        {communications.length === 0 ? (
          <div className="timeline-empty">
            {status === "draft" ? (
              <p>Once you&apos;ve sent your FOIA request to the agency, click <strong>Mark as Submitted</strong> above to start tracking it.</p>
            ) : (
              <p>No communications logged yet.</p>
            )}
          </div>
        ) : (
          <ul className="timeline-list">
            {[...communications]
              .sort((a, b) => a.date.localeCompare(b.date))
              .map((comm) => (
                <TimelineEntry
                  key={comm.id}
                  comm={comm}
                  inlineAnalysis={analysesByCommId.get(comm.id)}
                  onGenerateAppeal={
                    analysesByCommId.has(comm.id) &&
                    ["appeal", "negotiate_scope"].includes(analysesByCommId.get(comm.id)!.recommended_action)
                      ? () => handleGenerateLetter("appeal")
                      : undefined
                  }
                  generating={generating}
                  generatedLetter={generatedLetter}
                  copiedLetter={copiedLetter}
                  onCopyLetter={handleCopyLetter}
                  onEdit={(updates) => handleEditComm(comm.id, updates)}
                  onDelete={() => handleDeleteComm(comm.id)}
                />
              ))}
          </ul>
        )}
      </div>

      {/* ── Legacy Analysis Panel (no communication_id) ── */}
      {legacyAnalysis && (
        <div className="analysis-card">
          <h3>Response Analysis</h3>
          <AnalysisBody analysis={legacyAnalysis} />
          {canGenerateAppeal && (
            <button
              className="draft-button"
              onClick={() => handleGenerateLetter("appeal")}
              disabled={!!generating}
              style={{ marginTop: "1rem" }}
            >
              {generating === "appeal" ? "Generating Appeal..." : "Generate Appeal Letter"}
            </button>
          )}
          {generatedLetter && (
            <div className="generated-letter-card" style={{ marginTop: "1rem" }}>
              <h4>{generatedLetter.type === "follow_up" ? "Follow-Up Letter" : "Appeal Letter"}</h4>
              <div className="letter-preview">
                <pre className="letter-text">{generatedLetter.text}</pre>
                <button className="copy-button" onClick={handleCopyLetter}>
                  {copiedLetter ? "Copied!" : "Copy to Clipboard"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Linked Discoveries (saved documents the user has linked to this request) ── */}
      <LinkedDiscoveriesSection requestId={id} />

      {/* ── Research Context (collapsed by default) ── */}
      <div className="research-context">
        <button
          className="collapse-toggle research-context-toggle"
          onClick={() => setResearchOpen(!researchOpen)}
        >
          <h3 className="research-context-title" style={{ margin: 0 }}>AI-Driven Analysis Reports</h3>
          <span className="collapse-arrow">{researchOpen ? "▲" : "▼"}</span>
        </button>
        {researchOpen && (
          <ResearchContext
            request={request}
            showStrategy={showStrategy}
            setShowStrategy={setShowStrategy}
            showSimilar={showSimilar}
            setShowSimilar={setShowSimilar}
            showDiscovery={showDiscovery}
            setShowDiscovery={setShowDiscovery}
          />
        )}
      </div>

    </main>
    </AuthGuard>
  );
}

/** Saved discoveries linked to this tracked request. Pulled live from the
 * discovered_documents library and filtered server-side by tracked_request_id. */
function LinkedDiscoveriesSection({ requestId }: { requestId: string }) {
  const [docs, setDocs] = useState<DiscoveredDocument[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMyDiscoveries({ tracked_request_id: requestId })
      .then((res) => setDocs(res.discoveries))
      .catch(() => setDocs([]))
      .finally(() => setLoading(false));
  }, [requestId]);

  if (loading || docs.length === 0) return null;

  const sourceLabels: Record<string, string> = {
    muckrock: "MuckRock",
    documentcloud: "DocumentCloud",
    web: "Web",
  };

  return (
    <div className="research-context">
      <h3 className="research-context-title">Linked discoveries ({docs.length})</h3>
      <p className="research-context-subtitle">
        Documents you saved from your research and linked to this request.
      </p>
      <ul className="discover-rows">
        {docs.map((d) => (
          <li key={d.id}>
            <a
              href={d.url}
              target="_blank"
              rel="noopener noreferrer"
              className="discover-row"
              style={{ textDecoration: "none" }}
            >
              <span className="discover-row-headline">{d.title}</span>
              <span className="discover-row-meta">
                <span className="discover-row-source">
                  {sourceLabels[d.source] || d.source}
                </span>
                {d.agency && (
                  <>
                    <span className="discover-row-meta-dot">·</span>
                    <span>{d.agency}</span>
                  </>
                )}
                {d.note && (
                  <>
                    <span className="discover-row-meta-dot">·</span>
                    <span>Note: {d.note.slice(0, 80)}{d.note.length > 80 ? "…" : ""}</span>
                  </>
                )}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Shared analysis body — used both inline and in the legacy standalone panel. */
function AnalysisBody({ analysis }: { analysis: ResponseAnalysis }) {
  return (
    <>
      <p className="analysis-summary">{analysis.summary}</p>
      <div className="analysis-action">
        <span className={`recommended-action action-${analysis.recommended_action}`}>
          Recommended: {analysis.recommended_action.replace(/_/g, " ")}
        </span>
      </div>
      {analysis.exemptions_valid.length > 0 && (
        <div className="analysis-section">
          <strong>Exemption Review</strong>
          <table className="exemption-table">
            <thead>
              <tr>
                <th>Exemption</th>
                <th>Assessment</th>
                <th>Reasoning</th>
              </tr>
            </thead>
            <tbody>
              {analysis.exemptions_valid.map((e, i) => (
                <tr key={i}>
                  <td>{e.exemption}</td>
                  <td>
                    <span className={`exemption-badge badge-${e.assessment}`}>{e.assessment}</span>
                  </td>
                  <td>{e.reasoning}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {analysis.missing_records.length > 0 && (
        <div className="analysis-section">
          <strong>Missing Records</strong>
          <ul>{analysis.missing_records.map((r, i) => <li key={i}>{r}</li>)}</ul>
        </div>
      )}
      {analysis.grounds_for_appeal.length > 0 && (
        <div className="analysis-section">
          <strong>Grounds for Appeal</strong>
          <ul>{analysis.grounds_for_appeal.map((g, i) => <li key={i}>{g}</li>)}</ul>
        </div>
      )}
    </>
  );
}

const SOURCE_COLORS: Record<string, string> = {
  documentcloud: "#1863dc",
  web: "#475569",
  muckrock: "#059669",
};

const SOURCE_LABELS: Record<string, string> = {
  documentcloud: "DocumentCloud",
  web: "Web",
  muckrock: "MuckRock",
};

function ResearchContext({
  request,
  showStrategy,
  setShowStrategy,
  showSimilar,
  setShowSimilar,
  showDiscovery,
  setShowDiscovery,
}: {
  request: import("@/lib/tracking-api").TrackedRequest;
  showStrategy: boolean;
  setShowStrategy: (v: boolean) => void;
  showSimilar: boolean;
  setShowSimilar: (v: boolean) => void;
  showDiscovery: boolean;
  setShowDiscovery: (v: boolean) => void;
}) {
  const { submission_info, tips, statute_cited, similar_requests, drafting_strategy, agency_intel, discovery_results } = request;
  const strategy = drafting_strategy;
  const intel = agency_intel;

  const hasSubmission = !!(submission_info || tips?.length || statute_cited);
  const hasStrategy = !!(strategy?.summary || strategy?.learned_from_successes || strategy?.avoided_from_denials || strategy?.scope_decisions || strategy?.exemption_awareness);
  const hasSimilar = (similar_requests?.length ?? 0) > 0 || (intel?.success_patterns?.length ?? 0) > 0 || (intel?.denial_patterns?.length ?? 0) > 0 || (intel?.exemption_patterns?.length ?? 0) > 0;
  const hasDiscovery = (discovery_results?.length ?? 0) > 0;

  if (!hasSubmission && !hasStrategy && !hasSimilar && !hasDiscovery) return null;

  return (
    <div style={{ marginTop: "1rem" }}>
      <p className="research-context-subtitle">
        Intelligence gathered from analyzing your initial request — use as reference while communicating with the agency.
      </p>

      {request.agency.cfr_available === false && (
        <div className="cfr-missing-notice">
          <div className="cfr-missing-icon">ⓘ</div>
          <div className="cfr-missing-body">
            <strong>Regulation text not yet available for {request.agency.name}</strong>
            <p>
              The eCFR (Electronic Code of Federal Regulations) does not publish a FOIA-specific
              regulation for <strong>{request.agency.abbreviation}</strong>. This typically means the agency
              handles FOIA requests under its parent department&apos;s procedures rather than its own published CFR part.
            </p>
            <p>
              We&apos;re using all available information — MuckRock request outcomes, agency exemption
              patterns, and the parent statute — to inform this analysis. We&apos;re actively working to
              add regulation data for agencies not yet covered.
            </p>
            <a
              className="cfr-missing-email"
              href={`mailto:foia-fluent@dssg.io?subject=Missing CFR regulation: ${request.agency.abbreviation}&body=Hi,%0A%0AI noticed that FOIA Fluent doesn't have CFR regulation text for ${request.agency.name} (${request.agency.abbreviation}). Could you add it?%0A%0AThanks`}
            >
              Notify us about this gap →
            </a>
          </div>
        </div>
      )}

      {hasSubmission && (
        <div className="research-subsection">
          <h4>Submission Guide</h4>
          {statute_cited && <div style={{ marginBottom: "0.5rem" }}><span className="tag">{statute_cited}</span></div>}
          {submission_info && <p style={{ marginBottom: "0.75rem" }}>{submission_info}</p>}
          {tips?.length > 0 && (
            <ul className="research-tips">{tips.map((tip, i) => <li key={i}>{tip}</li>)}</ul>
          )}
        </div>
      )}

      {hasStrategy && (
        <div className="research-subsection">
          <button className="collapse-toggle" onClick={() => setShowStrategy(!showStrategy)}>
            <strong>Initial Request Analysis</strong>
            <span className="collapse-arrow">{showStrategy ? "▲" : "▼"}</span>
          </button>
          {showStrategy && (
            <div style={{ marginTop: "0.75rem" }}>
              {strategy.summary && <p style={{ marginBottom: "0.75rem" }}>{strategy.summary}</p>}
              <div className="strategy-details">
                {strategy.learned_from_successes && (
                  <div className="strategy-item">
                    <span className="strategy-icon strategy-icon-success">✓</span>
                    <div><strong>Learned from successful requests</strong><p>{strategy.learned_from_successes}</p></div>
                  </div>
                )}
                {strategy.avoided_from_denials && (
                  <div className="strategy-item">
                    <span className="strategy-icon strategy-icon-warn">!</span>
                    <div><strong>Avoided patterns from denials</strong><p>{strategy.avoided_from_denials}</p></div>
                  </div>
                )}
                {strategy.scope_decisions && (
                  <div className="strategy-item">
                    <span className="strategy-icon strategy-icon-scope">⇒</span>
                    <div><strong>Scope and specificity decisions</strong><p>{strategy.scope_decisions}</p></div>
                  </div>
                )}
                {strategy.exemption_awareness && (
                  <div className="strategy-item">
                    <span className="strategy-icon strategy-icon-shield">■</span>
                    <div><strong>Exemption risk mitigation</strong><p>{strategy.exemption_awareness}</p></div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {hasSimilar && (
        <div className="research-subsection">
          <button className="collapse-toggle" onClick={() => setShowSimilar(!showSimilar)}>
            <strong>Similar FOIA Requests</strong>
            <span className="collapse-arrow">{showSimilar ? "▲" : "▼"}</span>
          </button>
          {showSimilar && (
            <div style={{ marginTop: "0.75rem" }}>
              {similar_requests?.length > 0 && (
                <div style={{ marginBottom: "1rem" }}>
                  <span className="research-label status-topic">Topic-specific requests</span>
                  <ul className="similar-list">
                    {similar_requests.map((sr, i) => (
                      <li key={i}>
                        <a href={sr.url} target="_blank" rel="noopener noreferrer" className="result-title">{sr.title}</a>
                        {sr.status && (
                          <span className={`similar-status ${sr.status === "completed" || sr.status === "partially completed" ? "status-completed" : sr.status === "rejected" || sr.status === "no responsive documents" ? "status-denied" : ""}`}>
                            {sr.status}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {intel?.success_patterns?.length > 0 && (
                <div style={{ marginBottom: "0.75rem" }}>
                  <span className="research-label status-completed">Agency successful requests</span>
                  <ul className="similar-list">
                    {intel.success_patterns.map((sr, i) => (
                      <li key={i}>
                        <a href={sr.url} target="_blank" rel="noopener noreferrer" className="result-title">{sr.title}</a>
                        {sr.status && <span className="similar-status status-completed">{sr.status}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {intel?.denial_patterns?.length > 0 && (
                <div style={{ marginBottom: "0.75rem" }}>
                  <span className="research-label status-denied">Agency denied requests</span>
                  <ul className="similar-list">
                    {intel.denial_patterns.map((sr, i) => (
                      <li key={i}>
                        <a href={sr.url} target="_blank" rel="noopener noreferrer" className="result-title">{sr.title}</a>
                        {sr.status && <span className="similar-status status-denied">{sr.status}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {intel?.exemption_patterns?.length > 0 && (
                <div>
                  <span className="research-label status-exemption">Exemption-related requests</span>
                  <ul className="similar-list">
                    {intel.exemption_patterns.map((sr, i) => (
                      <li key={i}>
                        <a href={sr.url} target="_blank" rel="noopener noreferrer" className="result-title">{sr.title}</a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {hasDiscovery && (
        <div className="research-subsection">
          <button className="collapse-toggle" onClick={() => setShowDiscovery(!showDiscovery)}>
            <strong>Documents &amp; Records Found ({discovery_results.length})</strong>
            <span className="collapse-arrow">{showDiscovery ? "▲" : "▼"}</span>
          </button>
          {showDiscovery && (
            <ul className="similar-list" style={{ marginTop: "0.75rem" }}>
              {discovery_results.map((r, i) => (
                <li key={i} style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <a href={r.url} target="_blank" rel="noopener noreferrer" className="result-title">{r.title || r.url}</a>
                    <span
                      className="source-badge"
                      style={{ backgroundColor: SOURCE_COLORS[r.source] || "#6b7280", fontSize: "0.7rem", padding: "0.1rem 0.4rem" }}
                    >
                      {SOURCE_LABELS[r.source] || r.source}
                    </span>
                    {r.status && <span className="similar-status">{r.status}</span>}
                  </div>
                  {r.description && <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--text-secondary)" }}>{r.description}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function TimelineEntry({
  comm,
  inlineAnalysis,
  onGenerateAppeal,
  generating,
  generatedLetter,
  copiedLetter,
  onCopyLetter,
  onEdit,
  onDelete,
}: {
  comm: Communication;
  inlineAnalysis?: ResponseAnalysis;
  onGenerateAppeal?: () => void;
  generating: string | null;
  generatedLetter?: { type: string; text: string } | null;
  copiedLetter?: boolean;
  onCopyLetter?: () => void;
  onEdit: (updates: { body?: string; date?: string; subject?: string }) => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [analysisExpanded, setAnalysisExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [editBody, setEditBody] = useState(comm.body);
  const [editDate, setEditDate] = useState(comm.date);
  const [editSubject, setEditSubject] = useState(comm.subject);
  const isIncoming = comm.direction === "incoming";
  const { names: attachmentNames, rest: bodyText } = parseAttachmentManifest(comm.body);

  function handleSaveEdit() {
    const updates: { body?: string; date?: string; subject?: string } = {};
    if (editBody !== comm.body) updates.body = editBody;
    if (editDate !== comm.date) updates.date = editDate;
    if (editSubject !== comm.subject) updates.subject = editSubject;
    if (Object.keys(updates).length > 0) onEdit(updates);
    setEditing(false);
  }

  return (
    <li className={`timeline-entry ${isIncoming ? "entry-incoming" : "entry-outgoing"}`}>
      <div className="timeline-dot" />
      <div className="timeline-content">
        <div className="timeline-header" onClick={() => !editing && setExpanded(!expanded)}>
          <div>
            <span className="comm-type-label">
              {COMM_TYPE_LABELS[comm.comm_type] || comm.comm_type}
            </span>
            {comm.subject && <span className="comm-subject"> — {comm.subject}</span>}
            {attachmentNames.length > 0 && (
              <span className="attachment-badge" title={attachmentNames.join(", ")}>
                📎 {attachmentNames.length} attachment{attachmentNames.length > 1 ? "s" : ""} included in analysis
              </span>
            )}
          </div>
          <div className="timeline-meta">
            <span className="timeline-date">{comm.date}</span>
            <span className={`direction-badge ${isIncoming ? "badge-incoming" : "badge-outgoing"}`}>
              {isIncoming ? "Incoming" : "Outgoing"}
            </span>
            <span className="expand-toggle">{expanded ? "▲" : "▼"}</span>
          </div>
        </div>

        {expanded && !editing && (
          <div>
            <pre className="timeline-body">{bodyText}</pre>
            <div className="timeline-actions">
              <button className="timeline-action-btn" onClick={(e) => { e.stopPropagation(); setEditing(true); }}>Edit</button>
              <button className="timeline-action-btn timeline-action-delete" onClick={(e) => { e.stopPropagation(); setConfirmingDelete(true); }}>Delete</button>
            </div>
          </div>
        )}

        {editing && (
          <div className="timeline-edit-form" onClick={(e) => e.stopPropagation()}>
            <label className="form-label">
              Date
              <input type="date" className="form-input" value={editDate} onChange={(e) => setEditDate(e.target.value)} />
            </label>
            <label className="form-label">
              Subject
              <input type="text" className="form-input" value={editSubject} onChange={(e) => setEditSubject(e.target.value)} />
            </label>
            <label className="form-label">
              Content
              <textarea className="search-textarea" rows={4} value={editBody} onChange={(e) => setEditBody(e.target.value)} />
            </label>
            <div className="wizard-actions">
              <button className="draft-button" onClick={handleSaveEdit}>Save</button>
              <button className="wizard-cancel" onClick={() => { setEditing(false); setEditBody(comm.body); setEditDate(comm.date); setEditSubject(comm.subject); }}>Cancel</button>
            </div>
          </div>
        )}

        {/* Inline analysis for this communication */}
        {inlineAnalysis && !editing && (
          <div className="inline-analysis">
            <button
              className="inline-analysis-toggle"
              onClick={() => setAnalysisExpanded(!analysisExpanded)}
            >
              <span>
                Analysis — <span className={`recommended-action action-${inlineAnalysis.recommended_action}`}>
                  {inlineAnalysis.recommended_action.replace(/_/g, " ")}
                </span>
              </span>
              <span className="collapse-arrow">{analysisExpanded ? "▲" : "▼"}</span>
            </button>
            {analysisExpanded && (
              <div className="inline-analysis-body">
                <AnalysisBody analysis={inlineAnalysis} />
                {onGenerateAppeal && (
                  <button
                    className="draft-button"
                    onClick={onGenerateAppeal}
                    disabled={!!generating}
                    style={{ marginTop: "0.75rem" }}
                  >
                    {generating === "appeal" ? "Generating Appeal..." : "Generate Appeal Letter"}
                  </button>
                )}
                {generatedLetter && (
                  <div className="generated-letter-card" style={{ marginTop: "1rem" }}>
                    <h4>{generatedLetter.type === "follow_up" ? "Follow-Up Letter" : "Appeal Letter"}</h4>
                    <div className="letter-preview">
                      <pre className="letter-text">{generatedLetter.text}</pre>
                      <button className="copy-button" onClick={onCopyLetter}>
                        {copiedLetter ? "Copied!" : "Copy to Clipboard"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {confirmingDelete && (
          <ConfirmModal
            title="Delete communication"
            message="Are you sure you want to delete this timeline entry? This cannot be undone."
            onConfirm={() => { setConfirmingDelete(false); onDelete(); }}
            onCancel={() => setConfirmingDelete(false)}
          />
        )}
      </div>
    </li>
  );
}

// ── Auto-File Card ──────────────────────────────────────────────────────────

function AutoFileCard({
  requestId,
  agencyName,
  initialName,
  initialOrganization,
  initialEmail,
  initialPhone,
  initialAddress,
  initialLetterText,
  onFiled,
}: {
  requestId: string;
  agencyName: string;
  initialName: string;
  initialOrganization: string;
  initialEmail: string;
  initialPhone: string;
  initialAddress: string;
  initialLetterText: string;
  onFiled: () => void;
}) {
  const [runs, setRuns] = useState<SubmissionRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [queueing, setQueueing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [channelSummary, setChannelSummary] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number>(0); // seconds remaining
  const streamStopRef = useRef<(() => void) | null>(null);

  // Review / edit state (populated from user_profiles + tracked_request fields)
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [senderName, setSenderName] = useState(initialName);
  const [senderOrg, setSenderOrg] = useState(initialOrganization);
  const [senderEmail, setSenderEmail] = useState(initialEmail);
  const [senderPhone, setSenderPhone] = useState(initialPhone);
  const [senderAddress, setSenderAddress] = useState(initialAddress);
  const [letterText, setLetterText] = useState(initialLetterText);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [showLetterEdit, setShowLetterEdit] = useState(false);
  const [channelPreview, setChannelPreview] = useState<ChannelPreview | null>(null);

  const activeRun: SubmissionRun | undefined = runs.find((r) =>
    ["queued", "submitting", "awaiting_user"].includes(r.status),
  );
  const latestTerminal: SubmissionRun | undefined = runs.find((r) =>
    ["succeeded", "failed", "cancelled"].includes(r.status),
  );

  // Initial fetch — submission runs + profile + channel preview in parallel
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [list, prof, preview] = await Promise.all([
          listRunsForRequest(requestId),
          getProfile().catch(() => null),
          previewChannel(requestId).catch(() => null),
        ]);
        if (cancelled) return;
        setRuns(list);
        setChannelPreview(preview);
        if (prof) {
          setProfile(prof);
          // Only fall back to profile values when the tracked_request fields
          // are empty — never overwrite a value the user already set on this
          // specific request.
          if (!initialName && prof.full_name) setSenderName(prof.full_name);
          if (!initialOrganization && prof.organization)
            setSenderOrg(prof.organization);
          if (!initialEmail && prof.email) setSenderEmail(prof.email);
          if (!initialPhone && prof.phone) setSenderPhone(prof.phone);
          if (!initialAddress && prof.mailing_address)
            setSenderAddress(prof.mailing_address);
        }
        setProfileLoaded(true);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    requestId,
    initialName,
    initialOrganization,
    initialEmail,
    initialPhone,
    initialAddress,
  ]);

  // Subscribe to SSE while there is an active run
  useEffect(() => {
    if (!activeRun) {
      streamStopRef.current?.();
      streamStopRef.current = null;
      return;
    }
    streamStopRef.current?.();
    streamStopRef.current = streamSubmissionRun(activeRun.id, {
      onUpdate: (run) => {
        setRuns((prev) => {
          const idx = prev.findIndex((r) => r.id === run.id);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = run;
            return next;
          }
          return [run, ...prev];
        });
        if (["succeeded", "cancelled"].includes(run.status)) {
          onFiled();
        }
      },
      onError: () => {
        /* transient — we fall back to the 1s poll the backend already does */
      },
    });
    return () => {
      streamStopRef.current?.();
      streamStopRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRun?.id]);

  // Countdown timer for queued runs
  useEffect(() => {
    if (!activeRun || activeRun.status !== "queued" || !activeRun.sends_at) {
      setCountdown(0);
      return;
    }
    function tick() {
      if (!activeRun || !activeRun.sends_at) return;
      const remaining = Math.max(
        0,
        Math.floor(
          (new Date(activeRun.sends_at).getTime() - Date.now()) / 1000,
        ),
      );
      setCountdown(remaining);
    }
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [activeRun]);

  // Build the list of profile fields that differ from the saved profile,
  // so we only PUT /profile when the user actually edited something.
  function profileDiff(): Partial<UserProfile> {
    if (!profile) {
      // First-time user — persist whatever non-empty values they entered
      const diff: Partial<UserProfile> = {};
      if (senderName) diff.full_name = senderName;
      if (senderOrg) diff.organization = senderOrg;
      if (senderEmail) diff.email = senderEmail;
      if (senderPhone) diff.phone = senderPhone;
      if (senderAddress) diff.mailing_address = senderAddress;
      return diff;
    }
    const diff: Partial<UserProfile> = {};
    if (senderName !== profile.full_name) diff.full_name = senderName;
    if (senderOrg !== profile.organization) diff.organization = senderOrg;
    if (senderEmail !== profile.email) diff.email = senderEmail;
    if (senderPhone !== profile.phone) diff.phone = senderPhone;
    if (senderAddress !== profile.mailing_address)
      diff.mailing_address = senderAddress;
    return diff;
  }

  async function handleConfirmAndQueue() {
    setQueueing(true);
    setError(null);
    try {
      // 1. Persist profile edits (if any) so the user doesn't have to
      // re-enter contact info on future filings.
      const pDiff = profileDiff();
      if (Object.keys(pDiff).length > 0) {
        const saved = await updateProfile(pDiff);
        setProfile(saved);
      }

      // 2. Persist the reviewed letter + contact snapshot onto the tracked
      // request so the submitter picks it up at send time.
      await updateRequest(requestId, {
        letter_text: letterText,
        requester_name: senderName,
        requester_organization: senderOrg,
        requester_email: senderEmail,
        requester_phone: senderPhone,
        requester_address: senderAddress,
      });

      // 3. Queue the submission (30-min QA hold starts now).
      const res = await queueSubmission({ request_id: requestId });
      setRuns((prev) => [res.run, ...prev]);
      setChannelSummary(res.channel_summary);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setQueueing(false);
    }
  }

  // Simple retry for the failed-state path — no re-review, just re-queue.
  async function handleRetry() {
    setQueueing(true);
    setError(null);
    try {
      const res = await queueSubmission({ request_id: requestId });
      setRuns((prev) => [res.run, ...prev]);
      setChannelSummary(res.channel_summary);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setQueueing(false);
    }
  }

  async function handleCancel() {
    if (!activeRun) return;
    setCancelling(true);
    setError(null);
    try {
      const updated = await cancelSubmission(activeRun.id, "user cancelled");
      setRuns((prev) =>
        prev.map((r) => (r.id === updated.id ? updated : r)),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCancelling(false);
    }
  }

  if (loading) return null;

  // Success state — show a summary, offer to file again
  if (latestTerminal?.status === "succeeded" && !activeRun) {
    const receipt = latestTerminal.receipt as { to?: string; subject?: string; message_id?: string };
    return (
      <div className="autofile-card autofile-card-success">
        <div className="autofile-head">
          <span className="autofile-eyebrow autofile-eyebrow-success">✓ Filed</span>
          <span className="autofile-meta">
            {latestTerminal.completed_at
              ? new Date(latestTerminal.completed_at).toLocaleString()
              : ""}
          </span>
        </div>
        <h3 className="autofile-title">Submitted to {agencyName}</h3>
        {receipt?.to && (
          <p className="autofile-body">
            Email delivered to <code>{receipt.to}</code>. Agency replies will
            appear in the communication timeline below.
          </p>
        )}
      </div>
    );
  }

  // Active run — show countdown + cancel OR live log
  if (activeRun) {
    const minutes = Math.floor(countdown / 60);
    const seconds = countdown % 60;
    const isQueued = activeRun.status === "queued";
    const isSubmitting = activeRun.status === "submitting";
    const isFailed = (activeRun.status as string) === "failed";

    return (
      <div className="autofile-card autofile-card-active">
        <div className="autofile-head">
          <span className="autofile-eyebrow">
            {isQueued
              ? "Filing in"
              : isSubmitting
                ? "Sending…"
                : "Processing"}
          </span>
          {channelSummary && (
            <span className="autofile-meta">{channelSummary}</span>
          )}
        </div>

        {isQueued && (
          <>
            <div className="autofile-countdown">
              {minutes}:{seconds.toString().padStart(2, "0")}
            </div>
            <p className="autofile-body">
              Your request will be sent to <strong>{agencyName}</strong> via
              email in {minutes > 0 ? `${minutes} min ${seconds}s` : `${seconds}s`}.
              Cancel anytime before then.
            </p>
            <button
              className="autofile-cancel-btn"
              onClick={handleCancel}
              disabled={cancelling}
            >
              {cancelling ? "Cancelling…" : "Cancel"}
            </button>
          </>
        )}

        {isSubmitting && (
          <p className="autofile-body">
            Sending your request to {agencyName}… this takes a few seconds.
          </p>
        )}

        {activeRun.log.length > 0 && (
          <details className="autofile-log">
            <summary>What the agent is doing ({activeRun.log.length} steps)</summary>
            <ol className="autofile-log-list">
              {activeRun.log.map((entry, i) => (
                <li key={i} className={`autofile-log-entry autofile-log-${entry.level || "info"}`}>
                  <span className="autofile-log-ts">
                    {new Date(entry.ts).toLocaleTimeString()}
                  </span>
                  <span className="autofile-log-action">{entry.action}</span>
                </li>
              ))}
            </ol>
          </details>
        )}

        {isFailed && activeRun.error && (
          <p className="autofile-error">Error: {activeRun.error}</p>
        )}
      </div>
    );
  }

  // Failed terminal state — offer retry
  if (latestTerminal?.status === "failed") {
    return (
      <div className="autofile-card autofile-card-failed">
        <div className="autofile-head">
          <span className="autofile-eyebrow autofile-eyebrow-failed">Filing failed</span>
        </div>
        <p className="autofile-body">{latestTerminal.error || "Unknown error."}</p>
        <button
          className="autofile-primary-btn"
          onClick={handleRetry}
          disabled={queueing}
        >
          {queueing ? "Queueing…" : "Try again"}
        </button>
      </div>
    );
  }

  // Default — no runs yet; show the review + edit pane
  if (!letterText.trim() && !profileLoaded) {
    return null;
  }

  // Portal-only agencies (DHS components, CIA, DOD, IRS, VA, HHS, …) have no
  // email filing channel. Show a card that points the user at the agency's
  // portal instead of the normal Confirm flow — Phase 2 scope to automate.
  if (channelPreview && !channelPreview.supported) {
    return (
      <div className="autofile-card autofile-card-portal">
        <div className="autofile-head">
          <span className="autofile-eyebrow autofile-eyebrow-warn">
            Portal-only agency
          </span>
        </div>
        <h3 className="autofile-title">
          Auto-file isn&rsquo;t available for{" "}
          {channelPreview.agency_name || agencyName} yet
        </h3>
        <p className="autofile-body">
          {channelPreview.agency_abbreviation || "This agency"} requires
          submission through their FOIA portal — they don&rsquo;t accept
          emailed requests. Submit manually on their site, then click{" "}
          <strong>Mark as Submitted</strong> below to track it here.
        </p>
        {channelPreview.submission_notes && (
          <p className="autofile-note">{channelPreview.submission_notes}</p>
        )}
        {channelPreview.foia_website && (
          <div className="autofile-actions">
            <a
              className="autofile-primary-btn autofile-primary-link"
              href={channelPreview.foia_website}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open {channelPreview.agency_abbreviation || "agency"} FOIA portal
              ↗
            </a>
          </div>
        )}
      </div>
    );
  }

  // Validation: all three required fields present, and the letter has no
  // `[something to provide]` placeholders still hanging around.
  const hasPlaceholder = /\[[^\]]{0,60}\]/.test(letterText);
  const requiredFilled =
    senderName.trim().length > 0 &&
    senderEmail.trim().length > 0 &&
    senderAddress.trim().length > 0;
  const canConfirm = requiredFilled && !hasPlaceholder && letterText.trim().length > 0;

  return (
    <div className="autofile-card autofile-card-cta">
      <div className="autofile-head">
        <span className="autofile-eyebrow autofile-eyebrow-primary">
          Review &amp; file this request
        </span>
      </div>
      <p className="autofile-body">
        We&rsquo;ll email <strong>{agencyName}</strong> from{" "}
        <code>reply-&hellip;@foiafluent.com</code> with your name on the letter.
        Check the sender info and letter below — you have a 30-minute window to
        cancel after confirming.
      </p>

      <div className="autofile-form-grid">
        <label className="autofile-field">
          <span className="autofile-field-label">
            Your name <span className="autofile-req">*</span>
          </span>
          <input
            className="autofile-input"
            type="text"
            value={senderName}
            onChange={(e) => setSenderName(e.target.value)}
            placeholder="Franklin Heng"
          />
        </label>
        <label className="autofile-field">
          <span className="autofile-field-label">Organization (optional)</span>
          <input
            className="autofile-input"
            type="text"
            value={senderOrg}
            onChange={(e) => setSenderOrg(e.target.value)}
            placeholder="e.g. Data Science for Social Good"
          />
        </label>
        <label className="autofile-field">
          <span className="autofile-field-label">
            Email <span className="autofile-req">*</span>
          </span>
          <input
            className="autofile-input"
            type="email"
            value={senderEmail}
            onChange={(e) => setSenderEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </label>
        <label className="autofile-field">
          <span className="autofile-field-label">Phone (optional)</span>
          <input
            className="autofile-input"
            type="tel"
            value={senderPhone}
            onChange={(e) => setSenderPhone(e.target.value)}
            placeholder="(555) 555-1212"
          />
        </label>
        <label className="autofile-field autofile-field-wide">
          <span className="autofile-field-label">
            Mailing address <span className="autofile-req">*</span>
          </span>
          <textarea
            className="autofile-input autofile-textarea-small"
            value={senderAddress}
            onChange={(e) => setSenderAddress(e.target.value)}
            placeholder={"123 Main St\nApt 4B\nSan Francisco, CA 94110"}
            rows={3}
          />
        </label>
      </div>

      <div className="autofile-letter-section">
        <div className="autofile-letter-head">
          <span className="autofile-field-label">Letter to be sent</span>
          <button
            type="button"
            className="autofile-link-btn"
            onClick={() => setShowLetterEdit((v) => !v)}
          >
            {showLetterEdit ? "Hide" : "Edit letter"}
          </button>
        </div>
        {hasPlaceholder && (
          <div className="autofile-warning">
            The letter still contains bracketed placeholders (e.g.{" "}
            <code>[requester to provide]</code>). Click <em>Edit letter</em>{" "}
            and replace them with your info before filing.
          </div>
        )}
        {showLetterEdit ? (
          <textarea
            className="autofile-input autofile-letter-textarea"
            value={letterText}
            onChange={(e) => setLetterText(e.target.value)}
            rows={18}
            spellCheck={true}
          />
        ) : (
          <pre className="autofile-letter-preview">{letterText}</pre>
        )}
      </div>

      {error && <p className="autofile-error">{error}</p>}

      <div className="autofile-actions">
        <button
          className="autofile-primary-btn"
          onClick={handleConfirmAndQueue}
          disabled={queueing || !canConfirm}
          title={
            !requiredFilled
              ? "Fill in your name, email, and mailing address"
              : hasPlaceholder
                ? "Remove bracketed placeholders from the letter first"
                : undefined
          }
        >
          {queueing ? "Saving…" : "Confirm + start 30-minute window"}
        </button>
      </div>
    </div>
  );
}
