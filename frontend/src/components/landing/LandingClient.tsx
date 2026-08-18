"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  Anno,
  CountUp,
  FloatingPapers,
  Reveal,
  TiltShot,
} from "@/components/landing/motion";
import {
  IconBookmark,
  IconChat,
  IconClock,
  IconFlask,
  IconInstitution,
  IconNewspaper,
  IconScales,
  IconSearch,
  IconSignal,
  IconUsers,
} from "@/components/landing/icons";

export default function LandingClient() {
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
      {/* Everything inside <Reveal> starts at opacity:0 and is un-hidden by
          an IntersectionObserver. With JS disabled that observer never runs,
          so the page would render as a hero above a column of blank space.
          This resets the reveals to their final state in that case. */}
      <noscript>
        <style>{`.lp-reveal{opacity:1 !important;transform:none !important}`}</style>
      </noscript>

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
        <FloatingPapers />
        <div className="home-inner">
          <span className="home-eyebrow">The complete FOIA workspace</span>
          <h1 className="home-hero-title">
            Search <Anno type="circle" delay={300}>records</Anno>.
            <br />
            Draft requests.
            <br />
            Track <Anno type="underline" delay={900}>responses</Anno>.
          </h1>
          <p className="home-hero-sub">
            One workspace to find public records, draft requests grounded
            in real statute, and see every filing through to release.
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
          <TiltShot>
            <div className="home-hero-shot-inner">
              <Image
                src="/landing/draft_page.png"
                alt="Discover and Draft search and request workspace"
                width={3394}
                height={1734}
                priority
                sizes="(max-width: 900px) 100vw, 1240px"
                className="home-hero-shot-img"
              />
            </div>
          </TiltShot>
        </div>
      </section>

      {/* STAT BAND */}
      <section className="home-stats-band">
        <div className="home-inner">
          <Reveal>
            <div className="home-stats">
              <div className="home-stat">
                <div className="home-stat-num">
                  <CountUp value={1600} suffix="+" />
                </div>
                <div className="home-stat-label">Federal agencies tracked</div>
              </div>
              <div className="home-stat">
                <div className="home-stat-num">
                  <CountUp value={54} />
                </div>
                <div className="home-stat-label">State jurisdictions</div>
              </div>
              <div className="home-stat">
                <div className="home-stat-num">
                  <CountUp value={17} suffix=" yr" />
                </div>
                <div className="home-stat-label">Years of FOIA.gov analytics</div>
              </div>
              <div className="home-stat">
                <div className="home-stat-num">
                  <CountUp value={19} />
                </div>
                <div className="home-stat-label">Live federal signal sources</div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* FEATURE SPOTLIGHTS */}
      <section id="features" className="home-features">
        <div className="home-inner">
          <Reveal>
            <div className="home-section-head">
              <span className="home-eyebrow">What&rsquo;s inside</span>
              <h2 className="home-section-title">
                The full workflow, in <Anno type="underline">one place</Anno>.
              </h2>
            </div>
          </Reveal>
        </div>

        {/* 1 — Discover & Draft: the standard two-column row. This is the
            primary flow, so it keeps the most conventional treatment. */}
        <article className="home-spotlight home-inner home-accent-draft">
          <Reveal className="home-spotlight-text">
            <span className="home-eyebrow home-eyebrow-icon">
              <IconSearch size={15} />
              Discover &amp; Draft
            </span>
            <h3 className="home-spotlight-title">
              Find what already exists. Draft what doesn&rsquo;t.
            </h3>
            <p className="home-spotlight-body">
              One search across MuckRock, DocumentCloud, and the open web.
              Nothing there? The AI drafts your request — citing real
              statute and agency rules, never invented law.
            </p>
            <ul className="home-spotlight-list">
              <li>AI picks the right agency, alternatives ranked</li>
              <li>Every citation verified against statute and CFR text</li>
              <li>Save any result to your library in one click</li>
            </ul>
            <Link href={signedIn ? "/draft" : "/login?next=/draft"} className="home-spotlight-link">
              {signedIn ? "Open Discover & Draft →" : "Sign in to use Discover & Draft →"}
            </Link>
          </Reveal>
          <Reveal className="home-spotlight-shot" delay={120}>
            <Image
              src="/landing/draft_page.png"
              alt="Discover and Draft three pane results"
              width={3394}
              height={1734}
              sizes="(max-width: 900px) 100vw, 620px"
              className="home-spotlight-img"
            />
          </Reveal>
        </article>

        {/* 2 — Track & Manage: full-width centered showcase. The visual here
            is a live DOM mockup rather than a screenshot, so it stays sharp
            at full width and earns the extra room. Breaking the alternating
            two-column rhythm here also splits the feature run in half. */}
        <section className="home-showcase home-accent-track">
          <div className="home-inner">
            <Reveal className="home-showcase-head">
              <span className="home-eyebrow home-eyebrow-icon">
                <IconClock size={15} />
                Track &amp; Manage
              </span>
              <h3 className="home-section-title">
                From filing to fulfillment, in one place.
              </h3>
              <p className="home-spotlight-body" style={{ marginTop: "1rem" }}>
                Every filing on one dashboard, statutory deadline on every
                row. When the agency replies, the AI reads the response and
                drafts your next move.
              </p>
            </Reveal>

            <Reveal className="home-showcase-stage" delay={120}>
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
            </Reveal>

            {/* The bulleted list becomes a row of points — centered layouts
                leave a left-aligned <ul> stranded. */}
            <Reveal className="home-showcase-points" delay={200}>
              <div className="home-showcase-point">
                <strong>Deadline tracking</strong>
                <span>20 business days, federal holidays included</span>
              </div>
              <div className="home-showcase-point">
                <strong>AI response analysis</strong>
                <span>Exemption review and a recommended next action</span>
              </div>
              <div className="home-showcase-point">
                <strong>Appeal &amp; follow-up letters</strong>
                <span>Drafted from the analysis in seconds</span>
              </div>
              <div className="home-showcase-point">
                <strong>Drop in any response</strong>
                <span>PDFs, scans, and DOCX read inline</span>
              </div>
            </Reveal>

            <Reveal className="home-showcase-cta" delay={260}>
              <Link href={signedIn ? "/dashboard" : "/login?next=/dashboard"} className="home-spotlight-link">
                {signedIn ? "Open My Requests →" : "Sign in to track your requests →"}
              </Link>
            </Reveal>
          </div>
        </section>

        {/* 3 — Transparency Hub: two-column, image first. */}
        <article className="home-spotlight home-spotlight-reverse home-inner home-accent-hub">
          <Reveal className="home-spotlight-text">
            <span className="home-eyebrow home-eyebrow-icon">
              <IconInstitution size={15} />
              Transparency Hub
            </span>
            <h3 className="home-spotlight-title">
              See how every agency responds.
            </h3>
            <p className="home-spotlight-body">
              1,600+ federal agencies and 54 states, ranked by Transparency
              Score. Know what to expect before you file.
            </p>
            <ul className="home-spotlight-list">
              <li>Per-agency deep dives with exemption patterns</li>
              <li>Interactive state map</li>
              <li>17 years of FOIA.gov data in one view</li>
            </ul>
            <Link href={signedIn ? "/hub" : "/login?next=/hub"} className="home-spotlight-link">
              {signedIn ? "Open Transparency Hub →" : "Sign in to open the Hub →"}
            </Link>
          </Reveal>
          <Reveal className="home-spotlight-shot" delay={120}>
            <Image
              src="/landing/homepage.png"
              alt="Transparency Hub dashboard"
              width={3394}
              height={1734}
              sizes="(max-width: 900px) 100vw, 620px"
              className="home-spotlight-img"
            />
          </Reveal>
        </article>

        {/* 4 — Live FOIA Signals. The Pattern Engine is not a separate
            product; it's the analysis layer over the same feed, so this is
            one section with one heading, one accent, and one CTA — the two
            visuals are two views of the same thing, labelled as such. */}
        <section className="home-duo home-inner home-accent-signals">
          <Reveal className="home-duo-head">
            <span className="home-eyebrow home-eyebrow-icon">
              <IconSignal size={15} />
              Live FOIA Signals
            </span>
            <h3 className="home-section-title">
              The federal record, as it lands.
            </h3>
            <p className="home-spotlight-body">
              Enforcement actions, warning letters, bid protests, and FOIA
              filings — summarized as they land, connected across sources.
              An AI analyst then reads 60 days of that feed daily and
              surfaces the stories you&rsquo;d miss one item at a time.
            </p>
          </Reveal>

          <div className="home-duo-panels">
            <Reveal className="home-duo-panel" delay={100}>
              <Image
                src="/landing/intelligence_page.png"
                alt="Live FOIA Signals feed"
                width={3394}
                height={1734}
                sizes="(max-width: 900px) 100vw, 600px"
                className="home-duo-panel-shot"
              />
              <div className="home-duo-panel-body">
                <h4 className="home-duo-panel-title">The feed</h4>
                <ul className="home-spotlight-list">
                  <li>19 federal sources, refreshed daily</li>
                  <li>Every record linked by company, agency, or case</li>
                  <li>Filter the feed to what you cover</li>
                </ul>
              </div>
            </Reveal>

            <Reveal className="home-duo-panel" delay={200}>
              <Image
                src="/landing/pattern_graph.png"
                alt="AI-detected patterns visualized as a force-directed graph"
                width={2166}
                height={1472}
                sizes="(max-width: 900px) 100vw, 600px"
                className="home-duo-panel-shot"
              />
              <div className="home-duo-panel-body">
                <h4 className="home-duo-panel-title">The Pattern Engine</h4>
                <ul className="home-spotlight-list">
                  <li><strong>Regulatory cascades</strong> — one agency&rsquo;s action triggers another&rsquo;s</li>
                  <li><strong>Compounding exposure</strong> — agencies converging on one company</li>
                  <li><strong>Recall to litigation</strong> — recalls and court filings on the same firm</li>
                </ul>
              </div>
            </Reveal>
          </div>

          <Reveal className="home-duo-cta" delay={280}>
            <Link href={signedIn ? "/signals" : "/login?next=/signals"} className="home-spotlight-link">
              {signedIn ? "Open Live Signals →" : "Sign in to explore Live Signals →"}
            </Link>
          </Reveal>
        </section>
        {/* Secondary features grid — supporting capabilities. "My Requests"
            was removed because the Track & Manage spotlight above covers it. */}
        <div className="home-inner">
          <div className="home-small-grid">
            <Reveal className="home-small-card">
              <span className="home-eyebrow home-eyebrow-icon">
                <IconBookmark size={15} />
                My Discoveries
              </span>
              <h4 className="home-small-title">A research library that remembers.</h4>
              <p className="home-small-body">
                Save, tag, and annotate any document — linked to the
                request it supports.
              </p>
              <span className="home-small-note">Sign in to use</span>
            </Reveal>
            <Reveal className="home-small-card" delay={120}>
              <span className="home-eyebrow home-eyebrow-icon">
                <IconChat size={15} />
                AI Chat Assistant
              </span>
              <h4 className="home-small-title">Help on every page.</h4>
              <p className="home-small-body">
                Open it anywhere with &#8984;K. Every answer cites its
                source — verified data, not model memory.
              </p>
              <span className="home-small-note">Available on every page</span>
            </Reveal>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how" className="home-how">
        <div className="home-inner">
          <Reveal>
            <div className="home-section-head">
              <span className="home-eyebrow">How it works</span>
              <h2 className="home-section-title">
                From question to records, in{" "}
                <Anno type="underline">three steps</Anno>.
              </h2>
            </div>
          </Reveal>
          <div className="home-how-steps">
            <Reveal className="home-how-step">
              <div className="home-how-step-n">1</div>
              <h4 className="home-how-step-title">Search</h4>
              <p className="home-how-step-body">
                Describe what you need in plain language — the AI finds the
                right agency and what&rsquo;s already public.
              </p>
            </Reveal>
            <Reveal className="home-how-step" delay={140}>
              <div className="home-how-step-n">2</div>
              <h4 className="home-how-step-title">Draft</h4>
              <p className="home-how-step-body">
                If the records aren&rsquo;t out there, the AI drafts your
                request from statute text and the agency&rsquo;s own rules.
              </p>
            </Reveal>
            <Reveal className="home-how-step" delay={280}>
              <div className="home-how-step-n">3</div>
              <h4 className="home-how-step-title">Track</h4>
              <p className="home-how-step-body">
                Watch the deadline, get AI analysis of every reply, and
                generate follow-ups or appeals in a click.
              </p>
            </Reveal>
          </div>
        </div>
      </section>

      {/* WHO IT'S FOR */}
      <section id="audience" className="home-audience">
        <div className="home-inner">
          <Reveal>
            <div className="home-section-head">
              <span className="home-eyebrow">Who it is for</span>
              <h2 className="home-section-title">
                Built for <Anno type="underline">public interest</Anno> work.
              </h2>
            </div>
          </Reveal>
          <div className="home-audience-grid">
            <Reveal className="home-audience-card">
              <span className="home-audience-icon">
                <IconNewspaper size={20} />
              </span>
              <strong>Journalists</strong>
              <p>Accountability reporting from primary sources.</p>
            </Reveal>
            <Reveal className="home-audience-card" delay={100}>
              <span className="home-audience-icon">
                <IconScales size={20} />
              </span>
              <strong>Lawyers</strong>
              <p>Records requests and appeals for clients.</p>
            </Reveal>
            <Reveal className="home-audience-card" delay={200}>
              <span className="home-audience-icon">
                <IconFlask size={20} />
              </span>
              <strong>Researchers</strong>
              <p>Policy and enforcement, straight from the record.</p>
            </Reveal>
            <Reveal className="home-audience-card" delay={300}>
              <span className="home-audience-icon">
                <IconUsers size={20} />
              </span>
              <strong>Civic organizations</strong>
              <p>Documented public records work at scale.</p>
            </Reveal>
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="home-final">
        <div className="home-inner home-final-inner">
          <Reveal>
            <h2 className="home-final-title">
              {signedIn ? (
                "Welcome back."
              ) : (
                <>
                  <Anno type="circle">Get started</Anno>.
                </>
              )}
            </h2>
            <p className="home-final-sub">
              {signedIn
                ? "Pick up where you left off."
                : "Just your email — we send a one-time code, no password."}
            </p>
            <div className="home-cta-row">
              <Link href={primaryHref} className="home-cta-primary">
                {primaryLabel} →
              </Link>
            </div>
          </Reveal>
        </div>
      </section>
    </main>
  );
}
