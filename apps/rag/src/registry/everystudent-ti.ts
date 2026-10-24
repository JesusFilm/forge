/**
 * EveryStudent — Tigrinya (everytemhari.com, "EveryTemhari.com"). The Tigrinya
 * banner of Cru's seeker-facing Q&A ministry: short apologetics and life-issue
 * articles written for Tigrinya-speaking students who are not believers. A
 * sibling of `everystudent` (en), `everystudent-am` (habeshastudent.com),
 * `everystudent-bg`, `everystudent-ar`, `everystudent-fr`.
 *
 * **A separate SOURCE KEY, not a language of `everystudent`** — one domain =
 * one source (ADR-0006). everytemhari.com is its own domain, so it gets its own
 * key, the same way `everystudent-am` (habeshastudent.com), `everystudent-sq`
 * (pyetjetejetes.com) and `thelife-fr` (laviejenparle.com) are separate entries.
 *
 * ## 🔴 THE SMALLEST SOURCE IN THE ESTATE — 14 articles, and that is CORRECT
 *
 * Read this before assuming the crawl is broken. **This host publishes exactly
 * 14 articles.** Not 14 that we chose; 14 that exist. Three independent methods
 * agreed on 2026-07-30, which is why the number is stated as fact rather than as
 * a recon estimate:
 *   1. the site's own HTML map `/sitemap.html` lists 14 `/a/` pages;
 *   2. the site's own SiteLevel search index (crid `a2em13zb`, queried with 10
 *      Tigrinya terms × 4 result pages) returns the SAME 14 and nothing else;
 *   3. **the server's `/a/` directory index is OPEN and returns HTTP 200** — an
 *      Apache `Index of /a` listing the actual files on disk: **16 `.html`
 *      files**, being those 14 plus `/a/fol.html` and `peace copy.html`, both
 *      excluded below with reasons. This is ground truth, not inference.
 *
 * The count was also attacked from the other side. **76 slugs harvested from the
 * sibling estate** (all 40 `/a/` slugs in habeshastudent.com's sitemap plus 61
 * from the `everystudent` / `-ar` / `-sq` entries, deduped against what is here)
 * were HEAD-probed against `/a/`: **76 of 76 returned 404**. There is no
 * unlinked article cohort. `/john.html`, `/adventure.html`, `/pack.html`,
 * `/aventure.html`, `/m/relationships.html`, `/m/video.html`, `/m/faq.html`,
 * `/a/bible.html` and `/a/john.html` are all 404 as well.
 *
 * ⚠️ Batch 4 recorded `igod.co.il` at "~5 articles" when it has 1,020, because
 * the recon counted a `<sitemapindex>`'s five children as if they were pages.
 * **That failure mode cannot apply here: there is no XML sitemap at all** (see
 * below), and the file-level directory listing bounds the host absolutely.
 * Expected yield is **14 documents, ~74,769 chars total** — genuinely tiny.
 *
 * ## 🔴 SEED MODE — this host has NO XML sitemap
 *
 * Verified 2026-07-30, every one a real fetch: `/sitemap.xml` **404**,
 * `/sitemap_index.xml` **404**, `/sitemap.xml.gz` **404**, `/wp-sitemap.xml`
 * **404**, `/sitemap-index.xml` **404**, `/sitemapindex.xml` **404**,
 * `/sitemap1.xml` **404**, `/sitemap/sitemap.xml` **404**, `/sitemap.txt`
 * **404**, `/rss.xml` **404**, `/feed` **404**, `/atom.xml` **404**. `robots.txt`
 * carries **no `Sitemap:` line**. The only map is the site's own HTML page
 * `/sitemap.html` (HTTP 200, 35,851 bytes), which is a nav page, not a feed.
 *
 * So there is no `sitemaps` field, and therefore — per the `everystudent-ar` and
 * `everystudent-bg` precedent — **no `allow`, no `articleHints` and no `block`
 * either. The seed list IS the filter.** Anything unwanted is simply not listed.
 *
 * ## HEAD sweep — 14 of 14 live, zero dead, zero redirects
 *
 * `everystudent-sr` proved a site's own map can list dead URLs, and
 * `everystudent-ro` staged 25 byte-identical homepage copies via 301s. Neither
 * happened here. Every one of the 14 seeds below was HEAD-fetched 2026-07-30:
 * **14 × HTTP 200, 0 × 3xx, 0 × 4xx, empty `redirect_url` on all 14.** Nothing
 * was excluded for being dead, because nothing is dead.
 *
 * ⚠️ **`/a/isGodgood.html` carries a capital G and the server is
 * case-sensitive.** `seedUrls` passes the path through `new URL(path, baseUrl)`
 * verbatim, so the case must survive any future edit or the page 404s.
 *
 * ## Excluded — the 2 `/a/` files that exist and are NOT seeded
 *
 *   - **`/a/peace copy.html` (seedable as `/a/peace%20copy.html`, HTTP 200).** A
 *     stray editor duplicate of `/a/peace.html` left in the web root — same 28K
 *     on-disk size, same `<title>`, and **96.0% 12-word shingle overlap** with
 *     `/a/peace.html` (1,997 of 2,081 shingles shared; 9,779 vs 9,616 chars
 *     post-strip). It is in NEITHER the HTML map nor the search index, so only
 *     the open directory listing reveals it — and only a hand-list can exclude
 *     it. The document-level content hash cannot collapse two near-duplicates at
 *     different URLs, so seeding it would add a redundant document.
 *   - **`/a/fol.html` (HTTP 200, 3,019 chars).** "ምጅማር ምስ እግዚኣብሄር" ("Beginning
 *     with God") — the post-decision follow-up page, this host's twin of the
 *     `am` sibling's `/a/fol.html` and of the French `/aventure.html`. Three
 *     independent reasons: (1) it is **the only page on the whole host carrying
 *     `<meta name="robots" content="noindex">`** — all 23 other pages declare
 *     `content="all"` — so it is the site's own explicit exclusion; (2) it is
 *     pastoral follow-up for someone who has already decided, not seeker-facing
 *     Q&A; (3) `.contentpadding` is ABSENT on it, so it would arrive via the
 *     `html` fallback carrying nav chrome.
 *
 * Also not seeded, all measured ABOVE the 250 floor so only omission catches
 * them: the homepage (`html` fallback, 21,994 chars raw), `/sitemap.html` (491
 * chars of link list), `/about.html` (670), `/contact.html` (238), and the four
 * `/m/` section indexes — `/m/existence.html` (326), `/m/knowing.html` (371),
 * `/m/life.html` (287), `/m/intl.html` (42, the sibling-language link page).
 *
 * ⓘ **MEASURED ABSENCE, not a silent omission:** there is **no localized
 * Gospel-of-John signup page and no adventure/pack email-series page** on this
 * host. `/john.html`, `/a/john.html`, `/adventure.html`, `/pack.html` and
 * `/aventure.html` all return 404. The nearest thing is `/a/fol.html`, excluded
 * above, and unlike the `am` sibling it does not even hand off to an off-domain
 * email series — its only external link is the AddToAny share widget.
 *
 * ## ⓘ NO Scripture page on this host — checked against the 2026-07-29 policy
 *
 * The estate-wide rule blocks complete Bible books carried on article URLs
 * (`es` 100,409 ch, `sq` 98,887 ch). **Nothing here comes close.** The longest
 * article is `/a/faith.html` at **13,457 chars**, and it was read: it argues in
 * an author's voice and closes on **34 numbered chapter-and-verse CITATIONS**
 * (ማቴ, ማር, ዮሃንስ, ግብሪ ሃዋርያት, ራእይ) followed by a secondary-source bibliography —
 * "ካብ ንምንታይ ከም እትኣምን ፍለጥ (Know Why You Believe) ብፖል ኢ.ሊትል (Paul E. Little):
 * ብቪክቶር ቡክስ ዝተሓትመ፡ መሰል ቅዳሕ (ሐ) 1988፡ SP Publications, Inc። ብፍቓድ ዝጥቀመሉ።"
 * ("…published by Victor Books, copyright 1988, SP Publications, Inc. Used by
 * permission."). That is the estate test exactly: argument closing on a
 * bibliography = ministry writing, not continuous chapter-and-verse text.
 * `/a/atheist.html` closes the same way. On a 14-article host one scripture page
 * would be 7% of the source, so this was measured rather than assumed. **No
 * Bible-society copyright appears anywhere on the domain**; the one third-party
 * notice is the Paul E. Little / SP Publications credit above, which is ordinary
 * in-article citation apparatus and does not affect the `rights` line.
 *
 * ## robots.txt — 200, and it ALLOWS everything
 *
 * Verified 2026-07-30: HTTP 200, **22 bytes**, `content-type: text/plain`,
 * Last-Modified 2025-02-17. The entire file, byte for byte, is
 * `User-agent: * Allow: /` on one line. **There is no `Disallow` at all, no
 * `Sitemap:` line, and no named AI-crawler rule** — grepped for `ClaudeBot`,
 * `GPTBot`, `CCBot` and `Content-Signal`: **0 hits each**. Unlike the sibling
 * `katramstudentam.lv`, which disallows ClaudeBot by name and is therefore not
 * being written, nothing here is excluded on robots grounds. (The acquire path
 * does not enforce robots.txt anyway; here there is nothing to enforce.)
 *
 * ## NOT walled — plain HTTP, no Cloudflare
 *
 * Verified 2026-07-30: robots.txt, `/sitemap.html`, the homepage, all 16 `/a/`
 * files, `/about.html`, `/contact.html` and all four `/m/` indexes fetched with
 * a plain `curl` carrying a desktop-Chrome UA. **Every one returned HTTP/2 200
 * with real HTML**, `server: Apache`, and **zero bytes of Cloudflare** (grepped
 * for "cloudflare" in bodies and headers — 0 hits). `fetchStrategy` is therefore
 * intentionally OMITTED: plain HTTP is the default (ADR-0012).
 *
 * The bare apex **301-redirects to `www`** on both http and https, as does
 * `http://www`; only `https://www.everytemhari.com` serves 200. So `domain` and
 * `baseUrl` are pinned to `www.` — checked in both directions, because
 * `everystudent.sk` runs the redirect the other way.
 *
 * ## Extraction — measured on THIS host, and the shadow selector is real here
 *
 * Verified 2026-07-30 by running node-html-parser exactly as
 * `src/acquisition/extract.ts` does, across all 24 fetched pages. Grepping for
 * class names proves nothing on this estate — every FreeFind host declares the
 * whole family in an inline `<style>` block — so these are extracted-text
 * character counts. Both `.x` and `#x` forms were probed for every candidate:
 *   - **`.contentpadding` — binds on 14/14 articles, 1 instance each,
 *     1,189–13,625 chars raw, and ZERO of them empty. This is the shipped
 *     selector.**
 *   - **⚠️ `.content4` — MATCHED on all 14 articles and extracts 0 CHARS on
 *     every single one.** An empty spacer div. `extractContent` binds the first
 *     selector that matches an ELEMENT and then stops — it is not a fallback
 *     chain — so listing `.content4` anywhere ahead of `.contentpadding` would
 *     bind an empty div and skip all 14 articles as `too-thin` on an HTTP 200.
 *     Silent, and invisible to unit tests. This is the failure that broke five
 *     of the eight pilot entries (#128), and it is live on this host.
 *   - **🔴 `.articletitle` — binds on 14/14 at 12–59 chars.** Deliberately never
 *     listed: a plausible non-zero number that is only the `<h1>`. Inheriting
 *     the sibling selector list would stage 14 documents of ~20 chars with no
 *     error anywhere.
 *   - **`#contentpadding`, `#content4`, `#content4b`, `.contentleftpadding`,
 *     `#contentleftpadding`, `.cb-entry-content`, `.entry-content`,
 *     `.post-content`, `.article-content`, `.content`, `#content`,
 *     `.elementor-widget-theme-post-content`, `article`, `main` — 0 matches
 *     each** on every page. The ID forms were probed because `el` uses
 *     `#content4` and `sl` uses `#contentpadding`; neither pattern is used here.
 *   - **`.content4b` — 0 matches on all 14 articles** (1 match at 0 chars on
 *     `/a/fol.html` only, which is not seeded).
 *   - **`<body>` — 0 matches on all 14 articles** (present only on the homepage
 *     and 3 `/m/` indexes). So on an article the implicit fallback in
 *     `extract.ts` lands on the document ROOT, which is why the homepage and nav
 *     pages are excluded by omission rather than trusted to the length floor.
 *   - **`<html>` — 24/24, 18,108–31,824 chars.**
 *
 * **`"html"` IS appended as a last entry, and it is safe precisely because
 * `.contentpadding` has ZERO matched-but-empty pages here.** It cannot shadow
 * anything (nothing follows it), it fires only when the primary misses, and it
 * beats `extract.ts`'s implicit `?? root` because `<html>` is a real element
 * carrying no literal doctype text node. It is paired with `"head"` in
 * `stripSelectors`: 0 chars whenever `.contentpadding` binds (head is outside
 * it), and on the fallback path it drops the duplicated `<title>` — safe because
 * `extract.ts` reads the title from `root` at line 43, BEFORE the strip loop at
 * line 52.
 *
 * **Measured end-to-end with the exact config below, across all 14 seeds:
 * 1,063 – 13,457 chars, median 4,414, total 74,769, and 0 pages below the 250
 * floor.**
 *
 * ⚠️ `.contentpadding` also binds on `/about.html`, `/contact.html`,
 * `/sitemap.html` and `/m/intl.html` — it does NOT discriminate article from
 * chrome. The seed list is what keeps the corpus clean.
 *
 * ## Chrome stripped — measured contribution, honestly reported
 *
 * Solo = what the selector removes on its own on top of the generic tags;
 * marginal = what it removes beyond the rest of the list. Across all 14
 * articles the site-specific list removes **79–168 chars per article**.
 *   - **`sitelevel_noindex`** is a custom ELEMENT tag, not a class, hence no
 *     leading dot. **2 instances on 14/14, solo 32 chars, MARGINAL 26** — the
 *     only site-specific selector doing irreplaceable work.
 *   - **`.shareiconsmenupg` — 1 instance on 14/14, solo 6 chars, MARGINAL 0.**
 *     ⓘ On THIS host `<sitelevel_noindex>` is **well-formed and already contains
 *     it**, so once that is stripped first this matches nothing. It is a genuine
 *     no-op today, kept only as a cheap drift guard for the day the markup
 *     breaks the way it has on the `-de` / `-ru` siblings. **It is not claimed
 *     to strip anything here** — the markup was NOT measured as malformed.
 *   - **`.fctable` (0–2 inst) + `.fccell` (4–8 inst) — 47–136 chars JOINTLY**,
 *     the "FEATURE CLOSE" call-to-action block. On 13 of 14 articles each is 0
 *     marginal alone because the cells nest inside the table. **`/a/personally.
 *     html` is the exception and the reason both are listed: `.fctable` has 0
 *     instances there, so `.fccell` is the ONLY thing removing its 123 chars.**
 *   - **`.hr2` (2–6 inst), `.articledivider` (0–1 inst), `.a2a_kit` (2 inst) —
 *     0 chars each.** They bind but are empty presentational divs and image-only
 *     AddToAny buttons whose `alt` text `structuredText` does not read. Retained
 *     so a markup change adding text labels cannot leak them.
 *   - **`.relatedbottom` and `.likesharediv` are OMITTED: 0 instances across all
 *     24 pages.** They can never bind here, so carrying them for sibling parity
 *     would be dead config.
 *   - **`form`** has 0 instances inside `.contentpadding` but **72 across the
 *     documents** (three SiteLevel search forms per page), so it is load-bearing
 *     on the `html` fallback path, not a no-op.
 *
 * After the full list all 14 articles were re-scanned for leftovers: **0 hits**
 * for "ሼር", "Share", "AddToAny" or the site name.
 *
 * ## Language: `["ti"]` — Tigrinya, read directly and separated from Amharic
 *
 * Verified 2026-07-30 by reading the extracted text. `/a/atheist.html` is titled
 * "ሓደ ኢዘሀራዊ ንኣምላኽ ዝረኸቦ መገዲ" ("How an atheist found God") and opens
 * "ሕቶይ ንሃይማኖታውያን ሰባት ዜበሳጭዎም እዩ ዚመስል ነይሩ ። 'ኣምላኽ ከም ዘሎ ኸመይ ጌርካ ትፈልጥ?'"
 * ("My question seemed to irritate religious people: 'How do you know God
 * exists?'"). `/a/created.html` is "ንኣምላኽ ዝፈጠሮ መን እዩ ?" ("Who created God?").
 *
 * ⚠️ **Amharic and Tigrinya share the Ge'ez script, so script proves nothing**
 * and the acquired sibling `everystudent-am` (habeshastudent.com, 41 documents)
 * had to be separated on morphology. Whole-word counts over all 14 articles
 * (16,017 tokens) against the same measurement on 5 same-topic habeshastudent
 * articles (4,609 tokens) are completely disjoint:
 *
 *     marker                        everytemhari (ti)   habeshastudent (am)
 *     እዩ  / ኢዩ  (TI copula m.)              463 / 58            0 / 0
 *     እያ  / እዮም (TI copula f./pl.)           26 / 65            0 / 0
 *     ድዩ      (TI interrog. copula)              27                 0
 *     ናይ      (TI genitive particle)             91                 0
 *     ኣይ…ን    (TI negation circumfix)           190                 0
 *     ነው      (AM copula m.)                      0               101
 *     ናቸው / ነበር (AM copula pl. / past)         0 / 0           13 / 16
 *     አይደለም   (AM negation)                       0                16
 *
 * The 81 word-initial `የ` tokens were inspected individually and are NOT the
 * Amharic genitive prefix: they are Tigrinya negative verb forms — የልቦን ("has
 * not", 14×), የለን ("there is not", 6×), የብሉን — plus the proper nouns የሩሳሌም and
 * የሱስ. The top content words are Tigrinya throughout: እዩ 463, ኣብ 369, ኣምላኽ 266,
 * እቲ 166, እንተ 111. The site agrees, declaring `<html lang="ti">`, but that is
 * corroboration only — `persoalanhidup.com` declares `lang="id"` and serves
 * Malay.
 *
 * ## ⓘ NOT a re-skin of the Amharic sibling — 0.0% overlap on 5 pairs
 *
 * Because both hosts are Ge'ez-script Cru properties with identical `/a/` slugs,
 * a real risk was that this one serves Amharic under a Tigrinya banner. Measured
 * 2026-07-30, **12-word shingle overlap between the same-slug article on each
 * host: `created` 0.0%, `religions` 0.0%, `toxic` 0.0%, `women` 0.0%,
 * `heaven` 0.0%** — 0 shared shingles out of 4,172 vs 4,592. They are
 * independent translations, and both keys earn their place.
 *
 * ## ⚠️⚠️ OPERATOR SIGNAL: content detection CANNOT emit `ti`
 *
 * `languages: ["ti"]` is the honest ISO 639-1 declaration for what this host
 * serves — the field records what the SOURCE IS, not what the detector
 * recognises. But **`tinyld`, the detector behind `detect-language.ts`, has no
 * Tigrinya model.** Verified 2026-07-30 by reading the shipped model table in
 * `node_modules/tinyld/dist/tinyld.normal.node.js`: it carries 61 languages,
 * including `amh:{code:"am"}`, and there is **no `tir` entry and no `ti` code**
 * anywhere in it. Same gap as Oromo in `everystudent-om`.
 *
 * The consequence here is worse than a null, and worth watching: **the only
 * Ge'ez-script model tinyld has is Amharic**, so the likely verdict on this
 * host's text is `am`. Pushed through `decideLanguage`, each of the 14 documents
 * lands as either `documents.language = null` (below `CONFIDENCE_GATE = 0.75`)
 * or **stored as `'am'` WITH the out-of-set warning** "detected language 'am' …
 * is outside the declared set [ti]", because ADR-0007 trusts content over the
 * declaration. Neither outcome is a defect in this entry; the warning is the
 * system correctly flagging a detector that cannot represent this language.
 *
 * ## Encoding — UTF-8 in the markup, but NOT in the HTTP header
 *
 * Verified 2026-07-30, and it matters on a Ge'ez-script host. Every page
 * responds with a bare **`content-type: text/html` carrying NO charset
 * parameter** — the same gap as habeshastudent.com and studentinjapan.com. The
 * bytes are UTF-8 and the HTML declares it (`<meta http-equiv="content-type"
 * content="text/html; charset=utf-8">`); `file -I` on the fetched bodies
 * independently reports `charset=utf-8`, and **the Tigrinya read clean with zero
 * mojibake** through parsing and extraction. Nothing needs configuring, but if a
 * future fetcher ever honours the header over the meta tag, this host breaks.
 *
 * ## ⓘ Two authoring defects on this host, both deliberately KEPT
 *
 *   - **`/a/then.html` carries `/a/peace.html`'s `<title>` and `<h1>` verbatim**
 *     ("ናይ ሕሊና ሰላም ኣብዛ ዘይተረጋግዐት ዓለም"). It is nonetheless a genuinely DIFFERENT
 *     article — **0.0% 12-word shingle overlap with `/a/peace.html`**, 4,490
 *     chars, its own kicker "ናተይ ህይወት" ("My life") and subhead "ሕጂ ዘሎ ህይወት ።
 *     ሽዑ ህይወት ። ድሕሪ ሞት ዘሎ ህይወት ድዩ ?" ("Life now. Life then. Is there life after
 *     death?"). It is SEEDED — a real article is not dropped for broken markup.
 *     Consequence to expect: `extract.ts` reads the title from `<title>`, so
 *     this document will store the wrong headline. Fix belongs upstream on the
 *     site, not here.
 *   - **The homepage `<title>` is in AMHARIC** ("ስለ ህይወት እና ስለ እግዚአብሔር የበለጠ
 *     ለማወቅ" — note the Amharic `እና` and `የ-`), evidently copied from the sibling
 *     during setup. It affects no seeded page: all 14 article titles are
 *     Tigrinya, and the homepage is not seeded.
 *
 * ## Rights — the publisher is named, and it is NOT plainly "Cru"
 *
 * ⚠️ Checked because batch 4's `igod.co.il` turned out not to be a Cru property
 * and the standard rights line would have misattributed it. Here the page footer
 * says only **`© EveryTemhari.com`** — no organisation. `/about.html` names the
 * publisher: **"እዚ መርበብ ሓበሬታ ብግሬት ኮሚሽን ሚኒስትሪ- ኢትዮጵያ ዲጂታል ስትራተጂ ኣገልግሎት ዝተዳለወ
 * እዩ።"** ("This website was produced by Great Commission Ministry – Ethiopia,
 * Digital Strategy Ministry."). Great Commission Ministry Ethiopia is Cru's
 * Ethiopian national ministry, and the pages reuse everystudent.com's own image
 * assets, so this IS the Cru estate — but the `rights` line below names the
 * actual publisher rather than asserting a bare "(Cru)" the site never says.
 *
 * `requestDelayMs: 1000` — the politeness default. ~140 sequential plain-HTTP
 * requests during recon drew **zero 429s** and no throttling.
 *
 * **Expected yield: 14 documents.**
 */
