"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { trackRequest } from "@/lib/tracking-api";

/**
 * Handles the Supabase magic link redirect.
 * Supabase redirects here after the user clicks the sign-in link in their email.
 * The URL contains the auth tokens in the fragment (#access_token=...).
 * Supabase JS SDK exchanges these automatically; we just wait and redirect.
 *
 * If localStorage has a pending_track_request (saved before login), we submit
 * it after sign-in and redirect to the new request's detail page.
 */
export default function AuthCallbackPage() {
  const router = useRouter();

  async function handlePostSignIn() {
    const pending = localStorage.getItem("pending_track_request");
    if (pending) {
      try {
        const payload = JSON.parse(pending);
        const detail = await trackRequest(payload);
        localStorage.removeItem("pending_track_request");
        router.replace(`/requests/${detail.request.id}`);
        return;
      } catch {
        localStorage.removeItem("pending_track_request");
      }
    }
    router.replace("/dashboard");
  }

  useEffect(() => {
    if (!supabase) {
      handlePostSignIn();
      return;
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event) => {
        if (event === "SIGNED_IN") {
          handlePostSignIn();
        }
      }
    );

    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        handlePostSignIn();
      }
    });

    return () => subscription.unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
