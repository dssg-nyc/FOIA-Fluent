"use client";
import { useState } from "react";

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
        <p>Built for the public with ❤️ in New York City 🗽</p>
        <p>FOIA Fluent is open source. <a href="https://github.com/dssg-nyc/FOIA-Fluent" target="_blank" rel="noopener noreferrer" className="footer-link">View on GitHub</a></p>
        <p>
          Have feedback or want to contribute?{" "}
          <button className="footer-copy-btn" onClick={copyEmail}>
            {copied ? "Copied!" : "Copy email"}
          </button>
        </p>
        <p className="footer-copy">© {new Date().getFullYear()} NYC Data Science for Social Good</p>
      </div>
    </footer>
  );
}
