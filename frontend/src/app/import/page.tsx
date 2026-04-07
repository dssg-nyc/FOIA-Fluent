"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import AuthGuard from "@/components/AuthGuard";
import { importRequest } from "@/lib/tracking-api";

const AGENCIES = [
  { abbr: "APHIS", name: "Animal and Plant Health Inspection Service" },
  { abbr: "ARMY", name: "Department of the Army" },
  { abbr: "ATF", name: "Bureau of Alcohol, Tobacco, Firearms and Explosives" },
  { abbr: "BOP", name: "Federal Bureau of Prisons" },
  { abbr: "CBP", name: "U.S. Customs and Border Protection" },
  { abbr: "CDC", name: "Centers for Disease Control and Prevention" },
  { abbr: "CFPB", name: "Consumer Financial Protection Bureau" },
  { abbr: "CIA", name: "Central Intelligence Agency" },
  { abbr: "CISA", name: "Cybersecurity and Infrastructure Security Agency" },
  { abbr: "CMS", name: "Centers for Medicare and Medicaid Services" },
  { abbr: "DEA", name: "Drug Enforcement Administration" },
  { abbr: "DHS", name: "Department of Homeland Security" },
  { abbr: "DIA", name: "Defense Intelligence Agency" },
  { abbr: "DOC", name: "Department of Commerce" },
  { abbr: "DOD", name: "Department of Defense" },
  { abbr: "DOE", name: "Department of Energy" },
  { abbr: "DOI", name: "Department of the Interior" },
  { abbr: "DOJ", name: "Department of Justice" },
  { abbr: "DOL", name: "Department of Labor" },
  { abbr: "EEOC", name: "Equal Employment Opportunity Commission" },
  { abbr: "EPA", name: "Environmental Protection Agency" },
  { abbr: "FBI", name: "Federal Bureau of Investigation" },
  { abbr: "FCC", name: "Federal Communications Commission" },
  { abbr: "FDA", name: "Food and Drug Administration" },
  { abbr: "FEC", name: "Federal Election Commission" },
  { abbr: "FEMA", name: "Federal Emergency Management Agency" },
  { abbr: "FSIS", name: "Food Safety and Inspection Service" },
  { abbr: "FTC", name: "Federal Trade Commission" },
  { abbr: "HHS", name: "Department of Health and Human Services" },
  { abbr: "ICE", name: "U.S. Immigration and Customs Enforcement" },
  { abbr: "IRS", name: "Internal Revenue Service" },
  { abbr: "NARA", name: "National Archives and Records Administration" },
  { abbr: "NAVY", name: "Department of the Navy" },
  { abbr: "NIH", name: "National Institutes of Health" },
  { abbr: "NLRB", name: "National Labor Relations Board" },
  { abbr: "NSA", name: "National Security Agency" },
  { abbr: "NSF", name: "National Science Foundation" },
  { abbr: "OPM", name: "Office of Personnel Management" },
  { abbr: "SEC", name: "Securities and Exchange Commission" },
  { abbr: "SSA", name: "Social Security Administration" },
  { abbr: "STATE", name: "Department of State" },
  { abbr: "TREASURY", name: "Department of the Treasury" },
  { abbr: "TSA", name: "Transportation Security Administration" },
  { abbr: "USAF", name: "U.S. Air Force" },
  { abbr: "USCG", name: "U.S. Coast Guard" },
  { abbr: "USCIS", name: "U.S. Citizenship and Immigration Services" },
  { abbr: "USDA", name: "Department of Agriculture" },
  { abbr: "USMS", name: "U.S. Marshals Service" },
  { abbr: "USSS", name: "U.S. Secret Service" },
  { abbr: "VA", name: "Department of Veterans Affairs" },
];

type Step = "agency" | "letter" | "processing";

interface AgencyStep {
  abbreviation: string;
  description: string;
}

interface LetterStep {
  title: string;
  requester_name: string;
  requester_organization: string;
  letter_text: string;
  filed_date: string;
  existing_response: string;
}

