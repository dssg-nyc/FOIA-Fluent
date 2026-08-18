import type { Metadata } from "next";
import LandingClient from "@/components/landing/LandingClient";

/**
 * Server component so the landing page can export `metadata` — the
 * interactive parts (session check, scroll motion) live in
 * <LandingClient>, which is the client boundary.
 */
export const metadata: Metadata = {
  title: "FOIA Fluent — The complete FOIA workspace",
  description:
    "One workspace to find public records, draft FOIA requests grounded in real statute, and track every filing through to release. 1,600+ federal agencies and all 54 state jurisdictions.",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "FOIA Fluent",
    title: "FOIA Fluent — The complete FOIA workspace",
    description:
      "Search public records, draft requests grounded in real statute, and track every filing through to release.",
  },
  twitter: {
    card: "summary_large_image",
    title: "FOIA Fluent — The complete FOIA workspace",
    description:
      "Search public records, draft requests grounded in real statute, and track every filing through to release.",
  },
};

export default function HomePage() {
  return <LandingClient />;
}
