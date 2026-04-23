"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  fetchSavedSearches,
  deleteSavedSearch,
  type SavedSearch,
} from "@/lib/saved-searches-api";

type NavItem = {
  href: string;
  label: string;
  icon: React.ReactNode;
  isActive: (pathname: string) => boolean;
  pulse?: boolean;
};

const iconProps = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const IconHub = () => (
  <svg {...iconProps}>
    <line x1="3" y1="22" x2="21" y2="22" />
    <line x1="6" y1="18" x2="6" y2="11" />
    <line x1="10" y1="18" x2="10" y2="11" />
    <line x1="14" y1="18" x2="14" y2="11" />
    <line x1="18" y1="18" x2="18" y2="11" />
    <polygon points="12 2 20 7 4 7" />
  </svg>
);

const IconDraft = () => (
  <svg {...iconProps}>
    <circle cx="12" cy="12" r="10" />
    <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
  </svg>
);

const IconRequests = () => (
  <svg {...iconProps}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="8" y1="13" x2="16" y2="13" />
    <line x1="8" y1="17" x2="16" y2="17" />
    <line x1="8" y1="9" x2="10" y2="9" />
  </svg>
);

const IconDiscoveries = () => (
  <svg {...iconProps}>
    <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
  </svg>
);

const IconSignals = () => (
  <svg {...iconProps}>
    <circle cx="12" cy="12" r="2" />
    <path d="M16.24 7.76a6 6 0 0 1 0 8.49" />
    <path d="M7.76 16.24a6 6 0 0 1 0-8.49" />
    <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    <path d="M4.93 19.07a10 10 0 0 1 0-14.14" />
  </svg>
);

const WORKSPACE_ITEMS: NavItem[] = [
  {
    href: "/hub",
    label: "Transparency Hub",
    icon: <IconHub />,
    isActive: (p) => p.startsWith("/hub"),
  },
  {
    href: "/draft",
    label: "Discover & Draft",
    icon: <IconDraft />,
    isActive: (p) => p === "/draft",
  },
  {
    href: "/dashboard",
    label: "My Requests",
    icon: <IconRequests />,
    isActive: (p) => p.startsWith("/dashboard") || p.startsWith("/requests"),
  },
  {
    href: "/discoveries",
    label: "My Discoveries",
    icon: <IconDiscoveries />,
    isActive: (p) => p.startsWith("/discoveries"),
  },
];

