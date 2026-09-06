/**
 * Sightline Ministry (sightlineministry.org) — slice #4. The first source to
 * REUSE slice #3's discovery-crawl machinery (docs/architecture.md §3 fetch
 * policy / FOLLOW-UP F) with no new acquisition code: same WordPress/Yoast shape
 * as jesusfilm.org (`sitemap_index.xml`, serves 200, empty `Disallow:`, no
 * challenge wall — probed 2026-05-27). PARTNER content. Distinctive value is the
 * apologetics / skeptic / evidence axis.
 *
 * The retrieval corpus is two teaching buckets, both rendered in
 * `.o-longform-content__content`: ~414 apologetics/teaching **posts** (bare-root
 * `/<slug>/`) and ~1,000 **daily devotionals** (`/daily-devo/<slug>/`). We seed
 * the two content sitemaps directly rather than `sitemap_index.xml`, because
 * posts live at bare-root — path-indistinguishable from `page`/`contact` entries —
 * so the index would also pull in the asset (470), post_tag (124), category,
 * author, event and job sitemaps. The `resource` sitemap (45) is excluded: those
 * are `.o-principle-block` card/hub pages, not longform prose.
 */
import type { SourceEntry } from "./types.js"

export const sightlineMinistry: SourceEntry = {
  key: "sightline-ministry",
  name: "Sightline Ministry",
  domain: "sightlineministry.org",
  trust: "partner",
  ingestionMode: "html-scrape",
  languages: ["en"],
  defaultTags: ["sightline", "audience:skeptic"],
  defaultCategory: "article",
  rights:
    "© Sightline Ministry. Partner ministry content — used for retrieval/attribution.",
  crawl: {
    baseUrl: "https://sightlineministry.org",
    // Seed the two TEACHING content sitemaps directly (not the index). Each is a
    // flat <urlset>, so no <sitemapindex> recursion is needed. Scoping by sitemap
    // is the only clean lever here: posts are bare-root /<slug>/ and would be
    // indistinguishable by URL from page/contact entries in the index.
    sitemaps: ["/post-sitemap.xml", "/daily-devo-sitemap.xml"],
    // Same-host only.
    allow: ["^https://sightlineministry\\.org/"],
    // Keep apologetics posts (bare-root single-segment slug) OR daily devotionals
    // (/daily-devo/<slug>/). Validated against the live sitemaps 2026-05-27:
    // hint #1 covers all 415 post locs, hint #2 covers all 1,000 devo articles.
    // The two bare index pages (/blog/, /daily-devotions/) match a hint but are
    // dropped by `block` below.
    articleHints: [
      "^https://sightlineministry\\.org/[^/]+/$",
      "^https://sightlineministry\\.org/daily-devo/[^/]+/$",
    ],
    // Drop the two bare index pages each sitemap lists, plus non-HTML assets.
    block: [
      "sightlineministry\\.org/blog/?$",
      "sightlineministry\\.org/daily-devotions/?$",
      "\\.kml($|\\?)",
      "\\.pdf($|\\?)",
    ],
    // `.o-longform-content__content` is the prose container on BOTH posts and
    // devos (confirmed 2026-05-27); fall back to the <main id="content"> shell.
    contentSelectors: [
      ".o-longform-content__content",
      "#content",
      "main",
      "article",
    ],
    stripSelectors: [
      "script",
      "style",
      "noscript",
      "svg",
      "nav",
      "header",
      "footer",
      ".m-related-posts", // "related posts" widget at the foot of a post
      "form",
    ],
    requestDelayMs: 1500, // polite; ~1,414 pages ≈ 35 min
    maxPages: 1600, // covers post (415) + daily-devo (1001); ~1,414 kept after dropping 2 index pages
    minContentLength: 250,
  },
}
