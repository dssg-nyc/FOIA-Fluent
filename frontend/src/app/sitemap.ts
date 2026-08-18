import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";

// Only the landing page is reachable without a session — middleware.ts
// gates everything else (including /hub) behind Supabase auth, so listing
// those here would just point crawlers at a /login redirect. Add entries
// as routes become publicly readable.
export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: siteUrl, changeFrequency: "weekly", priority: 1 }];
}
