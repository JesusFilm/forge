/**
 * EveryStudent — Ukrainian (svitstudentiv.com, "СвітСтудентів"). The Ukrainian
 * banner of Cru's seeker-facing Q&A ministry: short apologetics and life-issue
 * articles, plus first-person student testimonies, written for Ukrainian-speaking
 * students who are not believers. A sibling of `everystudent` (en),
 * `everystudent-ru` (mirstudentov.com), `everystudent-fr`, `everystudent-bg`.
 *
 * One domain = one source (ADR-0006): svitstudentiv.com is its own key, never a
 * language variant of `everystudent` and never folded into `everystudent-ru`.
 *
 * ## SEED MODE — this host has NO XML sitemap at all
 *
 * Verified 2026-07-30, five probes, every one a hard miss on the canonical host:
 *   - `/sitemap.xml` → **404**
 *   - `/sitemap_index.xml` → **404**
 *   - `/sitemap.xml.gz` → **404**
 *   - `/wp-sitemap.xml` → **404**
 *   - `/robots.txt` → **404** (so no `Sitemap:` line either)
 * There is nothing to discover from, so `sitemaps` is absent and this is a
 * hand-listed crawl — same shape as `everystudent-bg` and `everystudent-ar`.
 * Per that precedent there is also **no `allow`, no `articleHints` and no
 * `block`**: those filter DISCOVERED urls, and a seed-only source discovers
 * none. The seed list itself IS the filter — anything unwanted is simply not
 * listed. Anything added later must be re-checked by hand.
 *
 * The apex 301-redirects to `www` (measured on `/` and `/robots.txt`), so
 * `www.svitstudentiv.com` is the canonical host and `baseUrl`.
 *
 * ## How the 47 seeds were found, and swept
 *
 * 1. The site's own HTML map, `/m/sitemap.html` (200, 41,835 bytes), lists
 *    **47 distinct `/a/<slug>.html` articles** plus 9 `/m/` nav pages,
 *    `/zvorotniy.html` and `/`.
 * 2. Every internal href was then harvested from all 57 fetched pages (the
 *    homepage, all 9 `/m/` indexes, `/zvorotniy.html` and all 47 articles).
 *    Href-harvest delta: **exactly one live article missing from the map** —
 *    `/a/osobysto2.html`, linked from 16 different articles but absent from
 *    `/m/sitemap.html`. Kept (see below). No further page was found by
 *    re-harvesting it.
 * 3. **HEAD sweep, 2026-07-30, all 48 article candidates: 48/48 returned HTTP
 *    200 with ZERO redirects** (HTTP/1.1, browser UA). There are no dead seeds
 *    and no redirect-to-homepage traps of the `everystudent-ro` kind.
 * 4. 47 of the 48 are seeded; `/a/isus.html` is excluded on the scripture
 *    policy, below.
 *
 * Probed and confirmed ABSENT (404) rather than silently omitted: `/john.html`,
 * `/pack.html`, `/ivana.html`, `/a/ivana.html`, `/pryhoda.html`, `/sitemap.html`
 * (root), `/a/index.html`, `/m/vid.html`, `/m/video.html`. **This host carries
 * no localized Gospel-of-John signup page and no "adventure/pack" email series**
 * — the pages `everystudent-fr` had to drop and `everystudent-ar` kept
 * provisionally simply do not exist here.
 *
 * ⚠️ The site's own map contains one dead link: `/m/ChaPy.html` → **404** (the
 * live page is the lower-case `/m/chapy.html`; the server is case-sensitive).
 * It is a nav index, so it was never a seed candidate — recorded because it
 * proves the map is not a reliable liveness signal on this host either.
 *
 * ## Excluded, each on measured evidence
 *
 *   - 🔴 **`/a/isus.html` — FULL SCRIPTURE, not ministry writing.** Estate-wide
 *     policy (2026-07-29). Its own opening states the rule for us: «Ці уривки
 *     взято першоджерела – Євангелія від Івана, що у Біблії, **без додавання
 *     будь-яких коментарів**» ("these passages are taken from the primary
 *     source — the Gospel of John in the Bible, **without adding any
 *     commentary**"). The 19,700-char body is 15 chapter headings (Івана 1, 3,
 *     5, 6, 7, 10, 11, 12, 13, 14, 16, 17, 18, 19, 20) each followed by
 *     continuous verse text, and it closes on a THIRD-PARTY translation
 *     attribution — «Уривки наведено з українського перекладу Біблії І.
 *     Огієнка» (the Ohiyenko Ukrainian Bible). Our `rights` line would
 *     misattribute that.
 *     **How it was told apart from apologetics ABOUT the Bible:** a scan of all
 *     48 extractions counted standalone chapter headings versus numbered
 *     verse-reference footnotes. `/a/isus.html` is the ONLY page with chapter
 *     headings (15) and it has ZERO footnote references. Every other article
 *     has the opposite profile — 0 chapter headings and 1–29 footnote refs —
 *     i.e. argument in an author's voice closing on a citation list. The two
 *     nearest calls were both KEPT on that test: `/a/bibliya.html` (23,595 ch,
 *     "Чому Біблія варта довіри") is a numbered Q&A defending the Bible's
 *     transmission, ending on a McDowell/Bruce/Tacitus bibliography; and
 *     `/a/vira.html` (16,279 ch, by Paul Little) argues from Jesus' claims and
 *     ends on 30 numbered scripture citations.
 *   - **The homepage `/`** — never seeded. It has no article container, and
 *     with `<body>` absent from the parsed tree the fallback would stage the
 *     WHOLE document.
 *   - **The 9 `/m/` nav indexes** — `chapy`, `intl`, `isnuvannya`, `nas`,
 *     `piznaty`, `sitemap`, `stosunky`, `zapytannya` (plus the 404 `ChaPy`).
 *     Measured 13–1,594 chars of headline-and-teaser link lists. `/m/intl.html`
 *     is the "Іншими мовами" page linking out to the sibling language domains —
 *     dropped for the same reason the English entry drops `/menus/intl.html`.
 *   - **`/zvorotniy.html`** — the "Запитай нас!" contact page, 285 chars of
 *     form copy and a privacy sentence. It would scrape past the 250 floor by
 *     35 characters, so only omission catches it.
 *
 * ## KEPT after checking: `/a/osobysto2.html`
 *
 * Absent from the site's own map and reachable only from article footers, so it
 * was read before being seeded. It is genuine ministry writing — a 2,562-char
 * follow-up Q&A, «Якщо я запросив Ісуса у своє життя, як я можу бути впевненим,
 * що Він справді живе у мені?» ("If I invited Jesus into my life, how can I be
 * sure He really lives in me?"), teaching in the author's voice around quoted
 * verses. NOT the off-domain referral stub `everystudent-bg` had to drop.
 *
 * ## No duplicate group, on this host or against the Russian sibling
 *
 * All 1,128 article pairs were compared on 12-word shingles: the **highest
 * overlap on the whole host is 12.3%** (`/a/molytvy.html` vs
 * `/a/osobysto2.html` — the shared "how to begin a relationship with God"
 * closing paragraph). Nothing approaches the 87.9% that forced the French
 * drops. The three near-twin slug pairs were checked explicitly and all kept:
 * `khtos` vs `khtos2` **0.00%**, `spravzhniy` vs `spravzhnye` **0.00%**,
 * `osobysto` vs `osobysto2` **3.88%**.
 *
 * Against `everystudent-ru` (mirstudentov.com), four same-topic pairs measured
 * 2026-07-30: `isnuye`↔`estli` **0.04%**, `molytvy`↔`molitvi` **0.00%**,
 * `triytsyu`↔`troitsu` **0.00%**, `lykho`↔`gdebog` **0.00%** (and
 * `lykho`↔`stradaniy` 0.00%). These are independent Ukrainian translations, not
 * Russian text under a Ukrainian banner. Both hosts stay.
 *
 * ## robots.txt — there is none
 *
 * Verified 2026-07-30: `https://www.svitstudentiv.com/robots.txt` → **HTTP 404**
 * (the server's 36,799-byte custom error page). The apex 301s to `www` and the
 * `www` copy 404s, so there is no robots file on either host. Consequently
 * there is **no Disallow, no named AI-crawler rule (`ClaudeBot`, `GPTBot`,
 * `CCBot` are all absent because the file is absent) and no `Content-Signal:`
 * line** — nothing needed dropping on robots grounds. The opposite signal is
 * present in the markup: every page carries `<meta name="robots" content="all">`.
 * Note the repo does not enforce robots at fetch time anyway, so an exclusion
 * would have had to be made by hand here.
 *
 * ## NOT walled — plain HTTP, like the Russian sibling
 *
 * 60+ plain-HTTP GETs and a 48-URL HEAD sweep on 2026-07-30 with a full browser
 * UA: every content request returned HTTP 200 with real HTML, no Cloudflare
 * block-page signature anywhere (no `Attention Required`, no `Just a moment`),
 * and no 429 or throttling. `server: Apache`, not a CDN wall. So
 * `fetchStrategy` is intentionally OMITTED — plain HTTP is the default
 * (ADR-0012).
 *
 * ## Extraction — `html` is the ONLY container, and here is exactly why
 *
 * 🔴 **The article markup on this host is broken, and it destroys the template
 * container.** Measured 2026-07-30 with the repo's own parser (node-html-parser,
 * as `extract.ts` uses it) across all 48 articles plus 4 nav pages. The cause is
 * interleaved tags, traced in `/a/isnuye.html`: `<sitelevel_noindex>` OPENS at
 * line 173, then `<div id="content4">` (179), `<div class="content4">` (185) and
 * `<div class="contentpadding">` (186) open inside it — and the matching
 * `</sitelevel_noindex>` arrives at line 202, still INSIDE `.contentpadding`.
 * The parser pops all three divs to close it, so `#content4` and
 * `.contentpadding` vanish from the tree entirely and the article's paragraphs
 * become direct children of `<html>`. `/a/osobysto2.html` has no share widget,
 * hence no interleave, hence an intact `.contentpadding` — the single exception.
 *
 * Every candidate measured, INCLUDING the zeros, and in both `.x` and `#x` form:
 *
 * | selector | result across 48 articles |
 * |---|---|
 * | `html` | **1 instance, 3,706–25,398 chars. Binds 48/48.** ✅ shipped |
 * | `.contentpadding` | MISS on 47; 2,562 ch on `/a/osobysto2.html` only |
 * | `#contentpadding` | MISS, 0 instances |
 * | `.content4` | **2 instances on 48/48 — and the FIRST extracts 0 chars on 47 of them.** The shadow trap: listing it would skip 47 of 48 articles as `too-thin` on a 200 status, with no error anywhere |
 * | `#content4` | MISS, 0 instances (the id div is destroyed by the same break) |
 * | `.articletitle` | 1 instance, **4–64 chars** — the `h1` headline. NEVER listed |
 * | `.content4b` / `#content4b` | MISS, 0 instances |
 * | `.contentleftpadding` / `#contentleftpadding` | MISS, 0 instances |
 * | `.article-content` / `#article-content` | MISS, 0 instances |
 * | `.entry-content` / `#entry-content` | MISS, 0 instances |
 * | `.post-content` / `#post-content` | MISS, 0 instances |
 * | `.cb-entry-content` / `#cb-entry-content` | MISS, 0 instances |
 * | `.content` / `#content` | MISS, 0 instances |
 * | `.elementor-widget-theme-post-content` | MISS, 0 instances |
 * | `body` | **MISS, 0 instances** — absent from the parsed tree, which is why `html` is named explicitly rather than left to `extract.ts`'s implicit fallback |
 * | `main` / `article` | MISS, 0 instances |
 *
 * `.contentpadding` is deliberately NOT listed ahead of `html`: it would be a
 * pure no-op. On the one page it binds, `.contentpadding` and `html` + the strip
 * list produce **byte-identical 2,562-char output**, and on the other 47 it
 * misses. Carrying it would add a second failure mode for zero gain.
 *
 * Resulting article lengths: **1,910–23,595 chars, 48/48 above the 250 floor**
 * (shortest `/a/stvoryv.html` at 1,910).
 *
 * ## Chrome stripped — every figure measured INSIDE the `html` container
 *
 * Because the container is the whole document, the strip list is what does the
 * cleaning. Counts from `/a/isnuye.html`, `/a/triytsyu.html`, `/a/molytvy.html`,
 * `/a/osobysto2.html`:
 *   - **`head` — 1 instance, removes 17,750–17,771 chars.** REQUIRED on this
 *     host: the page ships ~17.4 KB of inline CSS in `<style>` blocks plus a
 *     duplicated `<title>`. Safe because `extract.ts` reads the title from
 *     `root` (line 43) BEFORE the strip loop (line 52).
 *   - **`style` — 6 instances, 17,389 chars** (a subset of `head`, kept because
 *     a `<style>` outside `head` would otherwise land in the text).
 *   - **`script` — 6–7 instances, 1,617–1,943 chars.**
 *   - **`sitelevel_noindex` — a custom ELEMENT tag, not a class, hence no
 *     leading dot. 2 instances, removes 1,682–1,705 chars:** the cookie bar +
 *     top nav + topic menu, and the footer block ("Мапа сайту / Зворотній
 *     зв'язок / Про нас / © SvitStudentiv.com"). REQUIRED.
 *   - **`.likesharediv` — 2 instances, removes 349 chars.** The Facebook Like
 *     iframe and the "Поділитися з друзями:" AddToAny share row. It is NOT
 *     covered by `sitelevel_noindex` here — the surviving wrapper is the third
 *     tag pair, and the top share row sits outside it. `.shareiconsmenupg`,
 *     which does this job on the Russian and German siblings, has **0
 *     instances** on this host, so `.likesharediv` is its Ukrainian equivalent
 *     and the one selector this host genuinely needs by name.
 *   - **`.fccell` — 4–6 instances, removes 72–193 chars.** The "FEATURE CLOSE"
 *     call-to-action cells appended to every article.
 *   - **`form` — 3 instances, 0 chars** (the search boxes; kept as a guard).
 *   - **`noscript`, `svg`, `nav`, `header`, `footer` — 0 instances each.** Kept
 *     anyway, and only these: with the whole document as the container, a
 *     future `<nav>` or `<footer>` would otherwise land in every document.
 *
 * NOT carried, because they measured nothing here and honesty beats parity:
 * `.fctable` (0 instances), `.relatedbottom` (0), `.shareiconsmenupg` (0),
 * `.a2a_kit` (2 instances but 0 chars — empty JS-filled anchors), `.hr2` (2–3
 * instances, 0 chars — empty rule divs), `.articledivider` (0–1, 0 chars).
 *
 * Post-strip audit across all 47 seeds: zero hits for "Поділитися", "Мапа
 * сайту", "Enable javascript", "Copyright" or "Всі права". The three "©" hits
 * are author bylines inside articles (e.g. "© 1997 Richard Purnell",
 * "2001 © Лаура Краус Каленберґ").
 *
 * ## Language: `["uk"]` — read, and separated from Russian on the alphabet
 *
 * Read directly 2026-07-30. `/a/triytsyu.html` opens «Могли би ви пояснити
 * Трійцю?» and answers «Ми з тобою живемо у тривимірному світі. Усі фізичні
 * предмети мають певну висоту, ширину і довжину» ("You and I live in a
 * three-dimensional world. All physical objects have a height, a width and a
 * length"). `/a/stvoryv.html` is «Хто створив Бога?»; `/a/isnuye.html` «Чи існує
 * Бог?»; `/a/lykho.html` «Де Бог, коли приходить лихо?». Genuine Ukrainian
 * prose, not untranslated English.
 *
 * **Proved Ukrainian, not Russian, on the alphabet** — across 426,367 chars of
 * extracted text from all 48 pages:
 *   - Ukrainian-only letters: **23,851** — і ×18,069, є ×2,835, ї ×1,506,
 *     І ×1,242, Є ×109, ґ ×46, Ї ×36, Ґ ×8.
 *   - Russian-only letters (ы, э, ъ and capitals): **0. Not one, on any page.**
 * The markup agrees (`<html lang="uk">`) but was not relied on — `persoalanhidup`
 * declares `lang="id"` and serves Malay.
 *
 * Encoding: the response header is a bare `content-type: text/html` with NO
 * charset parameter; UTF-8 is declared only in a `<meta http-equiv>`. The text
 * decodes correctly as UTF-8 and is not mojibake — confirmed by reading it.
 *
 * The stored per-document language label still comes from content detection at
 * ingest (invariant 6), never from this field.
 *
 * ⓘ `uk` is a NEW language for this corpus as far as this entry knows; the
 * orchestrator should confirm before assuming Stage-4 eligibility overlap.
 *
 * ## Rights — what the site actually says
 *
 * The footer of every page reads exactly `© SvitStudentiv.com`. It does not name
 * Cru. `/m/nas.html` ("Про нас") attributes the site to «міжконфесійний
 * студентський рух «Кемпус»» — the interdenominational student movement
 * "Kempus", Cru's Ukrainian national campus ministry. The estate link is
 * independently confirmed in the markup: pages load shared assets straight from
 * `https://www.everystudent.com/1/2013/img/`, and `/m/intl.html` is the
 * estate's "Іншими мовами" language switcher. So the standard sibling `rights`
 * line is accurate here, with the footer's own wording preserved verbatim in it.
 *
 * `requestDelayMs: 1000` — the politeness default. Nothing argued for more: the
 * probes drew no 429 and no throttling, and 47 pages is under a minute of wall
 * clock.
 */
