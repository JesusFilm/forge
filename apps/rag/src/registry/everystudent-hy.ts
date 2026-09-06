/**
 * EveryStudent — Armenian (1patasxan.com, «1 պատասխան» / "1 Answer"). The
 * Armenian banner of Cru's seeker-facing Q&A ministry: short apologetics and
 * life-issue articles written for Armenian-speaking students who are not
 * believers. A sibling of `everystudent` (en), `everystudent-sq`,
 * `everystudent-bg`, `everystudent-ar`.
 *
 * One domain = one source (ADR-0006): 1patasxan.com is its own domain, so it
 * gets its own key, never a language variant of `everystudent`. Same rule that
 * keeps `everystudent-ru` (mirstudentov.com) and `thelife-fr`
 * (laviejenparle.com) separate.
 *
 * ⓘ The host starts with a DIGIT. Nothing in this entry may assume a
 * letter-initial hostname; the `key` is `everystudent-hy` (letters only) and
 * there are no regexes here at all, because this is a seed-mode source.
 *
 * ## SEED MODE — this host has NO XML sitemap at all
 *
 * Verified 2026-07-30, every path probed by hand with a browser UA:
 *
 *   | probe                  | result                                    |
 *   |------------------------|-------------------------------------------|
 *   | `/sitemap.xml`         | **404** (21,081-byte custom 404 page)     |
 *   | `/sitemap_index.xml`   | **404**                                    |
 *   | `/sitemap.xml.gz`      | **404**                                    |
 *   | `/wp-sitemap.xml`      | **404**                                    |
 *   | `/sitemap.txt`         | **404**                                    |
 *   | `/robots.txt`          | **404** — no file, so no `Sitemap:` line  |
 *   | `/m/sitemap.html`      | 200 — the site's own HTML map             |
 *
 * There is nothing to discover from, so `crawl` carries `baseUrl` + `seedPaths`
 * and **no `sitemaps`, no `allow`, no `articleHints`, no `block`** — the seed
 * list IS the filter, exactly as `everystudent-bg` (84 seeds) and
 * `everystudent-ar` (68 seeds) are shaped. `block` only ever filters DISCOVERED
 * URLs, and a seed-only source discovers none.
 *
 * ## How the 34 seeds were found — three nets, then a ground truth
 *
 *   1. **`/m/sitemap.html`** («Կայքի քարտեզ», HTTP 200, 24,739 bytes) lists
 *      **33** `/a/<slug>.html` articles.
 *   2. **Href harvest of the homepage, all 9 `/m/` indexes and `/contact.html`**
 *      added exactly **one** article the map omits — `/a/religions.html`,
 *      linked only from `/m/forum.html`.
 *   3. **Href harvest of all 34 article pages** added **one** more the map also
 *      omits — `/a/fol.html`, linked from 12 articles. (It is excluded below on
 *      measured evidence, not because it was missing from the map.)
 *   4. **Apache autoindex is ENABLED on this host** and settles it. `/a/`
 *      returns 200 with a real "Index of /a" listing: **36 files**, which is the
 *      35 found above plus `fol copy.html`. `/m/` likewise lists 10 files (the 9
 *      known + `forum copy.html`). `/v/`, `/pdf/`, `/video/`, `/t/`, `/s/` are
 *      all 404 — there is no video or PDF namespace on this banner.
 *
 * **HEAD sweep: all 35 `/a/` URLs return HTTP 200 with an empty redirect_url.
 * Zero 404s, zero 301s, so nothing was excluded as dead.** (Contrast
 * `everystudent-sr`, whose own map listed dead URLs, and `everystudent-ro`,
 * which staged 25 copies of its homepage through 301s.) One apparent dead link,
 * a root-level `/faith.html`, turned out to be a measurement artifact of my own
 * harvest resolving a relative `href="faith.html"` against the wrong base — the
 * real target is `/a/faith.html`, which is live and seeded.
 *
 * ## Excluded, all MEASURED rather than assumed
 *
 * Nothing here can be caught by `minContentLength: 250`; omission is the only
 * filter a seed-only source has.
 *
 *   - **`/a/fol.html` — 291 chars.** Titled «ԻՆՉՊԵՍ ԱՆՁՆԱԿԱՆ ՀԱՐԱԲԵՐՈՒԹՅՈՒՆ
 *     ՍԿՍԵԼ ԱՍՏԾՈ ՀԵՏ», it is a post-decision referral stub, not an article:
 *     "we are so glad you decided to invite Jesus Christ into your life; we have
 *     another website that will help you grow spiritually". It clears the 250
 *     floor by 41 characters, so only omission excludes it. Direct twin of the
 *     855-char `/начало-с-Бог.html` that `everystudent-bg` omits and of
 *     `everystudent-sq`'s blocked `/a/ungjillin2.html`. It is also the ONE page
 *     on this host whose FreeFind markup is intact (see extraction below).
 *   - **`/a/fol copy.html` — 2,636 chars,** reachable only through the Apache
 *     autoindex; linked from nowhere on the site. An editor leftover (note the
 *     literal space in the filename) holding the longer version of the same
 *     follow-up page. Unpublished content, so not seeded. `/m/forum copy.html`
 *     is the same pattern.
 *   - **the homepage (1,384 ch), the 9 `/m/` indexes (12 – 1,989 ch) and
 *     `/contact.html` (319 ch).** These do NOT extract to 0 — `html` matches on
 *     them as readily as on an article — so they must be left out by name.
 *     `/m/about.html` (842 ch) and `/m/privacy.html` (1,989 ch) are the two
 *     largest; `/m/intl.html` (12 ch, «Այլ լեզուներ») is the language switcher.
 *   - **No Gospel-of-John signup page and no "adventure pack" email series
 *     exist here.** Measured, not silently skipped: `/john.html`, `/pack.html`,
 *     `/4laws.html` and `/gospel.html` all return 404. The estate-standard
 *     signup landers this campaign drops elsewhere simply are not published on
 *     this banner.
 *   - 🔴 **CORRECTED 2026-08-06 — this claim was WRONG.** It read "No Scripture
 *     pages. Every one of the 34 seeds is ministry writing." **One of them was
 *     not:** `/a/whowas.html` (20,922 ch) is the estate's "Who was Jesus?" page,
 *     curated highlights from the Gospel of John that say so in their own first
 *     paragraph — «Ոչ մի մեկնաբանություն ավելացված չէ», no commentary added.
 *     It is now removed from `seedPaths`, leaving **33 seeds**, all of which
 *     genuinely are ministry writing. ⚠️ **Why the original audit missed it:**
 *     it measured scripture-citation DENSITY, and this page's citations are
 *     continuous Gospel narrative rather than the dense chapter-and-verse
 *     apparatus the density test looks for. Density under-detects; the reliable
 *     test is the article's own stated formula (campaign #111 §0.13 finding 3).
 *     The rest of the original finding stands and is worth keeping:
 *     the longest page, `/a/bible.html` (24,928 ch, «Ինչո՞ւ է Աստվածաշունչը
 *     վստահելի» — "Why is the Bible trustworthy"), is an apologetics ESSAY about
 *     the Bible, not the Bible: it argues in an author's voice and closes on a
 *     numbered secondary-source bibliography (Strobel, Geisler, McDowell,
 *     F. F. Bruce, Tacitus). That is the estate test for telling the two apart,
 *     and no page here fails it — peak scripture-citation density across the
 *     corpus is 6.0 references per 1,000 chars (`/a/endtimes.html`), which is
 *     ordinary citation apparatus, not continuous chapter-and-verse.
 *
 * ## robots.txt — there is no robots.txt
 *
 * `https://www.1patasxan.com/robots.txt` returns **HTTP 404** serving the site's
 * 21,080-byte custom error page (`server: Apache`). So: no `Disallow` of any
 * kind, no `Sitemap:` line, **no named AI-crawler rule for `ClaudeBot`,
 * `GPTBot` or `CCBot`, and no `Content-Signal:` header or line.** Nothing on
 * this domain had to be dropped on robots grounds. (The rights blocker seen on
 * `katramstudentam.lv`, which disallows ClaudeBot by name, is absent here.)
 * Note the repo does not enforce robots.txt at fetch time anyway, so honouring
 * it means leaving paths OUT of `seedPaths` — which is why this is recorded.
 *
 * ## Not walled — plain HTTP, bare Apache
 *
 * `fetchStrategy` is deliberately OMITTED (plain-http is the default, ADR-0012).
 * Every response on this host carries `server: Apache` and **no Cloudflare layer
 * at all** — no `cf-ray`, no `server: cloudflare`, no Turnstile, and no
 * block-page signature anywhere. ~130 plain `curl` requests over the recon drew
 * **zero 429s** and zero throttling, so `requestDelayMs: 1000` is kept rather
 * than raised.
 *
 * ⚠️ **Encoding.** Responses are `content-type: text/html` with **no charset
 * parameter**; the charset is declared only in-document
 * (`<meta http-equiv="content-type" content="text/html; charset=utf-8">`).
 * The bytes really are UTF-8: decoding as UTF-8 yields clean Armenian with
 * **0 pages showing any mojibake marker** (`Ã`, `Â`, `â€`, `Ð`).
 *
 * ## ⚠️ EXTRACTION — the shared EveryStudent template DOES NOT BIND here
 *
 * The one decision on this entry that would silently destroy the source if
 * undone, so it is measured rather than inherited. Every candidate below was run
 * through the repo's own parser (node-html-parser, exactly as
 * `src/acquisition/extract.ts` uses it) over **all 35 `/a/` pages** on
 * 2026-07-30 — not grepped, because these tokens are also declared in each
 * page's inline `<style>` block and a grep false-positives on all of them. Both
 * the class and the ID form of every candidate was probed:
 *
 *   - **`.content4` — matches on 35/35 pages and extracts 0 characters on 34 of
 *     them** (the sole non-zero is the excluded 291-char `/a/fol.html`). This is
 *     the shadow selector on this host and MUST NOT be listed.
 *   - **`.container2` — matches on 35/35 pages, 0 characters on all 35.**
 *   - **`.contentpadding` — matches on only 1/35 pages** (again the excluded
 *     `/a/fol.html`, 291 ch). Absent from all 34 seeded articles.
 *   - **`.articletitle` — matches on 29/35, 12–58 chars.** The `<h1>` headline.
 *     Never listed: a plausible non-zero number that stages ~20-char documents.
 *   - **`#content4`, `#contentpadding`, `#container2`, `#articletitle`,
 *     `#content`, `#entry-content`, `#post-content`, `#article-content`,
 *     `#contentleftpadding`, `#cb-entry-content`, `#articlebody` — 0 matches
 *     each.** `<div id="content4">` IS present in the raw bytes (line 192 of a
 *     typical article) but never becomes an element in the parsed tree, so
 *     `extract.ts` cannot see it. ID-form support was sanity-checked against a
 *     synthetic fixture first, so this is a property of THIS markup, not of the
 *     probe.
 *   - **`.content4b`, `.cb-entry-content`, `.entry-content`, `.post-content`,
 *     `.contentleftpadding`, `.article-content`, `.content`,
 *     `.elementor-widget-theme-post-content`, `.articlebody`, `article`,
 *     `main` — 0 matches each.**
 *   - **`body` — 0 matches.** `<body>` is present in the raw bytes (lines 44 and
 *     538) but is absent from the parsed tree on all 35 pages.
 *   - **`html` — matches 35/35, 4,481 – 29,723 chars unstripped. The only
 *     element that contains the article.**
 *
 * Root cause, the same shape as `everystudent-sq` and `everystudent-ko`: the
 * FreeFind markers INTERLEAVE with rather than nest inside the content divs. In
 * `/a/isthere.html`, `<sitelevel_noindex>` opens at line 186,
 * `<div class="container2">` at 189, `<div id="content4">` at 192,
 * `<div class="content4">` at 198 and `<div class="contentpadding">` at 199 —
 * then a stray `</sitelevel_noindex>` at line 213 closes that whole div stack
 * early, and a second unmatched `</sitelevel_noindex>` at line 516 disposes of
 * `<body>`. The article is left as flat direct children of `<html>`. Measured
 * proof: `.container2` parses with an `innerHTML` of exactly three newline
 * characters — its children are gone.
 *
 * ⚠️ `contentSelectors` is **NOT a fallback chain**. `extractContent` scopes to
 * the FIRST selector that MATCHES AN ELEMENT, not the first that yields text.
 * Listing `.content4` "as a fallback" would bind an empty div on all 34 seeds,
 * extract 0 chars, and skip every article as `too-thin` on an HTTP 200 — silent,
 * and invisible to the unit tests. `.content4` CAN match at 0 chars here, so
 * appending `"html"` after it would never fire; this host needs `["html"]`
 * outright, and that is what ships.
 *
 * `["html"]` is also explicit rather than left to `extractContent`'s implicit
 * `body ?? root` fallback: with `<body>` absent the fallback lands on `root`,
 * whose doctype node leaks the literal string `<!DOCTYPE html>` into the head of
 * every document — measured at exactly +17 chars on `/a/isthere.html`,
 * `/a/bible.html` and `/a/trinity.html`.
 *
 * **Measured with `["html"]` plus the strip list below, across all 34 seeds:
 * 2,501 – 24,928 chars, median 8,082, and 0 pages below the 250 floor.** Output
 * opens on the article title and closes on the article's own reference list.
 *
 * ## Chrome stripped — instances and marginal chars, measured 2026-07-30
 *
 * Per-selector figures are the characters each removes, measured by re-running
 * the full extraction over all 35 pages with that one selector withheld:
 *
 *   - **`sitelevel_noindex`** — a custom ELEMENT tag, not a class, hence no
 *     leading dot. **2 instances on 35/35 pages, removing exactly 1,819 chars on
 *     every single page.** By far the largest contributor: the top nav + cookie
 *     bar and the bottom share/related/footer block. ⓘ It is **well-formed
 *     enough to bind** here; do not copy the "malformed markup" note some
 *     siblings carry — what is malformed on this host is the CONTENT div stack
 *     it prematurely closes.
 *   - **`script`** — 280 instances, **1,343 – 1,490 chars** (inline GTM,
 *     Facebook-like and AddToAny loaders).
 *   - **`head`** — 1 instance, **14 – 60 chars.** Needed only because the
 *     container is `<html>`: without it every document opens with a duplicate of
 *     its own `<title>`. Safe because `extract.ts` reads the title from `root`
 *     at line 43, BEFORE the strip loop at line 52 — a future edit reordering
 *     those two steps would lose every title.
 *   - **`.fccell`** — 158 instances across 34/35 pages, **0 – 250 chars**: the
 *     "FEATURE CLOSE" call-to-action cells appended to each article.
 *   - **`.likesharediv`** (68 instances / 34 pages), **`.a2a_kit`** (68 / 34),
 *     **`.hr2`** (99 / 34) and **`.articledivider`** (29 / 29) — all **0 chars**
 *     today. The share buttons are images and `structuredText` does not read
 *     `alt`; the rules are empty divs. Kept as drift guards so a markup change
 *     that adds text labels cannot leak them into every article. Honest reading:
 *     these four are no-ops on today's bytes.
 *   - **`style`, `noscript`, `svg`, `nav`, `header`, `footer`, `form`** — the
 *     repo-wide structural baseline. Measured here: `style` 71 instances /
 *     0 chars, `form` 105 instances / 0 chars, and `noscript` / `svg` / `nav` /
 *     `header` / `footer` **0 instances**. Kept as the shared baseline every
 *     entry carries, not as a claim that they bind.
 *   - **NOT carried, because they have 0 instances on this host:** `.fctable`,
 *     `.shareiconsmenupg`, `.relatedbottom`. Shipping them would be dead config
 *     that can never bind. Do not add them expecting them to do anything.
 *
 * ## Language: `["hy"]` — read, not inferred
 *
 * Verified 2026-07-30 by reading the extracted text directly. Genuinely
 * Armenian, not untranslated English. `/a/isthere.html` asks «Աստված գոյություն
 * ունի՞» ("Does God exist?"); `/a/whydid.html` is «Ինչո՞ւ մեռավ Հիսուս» ("Why
 * did Jesus die?"); `/a/marriage.html` opens «Ինչո՞ւ են ամուսնությունները
 * ձախողվում, և ինչպե՞ս կարող եք ամուր ամուսնություն ունենալ:» ("Why do marriages
 * fail, and how can you have a strong marriage?").
 *
 * Script census over the whole extracted corpus (298,435 non-space characters):
 * **97.00% in the Armenian block U+0530–U+058F**, 0.06% Latin A–Z/a–z (184
 * characters total, all inside transliterated bibliography entries), **0
 * Cyrillic**, remainder digits and punctuation. The Armenian block is unique to
 * Armenian, so this is unambiguous. The site declares `<html lang="hy">`, which
 * agrees with what was read — but the reading, not the attribute, is the
 * evidence (`persoalanhidup.com` declares `lang="id"` and serves Malay).
 *
 * The stored per-document language label still comes from content detection at
 * ingest (invariant 6), never from this field.
 *
 * ## Rights — the footer, checked
 *
 * The page footer reads exactly `<span class="copyright">© 1patasxan.com</span>`
 * — no organisation is named there. `/m/about.html` supplies the attribution:
 * «Կայքը ստեղծվել է միջհարանվանական քրիստոնեական կազմակերպության կողմից, որը
 * կոչվում է Campus Crusade for Christ» — "this site was created by an
 * interdenominational Christian organisation called Campus Crusade for Christ",
 * i.e. Cru. The stylesheets are also served from `www.everystudent.com`. So the
 * standard sibling rights line is accurate for this host; there is no
 * third-party Bible-society copyright anywhere on the domain.
 */
