"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function Nav() {
  const pathname = usePathname();

  return (
    <nav className="site-nav">
      <div className="nav-inner">
        <Link href="/" className="nav-brand">
          FOIA Fluent
        </Link>
        <div className="nav-links">
          <Link
            href="/"
            className={`nav-link ${pathname === "/" ? "nav-link-active" : ""}`}
          >
            Search & Draft
          </Link>
          <Link
            href="/dashboard"
            className={`nav-link ${pathname.startsWith("/dashboard") || pathname.startsWith("/requests") ? "nav-link-active" : ""}`}
          >
            My Requests
          </Link>
        </div>
      </div>
    </nav>
  );
}
