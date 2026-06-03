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

  // Signed-in users go straight into the app; signed-out users go to
  // /login (the email-OTP flow). Middleware also catches direct hits to
  // gated routes and redirects them through /login?next=..., so any link
  // we render is "safe" — pre-login users land on the right page after
  // verifying their email.
  const primaryHref = signedIn ? "/hub" : "/login";
  const primaryLabel = signedIn ? "Open the app" : "Sign up free";

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
            <a href="#how" className="home-nav-link">
              How it works
            </a>
            <a href="#audience" className="home-nav-link">
              Who it&rsquo;s for
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
          <span className="home-eyebrow">The complete FOIA workspace</span>
          <h1 className="home-hero-title">
            Search records.
            <br />
            Draft requests.
            <br />
            Track responses.
          </h1>
          <p className="home-hero-sub">
            <strong>Search</strong> MuckRock, DocumentCloud, and the open
            web in one place.
            <strong> Draft</strong> requests grounded in statute and agency
            rules.
            <strong> Track</strong> every filing from statutory deadline
            through response analysis to appeal.
          </p>
          <div className="home-cta-row">
            <Link href={primaryHref} className="home-cta-primary">
              {primaryLabel} →
            </Link>
            <a href="#features" className="home-cta-secondary">
              See what&rsquo;s inside ↓
            </a>
          </div>
        </div>

        <div className="home-hero-shot">
          <div className="home-hero-shot-inner">
            <Image
              src="/landing/draft_page.png"
              alt="Discover and Draft search and request workspace"
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
              <div className="home-stat-label">Years of FOIA.gov analytics</div>
            </div>
            <div className="home-stat">
              <div className="home-stat-num">19</div>
              <div className="home-stat-label">Live federal signal sources</div>
            </div>
          </div>
        </div>
      </section>

      {/* FEATURE SPOTLIGHTS */}
      <section id="features" className="home-features">
        <div className="home-inner">
          <div className="home-section-head">
            <span className="home-eyebrow">What&rsquo;s inside</span>
            <h2 className="home-section-title">
              The full workflow, in one place.
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
              Search MuckRock, DocumentCloud, and the open web in one place.
              When nothing turns up, the AI drafts the request, grounded in
              statute text, the agency&rsquo;s eCFR rules, and outcomes from
              similar past filings. Every citation is verified; the AI cannot
              fabricate law.
            </p>
            <ul className="home-spotlight-list">
              <li>Three sources in one search: MuckRock, DocumentCloud, open web</li>
              <li>The AI picks the right agency, with backup options ranked</li>
              <li>Drafts cite real statute sections and CFR rules verbatim</li>
              <li>Save any result to your research library in one click</li>
            </ul>
            <Link href={signedIn ? "/draft" : "/login?next=/draft"} className="home-spotlight-link">
              {signedIn ? "Open Discover & Draft →" : "Sign in to use Discover & Draft →"}
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

        {/* Track Requests — full lifecycle: deadline tracking, response
            analysis, appeal letters. Uses a JSX UI mockup as the visual
            since no dashboard screenshot exists yet, and the mockup actually
            communicates the workflow shape more clearly than a static PNG. */}
        <article className="home-spotlight home-spotlight-reverse home-inner">
          <div className="home-spotlight-text">
            <span className="home-eyebrow">Track &amp; Manage</span>
            <h3 className="home-spotlight-title">
              From filing to fulfillment, in one place.
            </h3>
            <p className="home-spotlight-body">
              Filed requests live in a dashboard with the statutory deadline
              shown on every row. Open any request to see its full
              communication timeline, AI analysis of the agency&rsquo;s
              response, and follow up or appeal letters drafted from that
              analysis.
            </p>
            <ul className="home-spotlight-list">
              <li>
                <strong>Statutory deadline tracking.</strong> 20 business
                days, federal holidays accounted for, progress bar per
                request.
              </li>
              <li>
                <strong>Full communication timeline.</strong> Every letter,
                response, and note in order, with AI analysis on every
                incoming reply.
              </li>
              <li>
                <strong>AI response analysis.</strong> Exemption review,
                missing records, and a recommended next action when the
                agency replies.
              </li>
              <li>
                <strong>Appeal letters in seconds.</strong> Drafted from
                the exemption assessment and grounds the AI found in the
                response.
              </li>
              <li>
                <strong>Follow up letters for overdue requests.</strong>
                Auto drafted with the right statute sections cited.
              </li>
              <li>
                <strong>Drag and drop response uploads.</strong> PDF, images,
                scans, DOCX, all read by the AI inline.
              </li>
              <li>
                <strong>Import existing requests.</strong> Bring requests
                you&rsquo;ve already filed in and run the same research
                pass on them.
              </li>
            </ul>
            <Link href={signedIn ? "/dashboard" : "/login?next=/dashboard"} className="home-spotlight-link">
              {signedIn ? "Open My Requests →" : "Sign in to track your requests →"}
            </Link>
          </div>
          <div className="home-spotlight-shot">
            <div
              className="home-track-mock"
              role="img"
              aria-label="Dashboard preview with three requests in different states"
            >
              <div className="home-track-mock-header">
                <div className="home-track-mock-title">My Requests</div>
                <div className="home-track-mock-tabs">
                  <span className="home-track-mock-tab home-track-mock-tab-active">All · 3</span>
                  <span className="home-track-mock-tab">Active · 2</span>
                  <span className="home-track-mock-tab home-track-mock-tab-warn">Overdue · 1</span>
                  <span className="home-track-mock-tab">Completed</span>
                </div>
              </div>
              <div className="home-track-mock-rows">
                <div className="home-track-mock-row home-track-mock-row-overdue">
                  <div className="home-track-mock-row-top">
                    <span className="home-track-mock-agency">EPA</span>
                    <span className="home-track-mock-status home-track-mock-status-awaiting">
                      Awaiting Response
                    </span>
                  </div>
                  <div className="home-track-mock-row-headline">
                    PFAS Office of Water records, 2023&ndash;2024
                  </div>
                  <div className="home-track-mock-row-deadline home-track-mock-row-deadline-overdue">
                    <span className="home-track-mock-dot home-track-mock-dot-overdue" />
                    OVERDUE by 4 business days
                  </div>
                </div>
                <div className="home-track-mock-row">
                  <div className="home-track-mock-row-top">
                    <span className="home-track-mock-agency">FDA</span>
                    <span className="home-track-mock-status home-track-mock-status-submitted">
                      Submitted
                    </span>
                  </div>
                  <div className="home-track-mock-row-headline">
                    Inspection findings, Indian generic drug plants
                  </div>
                  <div className="home-track-mock-row-deadline">
                    <span className="home-track-mock-dot" />
                    Day 12 of 20
                  </div>
                </div>
                <div className="home-track-mock-row">
                  <div className="home-track-mock-row-top">
                    <span className="home-track-mock-agency">HUD</span>
                    <span className="home-track-mock-status home-track-mock-status-responded">
                      Responded
                    </span>
                  </div>
                  <div className="home-track-mock-row-headline">
                    Section 8 voucher fraud audits
                  </div>
                  <div className="home-track-mock-row-deadline home-track-mock-row-deadline-ready">
                    <span className="home-track-mock-dot home-track-mock-dot-ready" />
                    AI analysis ready &middot; appeal recommended
                  </div>
                </div>
              </div>
            </div>
          </div>
        </article>

        {/* Transparency Hub */}
        <article className="home-spotlight home-inner">
          <div className="home-spotlight-text">
            <span className="home-eyebrow">Transparency Hub</span>
            <h3 className="home-spotlight-title">
              See how every agency responds.
            </h3>
            <p className="home-spotlight-body">
              Over 1,600 federal agencies and 54 state jurisdictions, ranked
              by a composite Transparency Score: success rate, response
              speed, fee rate, and portal availability. Know what to expect
              before you file.
            </p>
            <ul className="home-spotlight-list">
              <li>Agency by agency deep dives with exemption patterns</li>
              <li>Interactive state map</li>
              <li>FOIA at a Glance, Volume Trends, Appeals and Litigation</li>
              <li>17 years of FOIA.gov data in one view</li>
            </ul>
            <Link href={signedIn ? "/hub" : "/login?next=/hub"} className="home-spotlight-link">
              {signedIn ? "Open Transparency Hub →" : "Sign in to open the Hub →"}
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

        {/* Live FOIA Signals */}
        <article className="home-spotlight home-spotlight-reverse home-inner">
          <div className="home-spotlight-text">
            <span className="home-eyebrow">Live FOIA Signals</span>
            <h3 className="home-spotlight-title">
              The federal record, as it lands.
            </h3>
            <p className="home-spotlight-body">
              Every new enforcement action, warning letter, bid protest, and
              FOIA filing from federal sources. Each record is summarized
              when it lands, then connected to others that touch the same
              company, agency, or investigation. Filter to what you care
              about.
            </p>
            <ul className="home-spotlight-list">
              <li>Cross source patterns refreshed daily</li>
              <li>Interactive connection graph</li>
              <li>Live feed grouped by day, with a sliding detail panel</li>
              <li>Drill from a theme bubble to the underlying signals</li>
            </ul>
            <Link href={signedIn ? "/signals" : "/login?next=/signals"} className="home-spotlight-link">
              {signedIn ? "Open Live Signals →" : "Sign in to explore Live Signals →"}
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

        {/* Pattern Engine — focused look at the galaxy graph. */}
        <article className="home-spotlight home-inner">
          <div className="home-spotlight-text">
            <span className="home-eyebrow">Pattern Engine</span>
            <h3 className="home-spotlight-title">
              The connections between records, made visible.
            </h3>
            <p className="home-spotlight-body">
              Every day, an AI analyst reads the last 60 days of signals
              across court opinions, agency enforcement, recalls, IG
              reports, and regulatory dockets, then surfaces the connections.
              Each cluster is a story you&rsquo;d miss reading the feed one
              item at a time.
            </p>
            <ul className="home-spotlight-list">
              <li>
                <strong>Regulatory cascades.</strong> One agency&rsquo;s
                action triggers another&rsquo;s.
              </li>
              <li>
                <strong>Compounding exposure.</strong> Several agencies
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
            <Link href={signedIn ? "/signals" : "/login?next=/signals"} className="home-spotlight-link">
              {signedIn ? "Explore the galaxy →" : "Sign in to explore the galaxy →"}
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

        {/* Secondary features grid — supporting capabilities. "My Requests"
            was removed because the Track & Manage spotlight above covers it. */}
        <div className="home-inner">
          <div className="home-small-grid">
            <div className="home-small-card">
              <span className="home-eyebrow">My Discoveries</span>
              <h4 className="home-small-title">A research library that remembers.</h4>
              <p className="home-small-body">
                Save any document from Discover &amp; Draft. Tag, annotate, mark
                as reviewed, or link a discovery to the request it supports.
              </p>
              <span className="home-small-note">Sign in to use</span>
            </div>
            <div className="home-small-card">
              <span className="home-eyebrow">AI Chat Assistant</span>
              <h4 className="home-small-title">Help on every page.</h4>
              <p className="home-small-body">
                A chat assistant you can open anywhere with &#8984;K.
                Sources cited on every claim. Answers come from tool
                results and verified reference data, not the model&rsquo;s
                memory.
              </p>
              <span className="home-small-note">Available on every page</span>
            </div>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how" className="home-how">
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
                Describe what you need in plain language. The AI identifies
                the right agency and pulls results from MuckRock,
                DocumentCloud, and the open web.
              </p>
            </div>
            <div className="home-how-step">
              <div className="home-how-step-n">2</div>
              <h4 className="home-how-step-title">Draft</h4>
              <p className="home-how-step-body">
                If the records don&rsquo;t exist yet, the AI drafts the
                request using statute text, the agency&rsquo;s CFR rules,
                and outcomes from similar past filings.
              </p>
            </div>
            <div className="home-how-step">
              <div className="home-how-step-n">3</div>
              <h4 className="home-how-step-title">Track</h4>
              <p className="home-how-step-body">
                Track the statutory deadline. When the agency replies, get
                an analysis of what they released and what they
                didn&rsquo;t. Generate follow up or appeal letters from
                the request timeline.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* WHO IT'S FOR */}
      <section id="audience" className="home-audience">
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
              <p>Hold agencies accountable through documented public records work.</p>
            </div>
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="home-final">
        <div className="home-inner home-final-inner">
          <h2 className="home-final-title">
            {signedIn ? "Welcome back." : "Get started."}
          </h2>
          <p className="home-final-sub">
            {signedIn
              ? "Pick up where you left off."
              : "Sign in with your email. We send a one-time code; no password to remember."}
          </p>
          <div className="home-cta-row">
            <Link href={primaryHref} className="home-cta-primary">
              {primaryLabel} →
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
