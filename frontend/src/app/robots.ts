import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";

// Only the marketing surface should be crawled — everything behind auth
// is user-specific and gated by middleware anyway.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/admin",
        "/auth",
        "/campaigns",
        "/dashboard",
        "/discoveries",
        "/draft",
        "/import",
        "/login",
        "/requests",
        "/research",
        "/signals",
      ],
    },
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
