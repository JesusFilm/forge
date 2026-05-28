import type { MetadataRoute } from "next"

import { WATCH_BASE_PATH, WATCH_CANONICAL_ORIGIN } from "@/lib/routes"

// Robots policy for the /watch surface. Allows the canonical watch routes and
// disallows the framework / API subtrees that must never be crawled (they
// mirror the proxy matcher + canonicalize RESERVED_PREFIXES). Paths are
// basePath-relative as Next.js serves robots.txt at the basePath root.
//
// No `sitemap` directive yet: the sitemap is deferred to its own ticket
// (no bulk video-list query exists, and a full video×language sitemap needs
// a sitemap-index + admin bulk query). Add the `sitemap` field here once
// `app/sitemap.ts` ships so crawlers discover it.
export default function robots(): MetadataRoute.Robots {
  const base = `${WATCH_CANONICAL_ORIGIN}${WATCH_BASE_PATH}`
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/_next/"],
    },
    host: base,
  }
}
