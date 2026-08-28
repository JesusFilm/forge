/**
 * FamilyLife (familylife.com) — slice #6. Cru's marriage & family ministry,
 * WordPress VIP (Automattic enterprise hosting). Probed 2026-06-03: 200,
 * empty challenge wall, open robots (`Disallow: /wp-admin/` only). Adds the
 * marriage/parenting teaching axis the 5-source corpus currently under-serves.
 *
 * **Fourth source to reuse slice #3's discovery-crawl machinery
 * (FOLLOW-UP F) with no new acquisition code** — same WordPress shape as
 * jesusfilm.org/sightline; differs from thelife (Statamic). The sitemap index
 * is `/sitemaps.xml` and lists 30 child sitemaps spanning posts, pages,
 * podcasts, and sub-brands (Art of Marriage, Blended, Stepping Up, Weekend
 * to Remember, Missions, Equip, Global, AOP, etc.).
 *
 * **Scope (operator-locked 2026-06-03, Scope A): "posts only"** — the
 * three post-sitemaps (the WordPress "post" content type) total **~2,330
 * URLs**: post-sitemap1 (939: 783 /articles/ + 155 /equip/ + 1 homepage),
 * post-sitemap2 (997 /articles/), post-sitemap3 (394 /articles/). We seed
 * these three child sitemaps directly rather than the index, sightline-style,
 * so we don't have to filter out 27 unrelated sub-brand sitemaps.
 *
 * The `/equip/` URLs in post-sitemap1 (155) are FamilyLife Equip teaching
 * content — mentoring, discipleship-of-a-new-Christian, leaving-an-abusive-
 * relationship, etc. — using the same WP post template + the same
 * `.the-content` selector as `/articles/`. They're kept (Scope A intent =
 * "all WP posts in the post-sitemap"); operator re-confirms at 1b dry
 * discovery. The separate `familylife-equip-sitemap1.xml` (custom post type)
 * is intentionally NOT seeded — that's sub-brand territory for a future
 * `familylife-equip` scoped sub-key per the Cru pattern.
 *
 * Content selectors verified on samples 2026-06-03: `<div class="the-content">`
 * is the innermost prose container inside `<div class="single-content
 * single-post-content">`; same wrapper on both `/articles/` and `/equip/`.
 * Sample article ~300 KB raw (heavy theme: nav, sidebar, related-posts CTAs,
 * social widgets — `stripSelectors` carries the load).
 */
import type { SourceEntry } from "./types.js"

export const familylife: SourceEntry = {
  key: "familylife",
  name: "FamilyLife",
  domain: "www.familylife.com",
  trust: "partner",
  ingestionMode: "html-scrape",
  // Spanish content lives on the same domain under the `/us-latinos/` path
  // prefix (its own `us-latinos-sitemap1.xml`); added 2026-06-24. No hreflang.
  languages: ["en", "es"],
  defaultTags: ["familylife", "cru", "topic:marriage", "topic:parenting"],
  defaultCategory: "article",
  rights:
    "© FamilyLife (Cru) — partner ministry content; used for retrieval/attribution.",
  crawl: {
    baseUrl: "https://www.familylife.com",
    // Seed the three WP "post" content-type sitemaps directly (sightline
    // pattern). The /sitemaps.xml index would also pull in 27 unrelated
    // sub-brand/page/podcast sitemaps that are out of Scope A.
    sitemaps: [
      "/post-sitemap1.xml",
      "/post-sitemap2.xml",
      "/post-sitemap3.xml",
      // Spanish (US Latino) content — its own isolated child sitemap.
      "/us-latinos-sitemap1.xml",
    ],
    // Same-host only.
    allow: ["^https://www\\.familylife\\.com/"],
    // Keep /articles/<...> OR /equip/<...> — both are WP posts using the same
    // template (verified 2026-06-03) — OR /us-latinos/<...> Spanish content.
    // Drops the single homepage `/` that post-sitemap1 lists, plus the bare
    // `/us-latinos/` landing (the `[^?#]+` requires a sub-path), plus any
    // defensive odd paths a future sitemap refresh might add.
    articleHints: [
      "^https://www\\.familylife\\.com/articles/[^?#]+",
      "^https://www\\.familylife\\.com/equip/[^?#]+",
      "^https://www\\.familylife\\.com/us-latinos/[^?#]+",
    ],
    // Defensive: block wp-admin (robots disallow), cart, podcast (deferred
    // to a future scope), and non-HTML assets that might leak from a
    // future sitemap shape change.
    block: [
      "^https://www\\.familylife\\.com/wp-admin/",
      "^https://www\\.familylife\\.com/cart/",
      "^https://www\\.familylife\\.com/podcast/",
      "\\.kml($|\\?)",
      "\\.pdf($|\\?)",
    ],
    // `.the-content` is the innermost prose container (inside
    // `.single-content.single-post-content`); confirmed on both /articles/
    // and /equip/ samples 2026-06-03. `.single-content` is a defensive
    // fallback if a future template tweak removes `.the-content`. <article>
    // and <main> are ultimate fallbacks.
    contentSelectors: [".the-content", ".single-content", "article", "main"],
    stripSelectors: [
      "script",
      "style",
      "noscript",
      "svg",
      "nav",
      "header",
      "footer",
      "form",
      ".related-content-posts", // foot-of-post related-articles widget
      ".fl-article-cta", // mid/end article CTAs ("Subscribe to…")
    ],
    requestDelayMs: 1500, // WP VIP (Automattic) — polite; ~2,330 pages ≈ 58 min
    maxPages: 2500, // ~2,330 expected + headroom
    minContentLength: 250,
  },
}
