"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

function LoginForm() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [hasPendingRequest, setHasPendingRequest] = useState(false);
  const searchParams = useSearchParams();

  useEffect(() => {
    setHasPendingRequest(
      searchParams.get("next") === "track" &&
      !!localStorage.getItem("pending_track_request")
    );
  }, [searchParams]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) {
      setError("Authentication is not configured.");
      return;
    }
    setLoading(true);
    setError("");
    const { error: authError } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    setLoading(false);
    if (authError) {
      setError(authError.message);
    } else {
      setSent(true);
    }
  }

  if (sent) {
    return (
      <main className="login-page">
        <div className="login-card">
          <h1>Check your email</h1>
          <p>
            We sent a sign-in link to <strong>{email}</strong>. Click the link
            in the email to continue.
          </p>
          {hasPendingRequest && (
            <p className="login-hint">
              Your draft request will be saved automatically when you sign in.
            </p>
          )}
          <p className="login-hint">
            If you don&rsquo;t see it, check your spam folder.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="login-page">
      <div className="login-card">
        <h1>Sign in to FOIA Fluent</h1>
        {hasPendingRequest && (
          <div className="login-pending-notice">
            Your draft request is ready to save. Sign in and it will be automatically added to your account.
          </div>
        )}
        <p className="login-subtitle">
          Enter your email to receive a sign-in link. No password needed.
        </p>
        <form onSubmit={handleSubmit} className="login-form">
          <label htmlFor="email">Email address</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            autoFocus
          />
          {error && <p className="login-error">{error}</p>}
          <button type="submit" disabled={loading || !email}>
            {loading ? "Sending…" : "Send sign-in link"}
          </button>
        </form>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
