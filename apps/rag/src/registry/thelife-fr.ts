/**
 * thelife — French (laviejenparle.com) — the French language-variant of
 * thelife (Cru Canada). thelife.com publishes hreflang `<xhtml:link>` alternates
 * pointing to three sibling DOMAINS — fr → laviejenparle.com, zh → uwota.com,
 * fa → shagerdan.com — each its own independent Statamic site with its own
 * `/sitemap.xml`. We model each as a separate single-domain source (one domain =
 * one language = one resumable crawl job), which keeps the single-valued
 * `SourceEntry.domain` invariant and needs no discover.ts hreflang traversal:
 * laviejenparle's own sitemap already lists every French URL under `<loc>`.
 *
 * **Structure mirrors thelife.com exactly** (verified live 2026-06-24): articles
 * are **bare-root single-segment slugs** (`/<slug>`, ~163 of them); `/articles/*`
 * (457) and `/devotionals/*` (1,078) are ALL `…/tags/<tag>` index pages, not
 * content; `/tags/*`, `/author/*`, `/series/*`, `/about` are nav. So thelife's
 * `articleHints` + `block` port over verbatim with the host swapped. The
 * `/devotionals/<slug>` hint currently matches nothing here (this site has no
 * separately-published leaf devotionals) — retained for parity with thelife and
 * to future-proof if French devotionals are added later.
 *
 * Content selector `.article-body` confirmed on a sample: French theological
 * prose extracted cleanly (`/10-questions-spirituelles-avec-reponses` → ~29k
 * chars). Same Statamic/Cloudflare stack as thelife → reuse `requestDelayMs:
 * 2000` (thelife saw ~45% Cloudflare 429s at 1000ms).
 */
import type { SourceEntry } from "./types.js"

export const thelifeFr: SourceEntry = {
  key: "thelife-fr",
  name: "thelife — French (La Vie J'en Parle)",
  domain: "laviejenparle.com",
  trust: "partner",
  ingestionMode: "html-scrape",
  languages: ["fr"],
  defaultTags: ["thelife", "cru-canada", "topic:discipleship", "lang:fr"],
  defaultCategory: "article",
  rights:
    "© thelife / La Vie J'en Parle (Cru Canada) — partner ministry content; used for retrieval/attribution.",
  crawl: {
    baseUrl: "https://laviejenparle.com",
    sitemaps: ["/sitemap.xml"],
    allow: ["^https://laviejenparle\\.com/"],
    articleHints: [
      "^https://laviejenparle\\.com/[^/]+/?$",
      "^https://laviejenparle\\.com/devotionals/[^/]+/?$",
    ],
    block: [
      // Nav/utility bare-root slugs observed in the sitemap (the bare-root hint
      // is broad). Thin ones would also fail minContentLength; this is belt-and-
      // suspenders + avoids fetching known non-articles.
      "^https://laviejenparle\\.com/(chat|about|contact|series|thanks|thank-you|la-vie|mon-bilan)/?$",
      // Section indexes — defensive.
      "^https://laviejenparle\\.com/(articles|devotionals|tags|author|series)/?$",
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
    maxPages: 1000, // ~163 bare-root articles + headroom
    minContentLength: 250,
  },
}
