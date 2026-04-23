"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export default function HomePage() {
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setSignedIn(!!data.session);
    });
  }, []);

  // /hub is public, so the primary CTA always routes there. Only the label
  // changes based on auth state — "Open the app" reads naturally for a
  // returning user, "Start exploring" invites first-time visitors in.
  const primaryHref = "/hub";
  const primaryLabel = signedIn ? "Open the app" : "Start exploring";

  return (
    <main className="home">
      {/* TOP NAV */}
      <nav className="home-nav">
        <div className="home-nav-inner">
          <Link href="/" className="home-nav-brand">
            FOIA Fluent
          </Link>
          <div className="home-nav-links">
            <a href="#features" className="home-nav-link">
              Features
            </a>
            <Link href="/signals" className="home-nav-link">
              Live Signals
            </Link>
            <Link href="/hub" className="home-nav-link">
              Transparency Hub
            </Link>
            <a
              href="https://github.com/dssg-nyc/FOIA-Fluent"
              target="_blank"
              rel="noopener noreferrer"
              className="home-nav-link"
            >
              GitHub
            </a>
            <Link href={signedIn ? "/hub" : "/login"} className="home-nav-cta">
              {signedIn ? "Open app →" : "Sign in →"}
            </Link>
          </div>
        </div>
      </nav>

      {/* HERO */}
      <section className="home-hero">
        <div className="home-inner">
          <span className="home-eyebrow">Open source · Civic AI</span>
          <h1 className="home-hero-title">
            Find public records.
            <br />
            File what doesn&rsquo;t exist yet.
          </h1>
          <p className="home-hero-sub">
            FOIA Fluent is a civic AI platform for public records research.
            Search what&rsquo;s already public. Draft optimized requests grounded
            in verified statute. Track agency responses. Watch federal activity
            in real time. All in one workspace.
          </p>
          <div className="home-cta-row">
            <Link href={primaryHref} className="home-cta-primary">
              {primaryLabel} →
            </Link>
            <a
              href="https://github.com/dssg-nyc/FOIA-Fluent"
              target="_blank"
              rel="noopener noreferrer"
              className="home-cta-secondary"
            >
              View on GitHub ↗
            </a>
          </div>
        </div>

        <div className="home-hero-shot">
          <div className="home-hero-shot-inner">
            <Image
              src="/landing/intelligence_page.png"
              alt="FOIA Fluent live signals dashboard"
              width={2400}
              height={1500}
              priority
              className="home-hero-shot-img"
            />
          </div>
        </div>
      </section>

      {/* STAT BAND */}
      <section className="home-stats-band">
        <div className="home-inner">
          <div className="home-stats">
            <div className="home-stat">
              <div className="home-stat-num">1,600+</div>
              <div className="home-stat-label">Federal agencies tracked</div>
            </div>
            <div className="home-stat">
              <div className="home-stat-num">54</div>
              <div className="home-stat-label">State jurisdictions</div>
            </div>
            <div className="home-stat">
              <div className="home-stat-num">17 yr</div>
              <div className="home-stat-label">FOIA.gov analytics history</div>
            </div>
            <div className="home-stat">
              <div className="home-stat-num">4</div>
              <div className="home-stat-label">Live federal signal sources</div>
            </div>
          </div>
        </div>
      </section>

      {/* FEATURE SPOTLIGHTS */}
      <section id="features" className="home-features">
        <div className="home-inner">
          <div className="home-section-head">
            <span className="home-eyebrow">The tools</span>
            <h2 className="home-section-title">
              Everything you need to work with public records.
            </h2>
          </div>
        </div>

        {/* Discover & Draft */}
        <article className="home-spotlight home-inner">
          <div className="home-spotlight-text">
            <span className="home-eyebrow">Discover &amp; Draft</span>
            <h3 className="home-spotlight-title">
              Find what already exists. Draft what doesn&rsquo;t.
            </h3>
            <p className="home-spotlight-body">
              Search MuckRock, DocumentCloud, and the open web in one unified
              three pane view. When nothing turns up, Claude drafts the request
              for you, grounded in real statute text, agency CFR regulations
              from eCFR, and MuckRock outcomes. It cannot cite law from its
              training data.
            </p>
            <ul className="home-spotlight-list">
              <li>Unified search across three public document sources</li>
              <li>Automatic agency identification with alternatives</li>
              <li>Drafts grounded in verified legal context</li>
              <li>Save any discovery to a persistent research library</li>
            </ul>
            <Link href={signedIn ? "/draft" : "/login?next=/draft"} className="home-spotlight-link">
              Try Discover &amp; Draft →
            </Link>
          </div>
          <div className="home-spotlight-shot">
            <Image
              src="/landing/draft_page.png"
              alt="Discover and Draft three pane results"
              width={2400}
              height={1500}
              className="home-spotlight-img"
            />
          </div>
        </article>

        {/* Live FOIA Signals */}
        <article className="home-spotlight home-spotlight-reverse home-inner">
          <div className="home-spotlight-text">
            <span className="home-eyebrow">Live FOIA Signals</span>
            <h3 className="home-spotlight-title">
              The federal record, in real time.
            </h3>
            <p className="home-spotlight-body">
              Every new enforcement action, warning letter, bid protest, and
              FOIA filing from federal sources. AI summarizes each record the
              moment it&rsquo;s released and surfaces the cross source patterns
              running through them. Interactive galaxy visualization. Persona
              filters for your role.
            </p>
            <ul className="home-spotlight-list">
              <li>Daily AI-detected cross source patterns</li>
              <li>Interactive force directed graph of signal clusters</li>
              <li>Day grouped live feed with slide in detail view</li>
              <li>Free to explore without an account</li>
            </ul>
            <Link href="/signals" className="home-spotlight-link">
              Open Live Signals →
            </Link>
          </div>
          <div className="home-spotlight-shot">
            <Image
              src="/landing/intelligence_page.png"
              alt="Live FOIA Signals dashboard"
              width={2400}
              height={1500}
              className="home-spotlight-img"
            />
          </div>
        </article>

        {/* Transparency Hub */}
        <article className="home-spotlight home-inner">
          <div className="home-spotlight-text">
            <span className="home-eyebrow">Transparency Hub</span>
            <h3 className="home-spotlight-title">
              See how every agency actually responds.
            </h3>
            <p className="home-spotlight-body">
              1,600 plus federal agencies and 54 state jurisdictions ranked by a
              composite Transparency Score, composed of success rate, response
              speed, fee rate, and portal availability. 17 years of FOIA.gov
              analytics. Know what to expect before you file.
            </p>
            <ul className="home-spotlight-list">
              <li>Per agency deep dives with exemption patterns</li>
              <li>Interactive state level choropleth map</li>
              <li>FOIA at a Glance, Volume Trends, Appeals + Litigation</li>
              <li>AI curated FOIA news digest</li>
            </ul>
            <Link href="/hub" className="home-spotlight-link">
              Open Transparency Hub →
            </Link>
          </div>
          <div className="home-spotlight-shot">
            <Image
              src="/landing/homepage.png"
              alt="Transparency Hub dashboard"
              width={2400}
              height={1500}
              className="home-spotlight-img"
            />
          </div>
        </article>

        {/* Secondary features grid */}
        <div className="home-inner">
          <div className="home-small-grid">
            <div className="home-small-card">
              <span className="home-eyebrow">My Requests</span>
              <h4 className="home-small-title">Track filings to resolution.</h4>
              <p className="home-small-body">
                Deadline monitoring, Claude powered response analysis, and
                appeal letter generation. Per user private storage with Row
                Level Security.
              </p>
              <span className="home-small-note">Sign in to use</span>
            </div>
            <div className="home-small-card">
              <span className="home-eyebrow">My Discoveries</span>
              <h4 className="home-small-title">A research library that remembers.</h4>
              <p className="home-small-body">
                Save any document from Discover &amp; Draft. Tag, annotate, mark
                as reviewed, or link to a tracked FOIA request.
              </p>
              <span className="home-small-note">Sign in to use</span>
            </div>
            <div className="home-small-card">
              <span className="home-eyebrow">AI Chat Assistant</span>
              <h4 className="home-small-title">An expert on every page.</h4>
              <p className="home-small-body">
                Persistent chat with 11 tools, a four tier accuracy system, and
                anti hallucination safeguards. Every fact comes from a tool
                result or verified reference data, with sources cited.
              </p>
              <span className="home-small-note">Available everywhere</span>
            </div>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="home-how">
        <div className="home-inner">
          <div className="home-section-head">
            <span className="home-eyebrow">How it works</span>
            <h2 className="home-section-title">
              From question to records, in three steps.
            </h2>
          </div>
          <div className="home-how-steps">
            <div className="home-how-step">
              <div className="home-how-step-n">1</div>
              <h4 className="home-how-step-title">Search</h4>
              <p className="home-how-step-body">
                Describe what you need in plain language. Claude interprets the
                query, identifies the right agency, and unifies results from
                MuckRock, DocumentCloud, and the open web.
              </p>
            </div>
            <div className="home-how-step">
              <div className="home-how-step-n">2</div>
              <h4 className="home-how-step-title">Draft</h4>
              <p className="home-how-step-body">
                If the records do not exist yet, Claude drafts the FOIA request
                from three layers of verified context: statute text, agency CFR
                regulations, and MuckRock outcomes.
              </p>
            </div>
            <div className="home-how-step">
              <div className="home-how-step-n">3</div>
              <h4 className="home-how-step-title">Track</h4>
              <p className="home-how-step-body">
                Monitor the statutory deadline. Receive Claude response
                analysis when the agency replies. Generate appeal or follow up
                letters directly from the communication timeline.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* WHO IT'S FOR */}
      <section className="home-audience">
        <div className="home-inner">
          <div className="home-section-head">
            <span className="home-eyebrow">Who it is for</span>
            <h2 className="home-section-title">
              Built for public interest work.
            </h2>
          </div>
          <div className="home-audience-grid">
            <div className="home-audience-card">
              <strong>Journalists</strong>
              <p>Investigate government activity and ship accountability reporting.</p>
            </div>
            <div className="home-audience-card">
              <strong>Lawyers</strong>
              <p>File records requests and manage appeals on behalf of clients.</p>
            </div>
            <div className="home-audience-card">
              <strong>Researchers</strong>
              <p>Study policy, enforcement, and federal spending from primary sources.</p>
            </div>
            <div className="home-audience-card">
              <strong>Civic organizations</strong>
              <p>Hold agencies accountable with persistent, documented pressure.</p>
            </div>
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="home-final">
        <div className="home-inner home-final-inner">
          <h2 className="home-final-title">Start investigating.</h2>
          <p className="home-final-sub">
            Free. Open source. Sign in with your email.
          </p>
          <div className="home-cta-row">
            <Link href={primaryHref} className="home-cta-primary">
              {primaryLabel} →
            </Link>
            <a
              href="https://github.com/dssg-nyc/FOIA-Fluent"
              target="_blank"
              rel="noopener noreferrer"
              className="home-cta-secondary"
            >
              View on GitHub ↗
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}
