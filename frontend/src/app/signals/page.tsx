"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  fetchPublicSample,
  type PublicSample,
  type Signal,
  type SignalPattern,
} from "@/lib/signals-api";

const SOURCE_LABELS: Record<string, string> = {
  gao_protests: "GAO Bid Protest",
  epa_echo: "EPA ECHO",
  fda_warning_letters: "FDA Warning Letter",
  dhs_foia_log: "DHS FOIA Log",
};

const PILOT_PERSONAS = [
  {
    id: "journalist",
    name: "Investigative Journalist",
    tagline: "Accountability stories before they break",
    description:
      "Track new IG reports, peer-FOIA activity, and agency mismanagement across every federal source.",
    icon: "📰",
  },
  {
    id: "pharma_analyst",
    name: "Pharma & Biotech",
    tagline: "FDA enforcement signals on your watchlist",
    description:
      "Warning Letters, GMP findings, AdComm signals, and drug substance enforcement updates as they go public.",
    icon: "💊",
  },
  {
    id: "hedge_fund",
    name: "Hedge Fund / Equity Research",
    tagline: "Material federal actions on the tickers you cover",
    description:
      "Federal contract awards, FDA approvals, EPA enforcement, and customs filings on publicly traded companies.",
    icon: "📈",
  },
  {
    id: "environmental",
    name: "Environmental Advocate",
    tagline: "EPA enforcement and pollution oversight",
    description:
      "NEPA filings, ESA consultations, EPA enforcement actions, and land-use signals across every region.",
    icon: "🌿",
  },
];

function fmtShortDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return iso;
  }
}

function SourceChip({ label, cadence, live = false }: { label: string; cadence: string; live?: boolean }) {
  return (
    <div className={`signals-source-chip ${live ? "signals-source-chip-live" : ""}`}>
      {live && <span className="signals-source-pulse" aria-hidden="true" />}
      <span className="signals-source-label">{label}</span>
      <span className="signals-source-cadence">{cadence}</span>
    </div>
  );
}

function PersonaCard({
  persona,
  sampleSignal,
  href,
}: {
  persona: typeof PILOT_PERSONAS[number];
  sampleSignal: Signal | undefined;
  href: string;
}) {
  return (
    <Link href={href} className="signals-landing-persona-card">
      <div className="signals-landing-persona-icon" aria-hidden="true">
        {persona.icon}
      </div>
      <h3 className="signals-landing-persona-name">{persona.name}</h3>
      <p className="signals-landing-persona-tagline">{persona.tagline}</p>
      <p className="signals-landing-persona-description">{persona.description}</p>

      {sampleSignal && (
        <div className="signals-landing-persona-sample">
          <div className="signals-landing-persona-sample-label">Latest signal</div>
          <div className="signals-landing-persona-sample-meta">
            <span className="signals-source-badge">
              {SOURCE_LABELS[sampleSignal.source] || sampleSignal.source}
            </span>
            <span className="signals-card-date">{fmtShortDate(sampleSignal.signal_date)}</span>
          </div>
          <p className="signals-landing-persona-sample-summary">
            {sampleSignal.summary || sampleSignal.title}
          </p>
        </div>
      )}

      <div className="signals-landing-persona-cta">Open this feed →</div>
    </Link>
  );
}

