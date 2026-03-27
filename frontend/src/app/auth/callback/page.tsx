"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { trackRequest } from "@/lib/tracking-api";

export default function AuthCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState("");

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
    const hash = window.location.hash;
    if (hash.includes("error=")) {
      const params = new URLSearchParams(hash.replace("#", ""));
      const errorDesc = params.get("error_description");
      if (errorDesc) {
        setError(errorDesc.replace(/\+/g, " "));
        return;
      }
    }

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

  if (error) {
    return (
      <main className="login-page">
        <div className="login-card">
          <h1>Sign-in link expired</h1>
          <p>Your sign-in link is no longer valid. This can happen if you requested multiple links — only the most recent one works.</p>
          <a href="/login" className="btn btn-primary" style={{ marginTop: "1rem", display: "inline-block", textDecoration: "none" }}>
            Request a new link
          </a>
        </div>
      </main>
    );
  }

  return (
    <main className="login-page">
      <div className="login-card">
        <h1>Signing you in…</h1>
        <p>Please wait while we verify your sign-in link.</p>
      </div>
    </main>
  );
}
