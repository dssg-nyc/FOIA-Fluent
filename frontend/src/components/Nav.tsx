"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export default function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const [userEmail, setUserEmail] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;

    supabase.auth.getUser().then(({ data }) => {
      setUserEmail(data.user?.email ?? null);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_, session) => {
        setUserEmail(session?.user?.email ?? null);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  async function handleSignOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
    router.push("/login");
  }

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
            className={`nav-link ${
              pathname.startsWith("/dashboard") || pathname.startsWith("/requests")
                ? "nav-link-active"
                : ""
            }`}
          >
            My Requests
          </Link>
        </div>
        {supabase && (
          <div className="nav-user">
            {userEmail ? (
              <>
                <span className="nav-user-email">{userEmail}</span>
                <button className="nav-signout" onClick={handleSignOut}>
                  Sign out
                </button>
              </>
            ) : (
              <Link href="/login" className="nav-link">
                Sign in
              </Link>
            )}
          </div>
        )}
      </div>
    </nav>
  );
}
