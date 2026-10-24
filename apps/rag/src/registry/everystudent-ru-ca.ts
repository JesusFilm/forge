/**
 * EveryStudent — Russian, Central-Asian edition (studentstan.com,
 * "СтудентСтан"). A Russian-language sibling of Cru's seeker-facing Q&A
 * ministry, aimed at Russian-speaking students in Central Asia.
 *
 * **A separate SOURCE KEY, not a language of `everystudent`** — one domain =
 * one source (ADR-0006). That rule is the entire reason this entry exists in
 * the shape it does; see the next section.
 *
 * ## 🔴 READ FIRST — this host is a MIRROR of `everystudent-ru`, and this
 * ## entry deliberately seeds only the FIVE articles that are NOT duplicates
 *
 * Measured 2026-07-30. 12-word shingle overlap of **all 87** studentstan
 * articles against the **full 99-article** `everystudent-ru` corpus
 * (mirstudentov.com) — a full cross-product, not a sample:
 *
 * | Best-match band                   | Articles |
 * |-----------------------------------|---------:|
 * | at or above 95% (identical)       |   **42** |
 * | 80-95%                            |       25 |
 * | 50-80%                            |       14 |
 * | below 20% (genuinely new)         |    **6** |
 *
 * **Mean 84.1%.** Same-slug pairs alone: mean 89.3%, median 94.6%. Worked
 * examples: `/a/christianstvo.html` 99.8%, `/a/dostoy.html` 99.7%,
 * `/a/abdul.html` 99.4%. **78 of 87 slugs are byte-identical filenames**, and
 * this host's own `/a/fol.html` reads "Я координатор проекта
 * Mirstudentov.com" — the sibling's signup page, not even re-branded.
 *
 * ⚠️ **The LOW percentages are not evidence of independence.** The lowest
 * same-slug pair, `/a/ad.html` at 52.7%, was diffed by hand: the bodies are
 * word-for-word the same translation. The score is depressed only because
 * mirstudentov prepends a section kicker and title, and uses en-dashes where
 * studentstan uses hyphens. **True content identity is HIGHER than the numbers
 * show.** Anyone re-running this must not conclude "only half overlaps".
 *
 * For calibration, the same test on hosts that are genuinely independent:
 * `uk` vs `ru` 0.00-0.04%, `ti` vs `am` 0.0%, `hr` vs `sr` 0.4-0.9%,
 * `cs` vs `sk` 0.00%. The test discriminates cleanly; a mirror is not a close
 * call.
 *
 * **Why seeding all 87 would be a real defect, not just waste:** the ingest
 * dedup gate keys on `(sourceKey, canonicalUrl)`. Two source keys means two
 * sets of rows, so roughly 81 near-duplicate Russian articles would be chunked,
 * embedded and left to compete with each other in retrieval. Nothing
 * downstream catches it — the same mechanism that let `everystudent-ro` stage
 * 25 byte-identical homepages (rule 1c), one level up.
 *
 * ## What IS seeded — 5 of the 6 genuinely unique articles
 *
 * Verified live 2026-07-30: all five return HTTP 200 with no redirect.
 *
 * | Path                   | Chars  | What it is                              |
 * |------------------------|-------:|-----------------------------------------|
 * | `/a/mutniye.html`      | 13,782 | Carl Wieland on genetics vs natural selection |
 * | `/a/uznat.html`        |  6,650 | Four Spiritual Laws tract — mirstudentov uses a different piece at this slug |
 * | `/a/aborti.html`       |  4,679 | Abortion                                |
 * | `/a/rashmor.html`      |  3,700 | Testimony                               |
 * | `/a/svetlana.html`     |  3,273 | Testimony                               |
 *
 * ⚠️ **`/a/mutniye.html` is third-party material** — by Carl Wieland, and the
 * page links to answersingenesis.org. Kept, because republished ministry
 * writing carried with credit is normal on this estate and already precedented
 * (`everystudent-ta` keeps articles credited to Worldwide Challenge and Richard
 * Purnell; `everystudent-ti` keeps one credited to SP Publications, used by
 * permission). The `rights` line below therefore does NOT claim authorship of
 * it — flagged here so nobody later reads our line as covering it.
 *
 * ⚠️ **The sixth unique article, `/a/jfil.html`, is deliberately NOT seeded.**
 * It is promo copy for the JESUS film pointing at a video ("Каждое слово,
 * произносимое Иисусом в фильме, взято из Евангелия от Луки… Для просмотра на
 * другом языке, перейдите по этой ссылке"), roughly 400 characters of real
 * prose before the nav begins. Same class as `everystudent-ro`'s
 * `/v/filmuliisus.html`, a transcript-less video embed that campaign already
 * skipped. One line to reverse if the operator disagrees.
 *
 * ## SEED MODE — there is no sitemap, and no `block` array
 *
 * Verified 2026-07-30 on the canonical `www` host: `/sitemap.xml`,
 * `/sitemap_index.xml`, `/sitemap.xml.gz`, `/wp-sitemap.xml` and `/robots.txt`
 * are **all 404**. The apex 301s to `www`. Because discovery is off, there is
 * no `sitemaps` field — and therefore no `block` array, because **the seed list
 * IS the filter**. Precedent for seed-only: `everystudent-ar` (68 seeds) and
 * `everystudent-bg` (84).
 *
 * The site's own map at `/m/karta.html` lists 86 articles; an href sweep adds
 * `/a/fol.html` (the signup stub above) and `/n/nedos.html`, the latter a
 * **404** — a site-wide typo for `/m/nedos.html` repeated on 10 pages. None of
 * that matters here, since only the 5 measured-unique paths are seeded.
 *
 * ## robots.txt — there is none
 *
 * HTTP 404 on both apex (via the 301) and `www`. No `Disallow`, and no named
 * AI-crawler rule: no `ClaudeBot`, no `GPTBot`, no `CCBot`, no
 * `Content-Signal:` line. Not a rights blocker, unlike katramstudentam.lv.
 *
 * ## Container — NOT the FreeFind template
 *
 * This host is a WordPress theme, structured
 * `#container > #content > .content-title + .entry > .post-content`. Measured
 * with the repo's own parser across all 87 pages:
 *
 * | Selector          | Matched | Zero-text | Chars        |
 * |-------------------|--------:|----------:|--------------|
 * | `.post-content`   |      86 |     **0** | 488 - 25,282 |
 * | `#content`        |      87 |         0 | 55 - 25,353  |
 * | `html`            |      87 |         0 | 4,581-37,100 |
 * | `.content4`       |   **0** |         - | matched 0 pages, 0 chars |
 * | `.contentpadding` |       0 |         - | -            |
 *
 * Both class and ID forms were probed for every candidate (rule 2): none of
 * `#content4`, `#contentpadding`, `.content4b`, `.entry-content`,
 * `.contentleftpadding`, `.cb-entry-content`, `.article-content`,
 * `.articletitle`, `main`, `article` or `body` matches an article here.
 *
 * `.post-content` binds first with **zero matched-but-empty pages**, so the
 * trailing `"html"` (rule 1e) is safe and can shadow nothing.
 *
 * ## Chrome — the legacy FreeFind strip list is 100% dead here
 *
 * `.sectionlink` is this host's call-to-action: **211 instances across 85
 * pages, 7,591 characters**. `.fccell`, `.fctable`, `.hr2`, `.articledivider`,
 * `.relatedbottom`, `.shareiconsmenupg` and `.likesharediv` have **0 instances
 * in the raw HTML** and are omitted rather than carried as parity no-ops that
 * can never bind. `sitelevel_noindex` is well-formed here and removes 0 chars
 * from `.post-content`; it is kept only because it earns its place on the
 * `"html"` fallback path.
 *
 * ## Language
 *
 * Russian, unambiguously. Over 710,461 extracted characters: Russian-only
 * ы/э/ъ = 12,572; Ukrainian-only і/ї/є/ґ = 1 (a stray inside a bibliography).
 * Word-boundary function words что 2,381 / это 914 / если 537, against
 * що 0 / це 0 / якщо 0. Latin is 0.37% of letters, citations only.
 *
 * ⚠️ **`ru` is a colliding label.** `everystudent-ru` (mirstudentov.com) also
 * declares `ru`, so language-filtered retrieval cannot separate the two — the
 * same ambiguity as `zh` across `thelife-zh` / `everystudent-zh-cn` /
 * `everystudent-zh-tw`. Recorded as an observation; not solved here.
 *
 * ## Not walled
 *
 * `server: Apache`, no Cloudflare header and no block-page signature on any
 * probe, so `fetchStrategy` is omitted and plain HTTP applies (ADR-0012).
 */
