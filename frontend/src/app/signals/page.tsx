"use client";

import SignalsDashboard from "@/components/SignalsDashboard";

// Live FOIA Signals is publicly accessible. Unauthenticated users see the
// same dashboard as signed-in users — persona preferences are simply not
// persisted until they sign in.
export default function SignalsPage() {
  return <SignalsDashboard />;
}
