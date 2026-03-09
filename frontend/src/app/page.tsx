"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  discover,
  identifyAgency,
  generateDraft,
  DiscoveryResponse,
  DiscoveryStep,
  SearchResult,
  AgencyInfo,
  AgencyIdentifyResponse,
  DraftResponse,
  DraftingStrategy,
  AgencyIntel,
} from "@/lib/api";
import { trackRequest } from "@/lib/tracking-api";

const SOURCE_LABELS: Record<string, string> = {
  documentcloud: "DocumentCloud",
  web: "Web",
  muckrock: "MuckRock",
};

const SOURCE_COLORS: Record<string, string> = {
  documentcloud: "#2563eb",
  web: "#7c3aed",
  muckrock: "#059669",
};

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

type DraftPhase =
  | "idle"
  | "identifying"
  | "confirm-agency"
  | "fill-details"
  | "generating"
  | "review-draft";

export default function Home() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [data, setData] = useState<DiscoveryResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Draft wizard state
  const [draftPhase, setDraftPhase] = useState<DraftPhase>("idle");
  const [draftError, setDraftError] = useState<string | null>(null);
  const [agencyResult, setAgencyResult] =
    useState<AgencyIdentifyResponse | null>(null);
  const [selectedAgency, setSelectedAgency] = useState<AgencyInfo | null>(null);
  const [draftResult, setDraftResult] = useState<DraftResponse | null>(null);
  const [copied, setCopied] = useState(false);
  const [isTracking, setIsTracking] = useState(false);

  // Draft form fields
  const [requesterName, setRequesterName] = useState("");
  const [requesterOrg, setRequesterOrg] = useState("");
  const [recordsDescription, setRecordsDescription] = useState("");
  const [feeWaiver, setFeeWaiver] = useState(false);
  const [expedited, setExpedited] = useState(false);
  const [preferredFormat, setPreferredFormat] = useState("electronic");

  async function handleSearch() {
    if (!query.trim()) return;
    setIsLoading(true);
    setError(null);
    resetDraft();
    try {
      const result = await discover(query.trim());
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
      setData(null);
    } finally {
      setIsLoading(false);
    }
  }

  function resetDraft() {
    setDraftPhase("idle");
    setDraftError(null);
    setAgencyResult(null);
    setSelectedAgency(null);
    setDraftResult(null);
    setCopied(false);
  }

  async function handleStartDraft() {
    if (!data) return;
    setDraftPhase("identifying");
    setDraftError(null);
    try {
      const result = await identifyAgency(query, data.agencies);
      setAgencyResult(result);
      setSelectedAgency(result.agency);
      setRecordsDescription(query);
      setDraftPhase("confirm-agency");
    } catch (err) {
      setDraftError(
        err instanceof Error ? err.message : "Agency identification failed"
      );
      setDraftPhase("idle");
    }
  }

  async function handleGenerateDraft() {
    if (!selectedAgency || !requesterName.trim()) return;
    setDraftPhase("generating");
    setDraftError(null);
    try {
      const result = await generateDraft({
        description: recordsDescription,
        agency: selectedAgency,
        requester_name: requesterName.trim(),
        requester_organization: requesterOrg.trim(),
        fee_waiver: feeWaiver,
        expedited_processing: expedited,
        preferred_format: preferredFormat,
      });
      setDraftResult(result);
      setDraftPhase("review-draft");
    } catch (err) {
      setDraftError(
        err instanceof Error ? err.message : "Draft generation failed"
      );
      setDraftPhase("fill-details");
    }
  }

  async function handleCopy() {
    if (!draftResult) return;
    await navigator.clipboard.writeText(draftResult.letter_text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleTrackRequest() {
    if (!draftResult || !selectedAgency) return;
    setIsTracking(true);
    try {
      const detail = await trackRequest({
        title: recordsDescription.slice(0, 80) + (recordsDescription.length > 80 ? "..." : ""),
        description: recordsDescription,
        agency: selectedAgency,
        letter_text: draftResult.letter_text,
        requester_name: requesterName,
        requester_organization: requesterOrg,
        // Phase 2 research intelligence
        statute_cited: draftResult.statute_cited,
        key_elements: draftResult.key_elements,
        tips: draftResult.tips,
        submission_info: draftResult.submission_info,
        similar_requests: draftResult.similar_requests,
        drafting_strategy: draftResult.drafting_strategy,
        agency_intel: draftResult.agency_intel,
        // Phase 1 discovery results
        discovery_results: data?.steps.flatMap((s) =>
          s.results.map((r) => ({
            title: r.title || "",
            url: r.url,
            source: r.source,
            description: r.description,
            agency: r.agency,
            date: r.date ?? undefined,
            status: r.status,
          }))
        ) ?? [],
      });
      router.push(`/requests/${detail.request.id}`);
    } catch {
      setDraftError("Failed to save request for tracking. Please try again.");
      setIsTracking(false);
    }
  }

  return (
    <main className="container">
      <header className="header">
        <h1>FOIA Fluent</h1>
        <p>
          Describe what information you need — we&apos;ll find existing requests,
          public documents, and help you get the records released
        </p>
      </header>

      <form
        className="search-form"
        onSubmit={(e) => {
          e.preventDefault();
          handleSearch();
        }}
      >
        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Describe what you're looking for in plain language. For example:&#10;&#10;&quot;My family member died in an ICE detention center and I'm trying to get records about the circumstances of their death&quot;&#10;&#10;&quot;EPA water quality inspection reports for Flint, Michigan&quot;"
          className="search-textarea"
          rows={3}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSearch();
            }
          }}
        />
        <button type="submit" className="search-button" disabled={isLoading}>
          {isLoading ? "Searching..." : "Find Records"}
        </button>
      </form>

      {isLoading && (
        <ProgressStepper
          steps={[
            "Understanding your request",
            "Searching for existing FOIA requests",
            "Searching public document repositories",
          ]}
          intervalMs={3000}
        />
      )}

      {error && <div className="error-message">{error}</div>}

      {data && (
        <div className="discovery-results">
          {/* Intent summary */}
          <div className="intent-card">
            <h3>What we searched for</h3>
            <p>{data.intent}</p>
            {data.agencies.length > 0 && (
              <div className="tag-list">
                <span className="tag-label">Relevant agencies:</span>
                {data.agencies.map((a) => (
                  <span key={a} className="tag">
                    {a}
                  </span>
                ))}
              </div>
            )}
            {data.record_types.length > 0 && (
              <div className="tag-list">
                <span className="tag-label">Record types:</span>
                {data.record_types.map((r) => (
                  <span key={r} className="tag">
                    {r}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Recommendation */}
          <div className="recommendation-card">
            <h3>Recommendation</h3>
            <p>{data.recommendation}</p>
            {draftPhase === "idle" && (
              <button className="draft-button" onClick={handleStartDraft}>
                Draft a FOIA Request
              </button>
            )}
          </div>

          {/* Draft wizard */}
          {draftError && <div className="error-message">{draftError}</div>}

          {draftPhase === "identifying" && (
            <ProgressStepper
              steps={["Identifying the right federal agency"]}
              intervalMs={2000}
            />
          )}

          {draftPhase === "confirm-agency" && agencyResult && (
            <AgencyConfirmation
              result={agencyResult}
              selected={selectedAgency}
              onSelect={setSelectedAgency}
              onConfirm={() => setDraftPhase("fill-details")}
              onCancel={resetDraft}
            />
          )}

          {draftPhase === "fill-details" && selectedAgency && (
            <DraftForm
              agency={selectedAgency}
              recordsDescription={recordsDescription}
              setRecordsDescription={setRecordsDescription}
              requesterName={requesterName}
              setRequesterName={setRequesterName}
              requesterOrg={requesterOrg}
              setRequesterOrg={setRequesterOrg}
              feeWaiver={feeWaiver}
              setFeeWaiver={setFeeWaiver}
              expedited={expedited}
              setExpedited={setExpedited}
              preferredFormat={preferredFormat}
              setPreferredFormat={setPreferredFormat}
              onGenerate={handleGenerateDraft}
              onBack={() => setDraftPhase("confirm-agency")}
            />
          )}

          {draftPhase === "generating" && (
            <ProgressStepper
              steps={[
                "Researching similar FOIA requests on this topic",
                "Analyzing this agency's FOIA track record",
                "Generating optimized FOIA request letter",
              ]}
              intervalMs={4000}
            />
          )}

          {draftPhase === "review-draft" && draftResult && (
            <DraftReview
              draft={draftResult}
              copied={copied}
              onCopy={handleCopy}
              onStartOver={resetDraft}
              onTrack={handleTrackRequest}
              isTracking={isTracking}
            />
          )}

          {/* Discovery steps */}
          {data.steps.map((step) => (
            <StepSection key={step.step} step={step} />
          ))}
        </div>
      )}
    </main>
  );
}

/* --- Progress Stepper --- */

function ProgressStepper({
  steps,
  intervalMs,
}: {
  steps: string[];
  intervalMs: number;
}) {
  const [activeStep, setActiveStep] = useState(0);

  useEffect(() => {
    if (activeStep >= steps.length - 1) return;
    const timer = setTimeout(() => setActiveStep((s) => s + 1), intervalMs);
    return () => clearTimeout(timer);
  }, [activeStep, steps.length, intervalMs]);

  return (
    <div className="progress-stepper">
      {steps.map((label, i) => (
        <div
          key={i}
          className={`progress-step ${
            i < activeStep
              ? "step-done"
              : i === activeStep
                ? "step-active"
                : "step-pending"
          }`}
        >
          <div className="progress-indicator">
            {i < activeStep ? (
              <span className="progress-check">&#10003;</span>
            ) : i === activeStep ? (
              <span className="progress-spinner" />
            ) : (
              <span className="progress-dot" />
            )}
          </div>
          <span className="progress-label">{label}</span>
        </div>
      ))}
    </div>
  );
}

/* --- Agency Confirmation --- */

function AgencyConfirmation({
  result,
  selected,
  onSelect,
  onConfirm,
  onCancel,
}: {
  result: AgencyIdentifyResponse;
  selected: AgencyInfo | null;
  onSelect: (a: AgencyInfo) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="draft-wizard">
      <h3 className="wizard-title">Step 1: Confirm the Agency</h3>
      <p className="wizard-reasoning">{result.reasoning}</p>

      <div className="agency-options">
        <AgencyCard
          agency={result.agency}
          isSelected={selected?.abbreviation === result.agency.abbreviation}
          isPrimary
          onClick={() => onSelect(result.agency)}
        />
        {result.alternatives.map((alt) => (
          <AgencyCard
            key={alt.abbreviation}
            agency={alt}
            isSelected={selected?.abbreviation === alt.abbreviation}
            onClick={() => onSelect(alt)}
          />
        ))}
      </div>

      <div className="wizard-actions">
        <button className="draft-button" onClick={onConfirm} disabled={!selected}>
          Continue with {selected?.abbreviation || "..."}
        </button>
        <button className="wizard-cancel" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function AgencyCard({
  agency,
  isSelected,
  isPrimary,
  onClick,
}: {
  agency: AgencyInfo;
  isSelected: boolean;
  isPrimary?: boolean;
  onClick: () => void;
}) {
  return (
    <div
      className={`agency-card ${isSelected ? "agency-card-selected" : ""}`}
      onClick={onClick}
    >
      <div className="agency-card-header">
        <strong>
          {agency.abbreviation} — {agency.name}
        </strong>
        {isPrimary && <span className="tag">Recommended</span>}
      </div>
      <p className="agency-card-desc">{agency.description}</p>
      <div className="agency-card-meta">
        {agency.foia_website && (
          <a
            href={agency.foia_website}
            target="_blank"
            rel="noopener noreferrer"
          >
            FOIA Portal
          </a>
        )}
        {agency.foia_regulation && (
          <span>Regulation: {agency.foia_regulation}</span>
        )}
      </div>
    </div>
  );
}

/* --- Draft Form --- */

function DraftForm({
  agency,
  recordsDescription,
  setRecordsDescription,
  requesterName,
  setRequesterName,
  requesterOrg,
  setRequesterOrg,
  feeWaiver,
  setFeeWaiver,
  expedited,
  setExpedited,
  preferredFormat,
  setPreferredFormat,
  onGenerate,
  onBack,
}: {
  agency: AgencyInfo;
  recordsDescription: string;
  setRecordsDescription: (v: string) => void;
  requesterName: string;
  setRequesterName: (v: string) => void;
  requesterOrg: string;
  setRequesterOrg: (v: string) => void;
  feeWaiver: boolean;
  setFeeWaiver: (v: boolean) => void;
  expedited: boolean;
  setExpedited: (v: boolean) => void;
  preferredFormat: string;
  setPreferredFormat: (v: string) => void;
  onGenerate: () => void;
  onBack: () => void;
}) {
  return (
    <div className="draft-wizard">
      <h3 className="wizard-title">
        Step 2: Request Details for {agency.abbreviation}
      </h3>

      <div className="draft-form">
        <label className="form-label">
          Your Name <span className="required">*</span>
          <input
            type="text"
            value={requesterName}
            onChange={(e) => setRequesterName(e.target.value)}
            className="form-input"
            placeholder="Full name"
          />
        </label>

        <label className="form-label">
          Organization (optional)
          <input
            type="text"
            value={requesterOrg}
            onChange={(e) => setRequesterOrg(e.target.value)}
            className="form-input"
            placeholder="e.g. ACLU, ProPublica, University of..."
          />
        </label>

        <label className="form-label">
          Records Description
          <textarea
            value={recordsDescription}
            onChange={(e) => setRecordsDescription(e.target.value)}
            className="search-textarea"
            rows={4}
            placeholder="Describe what records you need..."
          />
          <span className="form-hint">
            Refine your description — Claude will translate this into precise
            legal language for the request letter.
          </span>
        </label>

        <label className="form-label">
          Preferred Format
          <select
            value={preferredFormat}
            onChange={(e) => setPreferredFormat(e.target.value)}
            className="form-input"
          >
            <option value="electronic">Electronic (PDF)</option>
            <option value="paper">Paper copies</option>
          </select>
        </label>

        <div className="form-checkboxes">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={feeWaiver}
              onChange={(e) => setFeeWaiver(e.target.checked)}
            />
            <span>Request fee waiver</span>
            <span className="form-hint">
              Under 5 U.S.C. 552(a)(4)(A)(iii) — if disclosure is in the public
              interest and not primarily for commercial use
            </span>
          </label>

          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={expedited}
              onChange={(e) => setExpedited(e.target.checked)}
            />
            <span>Request expedited processing</span>
            <span className="form-hint">
              Under 5 U.S.C. 552(a)(6)(E) — requires demonstrating a compelling
              need (imminent threat or urgent public interest)
            </span>
          </label>
        </div>

        <div className="wizard-actions">
          <button
            className="draft-button"
            onClick={onGenerate}
            disabled={!requesterName.trim()}
          >
            Generate FOIA Request
          </button>
          <button className="wizard-cancel" onClick={onBack}>
            Back
          </button>
        </div>
      </div>
    </div>
  );
}

/* --- Draft Review --- */

function DraftReview({
  draft,
  copied,
  onCopy,
  onStartOver,
  onTrack,
  isTracking,
}: {
  draft: DraftResponse;
  copied: boolean;
  onCopy: () => void;
  onStartOver: () => void;
  onTrack: () => void;
  isTracking: boolean;
}) {
  const strategy = draft.drafting_strategy;
  const intel = draft.agency_intel;
  const hasIntel =
    intel &&
    (intel.success_patterns?.length > 0 ||
      intel.denial_patterns?.length > 0 ||
      intel.exemption_patterns?.length > 0);

  const [showAgencyResearch, setShowAgencyResearch] = useState(false);

  return (
    <div className="draft-wizard">
      <h3 className="wizard-title">Your FOIA Request Letter</h3>

      {/* Key elements */}
      {draft.key_elements.length > 0 && (
        <div className="tag-list" style={{ marginBottom: "1rem" }}>
          {draft.key_elements.map((el) => (
            <span key={el} className="tag">
              {el}
            </span>
          ))}
        </div>
      )}

      {/* Letter */}
      <div className="letter-preview">
        <pre className="letter-text">{draft.letter_text}</pre>
        <button className="copy-button" onClick={onCopy}>
          {copied ? "Copied!" : "Copy to Clipboard"}
        </button>
      </div>

      {/* Submission info */}
      <div className="submission-card">
        <h4>How to Submit</h4>
        <p>{draft.submission_info}</p>
        {draft.agency.foia_website && (
          <a
            href={draft.agency.foia_website}
            target="_blank"
            rel="noopener noreferrer"
            className="portal-link"
          >
            Open {draft.agency.abbreviation} FOIA Portal
          </a>
        )}
      </div>

      {/* How We Built This Draft — combined interpretability section */}
      <div className="strategy-card">
        <h4>How We Built This Draft</h4>

        {strategy?.summary && (
          <p className="strategy-summary">{strategy.summary}</p>
        )}

        {/* Agency FOIA Profile */}
        {hasIntel && (
          <div className="agency-profile">
            <h5 className="agency-profile-title">
              {draft.agency.abbreviation} FOIA Profile
            </h5>
            <div className="agency-profile-stats">
              <span className="profile-stat stat-success">
                {intel.success_patterns.length} completed requests found
              </span>
              <span className="profile-stat stat-denied">
                {intel.denial_patterns.length} denied/rejected found
              </span>
              <span className="profile-stat stat-exempt">
                {intel.exemption_patterns.length} exemption-related found
              </span>
            </div>
          </div>
        )}

        <div className="strategy-details">
          {strategy?.learned_from_successes && (
            <div className="strategy-item">
              <span className="strategy-icon strategy-icon-success">&#10003;</span>
              <div>
                <strong>Learned from successful requests</strong>
                <p>{strategy.learned_from_successes}</p>
              </div>
            </div>
          )}

          {strategy?.avoided_from_denials && (
            <div className="strategy-item">
              <span className="strategy-icon strategy-icon-warn">!</span>
              <div>
                <strong>Avoided patterns from denials</strong>
                <p>{strategy.avoided_from_denials}</p>
              </div>
            </div>
          )}

          {strategy?.scope_decisions && (
            <div className="strategy-item">
              <span className="strategy-icon strategy-icon-scope">&#8680;</span>
              <div>
                <strong>Scope and specificity decisions</strong>
                <p>{strategy.scope_decisions}</p>
              </div>
            </div>
          )}

          {strategy?.exemption_awareness && (
            <div className="strategy-item">
              <span className="strategy-icon strategy-icon-shield">&#9632;</span>
              <div>
                <strong>Exemption risk mitigation</strong>
                <p>{strategy.exemption_awareness}</p>
              </div>
            </div>
          )}
        </div>

        {/* Topic-specific requests */}
        {draft.similar_requests.length > 0 && (
          <div className="strategy-sources">
            <strong>Topic-specific requests on MuckRock</strong>
            <ul className="similar-list">
              {draft.similar_requests.map((sr, i) => (
                <li key={i}>
                  <a
                    href={sr.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="result-title"
                  >
                    {sr.title}
                  </a>
                  {sr.status && (
                    <span
                      className={`similar-status ${
                        sr.status === "completed" || sr.status === "partially completed"
                          ? "status-completed"
                          : sr.status === "rejected" || sr.status === "no responsive documents"
                            ? "status-denied"
                            : ""
                      }`}
                    >
                      {sr.status}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Agency pattern research (collapsible) */}
        {hasIntel && (
          <div className="strategy-sources">
            <button
              className="collapse-toggle"
              onClick={() => setShowAgencyResearch(!showAgencyResearch)}
            >
              <strong>Agency-wide pattern research</strong>
              <span className="collapse-arrow">
                {showAgencyResearch ? "\u25B2" : "\u25BC"}
              </span>
            </button>
            {showAgencyResearch && (
              <div className="agency-research-details">
                {intel.success_patterns.length > 0 && (
                  <div>
                    <span className="research-label status-completed">Successful</span>
                    <ul className="similar-list">
                      {intel.success_patterns.map((sr, i) => (
                        <li key={`s-${i}`}>
                          <a
                            href={sr.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="result-title"
                          >
                            {sr.title}
                          </a>
                          {sr.status && (
                            <span className="similar-status status-completed">
                              {sr.status}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {intel.denial_patterns.length > 0 && (
                  <div>
                    <span className="research-label status-denied">Denied</span>
                    <ul className="similar-list">
                      {intel.denial_patterns.map((sr, i) => (
                        <li key={`d-${i}`}>
                          <a
                            href={sr.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="result-title"
                          >
                            {sr.title}
                          </a>
                          {sr.status && (
                            <span className="similar-status status-denied">
                              {sr.status}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {intel.exemption_patterns.length > 0 && (
                  <div>
                    <span className="research-label">Exemption-related</span>
                    <ul className="similar-list">
                      {intel.exemption_patterns.map((sr, i) => (
                        <li key={`e-${i}`}>
                          <a
                            href={sr.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="result-title"
                          >
                            {sr.title}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Tips */}
      {draft.tips.length > 0 && (
        <div className="tips-card">
          <h4>Submission Tips</h4>
          <ul>
            {draft.tips.map((tip, i) => (
              <li key={i}>{tip}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="wizard-actions">
        <button
          className="draft-button"
          onClick={onTrack}
          disabled={isTracking}
        >
          {isTracking ? "Saving..." : "Track This Request"}
        </button>
        <button className="wizard-cancel" onClick={onStartOver}>
          Start Over
        </button>
      </div>
    </div>
  );
}

/* --- Discovery components --- */

function StepSection({ step }: { step: DiscoveryStep }) {
  const icon = step.step === 1 ? "1" : "2";

  return (
    <div className={`step-section ${step.found ? "step-found" : "step-empty"}`}>
      <div className="step-header">
        <span className="step-number">{icon}</span>
        <div>
          <h3>{step.title}</h3>
          <p className="step-description">{step.description}</p>
        </div>
        <span className={`step-badge ${step.found ? "found" : "not-found"}`}>
          {step.found ? `${step.results.length} found` : "None found"}
        </span>
      </div>

      {step.results.length > 0 && (
        <ul className="results-list">
          {step.results.map((r) => (
            <ResultCard key={r.id} result={r} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ResultCard({ result }: { result: SearchResult }) {
  return (
    <li className="result-card">
      <div className="result-header">
        <a
          href={result.url}
          target="_blank"
          rel="noopener noreferrer"
          className="result-title"
        >
          {result.title || `Result ${result.id}`}
        </a>
        <span
          className="source-badge"
          style={{ backgroundColor: SOURCE_COLORS[result.source] || "#6b7280" }}
        >
          {SOURCE_LABELS[result.source] || result.source}
        </span>
      </div>

      {result.description && (
        <p className="result-description">{result.description}</p>
      )}

      <div className="result-meta">
        {result.agency && <span>Agency: {result.agency}</span>}
        {result.date && <span>{formatDate(result.date)}</span>}
        {result.page_count != null && <span>{result.page_count} pages</span>}
        {result.filed_by && <span>Filed by: {result.filed_by}</span>}
      </div>
    </li>
  );
}