export default function ImportPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("agency");
  const [error, setError] = useState<string | null>(null);

  const [agencyData, setAgencyData] = useState<AgencyStep>({
    abbreviation: "",
    description: "",
  });
  const [letterData, setLetterData] = useState<LetterStep>({
    title: "",
    requester_name: "",
    requester_organization: "",
    letter_text: "",
    filed_date: "",
    existing_response: "",
  });

  async function handleSubmit() {
    setStep("processing");
    setError(null);
    try {
      const result = await importRequest({
        title: letterData.title,
        description: agencyData.description,
        agency_abbreviation: agencyData.abbreviation.toUpperCase(),
        letter_text: letterData.letter_text,
        requester_name: letterData.requester_name,
        requester_organization: letterData.requester_organization || undefined,
        filed_date: letterData.filed_date || undefined,
        existing_response: letterData.existing_response || undefined,
      });
      router.push(`/requests/${result.request.id}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Import failed. Please try again.");
      setStep("letter");
    }
  }

  return (
    <AuthGuard>
      <main className="container">
        <div className="dashboard-header">
          <div>
            <h1 className="dashboard-title">Import an existing request</h1>
            <p className="dashboard-subtitle">
              Bring an in-flight FOIA request into the system — we'll analyze your letter
              and set up deadline tracking.
            </p>
          </div>
          <Link href="/dashboard" className="wizard-cancel">
            Cancel
          </Link>
        </div>

        {step === "agency" && (
          <AgencyStep
            data={agencyData}
            onChange={setAgencyData}
            onNext={() => setStep("letter")}
          />
        )}

        {step === "letter" && (
          <LetterStep
            data={letterData}
            onChange={setLetterData}
            onBack={() => setStep("agency")}
            onSubmit={handleSubmit}
            error={error}
          />
        )}

        {step === "processing" && <ProcessingState />}
      </main>
    </AuthGuard>
  );
}

// ── Step 1: Agency ─────────────────────────────────────────────────────────────

function AgencyStep({
  data,
  onChange,
  onNext,
}: {
  data: AgencyStep;
  onChange: (d: AgencyStep) => void;
  onNext: () => void;
}) {
  const [query, setQuery] = useState(
    () => {
      const match = AGENCIES.find(a => a.abbr === data.abbreviation);
      return match ? `${match.abbr} — ${match.name}` : data.abbreviation;
    }
  );
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // If query matches a selected agency display string, use the abbreviation part for filtering
  const searchTerm = query.includes(" — ") ? query.split(" — ")[0].trim() : query.trim();
  const filtered = searchTerm
    ? AGENCIES.filter(a => {
        const q = searchTerm.toUpperCase();
        return a.abbr.includes(q) || a.name.toUpperCase().includes(q);
      })
    : AGENCIES;

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function selectAgency(abbr: string, name: string) {
    onChange({ ...data, abbreviation: abbr });
    setQuery(`${abbr} — ${name}`);
    setOpen(false);
  }

  const canProceed = data.abbreviation.trim().length >= 2 && data.description.trim().length >= 10;

  return (
    <div className="wizard-step">
      <div className="wizard-step-header">
        <span className="wizard-step-number">Step 1 of 2</span>
        <h2>Which agency did you send this to?</h2>
        <p className="wizard-step-desc">
          Search for the federal agency and briefly describe what records you
          requested — this powers the research analysis.
        </p>
      </div>

      <div className="wizard-field">
        <label className="wizard-label">Agency *</label>
        <div className="agency-search-wrapper" ref={wrapperRef}>
          <input
            className="wizard-input"
            type="text"
            placeholder="Search by name or abbreviation…"
            value={query}
            onChange={(e) => {
              const val = e.target.value;
              setQuery(val);
              setOpen(true);
              // Clear selection — abbreviation only gets set via dropdown pick
              if (data.abbreviation) onChange({ ...data, abbreviation: "" });
            }}
            onFocus={() => setOpen(true)}
          />
          {open && filtered.length > 0 && (
            <ul className="agency-dropdown">
              {filtered.map((a) => (
                <li
                  key={a.abbr}
                  className={`agency-dropdown-item${a.abbr === data.abbreviation ? " selected" : ""}`}
                  onClick={() => selectAgency(a.abbr, a.name)}
                >
                  <strong>{a.abbr}</strong>
                  <span>{a.name}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <p className="wizard-hint">
          Select from 50+ federal agencies we have on file.
        </p>
      </div>

      <div className="wizard-field">
        <label className="wizard-label">What records did you request? *</label>
        <textarea
          className="wizard-textarea"
          rows={4}
          placeholder="Briefly describe the records you requested…"
          value={data.description}
          onChange={(e) => onChange({ ...data, description: e.target.value })}
        />
        <p className="wizard-hint">
          A few sentences is enough. This helps us find similar MuckRock requests and
          analyze your letter against relevant precedents.
        </p>
      </div>

      <div className="wizard-actions">
        <button className="draft-button" onClick={onNext} disabled={!canProceed}>
          Continue →
        </button>
      </div>
    </div>
  );
}

// ── Step 2: Letter details ─────────────────────────────────────────────────────

function LetterStep({
  data,
  onChange,
  onBack,
  onSubmit,
  error,
}: {
  data: LetterStep;
  onChange: (d: LetterStep) => void;
  onBack: () => void;
  onSubmit: () => void;
  error: string | null;
}) {
  const canSubmit =
    data.title.trim().length > 0 &&
    data.requester_name.trim().length > 0 &&
    data.letter_text.trim().length > 50;

  return (
    <div className="wizard-step">
      <div className="wizard-step-header">
        <span className="wizard-step-number">Step 2 of 2</span>
        <h2>Paste your letter and details</h2>
        <p className="wizard-step-desc">
          We'll analyze your letter against similar MuckRock outcomes and agency-specific
          exemption patterns. This takes about 30 seconds.
        </p>
      </div>

      {error && <div className="error-message">{error}</div>}

      <div className="wizard-field">
        <label className="wizard-label">Request title *</label>
        <input
          className="wizard-input"
          type="text"
          placeholder="e.g. ICE detainer request records 2023"
          value={data.title}
          onChange={(e) => onChange({ ...data, title: e.target.value })}
        />
        <p className="wizard-hint">A short label for your dashboard.</p>
      </div>

      <div className="import-row">
        <div className="wizard-field">
          <label className="wizard-label">Your name *</label>
          <input
            className="wizard-input"
            type="text"
            placeholder="Full name"
            value={data.requester_name}
            onChange={(e) => onChange({ ...data, requester_name: e.target.value })}
          />
        </div>
        <div className="wizard-field">
          <label className="wizard-label">Organization (optional)</label>
          <input
            className="wizard-input"
            type="text"
            placeholder="Organization name"
            value={data.requester_organization}
            onChange={(e) => onChange({ ...data, requester_organization: e.target.value })}
          />
        </div>
      </div>

      <div className="wizard-field">
        <label className="wizard-label">Date filed (optional)</label>
        <input
          className="wizard-input"
          type="date"
          value={data.filed_date}
          onChange={(e) => onChange({ ...data, filed_date: e.target.value })}
          style={{ maxWidth: "200px" }}
        />
        <p className="wizard-hint">
          If submitted, we'll start the 20-business-day deadline countdown.
        </p>
      </div>

      <div className="wizard-field">
        <label className="wizard-label">Your FOIA request letter *</label>
        <textarea
          className="wizard-textarea import-letter"
          rows={14}
          placeholder="Paste your full FOIA request letter here..."
          value={data.letter_text}
          onChange={(e) => onChange({ ...data, letter_text: e.target.value })}
        />
      </div>

      <div className="wizard-field">
        <label className="wizard-label">Agency response (optional)</label>
        <textarea
          className="wizard-textarea"
          rows={6}
          placeholder="If you've already received a response, paste it here — we'll analyze it immediately..."
          value={data.existing_response}
          onChange={(e) => onChange({ ...data, existing_response: e.target.value })}
        />
        <p className="wizard-hint">
          Skip this if you haven't heard back yet. You can always add a response later
          from the request detail page.
        </p>
      </div>

      <div className="wizard-actions">
        <button className="wizard-cancel" onClick={onBack}>
          ← Back
        </button>
        <button className="draft-button" onClick={onSubmit} disabled={!canSubmit}>
          Analyze & Track →
        </button>
      </div>
    </div>
  );
}

// ── Processing state ───────────────────────────────────────────────────────────

function ProcessingState() {
  return (
    <div className="processing-state">
      <div className="processing-spinner" />
      <h2 className="processing-title">Analyzing your request…</h2>
      <p className="processing-subtitle">
        Searching MuckRock for similar outcomes, reviewing agency exemption patterns,
        and assessing your letter. This takes about 30 seconds.
      </p>
      <ul className="processing-steps">
        <li>Researching similar FOIA requests on MuckRock</li>
        <li>Pulling agency FOIA track record</li>
        <li>Analyzing letter scope and exemption exposure</li>
        <li>Setting up deadline tracking</li>
      </ul>
    </div>
  );
}
