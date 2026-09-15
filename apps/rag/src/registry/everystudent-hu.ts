/**
 * EveryStudent — Hungarian (everystudent.hu). The Hungarian banner of Cru's
 * seeker-facing Q&A ministry: short apologetics and life-issue articles, plus a
 * dedicated section of first-person Hungarian student testimonies, written for
 * Hungarian-speaking students who are not believers. A non-walled #111 sibling
 * of `everystudent` (en), `everystudent-ru`, `everystudent-de` and the rest.
 *
 * **A separate SOURCE KEY, not a language of `everystudent`** — one domain =
 * one source (ADR-0006). everystudent.hu is its own domain, so it gets its own
 * key, the same way `everystudent-ru` (mirstudentov.com), `everystudent-fr`
 * (questions2vie.com) and `thelife-fr` (laviejenparle.com) are separate.
 *
 * ## NOT walled — plain HTTP throughout
 *
 * Verified 2026-07-29: **~110 plain-HTTP requests** with a full browser UA —
 * robots.txt, /sitemap.xml, a HEAD sweep of all 95 sitemap URLs, and a GET of
 * every one of those 95 pages plus /m/intl.html. **Every request returned HTTP
 * 200 with real HTML**, and not one carried a Cloudflare block-page signature.
 * So `fetchStrategy` is intentionally OMITTED — plain HTTP is the default and
 * nothing here needs Firecrawl (ADR-0012). Discovery is therefore free, so this
 * is a **discovery crawl**, not the hand-listed seed set the three walled
 * banners were forced into. Precedent: `thelife-fr`, `everystudent-ru`.
 *
 * The bare apex **301-redirects to `www`** (measured on /robots.txt), so
 * `www.everystudent.hu` is canonical and is the host every `<loc>` uses.
 *
 * ⓘ The brief flagged that `everystudent.cz` shares a ccTLD naming style and
 * does NOT use the shared template. That warning does not transfer: measured
 * against this host's own markup, everystudent.hu **is** a FreeFind-template
 * site — but with the `.contentpadding` correction, not the `.content4` the
 * walled entries claim. See Extraction.
 *
 * ## robots.txt — nothing disallowed
 *
 * Verified 2026-07-29: `https://www.everystudent.hu/robots.txt` → HTTP 200, and
 * the entire body is `User-agent: * Allow: /`. There is **no `Disallow` line at
 * all**, so nothing on this domain is disallowed and no URL is dropped on
 * robots grounds. Every exclusion below is a content-quality call, not a policy
 * one. Same as everyarabstudent.com / questions2vie.com, and unlike
 * everystudent.com, which carries a real disallow list.
 *
 * ## Sitemap — 95 entries, all distinct, all live
 *
 * Verified 2026-07-29: `https://www.everystudent.hu/sitemap.xml` → HTTP 200,
 * 7,055 bytes, `application/xml`. It holds 95 `<loc>` elements and **95
 * distinct URLs** — no duplicates. This matches prior recon's ~95 exactly.
 *
 * The 95 break down as:
 *   - **63 `/a/<slug>.html`** — the article corpus.
 *   - **20 `/story/<Name>.html`** — first-person student testimonies. KEPT: see
 *     "Testimonies are content" below.
 *   - **7 `/m/<slug>.html`** — section indexes. BLOCKED.
 *   - **`/story/`** — the testimony index. BLOCKED.
 *   - **`/janos.html`, `/hatizsak.html`, `/contact1.html`** — two email-series
 *     signup pages and the contact form. BLOCKED.
 *   - **`/`** — the homepage. BLOCKED.
 * So the expected yield is **83 documents** (63 articles + 20 testimonies).
 *
 * **All 95 URLs are live.** A HEAD sweep of the full sitemap returned **95/95
 * HTTP 200 with zero redirects** — no dead URLs, and none of the 301/302→home
 * stubs a sibling domain shipped unblocked.
 *
 * **Slugs are pure ASCII.** Measured on the actual `<loc>` values: **0 URLs
 * carry a non-ASCII character and 0 carry percent-encoding**, despite Hungarian
 * orthography (á é í ó ö ő ú ü ű) — the site transliterates them out of its
 * slugs (`/a/imadsagra.html`, not `imádságra`). Two slug shapes do need care and
 * `[^/]+` handles both: mixed case (`/a/Istenmegismerese.html`, and every
 * `/story/` slug is a capitalised first name) and hyphens
 * (`/a/isten-szemelyes-megismerese.html`).
 *
 * ## HTML-map cross-check — no delta, so no `seedPaths`
 *
 * The XML sitemap was cross-checked against the site's own HTML map
 * (`/m/sitemap.html`, "Oldaltérkép") **and** the union of internal links on all
 * 7 `/m/` indexes, the `/story/` index and the homepage — 96 internal links
 * total. Verified 2026-07-29: **not one article is missing from the XML
 * sitemap.** The only linked-but-unlisted URL is `/m/intl.html` (the "Más
 * országok" other-languages nav page, 12 chars), which is blocked anyway. So
 * unlike the siblings whose stale sitemaps needed pinning, this one is complete
 * and `seedPaths` is intentionally absent.
 *
 * ## Testimonies are content, not chrome
 *
 * The 20 `/story/<Name>.html` pages are kept deliberately. Verified 2026-07-29:
 * they extract **2,773–5,135 chars** each of genuine first-person Hungarian
 * narrative on the same `.contentpadding` container as the articles — e.g.
 * `/story/Agi.html` ("Megnyugvás Istenben", 3,523 ch) and `/story/David.html`
 * ("Ahogyan a távoli Isten közel került", 3,462 ch). The Russian sibling counts
 * the same genre as corpus; here it simply lives under its own path prefix, so
 * `articleHints` carries a second pattern rather than one.
 *
 * ## No duplicate slugs
 *
 * Six near-twin slug pairs looked like part-1/part-2 or transliteration
 * duplicates and were checked rather than assumed. Verified 2026-07-29 by
 * 12-word shingle overlap on extracted text — all six are genuinely distinct
 * and all are kept: `jezus`/`jezus2` **4.5%**, `Istenmegismerese`/
 * `isten-szemelyes-megismerese` **1.6%**, `letezik`/`isten-segitsege` **1.0%**,
 * and `kicsoda`/`kicsoda2`, `reinkarnacio`/`reinkarnaciorol`, `no`/`noi` all at
 * **0.0%**. There is no duplicate-content group to exclude.
 *
 * ## What is blocked, and the evidence for each
 *
 * `articleHints` alone already excludes all of these. The `block` list is
 * deliberately redundant: it records *why* each group is out, so a later
 * widening of the hints cannot silently readmit them.
 *
 * ⚠️ **11 of the 13 blocked pages CLEAR the 250-char floor**, so
 * `minContentLength` could never have excluded them. When no contentSelector
 * matches, `extractContent` does not return empty — it falls back to `<body>`
 * and returns the whole nav page. Every figure below is measured.
 *
 *   - **`/m/*` — navigation, not content.** All 7 fetched: `/m/foruma.html`
 *     735 ch, `/m/letezese.html` 905, `/m/megtapasztalasa.html` 999,
 *     `/m/problemai.html` 1,208, `/m/rejtelyei.html` 1,284 — each a list of
 *     headline + teaser pairs linking to `/a/` pages. Plus `/m/rolunk.html`
 *     ("Rólunk", the about page) at 3,589 ch and `/m/sitemap.html`
 *     ("Oldaltérkép", the site plan) at 3,186 ch of pure link list. The prefix
 *     block also covers `/m/intl.html`, the other-languages page that links out
 *     to the sibling domains — same reason the English entry drops
 *     `/menus/intl.html` and the French one `/m/intl.html`.
 *   - **`/story/` — the testimony index**, distinct from the 20 testimony pages
 *     it links to. 1,697 ch of name + teaser pairs ("Személyes történetek |
 *     Lilla | A kereszténység vallás vagy egy kapcsolat…").
 *   - **`/janos.html` — the Gospel-of-John email signup.** 1,241 ch: "János
 *     evangéliuma »bibliatanulmányozó« sorozat … Ebben az INGYENES email
 *     sorozatban…". The Hungarian twin of the `/jean.html` the French entry
 *     dropped at Stage 1 and the `/john.html` still live in the Arabic one.
 *     Signup form copy, not a seeker question being answered.
 *   - **`/hatizsak.html` — the "adventure/pack" email series.** 1,558 ch:
 *     "Lelki hátizsák" ("Spiritual Backpack"), a 5-part free email course
 *     ("5 részes (ingyenes) email sorozatra"). The Hungarian twin of
 *     `/aventure.html` / `/pack.html`.
 *   - **`/contact1.html` — the contact form.** 240 ch ("Kapcsolat … Írj
 *     nekünk!" plus the JS fallback line). It would fail the floor anyway;
 *     blocking skips the fetch.
 *   - **`/`** — the homepage. 1,009 ch via the `<body>` fallback — teaser text,
 *     well over the floor. Blocked so it is never fetched.
 *
 * ## Extraction — measured on this host, with the parser, not grepped
 *
 * Verified 2026-07-29 by running the repo's own `extractContent` logic
 * (node-html-parser, identical `tidy()`) against **all 95 live pages**. Grepping
 * proves nothing here: every one of these class names is also declared in the
 * page's inline `<style>` block, so a text search false-positives on all of
 * them. Char counts are extracted-text length. Every candidate, including the
 * zeroes:
 *
 *   - **`.contentpadding` — matched an element on 85/95 pages, and extracted
 *     0 chars on NONE of them. Median 5,269 ch.** This is the article
 *     container: kicker, title, subhead, byline and body. **SHIPPED, alone.**
 *   - **`.content4` — matched an element on 91/95 pages, and extracted 0 chars
 *     on 85 of them.** It is the empty spacer `<div class="content4"> </div>`.
 *     Its only non-zero matches are the `/m/` indexes and the `/story/` index —
 *     i.e. it yields text on exactly the pages this source excludes.
 *   - **`.content4b` — matched an element on 4/95 pages, 0 chars on 3 of them.**
 *     Effectively absent, and where present, empty.
 *   - **`.articletitle` — matched on 89/95, median 23 ch.** An `<h1>`. A title,
 *     not a body.
 *   - **`.content3`, `.content2`, `article`, `main` — 0 instances.** Not on this
 *     host at all.
 *
 * ⚠️ `contentSelectors` is NOT a fallback chain. `extractContent` binds the
 * FIRST selector that matches an ELEMENT — even one extracting 0 characters —
 * and then stops. Listing `.content4` "outermost first as a fallback" would
 * therefore bind the empty spacer on 85 pages and extract nothing, and every
 * article would skip as `too-thin` on an HTTP 200: silent, and invisible to the
 * unit tests. That is exactly how 5 of the 8 pilot entries shipped broken. So
 * this entry ships the ONE measured container and nothing else.
 *
 * **The 10 pages without `.contentpadding` — deliberately given no fallback.**
 * 3 are real articles (`/a/Istenmegismerese.html`, `/a/biblianak.html`,
 * `/a/kapcsolat.html`); the other 7 are pages this source blocks. Those 3 have
 * genuinely broken markup: the `<div class="content4b">` closes immediately and
 * the article's `<h1>`/`<h2>`/`<p>` nodes sit as **bare siblings under `<html>`
 * with no `<body>` element at all**, so the parser's largest container on
 * `/a/Istenmegismerese.html` holds just 164 chars. There is no container to fall
 * back TO. `extractContent`'s implicit `<body> ?? root` fallback already handles
 * them well — measured **7,342 / 26,575 / 10,929 chars** of clean article text,
 * opening on the title and closing on the footnote list, because this host's nav
 * and footer both sit inside the stripped `<sitelevel_noindex>`. Adding
 * `.content4b` as a "fallback" would actively break them (0 chars on 3 of its 4
 * matches). Known cosmetic artifact on those 3 only: a literal `<!DOCTYPE html>`
 * and the `<title>` text lead the extraction.
 *
 * ## Chrome stripped — every selector measured, unproductive ones DROPPED
 *
 * Measured inside the real `.contentpadding` scope across all 83 content pages,
 * each selector counted independently after the base strips:
 *
 *   - **`sitelevel_noindex` — 83/83 pages, 172 instances, 15,863 ch.** A custom
 *     ELEMENT tag, not a class: `<sitelevel_noindex> … </sitelevel_noindex>`.
 *     Hence the bare tag-name selector with no leading `.` — the sibling
 *     entries' form is correct, not a typo. It wraps the top nav and the footer.
 *   - **`.fctable` — 83/83 pages, 168 instances, 14,231 ch** — the "FEATURE
 *     CLOSE" call-to-action table appended to every article. Included as well as
 *     `.fccell` because stripping only the cells leaves the table shell.
 *   - **`.fccell` — 83/83 pages, 384 instances, 9,345 ch** — its cells. The two
 *     figures overlap (cells nest in the table); combined with everything above,
 *     the full strip list removes **25,208 ch** corpus-wide (716,927 → 691,719).
 *   - **`.shareiconsmenupg` — 83/83 pages, 83 instances, 1,660 ch** measured
 *     standalone. ⓘ **On THIS host it is redundant, unlike the German and
 *     Russian siblings.** Verified 2026-07-29: stripping `sitelevel_noindex`
 *     already removes the share widget on **83/83** pages, so the malformed-
 *     markup rationale from #128 does NOT hold here — this host's
 *     `<sitelevel_noindex>` nests correctly. Retained as a cheap explicit guard
 *     (it does remove real text when measured on its own), but do not cite this
 *     entry as evidence of the malformed-markup pattern.
 *
 * Measured and **deliberately NOT shipped**, because they remove no text:
 *   - **`.hr2` — 176 instances, 0 ch.** Empty 1px rule divs.
 *   - **`.articledivider` — 80 instances, 0 ch.** Same.
 *   - **`.relatedbottom` — 0 instances.** Absent from this host entirely.
 * The sibling entries carry all three; here they are provably no-ops on
 * extracted text, so they are omitted rather than copied on trust.
 *
 * ⚠️ `.contentpadding` also binds on `/m/rolunk.html`, `/m/sitemap.html`,
 * `/janos.html`, `/hatizsak.html` and `/contact1.html` — it does **not**
 * discriminate content from nav. The URL filters are what keep the corpus clean;
 * the selector must not be relied on to do it.
 *
 * ## Language: `["hu"]` — read, not inferred
 *
 * Verified 2026-07-29 by reading the extracted text myself. The pages serve
 * genuine Hungarian prose, not untranslated English. `/a/letezik.html` is titled
 * "Létezik-e Isten? Hat érv amellett, hogy hihetünk Istenben"; `/a/melegek.html`
 * opens "Az élet tele van elvárásokkal. Ahhoz, hogy megszerezzük a jogosítványt,
 * át kell menni a vizsgán."; `/a/szomjadat.html` asks "De gondolkodtál már azon,
 * hogy miért iszol annyit?"; `/story/David.html` narrates "Volt egyszer egy
 * Isten, akit a hittan órákról megismertem: egy szigorú, ősz, szakállas
 * öregúr…". The morphology is unmistakably Hungarian — agglutinative suffix
 * stacking (`megismerése`, `elvárásokkal`, `gondolkodtál`), the definite/
 * indefinite article pair `a`/`az`, and the vowels `ő`/`ű`. Scripture citations
 * use Hungarian book names throughout (János, Róma, Kolossé, Efézus, Zsoltárok,
 * Jelenések, Máté, Lukács, Apostolok).
 *
 * The only English on these pages is bibliographic — footnotes citing
 * English-language books ("McDowell, Josh. Evidence That Demands a Verdict") —
 * plus one stray untranslated meta phrase ("Find God -") in the lead of
 * `/a/Istenmegismerese.html`. Normal citation apparatus in a translated article,
 * not an untranslated body.
 *
 * The stored per-document language label still comes from content detection at
 * ingest (invariant 6), never from this field. `hu` is a NEW language for this
 * corpus as far as this entry knows; the orchestrator owns that determination.
 *
 * `requestDelayMs: 1000` — the politeness default. Nothing in the probes argued
 * for more: ~110 sequential requests drew no 429 and no throttling, and at 83
 * pages the whole crawl is ~1.5 minutes of wall clock.
 */
