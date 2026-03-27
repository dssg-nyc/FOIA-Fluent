"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

function LoginForm() {
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [hasPendingRequest, setHasPendingRequest] = useState(false);
  const searchParams = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    setHasPendingRequest(
      searchParams.get("next") === "track" &&
      !!localStorage.getItem("pending_track_request")
    );
  }, [searchParams]);

  async function handleSendCode(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) {
      setError("Authentication is not configured.");
      return;
    }
    setLoading(true);
    setError("");
    const { error: authError } = await supabase.auth.signInWithOtp({
      email,
    });
    setLoading(false);
    if (authError) {
      setError(authError.message);
    } else {
      setStep("code");
    }
  }

  async function handleVerifyCode(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) {
      setError("Authentication is not configured.");
      return;
    }
    setLoading(true);
    setError("");
    const { error: authError } = await supabase.auth.verifyOtp({
      email,
      token: otp,
      type: "email",
    });
    setLoading(false);
    if (authError) {
      setError(authError.message);
    } else {
      const pending = localStorage.getItem("pending_track_request");
      if (pending) {
        router.replace("/auth/callback");
      } else {
        router.replace("/dashboard");
      }
    }
  }

  if (step === "code") {
    return (
      <main className="login-page">
        <div className="login-card">
          <h1>Enter your code</h1>
          <p>
            We sent a code to <strong>{email}</strong>.
          </p>
          {hasPendingRequest && (
            <p className="login-hint">
              Your draft request will be saved automatically when you sign in.
            </p>
          )}
          <form onSubmit={handleVerifyCode} className="login-form">
            <label htmlFor="otp">Verification code</label>
            <input
              id="otp"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={8}
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
              placeholder="12345678"
              required
              autoFocus
              autoComplete="one-time-code"
              style={{ letterSpacing: "0.3em", fontSize: "1.25rem", textAlign: "center" }}
            />
            {error && <p className="login-error">{error}</p>}
            <button type="submit" disabled={loading || otp.length !== 8}>
              {loading ? "Verifying…" : "Verify"}
            </button>
          </form>
          <p className="login-hint" style={{ marginTop: "1rem" }}>
            Didn&rsquo;t get it? Check spam or{" "}
            <button
              onClick={() => { setStep("email"); setOtp(""); setError(""); }}
              style={{ background: "none", border: "none", color: "var(--primary)", cursor: "pointer", padding: 0, font: "inherit", textDecoration: "underline" }}
            >
              try again
            </button>
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
          Enter your email to receive a sign-in code. No password needed.
        </p>
        <form onSubmit={handleSendCode} className="login-form">
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
            {loading ? "Sending…" : "Send sign-in code"}
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
