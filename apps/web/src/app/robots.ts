import type { MetadataRoute } from "next"

// Robots policy for the /watch surface. Allows crawling and disallows the
// framework / API subtrees (`/api/`, `/_next/`) that must never be indexed.
// Paths are basePath-relative as Next.js serves robots.txt at the basePath
// root.
//
// No `host` directive: it's a non-standard Yandex-ism that Google/Bing
// ignore, and pointing it at a basePath sub-path would be misleading.
//
// No `sitemap` directive yet: the sitemap is deferred to its own ticket
// (no bulk video-list query exists, and a full video×language sitemap needs
// a sitemap-index + admin bulk query — see todo 025). Add the `sitemap`
// field here once `app/sitemap.ts` ships so crawlers discover it.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/_next/"],
    },
  }
}
