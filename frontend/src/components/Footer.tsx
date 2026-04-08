"use client";
import { useState } from "react";
import Link from "next/link";

export default function Footer() {
  const [copied, setCopied] = useState(false);

  function copyEmail() {
    navigator.clipboard.writeText("heng.franklin@gmail.com");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <div className="footer-grid">
          {/* Brand column */}
          <div className="footer-col footer-col-brand">
            <div className="footer-brand">FOIA Fluent</div>
            <p className="footer-tagline">
              Civic AI for government transparency. Draft, track, and analyze public records requests with verified legal context.
            </p>
            <p className="footer-meta">Built in New York City</p>
          </div>

          {/* Product column */}
          <div className="footer-col">
            <div className="footer-col-title">Product</div>
            <ul className="footer-links">
              <li><Link href="/hub" className="footer-link">Transparency Hub</Link></li>
              <li><Link href="/hub/insights" className="footer-link">Insights</Link></li>
              <li><Link href="/draft" className="footer-link">Discover & Draft</Link></li>
              <li><Link href="/dashboard" className="footer-link">My Requests</Link></li>
            </ul>
          </div>

          {/* Open source column */}
          <div className="footer-col">
            <div className="footer-col-title">Open Source</div>
            <ul className="footer-links">
              <li>
                <a href="https://github.com/dssg-nyc/FOIA-Fluent" target="_blank" rel="noopener noreferrer" className="footer-link">
                  View on GitHub
                </a>
              </li>
              <li>
                <a href="https://github.com/dssg-nyc/FOIA-Fluent/issues" target="_blank" rel="noopener noreferrer" className="footer-link">
                  Report an issue
                </a>
              </li>
              <li>
                <a href="https://github.com/dssg-nyc/FOIA-Fluent/pulls" target="_blank" rel="noopener noreferrer" className="footer-link">
                  Contribute
                </a>
              </li>
              <li>
                <a href="https://www.nyc-dssg.org/" target="_blank" rel="noopener noreferrer" className="footer-link">
                  NYC-DSSG
                </a>
              </li>
            </ul>
          </div>

          {/* Contact column */}
          <div className="footer-col">
            <div className="footer-col-title">Contact</div>
            <ul className="footer-links">
              <li>
                <a href="mailto:heng.franklin@gmail.com" className="footer-link">
                  Feedback
                </a>
              </li>
            </ul>
            <button className="footer-copy-pill" onClick={copyEmail}>
              {copied ? (
                <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
                  Copied
                </>
              ) : (
                <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                  Copy email
                </>
              )}
            </button>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="footer-bottom">
          <div className="footer-copyright">
            © {new Date().getFullYear()} NYC Data Science for Social Good
          </div>
        </div>
      </div>
    </footer>
  );
}
