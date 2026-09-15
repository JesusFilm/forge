/**
 * EveryStudent — Amharic (habeshastudent.com, "HabeshaStudent.com"). The Amharic
 * banner of Cru's seeker-facing Q&A ministry: short apologetics and life-issue
 * articles, FAQ answers and first-person testimonies written for Amharic-speaking
 * students who are not believers. A sibling of `everystudent` (en),
 * `everystudent-pl`, `everystudent-sq`, `everystudent-ru`, `everystudent-de`.
 *
 * **A separate SOURCE KEY, not a language of `everystudent`** — one domain =
 * one source (ADR-0006). habeshastudent.com is its own domain, so it gets its own
 * key, the same way `everystudent-sq` (pyetjetejetes.com), `everystudent-fr`
 * (questions2vie.com), `thelife-fr` (laviejenparle.com) and `thelife-zh`
 * (uwota.com) are separate entries.
 *
 * ⚠️ **"Habesha" is a pan-Ethiopian/Eritrean identity term, so the language was
 * READ off this host rather than inferred from its name.** The sibling domain
 * everytemhari.com is catalogued as Tigrinya (`ti`); Amharic and Tigrinya share
 * the Ge'ez script but are different languages. This host is **Amharic** — see
 * "Language" below for the evidence.
 *
 * ## NOT walled — plain HTTP
 *
 * Verified 2026-07-29: robots.txt, /sitemap.xml, **all 50 sitemap URLs**, plus
 * /a/personally.html, /a/fol.html, /m/faq.html and /m/intl.html were fetched with
 * a plain `curl` carrying a desktop-Chrome UA. **Every one returned HTTP/2 200
 * with real HTML**, `server: Apache`, and **not one byte of Cloudflare anywhere**
 * (grepped for both "cloudflare" and "Attention Required" — 0 hits). So
 * `fetchStrategy` is intentionally OMITTED: plain HTTP is the default and nothing
 * here needs Firecrawl (ADR-0012), unlike everystudent.com / everyarabstudent.com
 * / questions2vie.com which all 403.
 *
 * Discovery is therefore free, making this a **discovery crawl** rather than the
 * hand-listed seed set the walled banners were forced into. Precedent for the
 * shape: `thelife-fr`, `everystudent-pl`, `everystudent-sq`.
 *
 * The bare apex **301-redirects to `www`** (measured on both /robots.txt and
 * /a/isthere.html), and every `<loc>` in the sitemap is a `www` absolute URL, so
 * `domain`, `baseUrl` and every regex below are pinned to `www.`.
 *
 * ## robots.txt — nothing disallowed
 *
 * Verified 2026-07-29: HTTP 200, **22 bytes**, Last-Modified 2018-04-25, and the
 * whole file is `User-agent: * Allow: /` on one line. **There is no Disallow rule
 * at all**, so nothing below is excluded on robots grounds — every exclusion is a
 * content-quality call, and no path needed blocking by hand to honour the file.
 * (The acquire path does not enforce robots.txt; here there is nothing to
 * enforce.) Same posture as questions2vie.com, unlike pyetjetejetes.com whose one
 * Disallow named an `/a/` article.
 *
 * ## Sitemap — 50 entries, all distinct, 40 articles
 *
 * Verified 2026-07-29: `https://www.habeshastudent.com/sitemap.xml` → HTTP 200,
 * **3,965 bytes**, `application/xml`, Last-Modified 2021-07-14. A single flat
 * `<urlset>` (0 `<sitemapindex>` elements, so no recursion). It holds 50 `<loc>`
 * elements and **50 distinct URLs** — no duplicates. This matches the "~50" from
 * prior recon exactly. The breakdown:
 *   - **40 `/a/<slug>.html`** — the article corpus. This is the keep set.
 *   - **5 `/m/<slug>.html`** — section indexes (`existence`, `knowing`, `life`,
 *     `relationships`, `video`). BLOCKED, below.
 *   - **`/about.html`**, **`/contact.html`**, **`/john.html`**, **`/sitemap.html`**
 *     and **`/`** (homepage). All BLOCKED, below.
 *
 * **All 50 sitemap URLs are live.** A full sweep returned **50 × HTTP 200 and
 * 0 redirects** — there is no dead-URL cohort of the kind `everystudent-ro`
 * shipped 25 of, and **no sitemap URL redirects to the homepage**.
 *
 * ⓘ **Slugs on this host are pure lowercase ASCII English words** (`isthere`,
 * `trinity1`, `whodoyousay`) even though every body is Amharic — the Ge'ez script
 * never reaches the URL. Checked, not assumed: all 50 `<loc>` values were scanned
 * for non-ASCII bytes (**0**), for `%XX` percent-encoding (**0**) and for
 * uppercase letters (**0**). So an ASCII hint regex is safe here. `[^/]+` is used
 * anyway rather than `[a-z0-9-]+`, matching the siblings, so a future mixed-case
 * or transliterated slug cannot be silently dropped.
 *
 * ## Cross-checked against the site's own HTML sitemap — ONE article pinned
 *
 * These generated sitemaps are known to be stale, so `/sitemap.html` was fetched
 * and diffed, then every `href` on all 50 pages was harvested as a wider net.
 * Verified 2026-07-29:
 *   - **`/a/personally.html` is in the HTML map and linked from 51 pages, but is
 *     ABSENT from /sitemap.xml.** It is a genuine article — "እግዚአብሔርን በግል ማወቅ"
 *     ("Knowing God personally"), **3,754 chars** post-strip, closing on its own
 *     "የግርጌ ማስታወሻ:" ("Footnotes:") scripture list. Discovery cannot reach it, so
 *     it is **pinned in `seedPaths`**; acquire.ts unions seeds with discovered
 *     URLs, and seeds bypass the `block` filters entirely.
 *   - **`/a/christmas.html` runs the other way** — in the XML sitemap but linked
 *     from no page on the site. It returns 200 and extracts a real article, so
 *     discovery keeps it; nothing to do.
 *   - The href harvest also surfaced **`/a/fol.html`**, **`/m/faq.html`** and
 *     **`/m/intl.html`**, none of them in the XML sitemap. All three are excluded
 *     (see below). One link, `/x/faith.html`, is a **404** — a broken link in the
 *     site's own markup; it is outside `/a/` so `articleHints` already drops it.
 *
 * ## What is blocked, and the measured evidence for each
 *
 * `articleHints` already excludes everything outside `/a/`. The `block` list is
 * deliberately redundant for those, recording *why* each group is out so a later
 * widening of the hints cannot silently readmit them — same defensive posture as
 * `everystudent-pl` / `everystudent-sq`. **One entry is not redundant:**
 * `/a/fol.html` sits under `/a/` and matches `articleHints`, so `block` is the
 * only thing keeping it out.
 *
 * All figures below are post-strip, measured with the repo's own `extractContent`
 * under this entry's exact `contentSelectors`. **Every one except `/contact.html`
 * clears `minContentLength: 250`, so the floor could not have caught them** — they
 * need URL blocks:
 *   - **`/` — the homepage, 856 chars.** It has **no `.contentpadding`**, so
 *     `extractContent` falls back to `<body>` (which this page *does* emit) and
 *     returns the full teaser/CTA list. Exactly the failure the "minContentLength
 *     will drop it" argument gets wrong.
 *   - **`/m/*` — the section indexes.** The 4 nav indexes also lack
 *     `.contentpadding` and fall back to `<body>`: `/m/knowing.html` **676**,
 *     `/m/life.html` **664**, `/m/relationships.html` **632**,
 *     `/m/existence.html` **299**. `/m/video.html` *does* have `.contentpadding`
 *     (**313 chars**) and is still a video index. Not in the sitemap but linked
 *     heavily and blocked by the same prefix: `/m/faq.html` (**246**) and
 *     `/m/intl.html` (**9**) — the latter is the page linking out to the sibling
 *     language domains, dropped for the same reason the English entry drops
 *     `/menus/intl.html`.
 *   - **`/sitemap.html` — 1,101 chars** of pure link list. The Amharic twin of the
 *     French `/plan.html` and the Polish `/mapa.html`.
 *   - **`/about.html` — 560 chars** of about-page boilerplate.
 *   - **`/contact.html` — 134 chars.** The one page the floor *would* catch;
 *     blocked anyway so the exclusion does not depend on a threshold.
 *   - **`/john.html` — 1,039 chars.** "የዮሐንስ ወንጌል ተከታታይ ጥናት" ("Gospel of John
 *     series study"), a MailChimp signup for an email study translated from
 *     partner site startingwithgod.com. The Amharic twin of the French
 *     `/jean.html`, Polish `/jan.html`, Albanian `/gjonit.html`, Arabic
 *     `/john.html`.
 *   - **`/a/fol.html` — 713 chars, and it MATCHES `articleHints`.** "እንኳን ደህና መጡ"
 *     ("Welcome"): the post-decision follow-up page — "ኢየሱስ ክርስቶስን ወደ ህይወትዎ
 *     እንዲገባ ለመጠየቅ ስለወሰኑ እንኳን ደስ አሎት።" ("Congratulations on deciding to ask Jesus
 *     Christ into your life") — whose whole purpose is to hand the reader off to
 *     the off-domain site **addishiwot.net** for a "የመንፈሳዊ ጉዞ ጅማሬ" ("Beginning of
 *     the spiritual journey") email series. This is **this host's twin of the
 *     `/aventure` · `/aventura` · `/pack` · `/abenteuerreise` starter-kit signup**;
 *     there is no on-domain adventure page (0 hits across all 54 linked URLs).
 *     It is absent from today's sitemap, so discovery would not reach it — the
 *     block is what makes that safe rather than lucky.
 *
 * ⓘ **`/a/plates.html` is KEPT, and it is the one call a reviewer might reverse.**
 * "ወራጅ ሳህኖች (3:59)" is the Amharic "Falling Plates" film page: **953 chars**, the
 * shortest article on the host, and its body is explicitly "የቪዲዮው ጽሑፍ:" ("Video
 * transcript:") — ~40 one-line sentences that chunk poorly against paragraph
 * boundaries (invariant 4). The Polish and Russian siblings block their
 * equivalents, but theirs sit at `/wideo.html` and `/m/vid.html` — nav URLs
 * outside the article namespace. **This one is a genuine `/a/` page listed in the
 * XML sitemap**, so it is kept rather than dropped on my own judgement, the same
 * posture `everystudent-sq` took with its outlier. Blocking it is a one-line
 * addition and costs exactly one document.
 *
 * ## ⓘ NO full-Scripture page on this host — checked, not assumed
 *
 * The estate-wide scripture policy (2026-07-29) blocks complete Bible books
 * carried on article URLs (`es` `/articulos/biblia_juan.html` 100,409 ch, `sq`
 * `/a/gjoni.html` 98,887 ch). **This host has no such page.** The longest article
 * is `/a/bible.html` at **15,706 chars** post-strip, and it was read: it is
 * "መጽሐፍ ቅዱስን ለምን ልመን?" ("Why should I trust the Bible?") — an apologetics essay
 * on the Bible's authorship and reliability, closing on English-language
 * bibliographic footnotes (McDowell, *The New Evidence that Demands a Verdict*;
 * Tacitus *Annals* 15.44). Ministry writing about Scripture, not Scripture. No
 * third-party Bible-society copyright notice appears anywhere on the domain, and
 * no `block` entry is needed on scripture grounds.
 *
 * ## Extraction — measured on this host, not inherited on trust
 *
 * Verified 2026-07-29 by running node-html-parser exactly as
 * `src/acquisition/extract.ts` does, over **all 50 sitemap pages** — the only
 * check that proves anything, because every one of these class names is also
 * declared in the page's inline `<style>` block and a grep false-positives on all
 * of them. Raw (pre-strip) character counts:
 *   - **`.contentpadding` — matched 45/50 pages, ZERO of them empty, 244–15,874
 *     chars.** On all **40 `/a/` articles** it is 1 instance holding the whole
 *     article: section kicker, title, subhead, byline, body and footnote list.
 *     **This is the shipped selector.**
 *   - **⚠️ `.content4` — matched 49/50 pages and extracts 0 chars on 45 of them,
 *     including ALL 40 articles.** An empty spacer div. Listing it — anywhere,
 *     even "as a fallback" — would bind it first and skip every single article as
 *     `too-thin` on an HTTP 200: silent, and invisible to the unit tests. That is
 *     how five of the eight pilot entries first shipped (#128). It is the reason
 *     `contentSelectors` here is one selector and not the sibling list.
 *   - **`.articletitle` — 45/50, 3–49 chars.** A title, not a body.
 *   - **`.content4b`, `.contentleftpadding`, `.cb-entry-content`,
 *     `.entry-content`, `.article-content`, `.articlebody`, `.content`,
 *     `<article>`, `<main>` — 0 matches each.** All seven of the page generators
 *     measured across this estate were tried; only two exist here.
 *   - **`<body>` — 0 matches on all 40 articles** (present only on the homepage
 *     and 4 `/m/` indexes, 9,200–9,638 chars). So on an article the fallback
 *     chain lands on the document ROOT.
 *   - **`<html>` — 50/50, 18,950–34,235 chars**: the whole page including nav,
 *     cookie bar and footer. Not used; unlike the Albanian sibling this host's
 *     content divs are well-formed, so the tight container is available.
 *
 * **Measured with `[".contentpadding"]` plus the strip list below, across all 40
 * articles: 953 – 15,706 chars, median 4,294, and 0 pages below the 250 floor.**
 * Output opens on the section kicker + title and closes on the article's own last
 * line, with no nav, cookie bar, share row, CTA or footer left.
 *
 * ⚠️ `.contentpadding` also binds on `/about.html`, `/contact.html`, `/john.html`,
 * `/sitemap.html` and `/m/video.html` — it does **not** discriminate article from
 * chrome. The URL filters above are what keep the corpus clean.
 *
 * ## Chrome stripped — per-selector contribution, measured across all 40 articles
 *
 * Marginal figures are what each selector removes *beyond* the rest of the list;
 * solo figures are what it removes on its own on top of the generic tags.
 *   - **`sitelevel_noindex`** is a custom ELEMENT tag, not a class:
 *     `<sitelevel_noindex> … </sitelevel_noindex>`. **2 instances on 40/40 pages,
 *     solo 119 chars, marginal 110** — the single largest contributor. It carries
 *     the share row ("ሼር ያድርጉ" — "Share") and the footer contact/nav block
 *     ("በስልክ ምክር ለማግኘት 0116174400 ይደውሉ / ጥያቄ ይጠይቁ / ፊልሞች ይመልከቱ / ► Amharic font
 *     / ► ሳይት ማፕ"). Hence the bare tag name with no leading `.`.
 *   - **`.shareiconsmenupg` — 1 instance on 40/40, solo 9 chars ("ሼር ያድርጉ"),
 *     MARGINAL 0.** ⓘ On THIS host the enclosing `<sitelevel_noindex>` is
 *     **well-formed and already contains it**, so once that is stripped first this
 *     selector matches nothing — a genuine no-op in list order. That is the
 *     batch-2 finding (6 of 11 hosts), not the `-de`/`-ru` malformed case. It is
 *     kept purely as a cheap drift guard: it costs nothing, and the day the markup
 *     breaks the way it has on other siblings, "ሼር ያድርጉ" would otherwise trail
 *     every extraction. **It is not claimed to strip anything today.**
 *   - **`.fctable` (1–2 instances) + `.fccell` (4–8) — 49–106 chars JOINTLY**, the
 *     "FEATURE CLOSE" call-to-action block appended to every article ("► ኢየሱስን ወደ
 *     ሕይወቴ እንዲገባ ጋበዝኩት … ► ጥያቄ አለኝ"). ⓘ Each measures **0 marginal on its own**
 *     because they cover each other — the cells nest inside the table. Both are
 *     listed deliberately: dropping `.fccell` would leave the cells, and dropping
 *     `.fctable` would leave the emptied shell.
 *   - **`.hr2` (2–4), `.articledivider` (0–1 — absent on 1 of 40), `.a2a_kit` (2)
 *     — 0 chars each.** They bind, but are empty presentational divs and
 *     image-only AddToAny buttons whose `alt` text `structuredText` does not read.
 *     Retained so a markup change that adds text labels cannot leak them.
 *   - **`.relatedbottom` — 0 instances on this host**, as on every sibling measured
 *     so far. Retained as a harmless parity no-op; do not read its presence here as
 *     evidence it binds.
 *   - **`form`** (generic) does real work here: the MailChimp signup blocks live
 *     inside `.contentpadding` on `/john.html` and on the CTA of several articles.
 *
 * **All site-specific selectors together remove 168–225 chars per article.** After
 * the full list, all 40 articles were re-scanned for leftovers: **0 hits** for
 * "ሼር ያድርጉ", "► ", "Amharic font", "ሳይት ማፕ" or the phone number.
 *
 * ## Language: `["am"]` — Amharic, read rather than inferred
 *
 * Verified 2026-07-29 by reading the extracted text myself. The pages serve
 * genuine Amharic prose, not untranslated English and **not Tigrinya**.
 * `/a/isthere.html` is titled "እግዚአብሔር አለ ?" ("Is there a God?") and opens "ስለ
 * እግዚአብሔር መኖር ማስረጃ የሚያሳይህን ሰው አትወድም?" ("Wouldn't you like someone to just show
 * you the evidence that God exists?"); `/a/prayers.html` is "እግዚአብሔር ፀሎት
 * ይመልሳልን?" ("Does God answer prayer?") and narrates "ኤቲስት የነበርኩ ጊዜ ዘወትር የምትፀልይ
 * መልካም ጓደኛ ነበረችኝ" ("When I was an atheist I had a good friend who prayed
 * constantly"); `/a/trinity1.html` uses the native "ጥያቄ፡ / መልሳችን፡" ("Question: /
 * Our answer:") FAQ pair; `/a/women.html` is "የሴቶች መብት" ("Women's rights").
 * Scripture citations use Amharic book abbreviations (ዮሐ, ሮሜ, ኤር, ራእይ, ኢሳ, 1ኛ ቆሮ)
 * under the Amharic "የግርጌ ማስታወሻ:" ("Footnotes:") heading.
 *
 * **Amharic, not Tigrinya** (the two share the Ge'ez script, and the domain name
 * "Habesha" spans both identities, so this was checked explicitly). Across all 40
 * articles the Amharic copula and morphology dominate — **936 × "ነው", 917 × the
 * relative prefix "የሚ", 99 × "ናቸው", 74 × "ነገር ግን"** — while the Tigrinya markers
 * are essentially absent: **4 × "ናይ", 1 × "እዩ", 1 × "ኢዩ"** in ~200,000 characters,
 * all incidental substrings. Tigrinya would use "ናይ" for the genitive throughout
 * where this text uses "የ-", and "እዩ/እያ" where this text uses "ነው". The sibling
 * everytemhari.com remains the `ti` banner. The site itself agrees, declaring
 * `<html lang="am">`.
 *
 * The only English on these pages is bibliographic — footnotes citing
 * English-language books — which is normal citation apparatus in a translated
 * article, not an untranslated body. The stored per-document language label still
 * comes from content detection at ingest (invariant 6), never from this field.
 *
 * ## Encoding — UTF-8 in the markup, but NOT in the HTTP header
 *
 * Verified 2026-07-29, and it matters because this is a Ge'ez-script host. Every
 * page responds with a bare **`content-type: text/html` carrying NO charset
 * parameter** — the same gap `studentinjapan.com` and `everykoreanstudent.com`
 * have. The bytes are UTF-8 and the HTML declares it: `<meta http-equiv=
 * "content-type" content="text/html; charset=utf-8" />`. `file -I` on the fetched
 * bodies independently reports `charset=utf-8`, and **the Amharic read clean with
 * zero mojibake** through parsing and extraction. Nothing needs configuring — HTTP
 * defaults plus the meta tag land on UTF-8 — but if a future fetcher ever honours
 * the header over the meta tag, this host is where it will break first.
 * (Incidentally the site still ships a "► Amharic font" help link in its footer,
 * a relic of the pre-Unicode era; it is stripped as chrome.)
 *
 * `requestDelayMs: 1000` — the politeness default, and we pay this host's
 * bandwidth directly rather than proxying through Firecrawl. ~60 sequential
 * plain-HTTP requests drew **zero 429s** and no throttling, so the sibling default
 * is kept rather than raised.
 *
 * **Expected yield: 41 documents** — the 40 sitemap articles plus the pinned
 * `/a/personally.html`.
 */
