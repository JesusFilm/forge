/**
 * EveryStudent — Mongolian (tailal.mn). The Mongolian banner of Cru's
 * seeker-facing Q&A ministry: short apologetics and life-issue articles written
 * for Mongolian-speaking students who are not believers. A sibling of
 * `everystudent` (en), `everystudent-ar`, `everystudent-fr`, `everystudent-ru`.
 *
 * **A separate SOURCE KEY, not a language of `everystudent`** — one domain =
 * one source (ADR-0006). tailal.mn is its own domain, so it gets its own key,
 * the same way `everystudent-ru` (mirstudentov.com), `everystudent-fr`
 * (questions2vie.com), `thelife-fr` and `thelife-zh` are separate entries.
 *
 * ⚠️ This is a **ccTLD host, not an `everystudent*.com`-style domain**, and its
 * URL layout does NOT match the siblings' (`/a/…` is shared, but `/iohan/` and
 * `/cont.html` are local to this host). Every claim below was measured here.
 *
 * ## NOT walled — plain HTTP
 *
 * Verified 2026-07-29: **~235 plain-HTTP GETs** with a full browser UA
 * (robots.txt, /sitemap.xml, a status sweep of all 105 sitemap URLs, and 119
 * full page bodies) — **every one returned HTTP 200 with real HTML** except the
 * single 301 noted below, and not one carried a Cloudflare block-page signature.
 * The server is `Apache`, not Cloudflare. So `fetchStrategy` is intentionally
 * OMITTED: plain HTTP is the default and nothing here needs Firecrawl
 * (ADR-0012). Discovery is therefore free, so this is a **discovery crawl** with
 * pinned extra seeds — precedent `thelife-fr` and `everystudent-ru`.
 *
 * The bare host **301-redirects to `www`** (measured on /robots.txt), so
 * `www.tailal.mn` is canonical and the host every `<loc>` uses.
 *
 * ## robots.txt — nothing disallowed
 *
 * Verified 2026-07-29: HTTP 200, **22 bytes**, Last-Modified 2018-07-20. The
 * whole file is the single line `User-agent: * Allow: /` — and it really is one
 * physical line: the hexdump shows no newline between the two directives, so
 * `Allow: /` is technically a malformed continuation rather than its own record.
 * Either reading grants everything: there is **no `Disallow` anywhere**, so no
 * URL below is dropped on robots grounds. Every exclusion here is a
 * content-quality call, not a policy one.
 *
 * ## Sitemap — 105 entries, and STALE
 *
 * Verified 2026-07-29: `https://www.tailal.mn/sitemap.xml` → HTTP 200, 7,211
 * bytes, `application/xml`, **Last-Modified 2017-12-22**. It holds 105 `<loc>`
 * elements and **105 distinct URLs** — matching the ~105 from prior recon
 * exactly. They break down as:
 *   - **73 `/a/<slug>.html`** — the article corpus (1 dead, 1 non-article; see below).
 *   - **21 `/iohan/iohan<N>.html`** — Gospel-of-John scripture. BLOCKED, below.
 *   - **8 `/m/<slug>.html`** — section indexes. BLOCKED, below.
 *   - **`/cont.html`**, **`/index.html`**, **`/`** — chrome. BLOCKED, below.
 *
 * ### The XML sitemap is missing 11 live articles — pinned as `seedPaths`
 *
 * Cross-checked 2026-07-29 against the site's own HTML sitemap `/m/map.html`,
 * which links **83 `/a/` pages to the XML sitemap's 73**. Eleven of those are
 * real articles absent from `/sitemap.xml`; all 11 were fetched and returned
 * HTTP 200 with substantial Mongolian prose (extracted chars in brackets):
 * `100boditoi` [5,850], `100buteev` [2,184], `100erdemted` [9,831],
 * `100yertontsiig` [9,977], `200kholbogdokh` [18,349], `300amgalan` [17,208],
 * `300gantsaardalaa` [9,569], `500arvanyesdugeer` [7,076], `500gaduurkhal`
 * [11,443], `500gyeilyesbi` [15,455], `500gyeroinoos` [13,043]. That is **13.4%
 * of the live article set the sitemap alone would miss**, so they are pinned in
 * `seedPaths`; acquire.ts unions seeds with discovered URLs
 * (`[...new Set([...seeds, ...disc.urls])]`), and seeds are NOT re-filtered
 * through `allow`/`articleHints`/`block`.
 *
 * A further link-harvest across all 119 fetched pages surfaced 3 more `/a/` URLs
 * that appear in neither sitemap. None is seeded — see the block list for why.
 *
 * **Expected yield: 82 documents** = 71 discovered (73 sitemap `/a/` − 2 blocked)
 * + 11 pinned seeds.
 *
 * ## What is blocked, and the evidence for each
 *
 * `articleHints` already excludes everything outside `/a/`. The `block` entries
 * for `/iohan/`, `/m/`, `/cont.html` and the homepage are deliberately
 * redundant — they record *why* each group is out so a later widening of the
 * hints cannot silently readmit them. Same posture as `everystudent-ru`.
 *
 *   - **`/iohan/*` — 21 pages of VERBATIM SCRIPTURE, not ministry prose.**
 *     Verified 2026-07-29: `/iohan/iohan1.html` … `/iohan/iohan21.html` are the
 *     21 chapters of the Gospel of John in Mongolian, verse-numbered, under the
 *     running head "Ертөнцийн Эзэний Үгийг бие даан унших" ("Reading the Word of
 *     the Lord of the universe on your own"). `iohan1` opens "Эхэнд Үг байсан,
 *     Үг Бурхантай хамт байсан ба Үг нь Бурхан байсан" (John 1:1). They extract
 *     **2,575–7,242 chars**, so every one clears `minContentLength` and the
 *     floor could not catch them. This is this host's form of the localized
 *     Gospel-of-John series the sibling entries drop (`/jean.html`,
 *     `/john.html`); it is a Bible-reading plan, not seeker Q&A.
 *   - **`/a/Ezeniy.html` — the index page for that same John plan.** Verified
 *     2026-07-29: **1,695 chars**, and its body is purely the 21-chapter table
 *     of contents ("1-р бүлэг … 21-р бүлэг"). It matches the `/a/` article
 *     pattern, so ONLY a URL block excludes it.
 *   - **`/a/510Moriytey.html` — 301 to the HOMEPAGE.** Verified 2026-07-29 by a
 *     status sweep of all 105 sitemap URLs: this is the **only** non-200 among
 *     them (`location: https://www.tailal.mn/`, following it yields the
 *     139,899-byte homepage). Blocked by URL, not left to the floor: the
 *     homepage extracts 1,511 chars, far over 250.
 *   - **`/a/212Yzmerchid.html`, `/a/217Hoyor.html`, `/a/402fol.html` — link-only,
 *     all three excluded.** Verified 2026-07-29: `212Yzmerchid` **301s to the
 *     homepage**; `217Hoyor` **301s to `/a/202Yesys.html`**, a page already in
 *     the corpus; `402fol` is a **decision follow-up email form** ("Ингээд та
 *     Есүсийг өөртөө хүлээн авлаа…" — name / email / confirm email / school
 *     fields plus a privacy notice) that still extracts **821 chars** because
 *     its labels sit outside the `<form>`. None is in either sitemap today, so
 *     the block is insurance: this XML sitemap is 8 years stale, and a
 *     regeneration could introduce them.
 *   - **`/m/*` — navigation.** Verified 2026-07-29: all 9 fetched, extracting
 *     **30–3,573 chars** of headline+teaser link lists. They are the section
 *     indexes (`exi`, `jes`, `exp`, `iss`, `eni`, `for`), `/m/ab.html` (about),
 *     `/m/map.html` (the HTML site plan, 3,573 chars of pure link list) and
 *     `/m/intl.html` ("Өөр хэл сонгох" — choose another language, the page
 *     linking out to the sibling language domains, the twin of the `/m/intl.html`
 *     the French entry drops). Six of the nine clear the 250 floor.
 *   - **`/cont.html` — the contact form.** Verified 2026-07-29: **387 chars**,
 *     titled "Асуулт байна уу?" ("Have a question?"). Over the floor, so blocked.
 *   - **`/` and `/index.html` — the homepage, served at BOTH URLs.** Verified
 *     2026-07-29: byte-identical, 139,899 bytes each, extracting **1,511 chars**
 *     of teaser links. Both are in the sitemap and both are blocked.
 *
 * ## Extraction — the shared template does NOT survive parsing on this host
 *
 * Measured 2026-07-29 by running extract.ts's own node-html-parser logic over
 * **all 119 fetched pages** — the only check that proves anything, because every
 * one of these tokens is also declared in the page's 12.7 KB inline `<style>`
 * block and a grep false-positives on all of them. Counts are pages the selector
 * binds an ELEMENT on, out of 119:
 *   - **`.content4` — binds on 109 pages, and extracts 0 characters on 105 of
 *     them.** On the 86 `/a/` pages measured it binds 84 times and yields **0
 *     chars every single time**: it is an empty spacer `<div class="content4">`.
 *   - **`.content4b` — 0 instances. Absent from this host entirely.**
 *   - **`.contentpadding` — binds on only 5 of 119 pages, and on NONE of the 86
 *     articles.** It exists only on `/cont.html`, `/m/ab.html`, `/m/intl.html`,
 *     `/m/jes.html` and `/m/map.html` — all of them blocked. This is the sharp
 *     difference from `everystudent-ru`, where `.contentpadding` is the answer.
 *   - **`.articletitle` — binds on 55 pages, 17–48 chars.** An `<h1>`; a title,
 *     not a body.
 *   - **`body` — binds on only 5 of 119 pages, and on NO article.**
 *   - **`html` — binds on 119 of 119. The only universal container, and what
 *     this entry ships.**
 *
 * ### Why no article container survives: malformed `sitelevel_noindex`
 *
 * The raw HTML of an article *does* contain `<div class="contentpadding">` — but
 * the parser never surfaces it. On `/a/101Yertontsiyn.html` the markup opens
 * `<sitelevel_noindex>` (line 176), then `<div id="content4">`, `<div
 * class="content4">`, `<div class="contentpadding">` (line 187) — and then
 * closes `</sitelevel_noindex>` at line 202, **inside** `.contentpadding` and
 * before the article even starts (`<h1 class="articletitle">` is line 212).
 * Closing the outer element pops the three open divs with it, so `#content4`,
 * `.content4`'s contents and `.contentpadding` all vanish from the tree, and
 * `<body>` (line 25) is destroyed too: `root.querySelector("body")` returns
 * **null**, and the whole article becomes a flat run of ~55 direct children of
 * `<html>` (h1, h2, p, h3, …), with no wrapper of any kind.
 *
 * So `contentSelectors: ["html"]` is not laziness — it is the only element that
 * exists. `["body"]` was measured and rejected: it does not bind, and extract.ts
 * would silently fall through to `root.querySelector("body") ?? root`, giving the
 * same text plus a stray `<!DOCTYPE html>` line. Naming `html` makes the binding
 * explicit and deterministic instead of accidental.
 *
 * ⚠️ `html` obviously does not discriminate content from nav. The URL filters
 * above are what keep the corpus clean; the selector must not be relied on for it.
 *
 * ## Chrome stripped — measured INSIDE the shipped `html` scope
 *
 * Instance counts and char removals below are measured on `/a/101Yertontsiyn.html`,
 * `/a/601Emgenelt.html` and `/a/709Goorval.html`. Because the scope is the whole
 * document, the strip list is doing far more work here than on the siblings:
 * base stripping alone takes 36,048 → 21,154 chars on `101Yertontsiyn`.
 *
 *   - **`head` — this host's addition, and it is REQUIRED.** With the scope at
 *     `html`, `<head>` is inside it, and after `script`/`style` removal its
 *     surviving `<title>` prepends the full SEO title as the first body line.
 *     Stripping `head` is safe because extract.ts calls `extractTitle(root)`
 *     BEFORE the strip loop mutates the container — verified: all 82 keep-set
 *     articles still resolve a non-null `title` with `head` stripped.
 *   - **`sitelevel_noindex` — a custom ELEMENT tag, not a class.** 2 instances
 *     per article, removing **2,228 chars** on all three pages measured (cookie
 *     bar, `#cont1wrapper` top nav, and the bottom related/footer block). Hence
 *     the bare tag-name selector with no leading `.`, matching the siblings.
 *     It subsumes `#cookie-notice`, `#cont1wrapper`, `#footer`, `.bottomnav`,
 *     `.mostpop` and `.sidebar`, each of which was measured removing **0
 *     additional chars** — which is why none of them is listed.
 *   - **`.likesharediv` — this host's share widget, and its own addition.** 2
 *     instances, **12 chars** ("ХУВААЛЦАХ:" — "SHARE:") wrapping the AddToAny
 *     buttons. It must be named explicitly because the `<sitelevel_noindex>`
 *     that nominally contains it closes early (see above) and never encloses it —
 *     the same malformed-markup finding as the German and Russian siblings.
 *   - **`.shareiconsmenupg` — 0 instances on this host.** The selector the
 *     siblings need does not exist here; `.likesharediv` replaces it.
 *   - **`.fctable` (1 instance) — removes 245 / 245 / 67 chars**, the "FEATURE
 *     CLOSE" call-to-action table appended to every article. **`.fccell` (4–6
 *     instances) removes 0 additional chars** — the cells nest inside the table
 *     shell, which is already gone; it is kept so stripping order cannot matter.
 *   - **`.hr2` (3) and `.articledivider` (1) — 0 chars**, empty rule divs.
 *   - **`.relatedbottom` — 0 instances.** A no-op here; retained for sibling
 *     parity. Do not read its presence as evidence that it binds.
 *
 * Result on the shipped config: the extracted text starts at the article's own
 * `<h1>` and ends on its last footnote line ("Зүүлт: (1) Ром 1:19-21 …"), with no
 * nav or footer surviving. Across the **82 keep-set articles**: min **1,103**,
 * median **5,001**, max **22,170** chars, and **0 fall below the 250 floor**.
 * No two extract identical text; the highest 12-word shingle overlap between any
 * pair is **32.4%** (`/a/202Yesys.html` "Есүс Өөрийгөө Бурхан гэж хэлсэн үү?" vs
 * `/a/718Bidend.html` "Есүс бидэнд юуг санал болгодог вэ?" — two distinct Q&A
 * articles quoting the same scripture blocks). That is far below the 87.9% /
 * 93.8% bands the sibling entries dropped duplicates at, so nothing is excluded
 * on duplication grounds.
 *
 * ## Language: `["mn"]` — read, not inferred
 *
 * Verified 2026-07-29 by reading the extracted text myself. The pages serve
 * genuine Mongolian Cyrillic prose, not untranslated English.
 * `/a/101Yertontsiyn.html` is titled "Бурхан байдаг уу?" ("Does God exist?") and
 * subtitled "Бурхан байдаг болов уу? Бурханы оршин буйг нотлох зургаан илэрхий
 * шалтгааныг толилуулж байна." ("Might God exist? Presenting six clear reasons
 * proving God's existence."); `/a/716Gants.html` asks "Есүс цорын ганц зам уу?"
 * ("Is Jesus the only way?") and runs the house Q&A format "Асуулт: … Бидний
 * хариулт: …" ("Question: … Our answer: …"); `/a/601Emgenelt.html` is "Гай
 * зовлон тохиолдох үед Бурхан хаана байдаг вэ?" ("Where is God when trouble
 * comes?").
 *
 * This is Mongolian, not Russian, despite the shared Cyrillic base: the
 * distinctively Mongolian letters **Ө** and **Ү** appear throughout (Ертөнц, Үг,
 * өөрийн, хүсэл), as does the Mongolian agglutinative morphology (-ийн, -даг,
 * -лаа). Scripture citations use Mongolian book names — Иохан (John), Матай
 * (Matthew), Ром (Romans), Дуулал (Psalms), Илчлэлт (Revelation), Эхлэл
 * (Genesis), Лук (Luke), Исаиа (Isaiah), Еврей (Hebrews), Номлогчийн Үгс
 * (Ecclesiastes).
 *
 * The only English on these pages is bibliographic: footnotes citing
 * English-language sources (e.g. "R.E.D. Clark, Creation (London: Tyndale Press,
 * 1946)", "The Wonders of God's Creation, Moody Institute of Science"), which is
 * normal citation apparatus in a translated article, not an untranslated body.
 *
 * ⓘ **`mn` is a NEW language for this corpus** as far as this entry can see, and
 * `languages` here is the registry-level declaration only. The stored
 * per-document language label still comes from content detection at ingest
 * (invariant 6), never from this field.
 *
 * `requestDelayMs: 1000` — the politeness default. Nothing in the probes argued
 * for more: ~235 requests (including a 105-URL status sweep and a 116-page
 * parallel fetch) drew no 429 and no throttling.
 */
