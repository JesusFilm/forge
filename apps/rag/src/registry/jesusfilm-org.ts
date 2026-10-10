/**
 * Jesus Film Project (jesusfilm.org) — slice #3's source and the first on the
 * discovery-crawl model (docs/architecture.md §3 Acquisition). FOLLOW-UP F was
 * the standalone implementation trail; the registry now carries the policy.
 * OWNED content. WordPress (Yoast sitemaps, `jesusfilm-2023` block theme),
 * Cloudflare-fronted but serves 200 — no challenge wall (probed 2026-05-26).
 *
 * The retrieval corpus is the ~351 `/blog/` teaching articles (devotional /
 * evangelism / parables / Bible-verse studies). `sitemap_index.xml` also lists
 * a page-sitemap (mostly `/give/` donation pages + `/about`) and a single
 * `.kml` location file — those are filtered out so only blog articles land.
 * Content lives in `.entry-content` (the WP block-theme post wrapper); the
 * related-posts widget is stripped.
 */
import type { SourceEntry } from "./types.js"

export const jesusFilmOrg: SourceEntry = {
  key: "jesusfilm-org",
  name: "Jesus Film Project",
  domain: "www.jesusfilm.org",
  trust: "owned",
  ingestionMode: "html-scrape",
  languages: ["en"],
  defaultTags: ["jesusfilm", "topic:blog", "audience:seeker"],
  defaultCategory: "article",
  rights:
    "© Jesus Film Project (Cru). Owned ministry content — used for retrieval/attribution.",
  crawl: {
    baseUrl: "https://www.jesusfilm.org",
    // One seed: the Yoast sitemap index. Discovery recurses it into its child
    // sitemaps (post-sitemap1/2, page-sitemap, local-sitemap) and filters below.
    sitemaps: ["/sitemap_index.xml"],
    // Same-host only.
    allow: ["^https://www\\.jesusfilm\\.org/"],
    // Content articles are /blog/<slug>/ — this also drops the bare /blog/
    // index, /give/, /about, the homepage, and the .kml location entry.
    articleHints: ["/blog/[^/]+/"],
    // robots.txt disallows (top-level paths) + donation/fundraising + non-HTML
    // assets. Anchored to the path root (`jesusfilm.org/<path>`) so a blog slug
    // that merely *contains* one of these substrings — e.g. /blog/devotions or
    // /blog/design-for-discipleship — is NOT dropped (an unanchored "/dev" would
    // false-positive on it).
    block: [
      "jesusfilm\\.org/wp-admin",
      "jesusfilm\\.org/dev(/|$)",
      "jesusfilm\\.org/messages(/|$)",
      "jesusfilm\\.org/email(/|$)",
      "jesusfilm\\.org/passionpurpose(/|$)",
      "jesusfilm\\.org/lac(/|$)",
      "jesusfilm\\.org/design(/|$)",
      "jesusfilm\\.org/give(/|$)",
      "\\.kml($|\\?)",
      "\\.pdf($|\\?)",
    ],
    contentSelectors: [".entry-content", "main", "article"],
    stripSelectors: [
      "script",
      "style",
      "noscript",
      "svg",
      "nav",
      "header",
      "footer",
      ".wp-block-jf-related-posts", // "related posts" widget at the foot of a post
      "form", // newsletter / search forms inside the content flow
    ],
    requestDelayMs: 1500, // polite; Cloudflare-fronted
    maxPages: 400, // covers all ~351 /blog/ posts (operator chose the full crawl)
    minContentLength: 250,
  },
}
