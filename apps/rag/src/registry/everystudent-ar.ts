/**
 * EveryStudent — Arabic (everyarabstudent.com). The Arabic banner of Cru's
 * seeker-facing Q&A ministry: short apologetics/life-issue articles aimed at
 * Arabic-speaking students who are not believers. Slice #9; planned in #112.
 *
 * **A separate SOURCE KEY, not a language of `everystudent`** — one domain =
 * one source (ADR-0006). everyarabstudent.com is its own domain, so it gets its
 * own key, the same way `thelife-fr` (laviejenparle.com) and `thelife-zh`
 * (uwota.com) are separate from `thelife`. questions2vie.com → `everystudent-fr`
 * follows as its own slice.
 *
 * **WALLED (ADR-0012), like its English sibling.** Re-probed 2026-07-25: the
 * homepage and `/sitemap.xml` both return **403** carrying the Cloudflare
 * block-page signature (`Attention Required`), and only `robots.txt` answers
 * plain HTTP. So `fetchStrategy: "firecrawl"` — every request this source makes
 * is billed per page (measured 1 credit/page on this exact host in #114, because
 * Firecrawl's `basic` proxy clears it and `auto` never escalates to the 5-credit
 * enhanced retry; re-measure before any large re-crawl, since a tightened wall
 * would quintuple the cost).
 *
 * **Hand-listed seeds, not a discovery crawl** — same reasoning as the English
 * entry, and the same already-paid inventory. `/sitemap.xml` is unreachable to
 * plain HTTP, and #114 already enumerated this domain through Firecrawl's
 * `/v2/map` (84 URLs, 1 credit flat, full list preserved as a comment on that
 * issue). Re-discovering would re-pay for knowledge we already hold, so the
 * mapped inventory is lifted here directly. `sitemaps` is intentionally absent.
 *
 * **67 seeds from the 84 mapped.** Dropped:
 *   - the **11 `/m/*` pages** — the mobile/menu section indexes (`about`,
 *     `contact`, `sitemap`, `intl`, `forum`, and the six topic hubs). #112's
 *     crawl policy strips `/m/`, `/menu/`, `/menus/` across all three banners;
 *     these are navigation, not articles.
 *   - the **4 `/bible/**.pdf` files** (1 Corinthians, Numbers, Nehemiah,
 *     Psalms). `ingestionMode: "html-scrape"` cannot extract a PDF, and they are
 *     public-domain Scripture text rather than ministry writing — outside what
 *     this corpus answers from.
 *   - the bare homepage.
 * No `block` array: `block` filters DISCOVERED urls, and a seed-only source
 * discovers none — the seed list itself is the filter. Anything added later must
 * be re-checked against robots.txt by hand.
 *
 * **`/john.html` and `/pack.html` are kept provisionally.** Both are root-level
 * pages the map returned but that could not be classified without spending a
 * credit to fetch them (likely a Gospel-of-John reader and a resource pack).
 * `minContentLength: 250` drops them automatically if they turn out to be
 * link-only chrome; confirm at Stage 1 rather than pre-emptively.
 *
 * **robots.txt is `User-agent: * Allow: /`** — checked live 2026-07-25. This
 * DIFFERS from everystudent.com, which carries a real disallow list
 * (`/4laws.html`, `/team/*`, `/mobi/*`, …). Nothing on this domain is
 * disallowed, so no seed needed dropping on robots grounds.
 *
 * **Extraction.** `.content4` / `.content4b` (plus `.articletitle`,
 * `.contentpadding`) — #112 records the same template across all three walled
 * banners and the 48 non-walled siblings (#111). The strip list mirrors the
 * English entry's measured tuning: `sitelevel_noindex` (share links + related
 * cards) and `.fccell` (the "FEATURE CLOSE" call-to-action table appended to
 * every article), which together removed ~275–360 chars of pure chrome per page
 * there. Verify the selectors actually bind on the first Arabic fetch — the
 * shared-template claim is #112's, not yet measured on this host.
 *
 * **Language: `["ar"]` — declared, not assumed.** All 84 mapped URLs sit under
 * one Arabic banner and #114 sampled `/a/personally.html` as genuine Arabic. The
 * stored per-document label still comes from content detection at ingest
 * (invariant 6), never from this field. Null-language risk is low here in a way
 * it was not for English: tinyld returns `ar` at confidence **1.0 with no
 * runner-up** on Arabic prose (probed 2026-07-25), where the English domain's 9
 * nulls came from `en` scoring 0.605–0.771 against a spurious `hi` runner-up
 * under the 0.75 gate. The residual null source here is the 500-char detection
 * floor on thin docs, not script ambiguity.
 *
 * `requestDelayMs` is modest because Firecrawl fronts the requests: the
 * politeness that matters is Firecrawl's own egress, and each scrape already
 * takes seconds.
 */
