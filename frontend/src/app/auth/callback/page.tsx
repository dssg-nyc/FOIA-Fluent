"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

/**
 * Handles the Supabase magic link redirect.
 * Supabase redirects here after the user clicks the sign-in link in their email.
 * The URL contains the auth tokens in the fragment (#access_token=...).
 * Supabase JS SDK exchanges these automatically; we just wait and redirect.
 */
export default function AuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    if (!supabase) {
      router.replace("/dashboard");
      return;
    }

    // Listen for the auth state change that fires when the magic link is processed
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event) => {
        if (event === "SIGNED_IN") {
          router.replace("/dashboard");
        }
      }
    );

    // Also check if we're already signed in (handles page refresh)
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        router.replace("/dashboard");
      }
    });

    return () => subscription.unsubscribe();
  }, [router]);

  return (
    <main className="login-page">
      <div className="login-card">
        <h1>Signing you in…</h1>
        <p>Please wait while we verify your sign-in link.</p>
      </div>
    </main>
  );
}
