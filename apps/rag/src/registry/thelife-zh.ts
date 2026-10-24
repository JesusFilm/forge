/**
 * thelife — Simplified Chinese (uwota.com) — the Chinese language-variant of
 * thelife (Cru Canada). See thelife-fr.ts for the sibling-domain modeling
 * rationale (one domain = one language = one resumable crawl; uwota publishes
 * its own `/sitemap.xml`, so no discover.ts hreflang traversal is needed).
 *
 * **Structure mirrors thelife.com exactly** (verified live 2026-06-24): articles
 * are **bare-root single-segment slugs** (~336; uwota uses English-looking slugs
 * like `/a-happy-life`, `/6a-raising-kids` for its Chinese content); `/articles/*`
 * (456) and `/devotionals/*` (1,077) are ALL `…/tags/<tag>` index pages; `/tags/*`,
 * `/author/*`, `/about` are nav. thelife's `articleHints` + `block` port verbatim.
 *
 * Content selector `.article-body` confirmed on a sample: Simplified Chinese
 * prose extracted cleanly (`/a-happy-life` → ~14k chars). Same Statamic/Cloudflare
 * stack as thelife → `requestDelayMs: 2000`.
 */
import type { SourceEntry } from "./types.js"

export const thelifeZh: SourceEntry = {
  key: "thelife-zh",
  name: "thelife — Chinese (UWOTA)",
  domain: "uwota.com",
  trust: "partner",
  ingestionMode: "html-scrape",
  languages: ["zh"],
  defaultTags: ["thelife", "cru-canada", "topic:discipleship", "lang:zh"],
  defaultCategory: "article",
  rights:
    "© thelife / UWOTA (Cru Canada) — partner ministry content; used for retrieval/attribution.",
  crawl: {
    baseUrl: "https://uwota.com",
    sitemaps: ["/sitemap.xml"],
    allow: ["^https://uwota\\.com/"],
    articleHints: [
      "^https://uwota\\.com/[^/]+/?$",
      "^https://uwota\\.com/devotionals/[^/]+/?$",
    ],
    block: [
      "^https://uwota\\.com/(chat|about|contact|series|thanks|thank-you)/?$",
      "^https://uwota\\.com/(articles|devotionals|tags|author|series)/?$",
      "\\.kml($|\\?)",
      "\\.pdf($|\\?)",
    ],
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
    requestDelayMs: 2000, // same Statamic/Cloudflare stack as thelife
    maxPages: 1000, // ~336 bare-root articles + headroom
    minContentLength: 250,
  },
}
