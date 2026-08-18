import type { Metadata, Viewport } from "next";
import { Inter, Fraunces } from "next/font/google";
import "./globals.css";
import Sidebar from "@/components/Sidebar";
import Footer from "@/components/Footer";
import ChatPanel from "@/components/ChatPanel";
import TourOverlay from "@/components/TourOverlay";
import { Analytics } from "@vercel/analytics/next";
import { siteUrl } from "@/lib/site";

// Both faces are self-hosted through next/font instead of the old
// @import in globals.css. That @import put the fonts on a four-hop
// critical path (HTML → layout.css → fonts.googleapis.com → gstatic),
// and Fraunces renders the H1 — i.e. the LCP element on the landing
// page. next/font serves them from our own origin and preloads them.
const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

// Variable font: no `weight` so the whole 100–900 range is available
// (globals.css uses 400/500/600). `opsz` is kept so the optical-size
// axis still tracks font-size the way the old @import did.
const fraunces = Fraunces({
  subsets: ["latin"],
  display: "swap",
  axes: ["opsz"],
  variable: "--font-fraunces",
});

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "FOIA Fluent — The complete FOIA workspace",
    template: "%s · FOIA Fluent",
  },
  description:
    "Search public records, draft FOIA requests grounded in real statute, and track every filing through to release.",
};

// Pin the viewport to device width so an overflowing element on any page
// can't cause mobile Safari to zoom the viewport out and break responsive
// layouts (including the sidebar drawer media query).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${fraunces.variable}`}>
      <body>
        <div className="app-shell">
          <Sidebar />
          <main className="app-main">
            {children}
            <Footer />
          </main>
        </div>
        <ChatPanel />
        <TourOverlay />
        <Analytics />
      </body>
    </html>
  );
}