import type { SourceEntry } from "./types.js"

export const everystudentAr: SourceEntry = {
  key: "everystudent-ar",
  name: "EveryStudent — Arabic (everyarabstudent.com)",
  domain: "www.everyarabstudent.com",
  trust: "partner",
  ingestionMode: "html-scrape",
  languages: ["ar"],
  defaultTags: ["everystudent", "cru", "topic:seeker", "lang:ar"],
  defaultCategory: "article",
  rights:
    "© EveryArabStudent.com (Cru) — partner ministry content; used for retrieval/attribution.",
  crawl: {
    baseUrl: "https://www.everyarabstudent.com",
    // ADR-0012: the wall is unpassable to plain HTTP, so EVERY request is billed.
    fetchStrategy: "firecrawl",
    seedPaths: [
      "/a/acceptreject.html",
      "/a/answer.html",
      "/a/atheist.html",
      "/a/atheist2.html",
      "/a/beauty.html",
      "/a/bible.html",
      "/a/byondblind.html",
      "/a/care.html",
      "/a/childraped.html",
      "/a/compelled.html",
      "/a/coronavirus.html",
      "/a/difference.html",
      "/a/eating.html",
      "/a/endingthe8th.html",
      "/a/evil.html",
      "/a/facing.html",
      "/a/fem.html",
      "/a/forbidden.html",
      "/a/forgiveness.html",
      "/a/happy.html",
      "/a/heaven.html",
      "/a/holyspirit.html",
      "/a/hopeforlasting.html",
      "/a/howcan.html",
      "/a/isjesus.html",
      "/a/isthere.html",
      "/a/jesusinislam.html",
      "/a/jesustrust.html",
      "/a/jobinterviews.html",
      "/a/lamb.html",
      "/a/loveorlust.html",
      "/a/matter.html",
      "/a/midstoftragedy.html",
      "/a/mylife.html",
      "/a/peaceofmind.html",
      "/a/personally.html",
      "/a/purpose.html",
      "/a/quench.html",
      "/a/r1.html",
      "/a/real.html",
      "/a/searching.html",
      "/a/sex.html",
      "/a/strange.html",
      "/a/struggling.html",
      "/a/tense2.html",
      "/a/then.html",
      "/a/throne.html",
      "/a/toxic.html",
      "/a/trinity.html",
      "/a/universe.html",
      "/a/violin.html",
      "/a/where.html",
      "/a/whodoyousay.html",
      "/a/whois.html",
      // "/a/whowas.html" — REMOVED 2026-08-06. 23,624 chars of curated
      // highlights from the Gospel of John, carrying the estate's own formula:
      // excerpts taken straight from the Bible "دون إضافة لأي تعليق" (without
      // adding any commentary). Because it is predominantly Bible-translation
      // text, it stays quarantined until its translation, rights holder, reuse
      // terms, and required attribution are known and representable. The same
      // temporary rule covers this entry's own /bible/**.pdf files.
      // All 13 copies across the estate went together (campaign #111 §0.13).
      // ⚠️ This source is LIVE IN PRODUCTION with 12 golden cases; none of them
      // credits this document, so no answer key changes. A `block` rule would
      // be dead config here — this is a seed-only source.
      "/a/why.html",
      "/a/whydid.html",
      "/a/whypick.html",
      "/a/wolves.html",
      "/a/word1.html",
      "/a/word2.html",
      "/john.html",
      "/pack.html",
      "/v/collins.html",
      "/v/gods-help.html",
      "/v/isGodgood.html",
      "/v/personally.html",
      "/v/video7.html",
    ],
    // No `sitemaps`: discovery was already paid for (#114). See the header.
    contentSelectors: [
      ".content4",
      ".content4b",
      ".articletitle",
      ".contentpadding",
    ],
    stripSelectors: [
      "script",
      "style",
      "noscript",
      "svg",
      "nav",
      "header",
      "footer",
      "form",
      // Site-specific chrome, mirrored from the English entry (see header):
      "sitelevel_noindex", // share links + "Other articles you might like" cards
      ".relatedbottom", // related-article thumbnails
      ".fccell", // the "FEATURE CLOSE" call-to-action table appended to every article
      ".hr2",
      ".articledivider",
    ],
    // Firecrawl fronts every request; a scrape already takes seconds.
    requestDelayMs: 1000,
    maxPages: 120, // 67 seeds + headroom
    minContentLength: 250,
  },
}
