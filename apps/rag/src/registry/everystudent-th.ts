/**
 * EveryStudent — Thai (everythaistudent.com, "EveryThaiStudent.com"). The Thai
 * banner of Cru's seeker-facing Q&A ministry: short apologetics and life-issue
 * articles, Q&A ("ถาม&ตอบ") answers, first-person testimonies and video pages
 * with full transcripts, written for Thai-speaking students who are not
 * believers. A sibling of `everystudent` (en) and of the non-walled entries
 * `-de` / `-es` / `-ja` / `-ko` / `-pl` / `-pt` / `-ro` / `-ru` / `-sq` / …
 *
 * **A separate SOURCE KEY, not a language of `everystudent`** — one domain =
 * one source (ADR-0006). everythaistudent.com is its own domain, so it gets its
 * own key, the same way `everystudent-fr` (questions2vie.com), `thelife-fr`
 * (laviejenparle.com) and `thelife-zh` (uwota.com) are separate entries.
 *
 * `th` is a NEW language for this corpus as far as this entry knows; nothing
 * below depends on that, and the stored per-document label still comes from
 * content detection at ingest (invariant 6), never from `languages`.
 *
 * ## NOT walled — plain HTTP
 *
 * Verified 2026-07-29: ~130 plain-HTTP GETs with a full desktop-Chrome UA (the
 * XML sitemap, all 52 sitemap URLs, /a/500gaylesbian.html, /a/402fol.html,
 * /m/faq.html, /m/intl.html, plus a 52-URL HEAD sweep and 13 probes for pages
 * that turned out not to exist). **Every existing page returned HTTP 200 with
 * real HTML** — `server: Apache`, no Cloudflare layer, no block page anywhere.
 * So `fetchStrategy` is intentionally OMITTED: plain HTTP is the default and
 * nothing here needs Firecrawl (ADR-0012). Discovery is therefore free, which
 * makes this a **discovery crawl** rather than the hand-listed seed set the
 * three walled banners were forced into. Precedent: `thelife-fr`,
 * `everystudent-pl`, `everystudent-ru`.
 *
 * The bare host **301-redirects to `www`** (measured on /robots.txt), so
 * `www.everythaistudent.com` is canonical and the host every `<loc>` uses.
 *
 * ## robots.txt — there ISN'T ONE
 *
 * Verified 2026-07-29: `https://www.everythaistudent.com/robots.txt` returns
 * **HTTP 404** (`content-type: text/html`, 35,904 bytes — the site's own themed
 * "not found" page, not a robots file). There is no `User-agent`/`Disallow`
 * anywhere on this host, so **no path is disallowed and nothing below is
 * excluded on robots grounds** — every exclusion in `block` is a
 * content-quality call. Contrast `everystudent-sq`, whose one Disallow rule
 * named an `/a/` article and had to be mirrored into `block` by hand.
 *
 * ## Sitemap — 52 entries, all distinct, 43 articles
 *
 * Verified 2026-07-29: `https://www.everythaistudent.com/sitemap.xml` → HTTP
 * 200, **4,384 bytes**, `application/xml`, Last-Modified 2025-09-16, a single
 * flat `<urlset>` (no `<sitemapindex>`, so no recursion). It holds 52 `<loc>`
 * elements and **52 distinct URLs** — no duplicates, matching the "~52" from
 * prior recon exactly. The breakdown:
 *   - **43 `/a/<slug>.html`** — the article corpus. This is the keep set.
 *   - **7 `/m/<slug>.html`** — section indexes (`about`, `eni`, `exi`, `exp`,
 *     `iss`, `jes`, `map`). BLOCKED, below.
 *   - **`/contact.html`** (contact form) and **`/`** (homepage). BLOCKED.
 *
 * A HEAD + GET sweep of all 52 returned **51 × 200 and 1 × 301**, and the one
 * redirect is a `/m/` page that is blocked anyway: **`/m/jes.html` → `/m/exp.html`**
 * (GET-verified in both directions; an earlier HTTP/2 HEAD sweep reported the
 * pair backwards and was wrong). **No sitemap URL redirects to the homepage**
 * and no article URL redirects at all — there is no dead-seed cohort of the kind
 * `everystudent-ro` shipped 25 of.
 *
 * ## Slugs are pure ASCII — checked, not assumed
 *
 * All 52 `<loc>` values were scanned for non-ASCII bytes and for `%XX`
 * percent-encoding: **zero hits**. No Thai script appears in any URL — the site
 * uses English slugs (`/a/101isthere.html`, `/a/loneliness.html`) under Thai
 * page titles, so an ASCII hint regex is safe here. Three slugs carry an
 * **uppercase** letter — `/a/100Godrealvid.html`, `/a/106Godreal.html` and
 * `/a/video-Jesus.html` — so the hint must not be lowercase-only; `[^/]+`
 * covers all three. A `[a-z0-9-]+` hint would have silently dropped them.
 *
 * ## HTML-map cross-check — the XML sitemap IS stale, by one real article
 *
 * `/m/map.html` ("แผนผังเว็บไซต์" / "site map") was fetched and diffed against
 * the XML, then every `href` on all 52 pages was harvested as a wider net.
 * Verified 2026-07-29, the union finds **2 `/a/` URLs the XML sitemap lacks**:
 *   - **`/a/500gaylesbian.html` — a genuine 14,792-char article**, "เกย์
 *     เลสเบี้ยนและความรักของพระเจ้า" ("Gay, lesbian, and God's love") by Marilyn
 *     Adamson, linked from `/m/map.html` and the relationships index. HTTP 200,
 *     no redirect, `.contentpadding` binds normally. It is **PINNED in
 *     `seedPaths`** — `acquire.ts` unions seeds with discovered URLs, and seeds
 *     bypass `allow`/`block`/`articleHints`, so this is the only way to reach it
 *     until the sitemap is regenerated.
 *   - **`/a/402fol.html` — 944 chars, NOT an article.** "เริ่มต้นกับพระเจ้า"
 *     ("Starting with God"), the post-decision landing page linked from the
 *     FEATURE CLOSE cell of every article. Its body congratulates the reader and
 *     hands off to a different domain — "เราได้สร้างเว็บไซต์ใหม่ ขื่อ
 *     ThaiNewToJesus.com" — for the "ชุด การเริ่มต้นฝ่ายวิญญาณ" ("Spiritual
 *     Starter Kit") email signup. The Thai twin of the Polish
 *     `/a/nowezycie.html`. It sits under `/a/` and MATCHES `articleHints`, and
 *     at 944 chars it clears the 250 floor, so `block` is the only thing that
 *     can exclude it. Absent from today's sitemap; blocked so a regenerated
 *     sitemap cannot quietly admit it.
 * `/m/faq.html` and `/m/intl.html` are also linked but absent from the XML;
 * both are nav and both are already covered by the `/m/` block.
 *
 * ## ⓘ No Gospel-of-John signup, no "adventure/pack" series, no Scripture dump
 *
 * All three of the usual estate hazards were probed and **none exists on this
 * host**. `/john.html`, `/yohan.html`, `/yohn.html`, `/a/john.html`,
 * `/a/yohan.html`, `/adventure.html`, `/pack.html`, `/a/bible.html`,
 * `/sitemap.html`, `/map.html`, `/plan.html`, `/m/sitemap.html` and
 * `/privacy.html` **all return 404** (verified 2026-07-29), and no such URL is
 * linked from any of the 52 pages. The email-signup role is filled by
 * `/a/402fol.html`, which points off-site; there is nothing else to block.
 *
 * On the **estate-wide scripture policy** (decided 2026-07-29 — full Bible books
 * on article URLs are public-domain Scripture rather than ministry writing, and
 * are blocked): **this host carries none.** All 44 article pages were scanned
 * for chapter markers ("บทที่ N") and Thai Bible-edition / Bible-society
 * copyright strings — max 2 chapter references on any page, which is ordinary
 * in-text citation, and the only copyright string anywhere is the site's own
 * footer "© EveryThaiStudent.com". The longest article, `/a/215bible.html`
 * (31,897 ch, "ประวัติศาสตร์ของพระคัมภีร์ - ใครเป็นผู้เขียนพระคัมภีร์" — "History
 * of the Bible: who wrote the Bible"), is apologetics prose with a 16-item
 * English-language footnote list, not Scripture text. Nothing to block.
 *
 * ## Extraction — measured on this host, not inherited on trust
 *
 * Verified 2026-07-29 by running the repo's own `extractContent`
 * (node-html-parser) over the fetched HTML of all 56 pages — the only check that
 * proves anything, because **every one of these class names is also declared in
 * the page's inline `<style>` block**, so grepping false-positives on all of
 * them. Raw (pre-strip) figures:
 *   - **`.contentpadding` — matches on 48/56 pages, extracts 0 chars on NONE of
 *     them.** On articles it is the whole body: kicker, title, subhead, byline,
 *     prose and footnote list, **2,718 – 32,056 chars**. Present and non-empty
 *     on **43 of the 44** article pages (the exception is `/a/300whatislife.html`,
 *     below).
 *   - **`.content4` — matches on 53/56 pages and extracts 0 characters on 48 of
 *     them, including EVERY ONE of the 44 articles.** It is an empty spacer div
 *     that is a *sibling* of `.contentpadding`, not its parent. Listing it ahead
 *     of `.contentpadding` would bind the spacer and skip every article as
 *     `too-thin` on an HTTP 200 — the batch-1 failure (#128). The only pages it
 *     yields text on are the 5 `/m/` indexes (408–1,361 ch of nav), all blocked.
 *   - **`.content4b` — 1 match in 56 pages, 0 chars** (present only on the broken
 *     `/a/300whatislife.html`).
 *   - **`.articletitle` — 49 matches, 7–61 chars.** The `<h1>`, not a body.
 *   - **`.contentleftpadding`, `.cb-entry-content`, `.entry-content`,
 *     `.article-content`, `.articlecontent`, `.articlebody`, `.content`,
 *     `<article>`, `<main>` — 0 matches each.** Absent from this host.
 *   - **`<body>` — 0 matches on article pages** (7 of 56 overall: the homepage
 *     and 5 `/m/` indexes and one 301 stub). So on an article the fallback
 *     container is the document ROOT, whose doctype node leaks the literal
 *     string `<!DOCTYPE html>` into the head of the extracted text.
 *   - **`<html>` — 56/56, 70–51,218 chars.** Whole page; not used.
 * So `contentSelectors` is the single measured container and nothing else.
 *
 * ⚠️ `contentSelectors` is **NOT a fallback chain**. `extractContent` scopes to
 * the FIRST selector that MATCHES AN ELEMENT, not the first that yields text.
 * Adding `.content4` or `.content4b` "as a fallback" would bind an empty div and
 * silently drop every article. Exactly one selector, deliberately.
 *
 * ⚠️ `.contentpadding` also binds on `/contact.html` (296 ch), `/m/about.html`
 * (3,385 ch), `/m/map.html` (1,728 ch) and `/m/intl.html` (13 ch) — it does
 * **not** discriminate article from chrome. The URL filters are what keep the
 * corpus clean; the selector list must not be relied on to do it.
 *
 * ## ⚠️ `/a/300whatislife.html` — one article lost to a missing ">"
 *
 * "การรู้จักกับพระเจ้าเป็นอย่างไรหรือ?" ("What is it like to know God?") is a
 * genuine article and it is blocked anyway. Verified 2026-07-29: line 298 of its
 * source reads **`<sup>13</sup</p>`** — the closing `</sup>` is missing its `>`.
 * node-html-parser swallows the following `</p>` as part of that mangled tag and
 * the element stack unwinds: `querySelector(".contentpadding")` returns **null**,
 * `.content4` returns null too, `.content4b` matches an empty shell, and the
 * article's `<p>` elements end up as direct children of `<html>`. Patching that
 * one character in a local copy restores `.contentpadding` to **10,718 chars**,
 * which pins the cause exactly.
 *
 * With `.contentpadding` unmatched, `extractContent` falls through `<body>`
 * (absent) to the document root. Here that is **not** the whole-page blob the
 * Polish sibling saw — this page's `sitelevel_noindex` wrappers are well-formed,
 * so the strip list still removes the nav/cookie/share/footer and the fallback
 * yields **10,502 chars** that read as the article. But it opens with the literal
 * string `"<!DOCTYPE html> "` followed by a duplicate of its own `<title>`, and
 * carries a stray `</sup` mid-body. Shipping a document with a doctype in its
 * first characters is a known-bad artifact, and the fallback is clean only by
 * luck: any drift in those wrappers turns it into the 29,769-char whole page.
 * Blocked, following `everystudent-pl`'s call on `/a/biblia.html`.
 *
 * ⓘ **This is the one block a reviewer might reasonably reverse** — it costs one
 * real ~10.5k article, and today's fallback output is 96% clean. Reversing is
 * deleting one line of `block`. Recoverable properly by a source-side fix (one
 * character) or by sanitising HTML before `parse()`; both out of scope now.
 *
 * ## Chrome stripped — per-selector contribution, measured INSIDE the scope
 *
 * Marginal characters, measured by re-running the full extraction over the 43
 * kept articles with one selector withheld:
 *   - **`sitelevel_noindex` — 2 instances on every page, 62 chars on 43/43.** A
 *     custom ELEMENT tag, not a class: `<sitelevel_noindex> … </sitelevel_noindex>`,
 *     so the bare tag name with no leading `.` is correct rather than a typo.
 *     Instance [0] is "แชร์ต่อกับคนอื่น:" ("Share with others:", 17 ch); instance
 *     [1] is the related/footer block "ถามคำถาม / ส่งต่อเพื่อนๆ / ► แผนผังเว็บไซต์
 *     / ► ความเป็นส่วนตัว" ("Ask a question / Share with friends / ► Site map /
 *     ► Privacy", 60 ch).
 *   - **`.shareiconsmenupg` — 43 instances, 17 chars each, but 0 chars marginal.**
 *     ⓘ On THIS host the enclosing `<sitelevel_noindex>` is **well-formed** and
 *     already contains it, so once that is stripped first this selector matches
 *     nothing — a **0-char no-op in list order**, not a strip. That is the batch-2
 *     finding (6 of 11 hosts), the opposite of `-de`/`-ru` where the wrapper is
 *     malformed and the share row survives. Kept as a cheap drift guard: the day
 *     the markup changes, "แชร์ต่อกับคนอื่น:" would otherwise trail every article.
 *   - **`.fctable` + `.fccell` together — 78 to 386 chars** across the 43
 *     articles: the "FEATURE CLOSE" call-to-action ("► ฉัน/ผมได้เชิญพระเยซูให้เข้า
 *     มาในชีวิต ► ฉัน/ผม มีคำถาม หรือ ความคิดเห็น"). **Both are required.**
 *     `.fctable` (55 instances) removes the table and its cells on 42 of the 43;
 *     `/a/401fourlaws.html` has **no `.fctable` at all** — 4 bare `.fccell` cells
 *     worth 170 chars — and `.fccell` (254 instances) is the only thing that
 *     catches them.
 *   - **`.hr2` (122 instances) and `.articledivider` (30)** — empty divs drawing
 *     the rules bracketing the CTA block. **0 chars**, confirmed.
 *   - **`.a2a_kit` — 86 instances (2/page), 0 chars.** The AddToAny share-button
 *     row; the buttons are images and `structuredText` does not read `alt`.
 *     Stripped anyway so a markup change adding text labels cannot leak them.
 *   - **`.relatedbottom` — 0 instances on this host.** A parity no-op with the
 *     sibling entries; do not read its presence here as evidence it binds.
 *   - **`script`, `style`, `noscript`, `svg`, `nav`, `header`, `footer`, `form`
 *     — 0 instances each INSIDE `.contentpadding`.** This host puts all of them
 *     outside the content div. Kept as the estate-wide safety net; honest
 *     accounting is that they remove nothing here today.
 *
 * ## ⚠️ minContentLength cannot catch the non-articles
 *
 * Every page in `block` was fetched and extracted with the shipped selectors,
 * and all but two **clear the 250-char floor** — so the floor could not have
 * excluded them and `block` is doing real work. Verified 2026-07-29:
 * `/` = **826 ch** (no `.contentpadding`, so the `<body>` fallback yields the
 * whole teaser page, not nothing); `/m/about.html` = 3,385; `/m/map.html` =
 * 1,728; `/m/eni.html` = 1,342; `/m/exp.html` = 1,039; `/m/exi.html` = 878;
 * `/m/iss.html` = 649; `/m/faq.html` = 389; `/contact.html` = **296 ch**;
 * `/a/402fol.html` = 944; `/a/300whatislife.html` = 10,502. Only `/m/intl.html`
 * (13 ch) and the `/m/jes.html` redirect stub (47 ch) fall under the floor.
 *
 * ## Language: `["th"]` — read, not inferred
 *
 * Verified 2026-07-29 by reading the extracted text myself. The pages serve
 * genuine Thai prose, not untranslated English. `/a/101isthere.html` is
 * "พระเจ้าทรงดำรงอยู่จริงหรือ?" ("Does God really exist?") and invites the reader
 * "คุณอาจเป็นคนหนึ่งใช่ไหม ที่อยากจะให้ใครสักคนมาแสดงหลักฐาน เกี่ยวกับการมีอยู่จริงของ
 * พระเจ้าสักครั้งหนึ่ง" ("Aren't you someone who would like, just once, for
 * somebody to show you the evidence for God's existence?"); `/a/709trin.html` is
 * a Q&A that answers "«ตรีเอกานุภาพ» นี้ เราไม่พบในพระคัมภีร์ แต่เป็นคำที่ใช้เพื่อ
 * บรรยาย…" ("'Trinity' is not found in the Bible, but is a word used to
 * describe…"); `/a/500gaylesbian.html` says "ไม่ว่าคุณจะเป็นเกย์ เลสเบี้ยน
 * ไบเซ็กชวล แปลงเพศหรือยังไม่แน่ใจนัก พระเจ้าไม่ได้ทรงเป็นศัตรูของคุณ" ("Whether you
 * are gay, lesbian, bisexual, transgender or still unsure, God is not your
 * enemy"). Scripture citations use Thai book names throughout — ยอห์น (John),
 * โรม (Romans), สดุดี (Psalms), มัทธิว (Matthew), ลูกา (Luke), วิวรณ์ (Revelation),
 * เยเรมีห์ (Jeremiah), 2 โครินธ์ (2 Corinthians). Every page declares
 * `<html lang="th">` (55/55).
 *
 * The only English is bibliographic: footnotes citing English-language books
 * ("Josh McDowell, The Evidence that Demands a Verdict", "Zondervan Publishing
 * House, 1995"), normal citation apparatus in a translated article. No page
 * showed the cru.org `/mx/es/` failure mode of a localized URL serving an
 * English body.
 *
 * ## ⚠️ Encoding: UTF-8 with NO charset in the HTTP header
 *
 * Verified 2026-07-29, and it matters because two siblings share this shape.
 * Articles answer with **`content-type: text/html`** — bare, **no `charset`
 * parameter** — exactly like `studentinjapan.com` and `everykoreanstudent.com`.
 * The bytes ARE UTF-8 and the HTML declares it, but in the long form:
 * **`<meta http-equiv="content-type" content="text/html; charset=utf-8" />`**,
 * not the short `<meta charset>`. `file(1)` reports "UTF-8 Unicode text" and the
 * Thai read clean end to end — no mojibake, no replacement characters, in titles
 * or bodies. Any fetcher that trusts the HTTP header and defaults to latin-1
 * would mangle every page on this host.
 *
 * ## ⚠️ Article length in characters — a Phase-3 note, not a policy change here
 *
 * Thai is written without spaces between words, so a full article is far shorter
 * in characters than its European equivalent. Measured post-strip across the 43
 * kept articles: **min 2,481, p25 4,191, median 7,261, max 31,897 chars.
 * **Zero articles fall below 500** — so ADR-0007's 500-char
 * language-detection floor (which already mislabels short Chinese articles as
 * `language = null`) is **not** triggered by any real article on this host.
 * `minContentLength` stays at the sibling 250; nothing here argues for changing
 * it, and it is deliberately NOT lowered.
 *
 * ⓘ **Two data-quality observations for the orchestrator, neither blocked:**
 *   1. `/a/loneliness.html` carries a **copy-pasted `<title>`** from
 *      `/a/509beauty.html` ("คำจำกัดความของความงามคืออะไร?" — "What is the
 *      definition of beauty?"), while its real `<h1>` is "ทำอย่างไรดีกับความเหงา"
 *      ("What to do about loneliness"). `extract.ts` prefers `<title>`, so this
 *      document will be stored under the wrong title. Source-side bug; not
 *      fixable from the registry.
 *   2. **8 `-video` pages are transcript twins of a plain article** (e.g.
 *      `/a/301peace-video.html` ↔ `/a/301peace.html`). Character-shingle overlap
 *      was measured on all of them: **0.1% – 78.2%**, the top pairs being
 *      `/a/100whoisvid.html` ↔ `/a/109whatlike.html` (78.2%) and
 *      `/a/401fourlaws-video.html` ↔ `/a/401fourlaws.html` (75.9%). All sit
 *      BELOW the 87.9% / 93.8% band at which the French and English entries
 *      dropped near-duplicates, so all are kept. They are also real prose (23–27
 *      paragraph blocks), not the line-broken transcript the Polish entry
 *      excluded at `/wideo.html`.
 *
 * `requestDelayMs: 1000` — the politeness default. We pay this host's bandwidth
 * directly rather than proxying through Firecrawl, so it is real. ~130
 * sequential plain-HTTP requests drew **no 429 and no throttling**; TTFB is
 * steady at ~0.59 s and a full page ~1.0–1.3 s, so nothing argues for the 2000
 * a slower PHP sibling needed. At 44 pages the whole crawl is ~90 s of wall
 * clock.
 *
 * **Expected yield: 43 documents** — the 43 sitemap articles minus the blocked
 * `/a/300whatislife.html`, plus the pinned `/a/500gaylesbian.html` seed.
 */
