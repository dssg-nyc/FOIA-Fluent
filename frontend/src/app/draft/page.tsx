"use client";

import { useState, useEffect, useMemo, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  discover,
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
import { saveDiscovery, type DiscoveryStatus } from "@/lib/discoveries-api";
import { saveSearch, fetchSavedSearch } from "@/lib/saved-searches-api";
import { supabase } from "@/lib/supabase";

const SOURCE_LABELS: Record<string, string> = {
  documentcloud: "DocumentCloud",
  web: "Web",
  muckrock: "MuckRock",
};

const SOURCE_COLORS: Record<string, string> = {
  documentcloud: "#1863dc",
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

function formatRelativeTime(iso: string | null): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  const now = Date.now();
  const seconds = Math.max(0, Math.floor((now - then) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

type DraftPhase =
  | "idle"
  | "identifying"
  | "confirm-agency"
  | "fill-details"
  | "generating"
  | "review-draft";

export default function Home() {
  return (
    <Suspense
      fallback={
        <main className="container-wide draft-main">
          <div className="discover-loading-card">
            <div className="discover-loading-eyebrow">Loading</div>
            <h2 className="discover-loading-title">Preparing your workspace</h2>
          </div>
        </main>
      }
    >
      <HomeInner />
    </Suspense>
  );
}

function HomeInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Restore search state from sessionStorage so navigating away + back
  // doesn't erase the user's search results.
  const STORAGE_KEY = "foiafluent.draft.searchState";

  const [query, setQuery] = useState("");
  const [data, setData] = useState<DiscoveryResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  // Persist search state whenever it changes (only after hydration so we
  // don't overwrite on the mount that reads it).
  useEffect(() => {
    if (!hydrated) return;
    try {
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ query, data }),
      );
    } catch { /* sessionStorage full or unavailable — ignore */ }
  }, [query, data, hydrated]);

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

  async function runSearchWith(q: string) {
    if (!q.trim()) return;
    setIsLoading(true);
    setError(null);
    resetDraft();
    try {
      const result = await discover(q.trim());
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
      setData(null);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSearch() {
    return runSearchWith(query);
  }

  // Save-search state
  const [searchSavedAt, setSearchSavedAt] = useState<number | null>(null);
  const [isSavingSearch, setIsSavingSearch] = useState(false);
  const [searchSaveError, setSearchSaveError] = useState<string | null>(null);
  const [snapshotAt, setSnapshotAt] = useState<string | null>(null);
  const [savedSearchId, setSavedSearchId] = useState<string | null>(null);

  async function handleSaveSearch() {
    if (!data || !query.trim()) return;
    setIsSavingSearch(true);
    setSearchSaveError(null);
    try {
      const resultCount = (data.steps || []).reduce(
        (acc, s) => acc + (s.results?.length || 0),
        0,
      );
      const saved = await saveSearch({
        query: query.trim(),
        interpretation: {
          intent: data.intent,
          agencies: data.agencies,
          record_types: data.record_types,
        },
        result_count: resultCount,
        // Snapshot the full DiscoveryResponse so clicking this saved search
        // from the sidebar re-opens instantly without re-running discovery.
        result_snapshot: data as unknown as Record<string, unknown>,
      });
      setSavedSearchId(saved.id);
      setSnapshotAt(saved.snapshot_at);
      setSearchSavedAt(Date.now());
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("foiafluent.saved-search-changed"));
      }
      setTimeout(() => setSearchSavedAt(null), 2500);
    } catch (e) {
      setSearchSaveError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setIsSavingSearch(false);
    }
  }

  async function handleRefreshSearch() {
    if (!query.trim()) return;
    await runSearchWith(query);
    // If this search came from a saved row, re-save to update the snapshot.
    if (savedSearchId) {
      // Need the fresh `data`, but setState is async — so we re-use the
      // updated state via a follow-up effect below.
    }
  }

  // When the user refreshes a loaded-from-snapshot search and it finishes,
  // automatically update the snapshot on the saved row.
  useEffect(() => {
    if (!savedSearchId || !data) return;
    if (isLoading) return;
    // Only auto-update if this `data` has different content than the current
    // snapshot_at — avoid re-saving unchanged data.
    const resultCount = (data.steps || []).reduce(
      (acc, s) => acc + (s.results?.length || 0),
      0,
    );
    saveSearch({
      query: query.trim(),
      interpretation: {
        intent: data.intent,
        agencies: data.agencies,
        record_types: data.record_types,
      },
      result_count: resultCount,
      result_snapshot: data as unknown as Record<string, unknown>,
    })
      .then((saved) => {
        setSnapshotAt(saved.snapshot_at);
        if (typeof window !== "undefined") {
          window.dispatchEvent(new Event("foiafluent.saved-search-changed"));
        }
      })
      .catch(() => { /* ignore — refresh is best-effort */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // On mount, in priority order:
  //   1. ?id=<uuid>  → hydrate from saved_searches.result_snapshot (instant)
  //   2. ?q=<query>  → run a fresh discovery pipeline
  //   3. sessionStorage → restore prior in-session state
  useEffect(() => {
    const urlId = searchParams.get("id");
    const urlQuery = searchParams.get("q");

    if (urlId) {
      fetchSavedSearch(urlId)
        .then((saved) => {
          setSavedSearchId(saved.id);
          setSnapshotAt(saved.snapshot_at);
          setQuery(saved.query);
          if (saved.result_snapshot) {
            setData(saved.result_snapshot as unknown as DiscoveryResponse);
          } else {
            // Older rows with no snapshot — fall back to re-running.
            runSearchWith(saved.query);
          }
        })
        .catch(() => {
          if (urlQuery && urlQuery.trim()) {
            setQuery(urlQuery);
            runSearchWith(urlQuery);
          }
        })
        .finally(() => setHydrated(true));
      return;
    }

    if (urlQuery && urlQuery.trim()) {
      setQuery(urlQuery);
      runSearchWith(urlQuery);
    } else {
      try {
        const raw = sessionStorage.getItem(STORAGE_KEY);
        if (raw) {
          const saved = JSON.parse(raw);
          if (saved.query) setQuery(saved.query);
          if (saved.data) setData(saved.data);
        }
      } catch { /* ignore */ }
    }
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function resetDraft() {
    setDraftPhase("idle");
    setDraftError(null);
    setAgencyResult(null);
    setSelectedAgency(null);
    setDraftResult(null);
    setCopied(false);
  }

  function handleStartDraft() {
    if (!data) return;
    setDraftError(null);
    // Agency was already identified during discovery — use it directly
    if (data.agency) {
      setAgencyResult({
        agency: data.agency,
        alternatives: data.alternatives || [],
        reasoning: data.agency_reasoning || "",
      });
      setSelectedAgency(data.agency);
      setRecordsDescription(query);
      setDraftPhase("confirm-agency");
    } else {
      setDraftError("Could not identify an agency. Please try a more specific query.");
    }
  }

  async function handleGenerateDraft() {
    if (!selectedAgency || !requesterName.trim() || !data) return;
    setDraftPhase("generating");
    setDraftError(null);

    // Reuse similar_requests from discovery if same agency, otherwise let draft re-fetch
    const sameAgency = data.agency?.abbreviation === selectedAgency.abbreviation;
    try {
      const result = await generateDraft({
        description: recordsDescription,
        agency: selectedAgency,
        requester_name: requesterName.trim(),
        requester_organization: requesterOrg.trim(),
        fee_waiver: feeWaiver,
        expedited_processing: expedited,
        preferred_format: preferredFormat,
        ...(sameAgency && data.similar_requests.length > 0
          ? { similar_requests_prefetched: data.similar_requests }
          : {}),
      });
      setDraftResult(result);

      // If different agency, update Step 1 display to match the new similar_requests
      if (!sameAgency && result.similar_requests.length > 0) {
        setData((prev) => {
          if (!prev) return prev;
          const newStep1Results = result.similar_requests.map((sr, i) => ({
            id: `mr-${i}`,
            title: sr.title,
            status: sr.status,
            source: "muckrock" as const,
            url: sr.url,
            date: null,
            description: sr.description,
            agency: "",
            filed_by: "",
            page_count: null,
          }));
          const updatedSteps = prev.steps.map((step) =>
            step.step === 1
              ? {
                  ...step,
                  title: "Similar FOIA Requests",
                  description: `Similar FOIA requests filed with ${selectedAgency.abbreviation}`,
                  results: newStep1Results,
                  found: newStep1Results.length > 0,
                }
              : step
          );
          return { ...prev, steps: updatedSteps };
        });
      }

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

    const payload = {
      title: recordsDescription.slice(0, 80) + (recordsDescription.length > 80 ? "..." : ""),
      description: recordsDescription,
      agency: selectedAgency,
      letter_text: draftResult.letter_text,
      requester_name: requesterName,
      requester_organization: requesterOrg,
      statute_cited: draftResult.statute_cited,
      key_elements: draftResult.key_elements,
      tips: draftResult.tips,
      submission_info: draftResult.submission_info,
      similar_requests: draftResult.similar_requests,
      drafting_strategy: draftResult.drafting_strategy,
      agency_intel: draftResult.agency_intel,
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
    };

    // If Supabase is configured, check auth before proceeding
    if (supabase) {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        // Save payload and redirect to login — callback will submit it after sign-in
        localStorage.setItem("pending_track_request", JSON.stringify(payload));
        router.push("/login?next=track");
        return;
      }
    }

    setIsTracking(true);
    try {
      const detail = await trackRequest(payload);
      router.push(`/requests/${detail.request.id}`);
    } catch {
      setDraftError("Failed to save request for tracking. Please try again.");
      setIsTracking(false);
    }
  }

  return (
    <main className="container-wide draft-main">
      <header className="header">
        <h1>Find records. Draft requests.</h1>
        <p>
          Describe what you need — we&apos;ll surface existing requests, public
          documents, and help you get the records released.
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
          placeholder="Describe what you're looking for in plain language. Example: FDA inspection records of vaccine manufacturers since 2023."
          className="search-textarea"
          rows={5}
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
          title="Searching federal, state, and local public records"
          steps={[
            "Understanding your request",
            "Identifying the best agency",
            "Finding similar FOIA requests",
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
            {savedSearchId ? (
              <div className="search-snapshot-bar">
                <span className="search-snapshot-meta">
                  Saved · captured {formatRelativeTime(snapshotAt)}
                </span>
                <button
                  type="button"
                  className="search-refresh-btn"
                  onClick={handleRefreshSearch}
                  disabled={isLoading}
                  title="Re-run the discovery pipeline and update the snapshot"
                >
                  {isLoading ? "Refreshing…" : "Refresh"}
                </button>
              </div>
            ) : (
              <button
                type="button"
                className={`draft-button save-search-btn ${searchSavedAt ? "save-search-btn-saved" : ""}`}
                onClick={handleSaveSearch}
                disabled={isSavingSearch || !!searchSavedAt}
                title="Save this query to revisit from the Saved Searches list"
              >
                {searchSavedAt ? (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    Saved
                  </>
                ) : isSavingSearch ? (
                  "Saving…"
                ) : (
                  "Save this search"
                )}
              </button>
            )}
            {searchSaveError && (
              <div className="save-search-error">{searchSaveError}</div>
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
              title="Drafting your FOIA request"
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

          {/* Three-pane discovery results — left filter rail, middle compact rows, right preview pane */}
          <DiscoveryResults steps={data.steps} query={data.query} />
        </div>
      )}
    </main>
  );
}

/* --- Progress Stepper --- */

function ProgressStepper({
  title,
  steps,
  intervalMs,
}: {
  title: string;
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
    <div className="discover-loading-card">
      <div className="discover-loading-eyebrow">Working on it</div>
      <h2 className="discover-loading-title">{title}</h2>
      <ol className="discover-loading-steps">
        {steps.map((label, i) => {
          const state =
            i < activeStep ? "done" : i === activeStep ? "active" : "pending";
          return (
            <li key={i} className={`discover-loading-step discover-loading-step-${state}`}>
              <span className="discover-loading-indicator" aria-hidden="true">
                {state === "done" ? (
                  <span className="discover-loading-check">&#10003;</span>
                ) : state === "active" ? (
                  <span className="discover-loading-spinner" />
                ) : (
                  <span className="discover-loading-dot" />
                )}
              </span>
              <span className="discover-loading-label">{label}</span>
            </li>
          );
        })}
      </ol>
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

  const [showAgencyResearch, setShowAgencyResearch] = useState(true);

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
        <h4>Initial Request Analysis</h4>

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
            <strong>Similar FOIA Requests</strong>
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
                    <span className="research-label status-exemption">Exemption-related</span>
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

/* --- Three-pane Discovery Results --- */

type SortKey = "relevance" | "newest" | "pages";

function yearBucket(dateStr: string | null): "2024-25" | "2020-23" | "older" | "unknown" {
  if (!dateStr) return "unknown";
  const y = new Date(dateStr).getUTCFullYear();
  if (Number.isNaN(y)) return "unknown";
  if (y >= 2024) return "2024-25";
  if (y >= 2020) return "2020-23";
  return "older";
}

function DiscoveryResults({
  steps,
  query,
}: {
  steps: DiscoveryStep[];
  query: string;
}) {
  // Flatten all results across steps into one searchable list. Each result keeps
  // its source so we can badge + filter by source in the rail.
  const allResults: SearchResult[] = useMemo(
    () => steps.flatMap((s) => s.results || []),
    [steps],
  );

  // Tracked requests for the "Link to" dropdown in the detail pane.
  // Lazy-loaded once on mount; ignored on failure.
  const [trackedRequests, setTrackedRequests] = useState<
    { id: string; title: string }[]
  >([]);
  useEffect(() => {
    import("@/lib/tracking-api")
      .then((m) => m.listRequests())
      .then((rs) =>
        setTrackedRequests(
          (rs || []).map((r) => ({
            id: r.request.id,
            title: r.request.title || `Request ${r.request.id.slice(0, 8)}`,
          })),
        ),
      )
      .catch(() => setTrackedRequests([]));
  }, []);

  const [selectedId, setSelectedId] = useState<string | null>(
    allResults.length > 0 ? allResults[0].id : null,
  );
  const [sourceFilter, setSourceFilter] = useState<string[]>([]);
  const [yearFilter, setYearFilter] = useState<string[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>("relevance");

  // Source counts (from the unfiltered set, so the rail always shows the totals)
  const sourceCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of allResults) m[r.source] = (m[r.source] || 0) + 1;
    return m;
  }, [allResults]);

  // Year bucket counts (also unfiltered)
  const yearCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of allResults) {
      const b = yearBucket(r.date);
      m[b] = (m[b] || 0) + 1;
    }
    return m;
  }, [allResults]);

  // Apply filters + sort
  const visible = useMemo(() => {
    let arr = allResults;
    if (sourceFilter.length > 0) {
      arr = arr.filter((r) => sourceFilter.includes(r.source));
    }
    if (yearFilter.length > 0) {
      arr = arr.filter((r) => yearFilter.includes(yearBucket(r.date)));
    }
    if (sortKey === "newest") {
      arr = [...arr].sort((a, b) => {
        const ad = a.date ? new Date(a.date).getTime() : 0;
        const bd = b.date ? new Date(b.date).getTime() : 0;
        return bd - ad;
      });
    } else if (sortKey === "pages") {
      arr = [...arr].sort((a, b) => (b.page_count || 0) - (a.page_count || 0));
    }
    return arr;
  }, [allResults, sourceFilter, yearFilter, sortKey]);

  // Keep selection valid as filters change
  useEffect(() => {
    if (visible.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !visible.find((r) => r.id === selectedId)) {
      setSelectedId(visible[0].id);
    }
  }, [visible, selectedId]);

  const selected = visible.find((r) => r.id === selectedId) || null;

  function toggleSource(s: string) {
    setSourceFilter((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s],
    );
  }
  function toggleYear(y: string) {
    setYearFilter((prev) =>
      prev.includes(y) ? prev.filter((x) => x !== y) : [...prev, y],
    );
  }

  if (allResults.length === 0) {
    return (
      <div className="discover-empty">
        No public records found yet. You can still draft a FOIA request below.
      </div>
    );
  }

  return (
    <div className="discover-three-pane">
      {/* LEFT RAIL */}
      <aside className="discover-rail">
        <div className="discover-rail-section">
          <div className="discover-rail-label">Sources</div>
          <ul className="discover-rail-list">
            {Object.entries(sourceCounts).map(([source, count]) => {
              const active = sourceFilter.includes(source);
              return (
                <li key={source}>
                  <button
                    type="button"
                    className={`discover-rail-btn ${active ? "discover-rail-btn-active" : ""}`}
                    onClick={() => toggleSource(source)}
                  >
                    <span className="discover-rail-btn-name">
                      {SOURCE_LABELS[source] || source}
                    </span>
                    <span className="discover-rail-btn-count">{count}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        {Object.keys(yearCounts).length > 1 && (
          <div className="discover-rail-section">
            <div className="discover-rail-label">Year</div>
            <ul className="discover-rail-list">
              {[
                { key: "2024-25", label: "2024 – 2025" },
                { key: "2020-23", label: "2020 – 2023" },
                { key: "older", label: "Before 2020" },
                { key: "unknown", label: "No date" },
              ].map(({ key, label }) => {
                const count = yearCounts[key] || 0;
                if (count === 0) return null;
                const active = yearFilter.includes(key);
                return (
                  <li key={key}>
                    <button
                      type="button"
                      className={`discover-rail-btn ${active ? "discover-rail-btn-active" : ""}`}
                      onClick={() => toggleYear(key)}
                    >
                      <span className="discover-rail-btn-name">{label}</span>
                      <span className="discover-rail-btn-count">{count}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <div className="discover-rail-section">
          <div className="discover-rail-label">Sort</div>
          <ul className="discover-rail-list">
            {[
              { key: "relevance" as SortKey, label: "Relevance" },
              { key: "newest" as SortKey, label: "Newest first" },
              { key: "pages" as SortKey, label: "Most pages" },
            ].map(({ key, label }) => (
              <li key={key}>
                <button
                  type="button"
                  className={`discover-rail-btn ${sortKey === key ? "discover-rail-btn-active" : ""}`}
                  onClick={() => setSortKey(key)}
                >
                  <span className="discover-rail-btn-name">{label}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      {/* MIDDLE — compact row list */}
      <section className="discover-row-list">
        <div className="discover-row-list-header">
          {visible.length} {visible.length === 1 ? "record" : "records"}
          {(sourceFilter.length > 0 || yearFilter.length > 0) &&
            ` (filtered from ${allResults.length})`}
        </div>
        <ul className="discover-rows">
          {visible.map((r) => (
            <li key={r.id}>
              <DiscoveryRow
                result={r}
                selected={selectedId === r.id}
                onClick={() => setSelectedId(r.id)}
              />
            </li>
          ))}
        </ul>
      </section>

      {/* RIGHT — detail pane */}
      <DiscoveryDetailPane
        result={selected}
        discoveredViaQuery={query}
        trackedRequests={trackedRequests}
      />
    </div>
  );
}

function DiscoveryRow({
  result,
  selected,
  onClick,
}: {
  result: SearchResult;
  selected: boolean;
  onClick: () => void;
}) {
  const sourceLabel = SOURCE_LABELS[result.source] || result.source;
  const subjectParts: string[] = [sourceLabel];
  if (result.agency) subjectParts.push(result.agency);
  if (result.date) subjectParts.push(formatDate(result.date));
  if (result.page_count != null) subjectParts.push(`${result.page_count} pages`);

  return (
    <button
      type="button"
      className={`discover-row ${selected ? "discover-row-selected" : ""}`}
      onClick={onClick}
    >
      <span className="discover-row-headline">
        {result.title || `Result ${result.id}`}
      </span>
      <span className="discover-row-meta">
        <span className="discover-row-source">{sourceLabel}</span>
        {result.agency && (
          <>
            <span className="discover-row-meta-dot">·</span>
            <span>{result.agency}</span>
          </>
        )}
        {result.date && (
          <>
            <span className="discover-row-meta-dot">·</span>
            <span>{formatDate(result.date)}</span>
          </>
        )}
        {result.page_count != null && (
          <>
            <span className="discover-row-meta-dot">·</span>
            <span>{result.page_count} pages</span>
          </>
        )}
      </span>
    </button>
  );
}

function DiscoveryDetailPane({
  result,
  discoveredViaQuery,
  trackedRequests,
}: {
  result: SearchResult | null;
  discoveredViaQuery: string;
  trackedRequests: { id: string; title: string }[];
}) {
  // Save lifecycle state — keyed by result.id so it resets when the user
  // clicks a different row in the middle column.
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [savedId, setSavedId] = useState<string | null>(null);
  const [showNoteForm, setShowNoteForm] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [statusDraft, setStatusDraft] = useState<DiscoveryStatus>("saved");
  const [linkedRequestId, setLinkedRequestId] = useState<string>("");
  const [noteSavedAt, setNoteSavedAt] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Reset on result change
  useEffect(() => {
    setSaveStatus("idle");
    setSavedId(null);
    setShowNoteForm(false);
    setNoteDraft("");
    setStatusDraft("saved");
    setLinkedRequestId("");
    setNoteSavedAt(null);
    setErrorMsg(null);
  }, [result?.id]);

  if (!result) {
    return (
      <aside className="discover-detail-pane discover-detail-pane-empty">
        <div className="discover-detail-empty-inner">
          Select a record from the list to read the full details.
        </div>
      </aside>
    );
  }

  const sourceLabel = SOURCE_LABELS[result.source] || result.source;

  async function handleSave() {
    if (!result) return;
    setSaveStatus("saving");
    setErrorMsg(null);
    try {
      const saved = await saveDiscovery({
        source: result.source,
        source_id: result.id || null,
        title: result.title || `Result ${result.id}`,
        description: result.description || "",
        url: result.url,
        document_date: result.date || null,
        page_count: result.page_count ?? null,
        agency: result.agency || "",
        discovered_via_query: discoveredViaQuery || null,
        tracked_request_id: linkedRequestId || null,
        note: noteDraft || "",
      });
      setSavedId(saved.id);
      setSaveStatus("saved");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Save failed");
      setSaveStatus("error");
    }
  }

  async function handleUpdateNoteOrStatus() {
    if (!savedId) return;
    try {
      const { updateDiscovery } = await import("@/lib/discoveries-api");
      await updateDiscovery(savedId, {
        note: noteDraft,
        status: statusDraft,
        tracked_request_id: linkedRequestId || null,
      });
      setNoteSavedAt(Date.now());
      setTimeout(() => setNoteSavedAt(null), 2000);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Update failed");
    }
  }

  return (
    <aside className="discover-detail-pane">
      <div className="discover-detail-meta">
        <span className="discover-detail-badge">{sourceLabel}</span>
        {result.date && (
          <span className="discover-detail-date">{formatDate(result.date)}</span>
        )}
      </div>

      <h2 className="discover-detail-title">
        {result.title || `Result ${result.id}`}
      </h2>

      {(result.agency || result.page_count != null || result.filed_by) && (
        <dl className="discover-detail-facts">
          {result.agency && (
            <div className="discover-detail-fact">
              <dt>Agency</dt>
              <dd>{result.agency}</dd>
            </div>
          )}
          {result.page_count != null && (
            <div className="discover-detail-fact">
              <dt>Pages</dt>
              <dd>{result.page_count}</dd>
            </div>
          )}
          {result.filed_by && (
            <div className="discover-detail-fact">
              <dt>Filed by</dt>
              <dd>{result.filed_by}</dd>
            </div>
          )}
        </dl>
      )}

      {result.description && (
        <p className="discover-detail-description">{result.description}</p>
      )}

      <div className="discover-detail-actions">
        {saveStatus === "saved" ? (
          <span
            className="discover-detail-btn discover-detail-btn-saved"
            aria-label="Saved to your library"
          >
            Saved
          </span>
        ) : (
          <button
            type="button"
            className="discover-detail-btn discover-detail-btn-primary"
            onClick={handleSave}
            disabled={saveStatus === "saving"}
          >
            {saveStatus === "saving" ? "Saving…" : "Save"}
          </button>
        )}
        <button
          type="button"
          className="discover-detail-btn"
          onClick={() => setShowNoteForm((s) => !s)}
        >
          {showNoteForm ? "Hide note" : "Add note"}
        </button>
      </div>

      {result.url && (
        <a
          href={result.url}
          target="_blank"
          rel="noopener noreferrer"
          className="discover-detail-source-link"
        >
          Open original source ↗
        </a>
      )}

      {errorMsg && <p className="discover-detail-error">{errorMsg}</p>}

      {showNoteForm && (
        <div className="discover-detail-note-form">
          <label className="discover-detail-note-label">Note</label>
          <textarea
            className="discover-detail-note-textarea"
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            placeholder="Why this matters, what to look for, follow-ups…"
            rows={3}
          />
          <label className="discover-detail-note-label">Status</label>
          <select
            className="discover-detail-note-select"
            value={statusDraft}
            onChange={(e) => setStatusDraft(e.target.value as DiscoveryStatus)}
          >
            <option value="saved">Saved</option>
            <option value="reviewed">Reviewed</option>
            <option value="useful">Useful</option>
            <option value="not_useful">Not useful</option>
          </select>
          {trackedRequests.length > 0 && (
            <>
              <label className="discover-detail-note-label">Link to tracked request</label>
              <select
                className="discover-detail-note-select"
                value={linkedRequestId}
                onChange={(e) => setLinkedRequestId(e.target.value)}
              >
                <option value="">Not linked</option>
                {trackedRequests.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title}
                  </option>
                ))}
              </select>
            </>
          )}
          {savedId ? (
            <button
              type="button"
              className={`discover-detail-btn discover-detail-btn-primary ${
                noteSavedAt ? "discover-detail-btn-just-saved" : ""
              }`}
              onClick={handleUpdateNoteOrStatus}
            >
              {noteSavedAt ? (
                <span className="discover-saved-flash">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>
                  Saved
                </span>
              ) : (
                "Save note"
              )}
            </button>
          ) : (
            <p className="discover-detail-note-hint">
              Save the document first, then your note + status + link will be attached.
            </p>
          )}
        </div>
      )}
    </aside>
  );
}

/* Legacy StepSection / ResultCard removed — replaced by DiscoveryResults three-pane component above. */
