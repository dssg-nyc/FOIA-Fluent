"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

/**
 * Wraps a page to require authentication.
 * - If Supabase is not configured (local dev), renders children immediately.
 * - If authenticated, renders children.
 * - If not authenticated, redirects to /login.
 */
export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(!supabase); // no-auth → ready immediately

  useEffect(() => {
    if (!supabase) return;

    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        setReady(true);
      } else {
        router.replace("/login");
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event) => {
        if (event === "SIGNED_OUT") {
          router.replace("/login");
        }
      }
    );

    return () => subscription.unsubscribe();
  }, [router]);

  if (!ready) {
    return (
      <main style={{ padding: "4rem", textAlign: "center", color: "#888" }}>
        Loading…
      </main>
    );
  }

  return <>{children}</>;
}