import type { SourceEntry } from "./types.js"

export const everystudentTh: SourceEntry = {
  key: "everystudent-th",
  name: "EveryStudent — Thai (EveryThaiStudent.com)",
  domain: "www.everythaistudent.com",
  trust: "partner",
  ingestionMode: "html-scrape",
  languages: ["th"],
  defaultTags: ["everystudent", "cru", "topic:seeker", "lang:th"],
  defaultCategory: "article",
  rights:
    "© EveryThaiStudent.com (Cru) — partner ministry content; used for retrieval/attribution.",
  crawl: {
    baseUrl: "https://www.everythaistudent.com",
    // No `fetchStrategy`: verified 2026-07-29 that plain HTTP serves every page
    // on this host (bare Apache, no Cloudflare). See header.
    sitemaps: ["/sitemap.xml"],
    // The ONE article the XML sitemap is missing. Verified 2026-07-29: HTTP 200,
    // 14,792 chars, "เกย์ เลสเบี้ยนและความรักของพระเจ้า" ("Gay, lesbian, and God's
    // love"), linked from /m/map.html but absent from every <loc>. acquire.ts
    // unions seedPaths with discovered URLs and does NOT filter seeds through
    // allow/block/articleHints, so pinning it here is the only way to reach it.
    seedPaths: ["/a/500gaylesbian.html"],
    allow: ["^https://www\\.everythaistudent\\.com/"],
    // The whole article corpus: 43 of the 52 sitemap URLs. `[^/]+` rather than a
    // lowercase class — /a/100Godrealvid.html, /a/106Godreal.html and
    // /a/video-Jesus.html carry uppercase letters. Slugs are pure ASCII English
    // (verified: zero non-ASCII bytes and zero %XX escapes across all 52 <loc>).
    articleHints: ["^https://www\\.everythaistudent\\.com/a/[^/]+\\.html$"],
    block: [
      // ── These two match articleHints; `block` is the ONLY thing excluding them.
      // A REAL article (10,718 ch once repaired) blocked for a SOURCE-SIDE MARKUP
      // NOTE `/a/300whatislife.html` was blocked here when this entry was first
      // written, then UNBLOCKED by the orchestrator on 2026-07-29. Its markup is
      // genuinely broken — line 298 reads `<sup>13</sup</p>`, missing the ">",
      // which unwinds the element stack so `.contentpadding` never forms. The fix
      // is the `"html"` fallback in contentSelectors plus `head` in this strip
      // list: together they yield the article cleanly instead of a DOCTYPE-led
      // root blob. Blocking it cost a real 10,718-char document for a cosmetic
      // artefact. See the campaign file's rule 1e.
      // "เริ่มต้นกับพระเจ้า" ("Starting with God") — the post-decision landing page
      // that hands readers off to ThaiNewToJesus.com for the "Spiritual Starter
      // Kit" email series. 944 ch, so it CLEARS the 250 floor. Thai twin of the
      // Polish /a/nowezycie.html. Absent from today's sitemap but linked from
      // every article's CTA cell, so blocked in case the sitemap is regenerated.
      "^https://www\\.everythaistudent\\.com/a/402fol\\.html$",
      // ── Below here articleHints already excludes them; these record WHY.
      // The 7 section indexes (about, eni, exi, exp, iss, jes, map) — nav link
      // lists measured at 389-3,385 ch, all well clear of the 250 floor.
      // /m/map.html is the site plan; /m/intl.html (13 ch, not in the sitemap)
      // is the page linking out to the sibling language domains; /m/jes.html
      // 301-redirects to /m/exp.html.
      "^https://www\\.everythaistudent\\.com/m/",
      // The contact form: 296 ch, so unlike a shorter sibling's contact page
      // this one CLEARS minContentLength and the floor cannot catch it.
      "^https://www\\.everythaistudent\\.com/contact\\.html$",
      // The homepage — no .contentpadding, so the <body> fallback returns 826 ch
      // of teaser headlines rather than nothing. Only a URL block excludes it.
      "^https://www\\.everythaistudent\\.com/?$",
    ],
    // ONLY `.contentpadding` — measured 2026-07-29 as the sole element on this
    // host that extracts the article (2,718-32,056 ch raw across the 43 kept
    // pages). `.content4` is deliberately ABSENT: it is an empty spacer SIBLING
    // that matches on 53/56 pages and extracts 0 chars on every one of the 44
    // articles, and because extractContent binds the first selector that MATCHES
    // rather than the first that yields text, listing it would skip every page
    // as `too-thin` on an HTTP 200. `.content4b` exists on exactly one page (the
    // broken one, blocked above) and is also empty. Not a fallback chain.
    contentSelectors: [".contentpadding", "html"],
    stripSelectors: [
      // 0 chars whenever `.contentpadding` binds (it is not inside the div);
      // fires only on the `html` fallback, where it drops the duplicated
      // <title>. Safe because extract.ts reads the title from `root` BEFORE
      // this strip loop runs (extract.ts:43 vs :52).
      "head",
      // Estate-wide safety net. Honest accounting: all eight are 0 instances
      // INSIDE .contentpadding on this host — it keeps them outside the div.
      "script",
      "style",
      "noscript",
      "svg",
      "nav",
      "header",
      "footer",
      "form",
      // Site-specific chrome, all counted in this host's markup (see header):
      "sitelevel_noindex", // custom ELEMENT tag, 2 inst / 62 ch on 43/43: "แชร์ต่อกับคนอื่น:" + related/footer block
      ".shareiconsmenupg", // 43 inst / 17 ch each, but 0 ch MARGINAL — the sitelevel_noindex
      // wrapper is well-formed here and already contains it, so this is a no-op in
      // list order (batch-2 finding). Kept as a guard against that markup drifting.
      ".fctable", // "FEATURE CLOSE" CTA table; with .fccell removes 78-386 ch
      ".fccell", // REQUIRED separately: /a/401fourlaws.html has 4 bare cells and no .fctable
      ".hr2", // empty divs drawing the rules bracketing the CTA block — 0 ch
      ".articledivider", // 0 ch
      ".a2a_kit", // AddToAny share row — 0 ch today (image-only buttons)
      ".relatedbottom", // 0 instances on this host; kept for sibling parity
    ],
    requestDelayMs: 1000, // direct fetches, no Firecrawl proxy; 0 × 429 observed
    maxPages: 80, // 52 sitemap URLs + 1 pinned seed + headroom
    minContentLength: 250,
  },
}
