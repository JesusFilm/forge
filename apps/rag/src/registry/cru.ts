/**
 * Cru (cru.org) — the single source for the whole domain, English + Spanish.
 *
 * **One domain = one source** (rule adopted 2026-07-09). This entry supersedes BOTH
 * `cru-10-basic-steps` (slice #2's 12-page hand-list) and the short-lived `cru-es`
 * (a separate Spanish key, folded in here because it is the same domain). Sibling
 * sources still exist only where the *domain* differs — e.g. `thelife-fr`
 * (laviejenparle.com), `thelife-zh` (uwota.com).
 *
 * ## Scope (verified against the live sitemaps)
 *
 * English, from the `us-en` child sitemap (3,642 locs) → **2,145 URLs**:
 *   - `/train-and-grow/`  (1,842) discipleship — devotionals, 10-basic-steps,
 *     transferable-concepts, classics, pathways, core beliefs, prayer, fasting,
 *     evangelism, leadership training, bible studies, life & relationships.
 *   - `/how-to-know-god/` (114) the seeker/gospel trunk — "Would You Like to Know God
 *     Personally?", "What do Christians believe?", life-changed testimonies.
 *   - `/blog/` (317) spiritual-growth articles. Distinct content from train-and-grow
 *     despite mirroring its taxonomy: only 24 slugs overlap, all thin section-index
 *     pages that `minContentLength` drops.
 *
 * Spanish, from the `mx-es` child sitemaps (709 locs) → **571 URLs**:
 *   - `/mx/es/conoce-a-dios/` (seeker) + `/mx/es/crecer-y-equipar/` (grow & equip),
 *     minus `/10-pasos/` (see the language section below).
 *
 * Deliberately excluded (org / recruiting / commerce, not teaching): `/communities/`
 * (665), `/opportunities/` (399), `/about/` (169 — mostly donor-relations and
 * stewardship admin), `/campaigns/`, `/store/`, `/give/`. Also the regional English
 * mirrors `tt-en` (3,203) and `bb-en` (3,079): identical slugs under a different
 * locale path, which would duplicate the corpus under distinct canonical URLs.
 *
 * `/language-resources/` was un-blocked 2026-07-13 once per-document language detection
 * landed (ADR-0006/0007) — and inspection corrected the scope expectation: the 28
 * per-language pages (arabic.html … vietnamese.html) are **~90-char link-card hubs**
 * (the resources are `.cmp-teaser` cards pointing at external sites), all dropped by
 * `minContentLength`. The section's ONE real document is a French blog article
 * (`/language-resources/french/que-se-passe-t-il…`, ~3.5k chars of genuine French) —
 * hence `fr` in the declared set below.
 *
 * ## Language: the path lies, and so does `<html lang>`
 *
 * Language is decided **per document at ingest** from the cleaned body
 * (`ingestion/decide-language.ts`: 500-char floor, 0.75 confidence gate, `null` = not
 * confidently detected — never a guess; ADR-0006/0007). Neither the URL path nor
 * `<html lang>` participates. Evidence for why, all measured 2026-07-09 on this domain:
 *
 *  - `/mx/es/.../10-pasos-basicos-para-la-madurez-cristiana/**` serves **untranslated
 *    English** lesson bodies (Bill Bright's 10 Basic Steps) under Spanish chrome. Those
 *    pages carry the *English* `.article-long-form` template and read `lang=EN`
 *    (`intro-the-uniqueness-of-jesus.html` → 4,577 chars, "Who Is Jesus Christ? …").
 *    They are blocked below. (This *narrows* an older note in `registry/index.ts` /
 *    `docs/sources.md` which claimed cru.org had "no real Spanish content" — that was
 *    over-generalised from this one path.)
 *  - `<html lang>` is a **locale marker, not a body-language signal**: those same
 *    English-bodied pages declare `lang="es-mx"`, exactly like the genuinely Spanish
 *    ones. It fails wherever the path fails, so it is not worth capturing into
 *    `RawDocument`.
 *  - Blocking `/10-pasos/` is **not sufficient**. A body-language audit of the 537
 *    staged Spanish-path documents found **39–41 (≈7.6%) with English bodies**,
 *    concentrated in `crecer-y-equipar/comparte-evangelio` (31 of 98) and
 *    `crecer-y-equipar/vida-y-relaciones` (10 of 194) — e.g. "State of the Mission: The
 *    21st Century", "Weaving Social Justice into Cru Movements". They share **zero
 *    body_hash with any us/en document**, so they are unique articles that were simply
 *    never translated: keep them, label them `en`. An earlier 30-page spot-check found
 *    0 English pages and was simply unlucky — a reminder that sampling cannot establish
 *    a per-document property.
 *
 * ## Extraction (Adobe AEM — re-derived 2026-07-09; the slice-#2 selector did NOT generalize)
 *
 * There is **no single content container** across cru.org's templates. Measured against
 * ground truth (`.article-long-form`, else the sum of all `.cmp-text` blocks):
 *
 *  - `article` matched a **9-char stub on every page**. With the old
 *    `[".article-long-form","main","article","#content"]` list, any page lacking
 *    `.article-long-form` fell through to it and was dropped `too-thin` — the first live
 *    crawl skipped **59/59** `/how-to-know-god/` pages. Removed. (`main` and `#content`
 *    never match at all.)
 *  - `.article-long-form` exists only on *lesson-style* pages (10-basic-steps,
 *    transferable-concepts). It is **absent** on most of train-and-grow, on all of
 *    how-to-know-god, on all of blog, and on the Spanish templates.
 *  - `.cmp-text` **truncates**: articles are split across blocks and `querySelector`
 *    takes the first. heaven-and-hell → 14% of the article; the resurrection
 *    `full-article.html` → 3% (195 of 6,489 chars).
 *  - `.cmp-container` returns an **empty** first match on some pages (0 chars on
 *    `/how-to-know-god/my-story-a-life-changed/finding-peace.html`).
 *  - `.category-layout` (Spanish templates) matches **every** page but yields only a
 *    138-char CTA blurb. `.aem-Grid` is a first match that is 50k on one page, 21 on
 *    another, absent on a third. Both are traps.
 *
 * So: take `.article-long-form` where it exists, otherwise fall through to `<body>` and
 * let `stripSelectors` do the work. Across a 22-page English sample spanning 23
 * sub-sections this captures a **median 104% of ground truth (min 100%)**, and **105%**
 * over a 10-page Spanish sample — zero chrome leaks in either. The only drops are
 * genuine section-index/hub pages.
 *
 * `stripSelectors` therefore carries the load and must remove two things the tag-level
 * strip misses:
 *  - **AEM chrome** — `.cmp-header` / `.cmp-footer` / `.cmp-global-picker` are `<div>`s,
 *    not `<header>`/`<footer>` tags. The global picker alone is ~1,745 chars of country
 *    names ("Angola English Burundi Français …") that would otherwise land in every doc.
 *  - **Related-content furniture** — `.cmp-teaser` cards, `.swiper` carousels,
 *    `.cmp-experiencefragment` promos, `.legacy-tile`. Removing these took the
 *    body-fallback overhead from ~114–152% down to ~104%.
 */