import type { SourceEntry } from "./types.js"

export const everystudentHy: SourceEntry = {
  key: "everystudent-hy",
  name: "EveryStudent — Armenian (1patasxan.com)",
  domain: "www.1patasxan.com",
  trust: "partner",
  ingestionMode: "html-scrape",
  languages: ["hy"],
  defaultTags: ["everystudent", "cru", "topic:seeker", "lang:hy"],
  defaultCategory: "article",
  rights:
    "© 1patasxan.com (Cru) — partner ministry content; used for retrieval/attribution.",
  crawl: {
    // Apex 301s to www (measured on / and /robots.txt); www serves 200.
    baseUrl: "https://www.1patasxan.com",
    // SEED MODE. No `sitemaps`, and hence no `allow`/`articleHints`/`block` —
    // this host publishes no XML sitemap at all (five paths probed, all 404),
    // so there is nothing to discover from and the seed list IS the filter.
    // 34 of the 36 files in /a/: the two "fol" pages are excluded (see header).
    // Slugs are ASCII on this host despite the Armenian content, so no
    // percent-escaping is needed; two carry inner capitals.
    seedPaths: [
      "/a/Godreal.html",
      "/a/bible.html",
      "/a/connecting.html",
      "/a/devil.html",
      "/a/disaster.html",
      "/a/endtimes.html",
      "/a/faith.html",
      "/a/heaven.html",
      "/a/inevitable.html",
      "/a/isthere.html",
      "/a/jesusislam.html",
      "/a/judaism.html",
      "/a/knowGod.html",
      "/a/loneliness.html",
      "/a/marriage.html",
      "/a/peace.html",
      "/a/personally.html",
      "/a/prayers.html",
      "/a/reallife.html",
      "/a/religions.html",
      "/a/source.html",
      "/a/then.html",
      "/a/tragedy.html",
      "/a/trinity.html",
      "/a/trust.html",
      "/a/where.html",
      "/a/whodoyousay.html",
      "/a/whois.html",
      // "/a/whowas.html" — REMOVED 2026-08-06. 20,922 chars of curated
      // highlights from the Gospel of John: "Ոչ մի մեկնաբանություն ավելացված
      // չէ" — no commentary added. Because it is predominantly
      // Bible-translation text, it stays quarantined until its translation,
      // rights holder, reuse terms, and required attribution are known and
      // representable. All 13 sibling copies went together (campaign #111
      // §0.13). ⚠️ This one was NOT inert: it took rank 7
      // (0.603) on a cross question during drafting, consuming a top-10 slot a
      // real answer would hold. A `block` rule would be dead config here —
      // this is a seed-only source, so the seed list IS the filter.
      "/a/why.html",
      "/a/whydid.html",
      "/a/whypick.html",
      "/a/whyworship.html",
      "/a/women.html",
    ],
    // ⚠️ Measured 2026-07-30 over all 35 /a/ pages: .content4 MATCHES on 35/35
    // and extracts 0 chars on the 34 seeded ones; .container2 matches 35/35 at
    // 0 chars; .contentpadding matches only on the excluded /a/fol.html;
    // #content4 / #contentpadding are 0 matches; <body> is absent from the
    // parsed tree. <html> is the only element still containing the article.
    // Do NOT add .content4 or .contentpadding: extractContent binds the FIRST
    // selector that MATCHES, so either would win and yield "".
    contentSelectors: ["html"],
    stripSelectors: [
      "script",
      "style",
      "noscript",
      "svg",
      "nav",
      "header",
      "footer",
      "form",
      // Required because the container is <html>: drops the duplicate <title>.
      // extract.ts reads the title from `root` BEFORE stripping — keep that order.
      "head",
      // Site-specific chrome, all counted on this host 2026-07-30 (see header):
      "sitelevel_noindex", // custom TAG, 2/page on 35/35 — exactly 1,819 chars every time
      ".fccell", // "FEATURE CLOSE" CTA cells — 158 instances, 0-250 chars
      ".likesharediv", // Facebook-like + share row — 68 instances, 0 chars today
      ".a2a_kit", // AddToAny share buttons — 68 instances, 0 chars (image-only)
      ".hr2", // empty rule divs bracketing the CTA block — 99 instances, 0 chars
      ".articledivider", // 29 instances, 0 chars
      // Deliberately ABSENT (0 instances measured here, so they can never bind):
      // .fctable, .shareiconsmenupg, .relatedbottom.
    ],
    requestDelayMs: 1000, // direct fetches, bare Apache; 0 x 429 across ~130 probes
    maxPages: 60, // 33 seeds + headroom
    minContentLength: 250,
  },
}
