/**
 * thelife (thelife.com) — slice #5. **Live successor to the decommissioned
 * powertochange.com**: every powertochange content URL 301-redirects to
 * thelife.com (or to issuesiface.com for the `/discover/` + `/itv/` "issues"
 * sub-axis); the old WP sitemap is a 2014-2017 relic. thelife.com is Cru
 * Canada's modern discipleship/life-issues corpus — Statamic-powered, empty
 * `Disallow:` robots, no challenge wall. Probed 2026-05-29.
 *
 * **First Statamic source for the discovery crawler** (slice #3 was Yoast,
 * slice #4 was the same shape). Sitemap is a single flat `/sitemap.xml` with
 * 7,834 `<loc>` entries — no `<sitemapindex>`, so no recursion needed.
 *
 * **Scope (operator-chosen 2026-05-29):** articles + devotionals.
 *
 * **The true URL structure** (re-derived from the live sitemap at sub-step 1c
 * after the initial recon miscounted; see slice notes): articles live at
 * **bare-root single-segment slugs** like `/5-steps-to-staying-sober` (628 of
 * them in the sitemap, including a handful of nav/utility slugs blocked
 * below). The `/articles/` namespace contains ONLY tag-index pages
 * (`/articles/tags/<tag>`) — 478 of those, NOT articles. Devotionals are
 * `/devotionals/<slug>` (3,929); `/devotionals/tags/<tag>` is another 1,086
 * tag indexes that fail the single-segment hint and drop. Net policy intent
 * after the blocks below: ~623 articles + 3,929 devotionals ≈ **4,552 docs**.
 *
 * Taking the broader scope (vs. articles-only ~623) is a deliberate fork
 * despite slice #4's small-source crowding signal (FOLLOW-UP I #15) — the goal
 * is to sharpen the #15 evidence with a 4× source.
 *
 * Content selector `.article-body` covers BOTH shapes — confirmed on probes:
 * `/10-spiritual-questions-and-their-answers` → `<section class="article-body
 * dropcap">` (article, ~12k words shell), `/devotionals/a-higher-calling` →
 * the same `.article-body` wrapper (devotional, ~1.4k words). `.spaces-content`
 * is a wider page shell; we keep it as a lower-priority fallback.
 */
import type { SourceEntry } from "./types.js"

export const thelife: SourceEntry = {
  key: "thelife",
  name: "thelife",
  domain: "thelife.com",
  trust: "partner",
  ingestionMode: "html-scrape",
  // en + fr: the domain is overwhelmingly English, but it also serves genuine
  // French articles on the English host (e.g. /quand-ca-ne-va-pas-dites-la-verite,
  // /les-relations-sexuelles-ce-n-est-pas-du-cinema) — same-domain mixed content,
  // confirmed by the #73 corpus language sweep. Language is per-document at ingest
  // (decide-language.ts); this set only documents what the source contains.
  languages: ["en", "fr"],
  defaultTags: ["thelife", "cru-canada", "topic:discipleship"],
  defaultCategory: "article",
  rights:
    "© thelife (Cru Canada) — partner ministry content; used for retrieval/attribution.",
  crawl: {
    baseUrl: "https://thelife.com",
    // One flat <urlset> at /sitemap.xml (7,834 locs as of 2026-05-29 recon).
    // No sitemap index here; /sitemap_index.xml returns 404. discover.ts won't
    // need to recurse.
    sitemaps: ["/sitemap.xml"],
    // Same-host only.
    allow: ["^https://thelife\\.com/"],
    // Keep ARTICLES (bare-root single-segment slug — `/<slug>`) OR DEVOTIONALS
    // (single-segment `/devotionals/<slug>`). Optional trailing slash either
    // way; thelife serves the no-slash form, the regex is defensive.
    // Distribution from dry discovery: hint #1 matches 628 bare-root slugs
    // (623 articles + ~5 nav/utility blocked below); hint #2 matches 3,929
    // single-segment devotionals. `/articles/tags/*` (478 tag indexes) and
    // `/devotionals/tags/*` (1,086 tag indexes) fail both hints and drop.
    articleHints: [
      "^https://thelife\\.com/[^/]+/?$",
      "^https://thelife\\.com/devotionals/[^/]+/?$",
    ],
    // The bare-root hint above is broad — it also matches a handful of
    // nav/utility/section-index slugs that appear in the sitemap. Block them
    // explicitly. The other top-level non-article paths (`/tags/<tag>`,
    // `/author/<x>`, `/series/<x>`) have a subpath and so fail the hints
    // naturally; we don't need to block them.
    block: [
      "^https://thelife\\.com/(chat|give|partners|about|contact|error-report|content-submission-form|chat-terms-of-service|editorial-guidelines|editorial-themes|writing-for-the-internet)/?$",
      // section indexes — defensive; not observed in the live sitemap but cheap to assert.
      "^https://thelife\\.com/(articles|devotionals|tags|author|series)/?$",
      // non-HTML assets — defensive.
      "\\.kml($|\\?)",
      "\\.pdf($|\\?)",
    ],
    // `.article-body` is the prose container on BOTH articles and devotionals
    // (confirmed 2026-05-29). `.spaces-content` is the wider page shell — keep
    // as a defensive fallback; `<article>` / `<main>` after that.
    contentSelectors: [".article-body", ".spaces-content", "article", "main"],
    stripSelectors: [
      "script",
      "style",
      "noscript",
      "svg",
      "nav",
      "header",
      "footer",
      "form",
    ],
    requestDelayMs: 2000, // bumped from 1000 after Cloudflare 429'd ~45% of fetches at 1000ms; ~4,552 pages ≈ 152 min at this delay
    maxPages: 5000, // covers ~623 articles + 3,929 devotionals + headroom
    minContentLength: 250,
  },
}