import type { SourceEntry } from "./types.js"

export const cru: SourceEntry = {
  key: "cru",
  name: "Cru",
  domain: "www.cru.org",
  trust: "partner",
  ingestionMode: "html-scrape",
  // DECLARED/expected set (ADR-0006) — a cross-check, never the per-document stamp.
  // The label comes from content detection at ingest (decide-language.ts); a confident
  // detection outside this set is stored anyway and logs a warning. `fr` covers the one
  // real /language-resources/ French article.
  languages: ["en", "es", "fr"],
  defaultTags: ["cru", "discipleship", "spiritual-growth"],
  defaultCategory: "discipleship",
  rights:
    "Cru (partner ministry) — ingestion under ministry-partner understanding; citations + canonical URLs preserved; not redistributed.",
  crawl: {
    baseUrl: "https://www.cru.org",
    // Per-locale child sitemaps. The root /sitemap.xml is an index that also lists the
    // tt-en and bb-en regional English mirrors, which we do not want.
    sitemaps: [
      "https://www.cru.org/content/cru.sitemap.us-en-sitemap.xml",
      "https://www.cru.org/content/cru.sitemap.mx-es-sitemap.xml",
      // A separately-indexed spiritual-disciplines branch; overlaps the above, and the
      // discovery `Set` dedups. Seeded because it contributes 6 unique URLs.
      "https://www.cru.org/content/cru.sitemap.mx-es-crecer-y-equipar-crecimiento-espiritual-disciplinas-espirituales-sitemap.xml",
    ],
    allow: [
      "^https://www\\.cru\\.org/us/en/train-and-grow[/.]",
      "^https://www\\.cru\\.org/us/en/how-to-know-god[/.]",
      "^https://www\\.cru\\.org/us/en/blog[/.]",
      // `conoce-a-dios1` (a 7-loc CMS duplicate section) is excluded for free: the
      // trailing `[/.]` refuses to match the `1`.
      "^https://www\\.cru\\.org/mx/es/(conoce-a-dios|crecer-y-equipar)[/.]",
    ],
    block: [
      "/10-pasos", // untranslated English bodies under Spanish chrome — verified
      "/video/",
      "/quizzes-and-assessments/",
      "/audio/",
      "/infographics/",
      "/give",
      "/store",
      "/search",
      "\\?", // tracking/query variants
    ],
    // Every Cru content page is a `.html` leaf; this drops assets. Thin section-index
    // pages are removed later by `minContentLength`, not by a hint regex.
    articleHints: ["\\.html$"],
    // Lesson pages only; everything else falls through to <body> + stripSelectors.
    // Do NOT add `article` (a 9-char stub on every page), `.cmp-text` (truncates
    // multi-block articles), `.cmp-container` (empty first match), `.aem-Grid` or
    // `.category-layout` (Spanish-template traps). See docstring.
    contentSelectors: [".article-long-form"],
    stripSelectors: [
      "script",
      "style",
      "noscript",
      "svg",
      "nav",
      "header",
      "footer",
      // AEM chrome — these are <div>s, so the tag strip above misses them.
      ".cmp-header",
      ".cmp-footer",
      ".cmp-global-picker", // region/language picker: ~1,745 chars of country names
      ".cmp-breadcrumb",
      // related-content furniture (cards, carousels, reusable promo fragments)
      ".cmp-experiencefragment",
      ".cmp-teaser",
      ".swiper",
      ".swiper-slide",
      ".legacy-tile",
      ".material-icons-outlined", // icon ligature text (arrow_back, search, …)
      ".material-icons",
      ".article-share", // social share widget
      ".hidden-print",
    ],
    requestDelayMs: 2000, // AEM pages are large + sometimes slow; be polite
    maxPages: 3000, // 2,716 expected after allow/block; cap is a safety net
    minContentLength: 250,
  },
}
