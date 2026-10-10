import type { MetadataRoute } from "next"
import { WATCH_BASE_PATH, WATCH_PUBLIC_METADATA_ORIGIN } from "@/lib/routes"

// Robots policy for the /watch surface. Allows crawling and disallows the
// framework / API subtrees (`/api/`, `/_next/`) that must never be indexed.
// Paths are basePath-relative as Next.js serves robots.txt at the basePath
// root.
//
// No `host` directive: it's a non-standard Yandex-ism that Google/Bing
// ignore, and pointing it at a basePath sub-path would be misleading.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/_next/"],
    },
    sitemap: `${WATCH_PUBLIC_METADATA_ORIGIN}${WATCH_BASE_PATH}/sitemap.xml`,
  }
}