import type { SourceEntry } from "./types.js"

export const everystudentTi: SourceEntry = {
  key: "everystudent-ti",
  name: "EveryStudent — Tigrinya (EveryTemhari.com)",
  domain: "www.everytemhari.com",
  trust: "partner",
  ingestionMode: "html-scrape",
  languages: ["ti"],
  defaultTags: ["everystudent", "cru", "topic:seeker", "lang:ti"],
  defaultCategory: "article",
  rights:
    "© EveryTemhari.com — produced by Great Commission Ministry Ethiopia (Cru's Ethiopian national ministry); partner ministry content; used for retrieval/attribution.",
  crawl: {
    baseUrl: "https://www.everytemhari.com",
    // No `fetchStrategy`: verified 2026-07-30 that plain HTTP serves every page
    // (bare Apache, zero Cloudflare markers). See header.
    //
    // SEED MODE. There is NO XML sitemap on this host — /sitemap.xml,
    // /sitemap_index.xml, /sitemap.xml.gz, /wp-sitemap.xml and 8 more variants
    // all 404, and robots.txt has no `Sitemap:` line. Hence no `sitemaps`, and
    // therefore no `allow` / `articleHints` / `block`: the seed list IS the
    // filter (the everystudent-ar and everystudent-bg precedent).
    //
    // These 14 are the COMPLETE article corpus, confirmed three ways: the site's
    // /sitemap.html, its own SiteLevel search index, and the OPEN Apache
    // directory index at /a/ which lists 16 files on disk. All 14 HEAD-swept
    // 2026-07-30: 14 x 200, 0 redirects, 0 dead.
    //
    // The 2 files on disk NOT seeded:
    //   /a/peace copy.html — stray editor duplicate, 96.0% shingle overlap
    //                        with /a/peace.html; unlisted in both site maps.
    //   /a/fol.html        — post-decision follow-up; the ONLY page on the host
    //                        with <meta name="robots" content="noindex">, and
    //                        the one page where .contentpadding is absent.
    //
    // ⚠️ /a/isGodgood.html has a CAPITAL G and this server is case-sensitive.
    seedPaths: [
      "/a/atheist.html",
      "/a/created.html",
      "/a/dna.html",
      "/a/faith.html",
      "/a/heaven.html",
      "/a/isGodgood.html",
      "/a/peace.html",
      "/a/personally.html",
      "/a/religions.html",
      "/a/then.html",
      "/a/toxic.html",
      "/a/universe.html",
      "/a/where.html",
      "/a/women.html",
    ],
    // ONLY `.contentpadding` — measured 2026-07-30 as the sole element on this
    // host that extracts the article (1,063-13,457 ch post-strip across all 14,
    // median 4,414, none under the 250 floor), binding 14/14 with 0 empties.
    // ⚠️ `.content4` is deliberately ABSENT: it MATCHES on all 14 articles and
    // extracts 0 chars on every one. extractContent scopes to the first selector
    // that MATCHES, not the first that yields text, so listing it here — even
    // "as a fallback" — would bind an empty spacer div and skip every page as
    // `too-thin` on an HTTP 200. This is NOT a fallback chain.
    // ⚠️ `.articletitle` is also deliberately ABSENT: it binds 14/14 at 12-59
    // chars (the <h1>) and would stage 14 headline-only documents.
    // `html` is safe as the LAST entry only because the primary never matches
    // empty here; it cannot shadow anything and beats the implicit `?? root`.
    contentSelectors: [".contentpadding", "html"],
    stripSelectors: [
      // 0 chars whenever `.contentpadding` binds (head is outside it); fires
      // only on the `html` fallback, where it drops the duplicated <title>.
      // Safe because extract.ts reads the title from `root` BEFORE this strip
      // loop runs (extract.ts:43 vs :52).
      "head",
      "script",
      "style",
      "noscript",
      "svg",
      "nav",
      "header",
      "footer",
      // 0 instances inside .contentpadding but 72 across the documents (three
      // SiteLevel search forms per page) — load-bearing on the html fallback.
      "form",
      // Site-specific chrome; instance counts and char deltas all measured on
      // this host across all 14 articles (see header):
      "sitelevel_noindex", // custom ELEMENT tag, 2 inst on 14/14 — 32 ch solo, 26 MARGINAL
      ".shareiconsmenupg", // 1 inst, 6 ch solo but 0 MARGINAL — sitelevel_noindex is
      // WELL-FORMED on this host and already contains it. A genuine no-op today,
      // kept as a drift guard; the markup was NOT measured as malformed here.
      ".fctable", // the "FEATURE CLOSE" CTA table shell, 0-2 inst
      ".fccell", // its cells, 4-8 inst — 47-136 ch JOINTLY with .fctable. Both are
      // listed because /a/personally.html has 0 .fctable, making .fccell the only
      // thing removing its 123 chars.
      ".hr2", // 2-6 inst, 0 ch — empty presentational rules
      ".articledivider", // 0-1 inst, 0 ch
      ".a2a_kit", // 2 inst, 0 ch — AddToAny image-only buttons
      // NOT listed: .relatedbottom and .likesharediv — 0 instances across all 24
      // pages measured, so they could never bind. Dead config, deliberately omitted.
    ],
    requestDelayMs: 1000, // direct fetches; 0 x 429 across ~140 recon requests
    maxPages: 30, // 14 seeds + headroom
    minContentLength: 250,
  },
}
