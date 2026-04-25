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
          <span className="home-eyebrow">Civic intelligence for public records</span>
          <h1 className="home-hero-title">
            Find public records.
            <br />
            File what doesn&rsquo;t exist yet.
          </h1>
          <p className="home-hero-sub">
            FOIA Fluent is a workspace for public records research. Search
            what is already out there. When records do not exist yet, draft a
            request grounded in real statute text and agency rules. Track
            agency responses through resolution. Watch new federal activity
            as it lands.
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
              Search MuckRock, DocumentCloud, and the open web side by side.
              When nothing turns up, the AI drafts the request for you,
              grounded in real statute text, agency CFR regulations from eCFR,
              and outcomes from similar past requests. The model is constrained
              to verified sources, so it cannot invent legal citations.
            </p>
            <ul className="home-spotlight-list">
              <li>Search three public document sources in one place</li>
              <li>Automatic agency identification, with alternatives ranked</li>
              <li>Drafts grounded in verified statute and agency rules</li>
              <li>Save any document to a persistent research library</li>
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
              The federal record, as it lands.
            </h3>
            <p className="home-spotlight-body">
              Every new enforcement action, warning letter, bid protest, and
              FOIA filing from federal sources. Each record is summarized as
              soon as it is published, then connected to other records that
              touch the same company, agency, or investigation. Filter the
              feed to the kind of work you do.
            </p>
            <ul className="home-spotlight-list">
              <li>Cross source patterns refreshed daily</li>
              <li>Interactive force directed graph of the connections</li>
              <li>Live feed grouped by day, with a slide in detail view</li>
              <li>Free to explore without signing in</li>
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

        {/* Pattern Engine — focused look at the galaxy graph.
            Intentionally not reversed so the row direction zig-zags between
            the Live Signals + Transparency Hub spotlights for visual rhythm. */}
        <article className="home-spotlight home-inner">
          <div className="home-spotlight-text">
            <span className="home-eyebrow">Pattern Engine</span>
            <h3 className="home-spotlight-title">
              The connections between records, made visible.
            </h3>
            <p className="home-spotlight-body">
              Every day, an AI analyst reads the last 60 days of signals
              across court opinions, agency enforcement, recalls, IG reports,
              regulatory dockets, and more, then surfaces the connections
              between them. Each cluster is a story you would miss reading
              the feed one item at a time.
            </p>
            <ul className="home-spotlight-list">
              <li>
                <strong>Regulatory cascades.</strong> One agency&rsquo;s
                action triggers another&rsquo;s follow on.
              </li>
              <li>
                <strong>Compounding exposure.</strong> Multi agency action
                converging on a single company.
              </li>
              <li>
                <strong>Recall to litigation.</strong> Product recalls
                appearing alongside court filings on the same firm.
              </li>
              <li>
                <strong>Oversight to action.</strong> IG findings followed
                by real enforcement within a clear window.
              </li>
            </ul>
            <Link href="/signals" className="home-spotlight-link">
              Explore the galaxy →
            </Link>
          </div>
          <div className="home-spotlight-shot">
            <Image
              src="/landing/pattern_graph.png"
              alt="AI-detected patterns visualized as a force-directed graph"
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
              Over 1,600 federal agencies and 54 state jurisdictions ranked by
              a composite Transparency Score: success rate, response speed,
              fee rate, and portal availability. Backed by 17 years of FOIA.gov
              analytics. Know what to expect before you file.
            </p>
            <ul className="home-spotlight-list">
              <li>Agency by agency deep dives, with exemption patterns</li>
              <li>Interactive state level map</li>
              <li>FOIA at a Glance, Volume Trends, Appeals and Litigation</li>
              <li>Daily news digest of FOIA in the press</li>
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
                Statutory deadline monitoring, response analysis when the
                agency replies, and one click appeal letters. Your filings
                stay private to your account.
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
                A chat assistant available throughout the app, with sources
                cited for every claim. Answers come from tool results and
                verified reference data, never from the model alone.
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
                Describe what you need in plain language. The AI figures out
                the right agency and pulls results from MuckRock,
                DocumentCloud, and the open web.
              </p>
            </div>
            <div className="home-how-step">
              <div className="home-how-step-n">2</div>
              <h4 className="home-how-step-title">Draft</h4>
              <p className="home-how-step-body">
                If the records do not exist yet, the AI drafts the request
                using verified statute text, the agency&rsquo;s CFR rules,
                and outcomes from similar past requests.
              </p>
            </div>
            <div className="home-how-step">
              <div className="home-how-step-n">3</div>
              <h4 className="home-how-step-title">Track</h4>
              <p className="home-how-step-body">
                Track the statutory deadline. When the agency replies, get an
                analysis of what they did and did not release. Generate
                appeal or follow up letters straight from the request
                timeline.
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
              <p>Investigate government activity and publish accountability reporting.</p>
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
              <p>Hold agencies accountable with documented, persistent pressure.</p>
            </div>
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="home-final">
        <div className="home-inner home-final-inner">
          <h2 className="home-final-title">Start investigating.</h2>
          <p className="home-final-sub">
            Free to use. Sign in with your email.
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