const INTEL_ITEMS: NavItem[] = [
  {
    href: "/signals",
    label: "Live FOIA Signals",
    icon: <IconSignals />,
    isActive: (p) => p.startsWith("/signals"),
    pulse: true,
  },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [recentSearches, setRecentSearches] = useState<SavedSearch[]>([]);
  const profileRef = useRef<HTMLDivElement>(null);

  const loadRecent = useCallback(async () => {
    if (!userEmail) {
      setRecentSearches([]);
      return;
    }
    try {
      const { searches } = await fetchSavedSearches(10);
      setRecentSearches(searches);
    } catch {
      setRecentSearches([]);
    }
  }, [userEmail]);

  useEffect(() => {
    loadRecent();
  }, [loadRecent, pathname]);

  useEffect(() => {
    function handleChange() {
      loadRecent();
    }
    window.addEventListener("foiafluent.saved-search-changed", handleChange);
    return () =>
      window.removeEventListener(
        "foiafluent.saved-search-changed",
        handleChange,
      );
  }, [loadRecent]);

  async function handleRecentClick(e: React.MouseEvent, id: string) {
    e.preventDefault();
    router.push(`/draft?id=${id}`);
  }

  async function handleDeleteRecent(e: React.MouseEvent, id: string) {
    e.preventDefault();
    e.stopPropagation();
    try {
      await deleteSavedSearch(id);
      setRecentSearches((prev) => prev.filter((s) => s.id !== id));
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    try {
      const stored = localStorage.getItem("foiafluent.sidebar.collapsed");
      if (stored === "1") setCollapsed(true);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(
        "foiafluent.sidebar.collapsed",
        collapsed ? "1" : "0"
      );
    } catch {
      /* ignore */
    }
    document.body.dataset.sidebar = collapsed ? "collapsed" : "expanded";
  }, [collapsed]);

  useEffect(() => {
    setMobileOpen(false);
    setProfileOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getUser().then(({ data }) => {
      setUserEmail(data.user?.email ?? null);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_, session) => {
      setUserEmail(session?.user?.email ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        profileRef.current &&
        !profileRef.current.contains(e.target as Node)
      ) {
        setProfileOpen(false);
      }
    }
    if (profileOpen) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [profileOpen]);

  async function handleSignOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
    setProfileOpen(false);
    router.push("/login");
  }

  // The landing page at "/" is a full-width marketing page with its own top
  // nav — render nothing here so the sidebar doesn't compete with it.
  if (pathname === "/") {
    return null;
  }

  const initial = (userEmail?.[0] ?? "?").toUpperCase();

  return (
    <>
      <div className="sidebar-mobile-bar">
        <button
          className="sidebar-mobile-toggle"
          onClick={() => setMobileOpen(true)}
          aria-label="Open navigation"
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <Link href="/hub" className="sidebar-mobile-brand">
          FOIA Fluent
        </Link>
      </div>

      {mobileOpen && (
        <div
          className="sidebar-scrim"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={`sidebar ${collapsed ? "sidebar-collapsed" : ""} ${
          mobileOpen ? "sidebar-mobile-open" : ""
        }`}
        aria-label="Main navigation"
      >
        <div className="sidebar-top">
          <Link href="/hub" className="sidebar-brand">
            <span className="sidebar-brand-full">FOIA Fluent</span>
            <span className="sidebar-brand-short">FF</span>
          </Link>
          <button
            className="sidebar-toggle"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
            title={collapsed ? "Expand" : "Collapse"}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
        </div>

        <nav className="sidebar-section">
          <div className="sidebar-section-label">Workspace</div>
          <ul className="sidebar-nav">
            {WORKSPACE_ITEMS.map((item) => {
              const active = item.isActive(pathname);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={`sidebar-link ${
                      active ? "sidebar-link-active" : ""
                    }`}
                    title={collapsed ? item.label : undefined}
                  >
                    <span className="sidebar-link-icon">{item.icon}</span>
                    <span className="sidebar-link-label">
                      <span className="sidebar-link-text">{item.label}</span>
                      {item.pulse && (
                        <span
                          className="sidebar-link-pulse"
                          aria-hidden="true"
                        />
                      )}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <nav className="sidebar-section sidebar-section-intel">
          <div className="sidebar-section-label">Intelligence</div>
          <ul className="sidebar-nav">
            {INTEL_ITEMS.map((item) => {
              const active = item.isActive(pathname);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={`sidebar-link ${
                      active ? "sidebar-link-active" : ""
                    }`}
                    title={collapsed ? item.label : undefined}
                  >
                    <span className="sidebar-link-icon">{item.icon}</span>
                    <span className="sidebar-link-label">
                      <span className="sidebar-link-text">{item.label}</span>
                      {item.pulse && (
                        <span
                          className="sidebar-link-pulse"
                          aria-hidden="true"
                        />
                      )}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="sidebar-section sidebar-section-recent">
          <div className="sidebar-section-label">Saved Searches</div>
          {recentSearches.length > 0 ? (
            <ul className="sidebar-recent-list">
              {recentSearches.map((s) => (
                <li key={s.id} className="sidebar-recent-item">
                  <a
                    href={`/draft?id=${s.id}`}
                    onClick={(e) => handleRecentClick(e, s.id)}
                    className="sidebar-recent-link"
                    title={s.query}
                  >
                    <span className="sidebar-recent-text">{s.query}</span>
                    {s.last_result_count > 0 && (
                      <span className="sidebar-recent-count">
                        {s.last_result_count}
                      </span>
                    )}
                  </a>
                  <button
                    type="button"
                    className="sidebar-recent-delete"
                    onClick={(e) => handleDeleteRecent(e, s.id)}
                    aria-label="Remove saved search"
                    title="Remove"
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          ) : userEmail ? (
            <div className="sidebar-recent-empty">
              No saved searches yet. Save a query from Discover &amp; Draft to
              jump back in.
            </div>
          ) : (
            <div className="sidebar-recent-empty">
              Sign in to save searches and pick up where you left off.
            </div>
          )}
        </div>

        <div className="sidebar-spacer" />

        {supabase && (
          <div className="sidebar-profile" ref={profileRef}>
            {userEmail ? (
              <>
                {profileOpen && (
                  <div className="sidebar-profile-menu" role="menu">
                    <button
                      className="sidebar-profile-menu-item"
                      onClick={handleSignOut}
                    >
                      Sign out
                    </button>
                  </div>
                )}
                <button
                  className="sidebar-profile-trigger"
                  onClick={() => setProfileOpen((o) => !o)}
                  aria-haspopup="menu"
                  aria-expanded={profileOpen}
                  title={collapsed ? userEmail : undefined}
                >
                  <span className="sidebar-profile-avatar">{initial}</span>
                  <span className="sidebar-profile-meta">
                    <span className="sidebar-profile-email">{userEmail}</span>
                    <span className="sidebar-profile-status">Signed in</span>
                  </span>
                </button>
              </>
            ) : (
              <Link href="/login" className="sidebar-profile-signin">
                <span className="sidebar-profile-avatar sidebar-profile-avatar-empty">
                  ?
                </span>
                <span className="sidebar-profile-meta">
                  <span className="sidebar-profile-email">Sign in</span>
                  <span className="sidebar-profile-status">
                    Save + track requests
                  </span>
                </span>
              </Link>
            )}
          </div>
        )}
      </aside>
    </>
  );
}