import type { SourceEntry } from "./types.js"

export const everystudentMn: SourceEntry = {
  key: "everystudent-mn",
  name: "EveryStudent — Mongolian (Tailal.mn)",
  domain: "www.tailal.mn",
  trust: "partner",
  ingestionMode: "html-scrape",
  languages: ["mn"],
  defaultTags: ["everystudent", "cru", "topic:seeker", "lang:mn"],
  defaultCategory: "article",
  rights:
    "© Tailal.mn (Cru) — partner ministry content; used for retrieval/attribution.",
  crawl: {
    baseUrl: "https://www.tailal.mn",
    // No `fetchStrategy`: verified 2026-07-29 that plain HTTP serves every page
    // on this host (Apache, no Cloudflare wall). See header.
    sitemaps: ["/sitemap.xml"],
    allow: ["^https://www\\.tailal\\.mn/"],
    // The article corpus and nothing else: 73 of the 105 sitemap URLs, less the
    // 2 blocked below. Slugs are mixed-case (/a/Ezeniy.html), so `[^/]+` is used
    // rather than a lowercase class.
    articleHints: ["^https://www\\.tailal\\.mn/a/[^/]+\\.html$"],
    // The 11 articles the 2017 XML sitemap omits, recovered from the site's own
    // HTML site plan (/m/map.html) and each verified 200 + 2,184-18,349 chars.
    // acquire.ts unions seeds with discovered URLs and does NOT re-filter seeds
    // through allow/articleHints/block.
    seedPaths: [
      "/a/100boditoi.html",
      "/a/100buteev.html",
      "/a/100erdemted.html",
      "/a/100yertontsiig.html",
      "/a/200kholbogdokh.html",
      "/a/300amgalan.html",
      "/a/300gantsaardalaa.html",
      "/a/500arvanyesdugeer.html",
      "/a/500gaduurkhal.html",
      "/a/500gyeilyesbi.html",
      "/a/500gyeroinoos.html",
    ],
    block: [
      // 21 chapters of the Gospel of John, verbatim Mongolian scripture
      // (2,575-7,242 chars each, so all clear minContentLength). This host's
      // form of the localized John series the sibling entries drop.
      "^https://www\\.tailal\\.mn/iohan/",
      // The index page for that same John reading plan: 1,695 chars that are
      // purely a 21-chapter table of contents. Matches /a/, so only a URL
      // block excludes it.
      "^https://www\\.tailal\\.mn/a/Ezeniy\\.html$",
      // The one dead sitemap URL: 301 -> the homepage, which extracts 1,511
      // chars and would therefore sail past the 250 floor as a duplicate.
      "^https://www\\.tailal\\.mn/a/510Moriytey\\.html$",
      // Link-only, in neither sitemap today, blocked as insurance against this
      // 8-year-stale sitemap being regenerated: 212Yzmerchid 301s to the
      // homepage, 217Hoyor 301s to /a/202Yesys.html (already in the corpus),
      // and 402fol is the decision follow-up email form (821 chars, because
      // its field labels sit outside the <form>).
      "^https://www\\.tailal\\.mn/a/(212Yzmerchid|217Hoyor|402fol)\\.html$",
      // The 9 nav indexes (exi, jes, exp, iss, eni, for, ab, map, intl) —
      // headline+teaser link lists, 30-3,573 chars, six of them over the floor.
      // /m/map.html is the HTML site plan; /m/intl.html links out to the
      // sibling language domains.
      "^https://www\\.tailal\\.mn/m/",
      // The contact form: 387 chars, "Асуулт байна уу?".
      "^https://www\\.tailal\\.mn/cont\\.html$",
      // The homepage, served byte-identically at BOTH / and /index.html
      // (139,899 bytes, 1,511 extracted chars). Both are in the sitemap.
      "^https://www\\.tailal\\.mn/(index\\.html)?$",
    ],
    // ONLY `html` — measured 2026-07-29 as the sole element that binds on all
    // 119 pages fetched. `.content4` is deliberately ABSENT: it binds on 84 of
    // the 86 articles and extracts 0 chars on every one of them, and because
    // extractContent scopes to the first selector that MATCHES rather than the
    // first that yields text, listing it would make every page skip as
    // `too-thin` on an HTTP 200. `.content4b` does not exist here;
    // `.contentpadding` binds on no article; `body` is destroyed by the
    // malformed `</sitelevel_noindex>` and binds on no article either.
    contentSelectors: ["html"],
    stripSelectors: [
      "script",
      "style",
      "noscript",
      "svg",
      // Required because the scope is the whole document: without it the
      // surviving <title> prepends the SEO title as the first body line.
      // Safe — extractTitle() reads the title BEFORE stripping runs.
      "head",
      "nav",
      "header",
      "footer",
      "form",
      // Site-specific chrome — all counted in this host's markup (see header):
      "sitelevel_noindex", // custom ELEMENT tag, 2/article, 2,228 chars: cookie bar, top nav, bottom related+footer
      ".likesharediv", // this host's "ХУВААЛЦАХ:" share row (12 chars); its sitelevel_noindex nesting is malformed
      ".shareiconsmenupg", // 0 instances here; kept for sibling parity
      ".fctable", // the "FEATURE CLOSE" CTA table shell — 67-245 chars
      ".fccell", // its cells; 0 additional chars once the shell is gone
      ".hr2", // empty divs drawing the rules bracketing the CTA block
      ".articledivider",
      ".relatedbottom", // no instance on this host; kept for sibling parity
    ],
    requestDelayMs: 1000,
    maxPages: 150, // 82 expected documents (71 discovered + 11 seeds) + headroom
    minContentLength: 250,
  },
}
