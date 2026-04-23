"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function SignalsPatternsRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/signals");
  }, [router]);
  return (
    <main className="signals-container">
      <p className="signals-empty">Redirecting to the live dashboard…</p>
    </main>
  );
}
