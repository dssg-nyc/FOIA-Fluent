"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  getRequest,
  updateRequest,
  analyzeResponse,
  generateLetter,
  addCommunication,
  TrackedRequestDetail,
  Communication,
  ResponseAnalysis,
  DeadlineInfo,
  SimilarRequest,
  DraftingStrategy,
  AgencyIntel,
  DiscoveryResult,
} from "@/lib/tracking-api";

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
  const [showResponseForm, setShowResponseForm] = useState(false);
  const [responseText, setResponseText] = useState("");
  const [responseDate, setResponseDate] = useState(new Date().toISOString().split("T")[0]);
  const [showCommForm, setShowCommForm] = useState(false);
  const [commBody, setCommBody] = useState("");
  const [commSubject, setCommSubject] = useState("");
  const [commDate, setCommDate] = useState(new Date().toISOString().split("T")[0]);
  const [generating, setGenerating] = useState<string | null>(null);  // "follow_up" | "appeal" | "analyzing"
  const [generatedLetter, setGeneratedLetter] = useState<{ type: string; text: string } | null>(null);
  const [copiedLetter, setCopiedLetter] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Research context collapsible sections
  const [showStrategy, setShowStrategy] = useState(false);
  const [showSimilar, setShowSimilar] = useState(false);
  const [showDiscovery, setShowDiscovery] = useState(false);

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

  const { request, communications, deadline, analysis } = detail;
  const status = request.status;
  const isOverdue = deadline?.is_overdue;
  const canGenerateFollowUp = deadline && isOverdue && ["awaiting_response", "submitted"].includes(status);
  const canAnalyzeResponse = ["awaiting_response", "submitted", "responded", "partial"].includes(status);
  const canGenerateAppeal = analysis && ["appeal", "negotiate_scope"].includes(analysis.recommended_action);
  const isResolved = ["fulfilled", "denied", "appealed"].includes(status);

  async function handleMarkSubmitted() {
    if (!filedDate) return;
    setActionError(null);
    try {
      await updateRequest(id, { status: "awaiting_response", filed_date: filedDate });
      // Log the initial request as a communication
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

  async function handleAnalyzeResponse() {
    if (!responseText.trim()) return;
    setGenerating("analyzing");
    setActionError(null);
    try {
      await analyzeResponse(id, { response_text: responseText, response_date: responseDate });
      setShowResponseForm(false);
      setResponseText("");
      await refresh();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setGenerating(null);
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

  async function handleAddComm() {
    if (!commBody.trim()) return;
    setActionError(null);
    try {
      await addCommunication(id, {
        direction: "outgoing",
        comm_type: "other",
        subject: commSubject,
        body: commBody,
        date: commDate,
      });
      setShowCommForm(false);
      setCommBody("");
      setCommSubject("");
      await refresh();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed to log communication");
    }
  }

  async function handleCopyLetter() {
    if (!generatedLetter) return;
    await navigator.clipboard.writeText(generatedLetter.text);
    setCopiedLetter(true);
    setTimeout(() => setCopiedLetter(false), 2000);
  }

  return (
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

      {/* ── Actions ── */}
      {!isResolved && (
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

          {canAnalyzeResponse && !showResponseForm && !showSubmitForm && (
            <button
              className="draft-button action-secondary"
              onClick={() => setShowResponseForm(true)}
            >
              I Received a Response
            </button>
          )}

          {showResponseForm && (
            <div className="action-form">
              <label className="form-label">
                Response Date
                <input
                  type="date"
                  className="form-input"
                  value={responseDate}
                  onChange={(e) => setResponseDate(e.target.value)}
                />
              </label>
              <label className="form-label">
                Paste Agency Response
                <textarea
                  className="search-textarea"
                  rows={8}
                  value={responseText}
                  onChange={(e) => setResponseText(e.target.value)}
                  placeholder="Paste the full text of the agency's response letter..."
                />
              </label>
              <div className="wizard-actions">
                <button
                  className="draft-button"
                  onClick={handleAnalyzeResponse}
                  disabled={!responseText.trim() || !!generating}
                >
                  {generating === "analyzing" ? "Analyzing..." : "Analyze Response"}
                </button>
                <button className="wizard-cancel" onClick={() => setShowResponseForm(false)}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {!showSubmitForm && !showResponseForm && (
            <button
              className="wizard-cancel"
              onClick={() => setShowCommForm(!showCommForm)}
            >
              {showCommForm ? "Cancel" : "Log Communication"}
            </button>
          )}

          {showCommForm && (
            <div className="action-form">
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
                Subject (optional)
                <input
                  type="text"
                  className="form-input"
                  value={commSubject}
                  onChange={(e) => setCommSubject(e.target.value)}
                  placeholder="e.g. Acknowledgment received"
                />
              </label>
              <label className="form-label">
                Notes
                <textarea
                  className="search-textarea"
                  rows={4}
                  value={commBody}
                  onChange={(e) => setCommBody(e.target.value)}
                  placeholder="What happened? Paste letter text or write a note..."
                />
              </label>
              <div className="wizard-actions">
                <button
                  className="draft-button"
                  onClick={handleAddComm}
                  disabled={!commBody.trim()}
                >
                  Save
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Research Context ── */}
      <ResearchContext
        request={request}
        showStrategy={showStrategy}
        setShowStrategy={setShowStrategy}
        showSimilar={showSimilar}
        setShowSimilar={setShowSimilar}
        showDiscovery={showDiscovery}
        setShowDiscovery={setShowDiscovery}
      />

      {/* ── Response Analysis ── */}
      {analysis && (
        <div className="analysis-card">
          <h3>Response Analysis</h3>
          <p className="analysis-summary">{analysis.summary}</p>

          <div className="analysis-action">
            <span className={`recommended-action action-${analysis.recommended_action}`}>
              Recommended: {analysis.recommended_action.replace("_", " ")}
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
                        <span className={`exemption-badge badge-${e.assessment}`}>
                          {e.assessment}
                        </span>
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
              <ul>
                {analysis.missing_records.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            </div>
          )}

          {analysis.grounds_for_appeal.length > 0 && (
            <div className="analysis-section">
              <strong>Grounds for Appeal</strong>
              <ul>
                {analysis.grounds_for_appeal.map((g, i) => <li key={i}>{g}</li>)}
              </ul>
            </div>
          )}

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
        </div>
      )}

      {/* ── Generated Letter ── */}
      {generatedLetter && (
        <div className="generated-letter-card">
          <h3>{generatedLetter.type === "follow_up" ? "Follow-Up Letter" : "Appeal Letter"}</h3>
          <div className="letter-preview">
            <pre className="letter-text">{generatedLetter.text}</pre>
            <button className="copy-button" onClick={handleCopyLetter}>
              {copiedLetter ? "Copied!" : "Copy to Clipboard"}
            </button>
          </div>
        </div>
      )}

      {/* ── Communication Timeline ── */}
      <div className="timeline-section">
        <h3>Timeline</h3>
        {communications.length === 0 ? (
          <p className="timeline-empty">No communications logged yet.</p>
        ) : (
          <ul className="timeline-list">
            {[...communications]
              .sort((a, b) => a.date.localeCompare(b.date))
              .map((comm) => (
                <TimelineEntry key={comm.id} comm={comm} />
              ))}
          </ul>
        )}
      </div>

      {/* ── Original Letter ── */}
      <details className="original-letter-details">
        <summary>View Original Request Letter</summary>
        <div className="letter-preview" style={{ marginTop: "0.75rem" }}>
          <pre className="letter-text">{request.letter_text}</pre>
        </div>
      </details>
    </main>
  );
}

const SOURCE_COLORS: Record<string, string> = {
  documentcloud: "#2563eb",
  web: "#7c3aed",
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
    <div className="research-context">
      <h3 className="research-context-title">Research Context</h3>
      <p className="research-context-subtitle">
        Intelligence gathered when drafting this request — use as reference while communicating with the agency.
      </p>

      {/* A: Submission Guide */}
      {hasSubmission && (
        <div className="research-subsection">
          <h4>Submission Guide</h4>
          {statute_cited && (
            <div style={{ marginBottom: "0.5rem" }}>
              <span className="tag">{statute_cited}</span>
            </div>
          )}
          {submission_info && <p style={{ marginBottom: "0.75rem" }}>{submission_info}</p>}
          {tips?.length > 0 && (
            <ul className="research-tips">
              {tips.map((tip, i) => <li key={i}>{tip}</li>)}
            </ul>
          )}
        </div>
      )}

      {/* B: How We Built This Draft */}
      {hasStrategy && (
        <div className="research-subsection">
          <button className="collapse-toggle" onClick={() => setShowStrategy(!showStrategy)}>
            <strong>How We Built This Draft</strong>
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

      {/* C: Related FOIA Requests */}
      {hasSimilar && (
        <div className="research-subsection">
          <button className="collapse-toggle" onClick={() => setShowSimilar(!showSimilar)}>
            <strong>Related FOIA Requests</strong>
            <span className="collapse-arrow">{showSimilar ? "▲" : "▼"}</span>
          </button>
          {showSimilar && (
            <div style={{ marginTop: "0.75rem" }}>
              {similar_requests?.length > 0 && (
                <div style={{ marginBottom: "1rem" }}>
                  <span className="research-label">Topic-specific requests</span>
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
                  <span className="research-label">Exemption-related requests</span>
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

      {/* D: Documents & Records Found */}
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

function TimelineEntry({ comm }: { comm: Communication }) {
  const [expanded, setExpanded] = useState(false);
  const isIncoming = comm.direction === "incoming";

  return (
    <li className={`timeline-entry ${isIncoming ? "entry-incoming" : "entry-outgoing"}`}>
      <div className="timeline-dot" />
      <div className="timeline-content">
        <div className="timeline-header" onClick={() => setExpanded(!expanded)}>
          <div>
            <span className="comm-type-label">
              {COMM_TYPE_LABELS[comm.comm_type] || comm.comm_type}
            </span>
            {comm.subject && <span className="comm-subject"> — {comm.subject}</span>}
          </div>
          <div className="timeline-meta">
            <span className="timeline-date">{comm.date}</span>
            <span className={`direction-badge ${isIncoming ? "badge-incoming" : "badge-outgoing"}`}>
              {isIncoming ? "Incoming" : "Outgoing"}
            </span>
            <span className="expand-toggle">{expanded ? "▲" : "▼"}</span>
          </div>
        </div>
        {expanded && (
          <pre className="timeline-body">{comm.body}</pre>
        )}
      </div>
    </li>
  );
}
