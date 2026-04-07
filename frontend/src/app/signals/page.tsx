"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

function SourceChip({ label, cadence, live = false }: { label: string; cadence: string; live?: boolean }) {
  return (
    <div className={`signals-source-chip ${live ? "signals-source-chip-live" : ""}`}>
      {live && <span className="signals-source-pulse" aria-hidden="true" />}
      <span className="signals-source-label">{label}</span>
      <span className="signals-source-cadence">{cadence}</span>
    </div>
  );
}

export default function SignalsLandingPlaceholder() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    if (!supabase) {
      setSignedIn(true);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setSignedIn(!!data.session);
    });
  }, []);

  return (
    <main className="signals-landing">
      <div className="signals-landing-inner">
        <span className="signals-eyebrow">Phase 1 — Beta</span>
        <h1 className="signals-hero-title">Government records, the moment they&rsquo;re released.</h1>
        <p className="signals-hero-sub">
          Track new FOIA releases, who is filing requests, enforcement actions, and agency
          documents the moment they go public — summarized by AI and filtered for what matters
          to your work.
        </p>

        <div className="signals-cta-row">
          {signedIn ? (
            <Link href="/signals/feed" className="signals-cta-primary">
              Open the live feed →
            </Link>
          ) : (
            <Link href="/login?next=signals/feed" className="signals-cta-primary">
              Sign in to access →
            </Link>
          )}
        </div>

        <div className="signals-ticker">
          <div className="signals-ticker-track">
            {/* Track is duplicated so the loop is seamless */}
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
                <SourceChip label="GAO bid protests" cadence="hourly" live />
                <SourceChip label="EPA ECHO enforcement" cadence="daily" live />
              </div>
            ))}
          </div>
        </div>

        <p className="signals-landing-footnote">
          A polished public landing page launches in Phase 2 once we have a few weeks of real
          signals to showcase. For now, sign in to view the live feed directly.
        </p>
      </div>
    </main>
  );
}