function PatternsShowcase({ patterns }: { patterns: SignalPattern[] }) {
  if (patterns.length === 0) return null;
  return (
    <section className="signals-landing-section">
      <div className="signals-landing-section-header">
        <span className="signals-eyebrow">AI intelligence briefing</span>
        <h2 className="signals-landing-section-title">
          Patterns the AI already found this week
        </h2>
        <p className="signals-landing-section-sub">
          An AI analyst reads every signal across all four sources and surfaces non-obvious
          connections — compounding regulatory exposure on a single company, coordinated
          enforcement sweeps, journalist activity converging on a topic.
        </p>
      </div>
      <div className="signals-landing-patterns-grid">
        {patterns.slice(0, 3).map((p) => {
          const insight = p.narrative.split(/\n\n+/)[0] || "";
          return (
            <article key={p.id} className="signals-landing-pattern">
              <span className="signals-pattern-type">
                {(p.pattern_type || "pattern").replace(/_/g, " ")}
              </span>
              <h3 className="signals-landing-pattern-title">{p.title}</h3>
              <p className="signals-landing-pattern-insight">{insight}</p>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function ChatTeaser() {
  return (
    <section className="signals-landing-section signals-landing-section-dark">
      <div className="signals-landing-chat-grid">
        <div>
          <span className="signals-eyebrow signals-eyebrow-light">Ask anything</span>
          <h2 className="signals-landing-section-title-light">
            An AI assistant that already knows the corpus
          </h2>
          <p className="signals-landing-section-sub-light">
            Every page of FOIA Fluent has a chat panel that can read every signal, every pattern,
            every entity, every one of your tracked FOIA requests, and every federal agency
            transparency stat. Ask in plain English, get sourced answers in seconds.
          </p>
          <ul className="signals-landing-chat-examples">
            <li>&ldquo;What FOIA signals broke this week for hedge funds?&rdquo;</li>
            <li>&ldquo;Show me every EPA enforcement action against publicly traded companies in Texas.&rdquo;</li>
            <li>&ldquo;Has anyone filed FOIA requests on this contract before me?&rdquo;</li>
            <li>&ldquo;Summarize the GLP-1 enforcement pattern and tell me which tickers it affects.&rdquo;</li>
          </ul>
        </div>
        <div className="signals-landing-chat-mock">
          <div className="signals-landing-chat-mock-header">
            <span className="signals-landing-chat-mock-dot signals-landing-chat-mock-dot-red" />
            <span className="signals-landing-chat-mock-dot signals-landing-chat-mock-dot-yellow" />
            <span className="signals-landing-chat-mock-dot signals-landing-chat-mock-dot-green" />
            <span className="signals-landing-chat-mock-title">FOIA Fluent assistant</span>
          </div>
          <div className="signals-landing-chat-mock-body">
            <div className="signals-landing-chat-mock-message signals-landing-chat-mock-user">
              What FOIA signals broke this week for pharma analysts?
            </div>
            <div className="signals-landing-chat-mock-message signals-landing-chat-mock-bot">
              <strong>FDA crackdown on unlicensed GLP-1 peptides (8 letters in 7 days).</strong>{" "}
              The FDA issued warning letters to Gram Peptides, PekCura Labs, Prime Sciences, Mile
              High Compounds, Pink Pony Peptides, and three more between Mar 31 – Apr 7, all
              citing FD&amp;C Act §301(d) and §505(a) for selling unapproved Retatrutide,
              Tirzepatide, and other GLP-1 variants. Pattern matches a coordinated regulatory
              sweep against the booming weight-loss compounding market.
              <div className="signals-landing-chat-mock-sources">
                Sources: FDA Warning Letters · Patterns Feed
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function SignalsLandingPage() {
  const [signedIn, setSignedIn] = useState(false);
  const [sample, setSample] = useState<PublicSample | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) {
      setSignedIn(true);
    } else {
      supabase.auth.getSession().then(({ data }) => {
        setSignedIn(!!data.session);
      });
    }
    fetchPublicSample()
      .then(setSample)
      .catch((e) => setError(e.message));
  }, []);

  const ctaHref = signedIn ? "/signals/feed" : "/login?next=signals/feed";

  return (
    <main className="signals-landing">
      {/* HERO */}
      <section className="signals-landing-hero">
        <div className="signals-landing-inner">
          <span className="signals-eyebrow">Live FOIA Signals · Beta</span>
          <h1 className="signals-hero-title">
            Government records, the moment they&rsquo;re released.
          </h1>
          <p className="signals-hero-sub">
            Track new FOIA releases, who is filing requests, enforcement actions, and agency
            documents the moment they go public — summarized by AI and filtered for what matters
            to your work.
          </p>

          <div className="signals-cta-row">
            <Link href={ctaHref} className="signals-cta-primary">
              {signedIn ? "Open the live feed →" : "Sign in to access →"}
            </Link>
          </div>
        </div>
      </section>

      {/* SOURCE TICKER */}
      <div className="signals-ticker">
        <div className="signals-ticker-track">
          {[0, 1].map((dup) => (
            <div key={dup} className="signals-ticker-set" aria-hidden={dup === 1}>
              <SourceChip label="GAO bid protests" cadence="hourly" live />
              <SourceChip label="EPA ECHO enforcement" cadence="daily" live />
              <SourceChip label="FDA Warning Letters" cadence="daily" live />
              <SourceChip label="DHS FOIA log" cadence="weekly" live />
              <SourceChip label="FARA filings" cadence="daily" />
              <SourceChip label="OSHA fatality investigations" cadence="daily" />
              <SourceChip label="FERC pipeline filings" cadence="daily" />
              <SourceChip label="SEC enforcement actions" cadence="daily" />
              <SourceChip label="DOJ press releases" cadence="hourly" />
              <SourceChip label="USFWS Section 7 consultations" cadence="weekly" />
              <SourceChip label="Federal contract awards" cadence="hourly" />
              <SourceChip label="ICE detention facility logs" cadence="weekly" />
              <SourceChip label="CBP use-of-force incidents" cadence="daily" />
              <SourceChip label="Inspector General reports" cadence="daily" />
            </div>
          ))}
        </div>
      </div>

      {/* PERSONA GRID */}
      <section className="signals-landing-section">
        <div className="signals-landing-section-header">
          <span className="signals-eyebrow">Built for your work</span>
          <h2 className="signals-landing-section-title">Pick the topics that matter</h2>
          <p className="signals-landing-section-sub">
            Every signal is summarized and tagged by an AI that knows what your role cares about.
            Click any persona to land directly in your filtered feed.
          </p>
        </div>
        <div className="signals-landing-persona-grid">
          {PILOT_PERSONAS.map((p) => {
            const sampleSignal = sample?.signals_by_persona?.[p.id]?.[0];
            const href = signedIn
              ? `/signals/feed?personas=${p.id}`
              : `/login?next=signals/feed`;
            return (
              <PersonaCard
                key={p.id}
                persona={p}
                sampleSignal={sampleSignal}
                href={href}
              />
            );
          })}
        </div>
      </section>

      {/* PATTERNS SHOWCASE — real data */}
      {sample && <PatternsShowcase patterns={sample.patterns} />}

      {/* CHAT TEASER */}
      <ChatTeaser />

      {/* HOW IT WORKS */}
      <section className="signals-landing-section">
        <div className="signals-landing-section-header">
          <span className="signals-eyebrow">How it works</span>
          <h2 className="signals-landing-section-title">A continuous AI intelligence loop</h2>
        </div>
        <div className="signals-landing-steps">
          <div className="signals-landing-step">
            <div className="signals-landing-step-number">1</div>
            <h3 className="signals-landing-step-title">Ingest from federal sources</h3>
            <p className="signals-landing-step-body">
              Scheduled scrapers pull from GAO bid protests, EPA enforcement, FDA Warning Letters,
              and DHS FOIA logs. New signals appear within hours of upstream publication.
            </p>
          </div>
          <div className="signals-landing-step">
            <div className="signals-landing-step-number">2</div>
            <h3 className="signals-landing-step-title">Summarize and tag with AI</h3>
            <p className="signals-landing-step-body">
              Every signal is processed by AI — extracting entities, generating a one-sentence
              summary, and conservatively tagging which industry roles would care.
            </p>
          </div>
          <div className="signals-landing-step">
            <div className="signals-landing-step-number">3</div>
            <h3 className="signals-landing-step-title">Surface non-obvious patterns</h3>
            <p className="signals-landing-step-body">
              A daily AI analyst reads the recent corpus and flags concrete cross-source patterns
              — compounding regulatory exposure, coordinated journalist activity, enforcement
              sweeps. You get the connections, not just the data.
            </p>
          </div>
        </div>
      </section>

      {/* SOURCE COVERAGE */}
      <section className="signals-landing-section">
        <div className="signals-landing-section-header">
          <span className="signals-eyebrow">Live coverage</span>
          <h2 className="signals-landing-section-title">Federal sources we track today</h2>
        </div>
        <div className="signals-landing-coverage">
          <div className="signals-landing-coverage-card">
            <h3>EPA ECHO</h3>
            <p>Enforcement actions, NOVs, consent decrees from every EPA region</p>
            <span className="signals-landing-coverage-cadence">Updated daily</span>
          </div>
          <div className="signals-landing-coverage-card">
            <h3>DHS FOIA log</h3>
            <p>FOIA requests filed against DHS components — see who is filing on what</p>
            <span className="signals-landing-coverage-cadence">Updated weekly</span>
          </div>
          <div className="signals-landing-coverage-card">
            <h3>FDA Warning Letters</h3>
            <p>GMP violations, drug compounding enforcement, clinical investigator findings</p>
            <span className="signals-landing-coverage-cadence">Updated daily</span>
          </div>
          <div className="signals-landing-coverage-card">
            <h3>GAO Bid Protests</h3>
            <p>Sustained federal contract protest decisions, curated from GovCon legal blogs</p>
            <span className="signals-landing-coverage-cadence">Updated hourly</span>
          </div>
        </div>
      </section>

      {/* CLOSING CTA */}
      <section className="signals-landing-final-cta">
        <div className="signals-landing-inner">
          <h2 className="signals-landing-final-title">
            Start tracking what your government is doing.
          </h2>
          <p className="signals-landing-final-sub">
            Free during beta. Sign in with your email and pick the topics that matter to your
            work.
          </p>
          <div className="signals-cta-row">
            <Link href={ctaHref} className="signals-cta-primary">
              {signedIn ? "Open the live feed →" : "Sign in to access →"}
            </Link>
          </div>
        </div>
      </section>

      {error && (
        <p className="signals-landing-error">
          (Could not load live sample data: {error}. The site is still up — try the live feed
          directly.)
        </p>
      )}
    </main>
  );
}