import type { SourceEntry } from "./types.js"

export const everystudentAm: SourceEntry = {
  key: "everystudent-am",
  name: "EveryStudent — Amharic (HabeshaStudent.com)",
  domain: "www.habeshastudent.com",
  trust: "partner",
  ingestionMode: "html-scrape",
  languages: ["am"],
  defaultTags: ["everystudent", "cru", "topic:seeker", "lang:am"],
  defaultCategory: "article",
  rights:
    "© HabeshaStudent.com (Cru) — partner ministry content; used for retrieval/attribution.",
  crawl: {
    baseUrl: "https://www.habeshastudent.com",
    // No `fetchStrategy`: verified 2026-07-29 that plain HTTP serves every page
    // on this host (bare Apache, zero Cloudflare markers). See header.
    sitemaps: ["/sitemap.xml"],
    // Pinned because DISCOVERY CANNOT REACH IT: /a/personally.html is linked from
    // 51 pages and listed on the site's own /sitemap.html, but is absent from
    // /sitemap.xml. It is a genuine 3,754-char article ("እግዚአብሔርን በግል ማወቅ" —
    // "Knowing God personally"). acquire.ts unions seeds with discovered URLs.
    seedPaths: ["/a/personally.html"],
    allow: ["^https://www\\.habeshastudent\\.com/"],
    // The whole article corpus: 40 of the 50 sitemap URLs. Slugs here are pure
    // lowercase ASCII English even though the bodies are Ge'ez script (verified:
    // 0 non-ASCII bytes, 0 %XX escapes, 0 uppercase across all 50 <loc> values),
    // but `[^/]+` is used rather than a lowercase class so a future mixed-case or
    // transliterated slug cannot be silently dropped.
    articleHints: ["^https://www\\.habeshastudent\\.com/a/[^/]+\\.html$"],
    block: [
      // ── This one MATCHES articleHints; `block` is the ONLY thing excluding it.
      // "እንኳን ደህና መጡ" ("Welcome") — the post-decision follow-up page, 713 ch,
      // whose purpose is to hand the reader off to the off-domain addishiwot.net
      // for a "የመንፈሳዊ ጉዞ ጅማሬ" email series. This host's twin of the French
      // /aventure.html, German /abenteuerreise.html and Arabic /pack.html; there
      // is no on-domain adventure page. Absent from today's sitemap, so the block
      // makes that safe rather than lucky.
      "^https://www\\.habeshastudent\\.com/a/fol\\.html$",
      // ── Below here articleHints already excludes them; these record WHY.
      // The section indexes. The 4 nav ones have no .contentpadding, so the
      // <body> fallback returns 299-676 ch of headline+teaser links; /m/video.html
      // does have it (313 ch) and is still an index. /m/faq.html (246 ch) and
      // /m/intl.html (9 ch) are not in the sitemap but are linked 206 and 3 times;
      // /m/intl.html is the page linking out to the sibling language domains.
      "^https://www\\.habeshastudent\\.com/m/",
      // The site plan: 1,101 ch of pure link list. Amharic twin of the French
      // /plan.html and the Polish /mapa.html.
      "^https://www\\.habeshastudent\\.com/sitemap\\.html$",
      // About-page boilerplate (560 ch) and the contact form (134 ch). The
      // contact page is the ONLY excluded page the 250 floor would have caught;
      // blocked anyway so the exclusion does not depend on a threshold.
      "^https://www\\.habeshastudent\\.com/(about|contact)\\.html$",
      // "የዮሐንስ ወንጌል ተከታታይ ጥናት" — the Gospel-of-John email-study MailChimp signup,
      // 1,039 ch. Amharic twin of the French /jean.html and Polish /jan.html.
      "^https://www\\.habeshastudent\\.com/john\\.html$",
      // The homepage — no .contentpadding, so the <body> fallback returns 856 ch
      // of teaser headlines and CTA copy rather than nothing. Only a URL block
      // excludes it; minContentLength cannot.
      "^https://www\\.habeshastudent\\.com/?$",
    ],
    // ONLY `.contentpadding` — measured 2026-07-29 as the sole element on this
    // host that extracts the article (953-15,706 ch post-strip across all 40
    // articles, median 4,294, none under the 250 floor).
    // ⚠️ `.content4` is deliberately ABSENT: it MATCHES on 49 of 50 pages and
    // extracts 0 chars on all 40 articles. extractContent scopes to the first
    // selector that MATCHES, not the first that yields text, so listing it here —
    // even "as a fallback" — would bind an empty spacer div and skip every page
    // as `too-thin` on an HTTP 200. This is NOT a fallback chain.
    contentSelectors: [".contentpadding", "html"],
    stripSelectors: [
      // 0 chars whenever `.contentpadding` binds (it is not inside the div);
      // fires only on the `html` fallback, where it drops the duplicated
      // <title>. Safe because extract.ts reads the title from `root` BEFORE
      // this strip loop runs (extract.ts:43 vs :52).
      "head",
      "script",
      "style",
      "noscript",
      "svg",
      "nav",
      "header",
      "footer",
      "form", // real work here: MailChimp signup blocks sit inside .contentpadding
      // Site-specific chrome — all instance counts and char deltas measured on
      // this host across all 40 articles (see header):
      "sitelevel_noindex", // custom ELEMENT tag, 2 inst: share row + footer contact/nav — 119 ch solo, 110 marginal
      ".shareiconsmenupg", // "ሼር ያድርጉ", 9 ch solo but 0 MARGINAL — sitelevel_noindex is
      // well-formed on THIS host and already contains it. Kept as a drift guard,
      // not because it strips anything today.
      ".fctable", // the "FEATURE CLOSE" CTA table shell
      ".fccell", // its cells: "► ኢየሱስን ወደ ሕይወቴ እንዲገባ ጋበዝኩት…" — 49-106 ch JOINTLY
      // with .fctable; each is 0 marginal alone because they cover each other.
      ".hr2", // empty divs drawing the rules bracketing the CTA — 0 ch
      ".articledivider", // 0 ch (and absent on 1 of the 40)
      ".a2a_kit", // AddToAny share row — 0 ch today (image-only buttons)
      ".relatedbottom", // 0 instances on this host; kept for sibling parity
    ],
    requestDelayMs: 1000, // direct fetches, no Firecrawl proxy; 0 × 429 observed
    maxPages: 80, // 50 sitemap URLs + 1 pinned seed + headroom
    minContentLength: 250,
  },
}
