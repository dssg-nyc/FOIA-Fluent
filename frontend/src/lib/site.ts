/**
 * Canonical origin for the deployed site.
 *
 * Used for `metadataBase`, Open Graph URLs, robots.txt and the sitemap —
 * all of which need absolute URLs. Only ever imported by server code
 * (root layout, page metadata, robots.ts, sitemap.ts), so the non-public
 * Vercel system variables are readable here.
 *
 * Resolution order:
 *   1. NEXT_PUBLIC_SITE_URL — set this once a custom domain is live; it is
 *      the only one that survives a domain change.
 *   2. Vercel's production URL. The NEXT_PUBLIC_ variant only exists when
 *      "Automatically expose System Environment Variables" is on, so the
 *      bare one is checked too — it is always present during a build.
 *   3. localhost, for `next dev`.
 */
const vercelProductionUrl =
  process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL ||
  process.env.VERCEL_PROJECT_PRODUCTION_URL;

export const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ||
  (vercelProductionUrl ? `https://${vercelProductionUrl}` : "http://localhost:3000");
