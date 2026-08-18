import { ImageResponse } from "next/og";

/**
 * Social card for the landing page (1200x630).
 *
 * Rendered on demand rather than checked in as a PNG, so the copy and the
 * stat line stay in one place. Fraunces is loaded from ./_og-fonts because
 * satori (what next/og renders with) needs a TTF/OTF buffer — it can't use
 * the woff2 that next/font serves to browsers, and it has no access to the
 * page's CSS. The `_` prefix keeps the folder out of the router.
 */
export const runtime = "edge";
export const alt = "FOIA Fluent — The complete FOIA workspace";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpengraphImage() {
  const [regular, semibold, inter] = await Promise.all([
    fetch(new URL("./_og-fonts/Fraunces-Regular.ttf", import.meta.url)).then(
      (r) => r.arrayBuffer()
    ),
    fetch(new URL("./_og-fonts/Fraunces-SemiBold.ttf", import.meta.url)).then(
      (r) => r.arrayBuffer()
    ),
    fetch(new URL("./_og-fonts/Inter-Medium.ttf", import.meta.url)).then((r) =>
      r.arrayBuffer()
    ),
  ]);

  const ink = "#000000";
  const muted = "#6e6e7a";
  const primary = "#1863dc";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#ffffff",
          padding: "64px 76px",
          fontFamily: "Fraunces",
        }}
      >
        {/* Brand line */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            fontSize: 28,
            fontWeight: 600,
            color: ink,
            letterSpacing: "-0.02em",
          }}
        >
          <div
            style={{
              width: 10,
              height: 10,
              borderRadius: 10,
              background: primary,
              display: "flex",
            }}
          />
          FOIA Fluent
        </div>

        {/* Headline */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            fontSize: 78,
            fontWeight: 600,
            lineHeight: 1.08,
            letterSpacing: "-0.035em",
            color: ink,
          }}
        >
          <span>Search records.</span>
          <span>Draft requests.</span>
          <span style={{ color: primary }}>Track responses.</span>
        </div>

        {/* Stat line */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 20,
            fontSize: 21,
            color: muted,
            fontFamily: "Inter",
            borderTop: "1px solid #e5e5ea",
            paddingTop: 26,
          }}
        >
          <span>1,600+ federal agencies</span>
          <span style={{ color: "#d4d4d8" }}>/</span>
          <span>54 state jurisdictions</span>
          <span style={{ color: "#d4d4d8" }}>/</span>
          <span>17 years of FOIA.gov data</span>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Fraunces", data: regular, weight: 400, style: "normal" },
        { name: "Fraunces", data: semibold, weight: 600, style: "normal" },
        { name: "Inter", data: inter, weight: 500, style: "normal" },
      ],
    }
  );
}