import type { SourceEntry } from "./types.js"

export const everystudentUk: SourceEntry = {
  key: "everystudent-uk",
  name: "EveryStudent — Ukrainian (svitstudentiv.com)",
  domain: "www.svitstudentiv.com",
  trust: "partner",
  ingestionMode: "html-scrape",
  languages: ["uk"],
  defaultTags: ["everystudent", "cru", "topic:seeker", "lang:uk"],
  defaultCategory: "article",
  rights:
    "© SvitStudentiv.com (Cru) — partner ministry content; used for retrieval/attribution.",
  crawl: {
    // Apex 301s to www (measured); www is the serving host.
    baseUrl: "https://www.svitstudentiv.com",
    // No `fetchStrategy`: plain HTTP serves every page on this host (2026-07-30).
    // No `sitemaps`/`allow`/`articleHints`/`block`: there is NO XML sitemap on
    // this host (5 paths probed, all 404), so nothing is discovered and the seed
    // list below IS the filter. See the header.
    seedPaths: [
      "/a/apostoly.html",
      "/a/ateyistka.html",
      "/a/bibliya.html",
      "/a/blyzkosti.html",
      "/a/chomu.html",
      "/a/chudo.html",
      "/a/dali.html",
      "/a/dukh.html",
      "/a/hovoryv.html",
      "/a/islamu.html",
      "/a/isnuye.html",
      "/a/katolykamy.html",
      "/a/khto.html",
      "/a/khtos.html",
      "/a/khtos2.html",
      "/a/krasy.html",
      "/a/lykho.html",
      "/a/lyublyachyy.html",
      "/a/molytvy.html",
      "/a/myr.html",
      "/a/nadiyeyu.html",
      "/a/nevidvorotnym.html",
      "/a/nichoho.html",
      "/a/osobysto.html",
      // Absent from the site's own /m/sitemap.html — found by href harvest,
      // linked from 16 articles, read and confirmed as ministry writing.
      "/a/osobysto2.html",
      "/a/otruynyy.html",
      "/a/pantelyku.html",
      "/a/poklonyatysya.html",
      "/a/pravdyvoho.html",
      "/a/ray.html",
      "/a/relihiyamy.html",
      "/a/rezhyser.html",
      "/a/rozladiv.html",
      "/a/sens.html",
      "/a/shchos.html",
      "/a/shlyub.html",
      "/a/sprahu.html",
      "/a/spravzhniy.html",
      "/a/spravzhnye.html",
      "/a/stvoryv.html",
      "/a/triytsyu.html",
      "/a/vira.html",
      "/a/vovkamy.html",
      "/a/vsesvit.html",
      "/a/yednannya.html",
      "/a/zalezhnist.html",
      "/a/zminenoho.html",
    ],
    // ONLY `html`. Measured 2026-07-30 on all 48 articles: the shared
    // EveryStudent containers are destroyed by an interleaved
    // </sitelevel_noindex> that closes inside .contentpadding, so `#content4`
    // and `.contentpadding` do not exist in the parsed tree on 47 of 48 pages
    // and even `<body>` is absent. `.content4` is deliberately NOT listed: it
    // matches 2 elements on every page and the first extracts 0 chars on 47 of
    // them, which would shadow everything after it and skip the whole corpus as
    // `too-thin`. `.articletitle` is deliberately NOT listed: it is the h1,
    // 4-64 chars. See the header table for every candidate measured.
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
      // REQUIRED with an `html` container: ~17.4 KB of inline CSS plus the
      // duplicated <title>. Safe — extract.ts reads the title from `root`
      // BEFORE the strip loop runs.
      "head",
      // Custom ELEMENT tag, not a class: cookie bar + top nav + topic menu, and
      // the footer block. 2 instances, 1,682-1,705 chars.
      "sitelevel_noindex",
      // The Facebook Like iframe + "Поділитися з друзями:" AddToAny share row,
      // 2 instances, 349 chars. This host's equivalent of the siblings'
      // .shareiconsmenupg, which has 0 instances here.
      ".likesharediv",
      // The "FEATURE CLOSE" call-to-action cells, 4-6 instances, 72-193 chars.
      ".fccell",
    ],
    requestDelayMs: 1000,
    maxPages: 80, // 47 seeds + headroom
    minContentLength: 250,
  },
}
