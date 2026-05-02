"use client";

import { Suspense } from "react";
import SignalsDashboard from "@/components/SignalsDashboard";

// Live FOIA Signals is publicly accessible. Unauthenticated users see the
// same dashboard as signed-in users — persona preferences are simply not
// persisted until they sign in.
//
// Suspense boundary required because SignalsDashboard reads useSearchParams
// (drawer state lives in `?pattern=` / `?entity=` query params) and Next.js
// 14 needs the boundary so the static-prerender pass can bail to the
// client-side render path cleanly.
export default function SignalsPage() {
  return (
    <Suspense fallback={null}>
      <SignalsDashboard />
    </Suspense>
  );
}