import type { SourceEntry } from "./types.js"

export const everystudentRuCa: SourceEntry = {
  key: "everystudent-ru-ca",
  name: "EveryStudent — Russian, Central Asia (СтудентСтан)",
  domain: "www.studentstan.com",
  trust: "partner",
  ingestionMode: "html-scrape",
  languages: ["ru"],
  defaultTags: ["everystudent", "cru", "topic:seeker", "lang:ru"],
  defaultCategory: "article",
  rights:
    "© StudentStan.com (Cru) — partner ministry content; used for retrieval/attribution. " +
    "Note: /a/mutniye.html is by Carl Wieland (answersingenesis.org), republished here.",
  crawl: {
    baseUrl: "https://www.studentstan.com",
    // SEED MODE. No `sitemaps` (none exists) and therefore no `block` — the
    // seed list is the filter. These are the 5 articles measured NOT to
    // duplicate everystudent-ru; the other 82 are mirrors. See the header.
    seedPaths: [
      "/a/mutniye.html",
      "/a/uznat.html",
      "/a/aborti.html",
      "/a/rashmor.html",
      "/a/svetlana.html",
    ],
    // Measured container, binding first with zero matched-but-empty pages.
    // Trailing "html" per rule 1e — it can shadow nothing, and it beats
    // extract.ts's implicit `?? root`, which leaks a literal doctype node.
    contentSelectors: [".post-content", "html"],
    stripSelectors: [
      "head", // 0 ch inside .post-content; earns its place on the fallback path
      "script",
      "style",
      "noscript",
      "svg",
      "nav",
      "header",
      "footer",
      "form",
      ".sectionlink", // THIS host's CTA: 211 instances, 7,591 ch across 85 pages
      "sitelevel_noindex", // well-formed here; 0 ch in scope, fallback-path only
    ],
    maxPages: 20,
    minContentLength: 250,
    requestDelayMs: 1000,
  },
}