import type { SourceEntry } from "./types.js"

export const everystudentHu: SourceEntry = {
  key: "everystudent-hu",
  name: "EveryStudent — Hungarian (everystudent.hu)",
  domain: "www.everystudent.hu",
  trust: "partner",
  ingestionMode: "html-scrape",
  languages: ["hu"],
  defaultTags: ["everystudent", "cru", "topic:seeker", "lang:hu"],
  defaultCategory: "article",
  rights:
    "© EveryStudent.hu (Cru) — partner ministry content; used for retrieval/attribution.",
  crawl: {
    baseUrl: "https://www.everystudent.hu",
    // No `fetchStrategy`: verified 2026-07-29 that plain HTTP serves every page
    // on this host (unlike the three walled EveryStudent siblings). See header.
    sitemaps: ["/sitemap.xml"],
    allow: ["^https://www\\.everystudent\\.hu/"],
    // The whole content corpus and nothing else: 83 of the 95 sitemap URLs.
    // `[^/]+` is deliberate — slugs are ASCII but mixed-case
    // (/a/Istenmegismerese.html, every /story/ first name), and it stays safe if
    // a diacritic or percent-encoded slug is ever added.
    articleHints: [
      "^https://www\\.everystudent\\.hu/a/[^/]+\\.html$",
      "^https://www\\.everystudent\\.hu/story/[^/]+\\.html$",
    ],
    block: [
      // The estate's "Who was Jesus?" page (21,859 chars) — curated highlights
      // from the Gospel of John carrying the family's own formula: excerpts
      // taken straight from the Bible with NO COMMENTARY ADDED. Because it is
      // predominantly Bible-translation text, it stays quarantined until its
      // translation, rights holder, reuse terms, and required attribution are
      // known and representable. The same temporary rule covers the full
      // Gospel-of-John pages and `everystudent-ar` Bible-PDF pages. This is the
      // ~20-26k curated version of the same thing; all 13
      // instances across the estate go together (campaign #111 §0.13).
      // NOT inert — sibling copies took ranks 7 and 8 on a cross question,
      // consuming top-10 slots a real answer would hold.
      // It matches the article shape, so only a URL block catches it.
      "^https://www\\.everystudent\\.hu/a/jezus\\.html$",
      // The 7 section indexes (foruma, letezese, megtapasztalasa, problemai,
      // rejtelyei) are headline+teaser link lists at 735-1,284 ch; rolunk is the
      // about page (3,589 ch) and sitemap the site plan (3,186 ch). All clear
      // minContentLength, so the floor can NOT catch them. The prefix also
      // covers /m/intl.html, the other-languages page linking to the siblings.
      "^https://www\\.everystudent\\.hu/m/",
      // The testimony INDEX (1,697 ch of name+teaser pairs) — not the 20
      // /story/<Name>.html testimonies, which are kept as content.
      "^https://www\\.everystudent\\.hu/story/?$",
      // The Gospel-of-John email-study signup: 1,241 ch of form copy. Hungarian
      // twin of the /jean.html the French entry dropped at Stage 1.
      "^https://www\\.everystudent\\.hu/janos\\.html$",
      // "Lelki hátizsák", the 5-part email series: 1,558 ch. Hungarian twin of
      // /aventure.html / /pack.html. Clears the floor — only a URL block works.
      "^https://www\\.everystudent\\.hu/hatizsak\\.html$",
      // The contact form: 240 ch, would fail minContentLength anyway.
      "^https://www\\.everystudent\\.hu/contact1\\.html$",
      // The homepage — 1,009 ch of teaser text via the <body> fallback.
      "^https://www\\.everystudent\\.hu/?$",
    ],
    // ONLY `.contentpadding` — measured 2026-07-29 as the sole element on this
    // host that extracts the article (85/95 pages, 0 of them zero-char, median
    // 5,269 ch). `.content4` is deliberately ABSENT: it matches an element on
    // 91/95 pages but extracts 0 chars on 85 of them, and because extractContent
    // scopes to the first selector that MATCHES rather than the first that
    // yields text, listing it here would make every article skip as `too-thin`.
    // `.content4b` matches 4 pages and is empty on 3. See header for the 3
    // broken articles that intentionally use the implicit <body>/root fallback.
    // Rule 1e (added 2026-07-30, retrofitted): trailing "html" rescues pages
    // whose .contentpadding container collapses. Without it extract.ts falls
    // through to `?? root`, which returns the whole document INCLUDING a
    // literal `<!DOCTYPE html>` text node. Proven inert on healthy pages —
    // 21 of 21 sampled extractions were byte-identical before and after.
    // It can shadow nothing, because nothing follows it.
    contentSelectors: [".contentpadding", "html"],
    stripSelectors: [
      "head", // 0 ch inside .contentpadding; strips the duplicated
      // <title> on the "html" fallback path only. Safe because extract.ts
      // reads the title from `root` BEFORE the strip loop runs.
      "script",
      "style",
      "noscript",
      "svg",
      "nav",
      "header",
      "footer",
      "form",
      // Site-specific chrome — all counted in this host's markup (see header).
      // .hr2 / .articledivider / .relatedbottom are NOT listed: measured at
      // 176 instances / 80 instances / 0 instances but 0 chars removed each.
      "sitelevel_noindex", // custom ELEMENT tag, 172 instances, 15,863 ch: nav + footer
      ".shareiconsmenupg", // share widget, 1,660 ch — redundant on THIS host, kept as a guard
      ".fctable", // the "FEATURE CLOSE" CTA table shell, 14,231 ch
      ".fccell", // its cells, 9,345 ch (nested in the table above)
    ],
    requestDelayMs: 1000,
    maxPages: 130, // 95 sitemap entries (83 kept) + headroom
    minContentLength: 250,
  },
}
