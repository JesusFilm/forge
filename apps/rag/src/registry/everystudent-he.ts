/**
 * EveryStudent — Hebrew (igod.co.il, "iGod"). Hebrew-language Messianic-Jewish
 * apologetics: articles answering rabbinic objections to Yeshua, Messianic
 * prophecy studies, science-and-faith essays, first-person testimonies and a
 * large daily-devotional body. Registered under the EveryStudent sibling
 * campaign as the Hebrew banner.
 *
 * **A separate SOURCE KEY, not a language of `everystudent`** — one domain =
 * one source (ADR-0006). igod.co.il is its own domain, so it gets its own key,
 * the same way `everystudent-ar` (everyarabstudent.com), `everystudent-fa`
 * (everypersianstudent.com), `thelife-fr` (laviejenparle.com) and `thelife-zh`
 * (uwota.com) are separate entries.
 *
 * ## READ THIS FIRST — three ways this host is unlike every other sibling
 *
 * 1. **It is NOT ~5 articles. It is 1,020.** Verified 2026-07-30. The "~5"
 *    from prior recon is a misread of `/sitemap.xml`, which is a
 *    `<sitemapindex>` holding exactly **5 child `<sitemap>` entries** — the
 *    five children were counted as if they were pages. The children hold
 *    **1,000 + 20 posts, 16 pages, 72 categories, 74 tags = 1,182 URLs**.
 *    Same failure mode as `everystudent.sk` (catalogued 44, yielded 83).
 * 2. **It does NOT run the FreeFind generator the `everystudent-*` siblings
 *    run.** It is **WordPress + Elementor 4.2.0** on the `hello-elementor`
 *    theme (child theme `hello-theme-child-master`), with All in One SEO Pro
 *    4.9.10 generating the sitemaps. Measured from
 *    `<meta name="generator">` and the `wp-content/themes/…` asset paths.
 *    Not one FreeFind selector exists on this host — see the strip section.
 * 3. **The footer is NOT Cru.** See the rights section below. This matters.
 *
 * ## Rights — the footer names a local partner, NOT Cru
 *
 * Verified 2026-07-30. The site footer reads, in full:
 * `© 2026 – כל הזכויות שמורות המכללה למקרא` — "© 2026 – all rights reserved,
 * **המכללה למקרא** (HaMichlala LaMikra, 'The Bible College')". The
 * schema.org `Organization` block names the site itself, and 37 mentions of
 * `מכללה למקרא` appear across the pages fetched.
 *
 * ⚠️ **A sweep of every page fetched (53 documents, homepage included) found
 * ZERO occurrences of `Cru`, `EveryStudent`, `everyarabstudent`,
 * `questions2vie`, `Agape`, `Campus Crusade` or `jesusfilm`.** The only
 * outbound hosts the homepage links are youtube, instagram, facebook,
 * wa.me/m.me, `oral.law` and `bible.new`. So the siblings' standard
 * `© <Domain> (Cru)` rights line **would misattribute this site**, and
 * `rights` below names the actual copyright holder instead.
 *
 * ⚠️ The `cru` tag in `defaultTags` is kept for campaign-grouping parity with
 * the other 40+ EveryStudent keys, but **it is not corroborated by anything on
 * this host** — flagged here so an operator can drop it deliberately rather
 * than discover it in a citation.
 *
 * ## Canonical host — bare apex, and it is a `.co.il` second-level TLD
 *
 * Measured both ways 2026-07-30: `https://www.igod.co.il/robots.txt` →
 * **301 to `https://igod.co.il/robots.txt`**, and every one of the 1,182
 * sitemap `<loc>`s uses the bare apex. So `domain`, `baseUrl` and every regex
 * below pin the apex with no `www.`. Note the registrable suffix is `co.il`,
 * so `igod.co.il` is the second level — the escaped host pattern
 * `igod\.co\.il` is written out in full everywhere rather than matched loosely.
 *
 * ## robots.txt — permissive for us, but it DOES carry Disallow lines
 *
 * Verified 2026-07-30, HTTP 200 at the apex, the whole file being:
 * `User-agent: *` / `Disallow: /wp-admin/` / `Allow: /wp-admin/admin-ajax.php`
 * / `Disallow: /wp-content/uploads/wpforms/` plus two `Sitemap:` lines.
 *
 *   - **No named AI-crawler disallow.** No `ClaudeBot`, no `GPTBot`, no
 *     `CCBot`, no `Content-Signal` — unlike `katramstudentam.lv`. Nothing here
 *     is a rights blocker.
 *   - **Nothing it disallows is an article** — both rules are WordPress
 *     plumbing. But the acquire path does **not** enforce robots.txt, and
 *     `/wp-admin/admin-ajax.php` is a two-segment URL that WOULD match
 *     `articleHints`, so the `^https://igod\.co\.il/wp-` block below exists to
 *     honour robots BY HAND. That block is not cosmetic.
 *
 * ## Sitemaps — every path tried, and what each returned
 *
 * Measured 2026-07-30 with a full browser UA:
 *   - `/sitemap.xml` → **200**, a `<sitemapindex>` of 5 children (self-dated
 *     "יולי 30, 2026", i.e. generated the same day — not a fossil).
 *   - `/sitemap_index.xml` → **302 to `/sitemap.xml`**.
 *   - `/wp-sitemap.xml` → **302 to `/sitemap.xml`** (AIOSEO pre-empts the
 *     WordPress-core sitemap).
 *   - `/sitemap.xml.gz` → **404**. `/sitemap.html` → **404**.
 *   - `/sitemap.rss` → **200** (the second `Sitemap:` line in robots.txt); an
 *     RSS restatement of the newest posts, a strict subset. Not used.
 * `discoverUrls` auto-recurses a `<sitemapindex>`, so `sitemaps` is just
 * `/sitemap.xml` and the five children are walked for free (6 fetches, well
 * under `MAX_SITEMAP_FETCHES`). The children:
 *   - `post-sitemap.xml` **1,000 posts** (AIOSEO's per-file cap),
 *     `post-sitemap2.xml` **20 posts** — 1,020 total, all distinct.
 *   - `page-sitemap.xml` **16 pages** — dropped by shape, see below.
 *   - `category-sitemap.xml` **72**, `post_tag-sitemap.xml` **74** — index
 *     pages, blocked below.
 *
 * **Scheme: every `<loc>` is `https://`** — checked on all 1,182. `discover.ts`
 * filters the RAW `<loc>` string, so the `^https://` pin is correct here; the
 * `everystudent.gr` `http://` trap does not apply.
 *
 * ## URL shape — and why an ASCII-only hint would have destroyed this source
 *
 * All **1,020 posts are exactly `/<category>/<slug>/`** — two path segments,
 * trailing slash, no exceptions. All 16 pages are zero or one segment. So
 * `articleHints` is a pure shape rule and it selects the article body exactly.
 *
 * ⚠️ **947 of the 1,020 slugs are HEBREW SCRIPT, and 668 of the category
 * segments are too** (e.g. `/נבואות-על-המשיח/zechariah-prophecied…/`). The
 * `<loc>`s carry **literal UTF-8 Hebrew with zero `%XX` escapes** — measured,
 * 0 of 1,182 contain a `%`. Because `discover.ts` matches the raw string, an
 * ASCII-only hint such as `[a-z0-9-]+` would have discovered **73 of 1,020
 * articles and silently dropped 93% of the source.** Hence `[^/]+`. (No slug
 * carries an uppercase letter — 0 of 1,020 — but `[^/]+` covers that too.)
 *
 * ## Filters, simulated against the real sitemap: 1,182 seen → 1,020 kept
 *
 * Every rule below was run over the actual `<loc>` list with `discover.ts`'s
 * own `keepUrl` logic. Result: **1,020 kept, 146 blocked, 16 dropped on shape.**
 *   - **`/category/` + `/tag/` — 146 URLs, and they DO bind.** Both are
 *     `/category/<slug>/` and `/tag/<slug>/`: two segments, so they match the
 *     article shape and must be blocked explicitly. These are term-archive
 *     listing pages, not articles.
 *   - **`/author/` — 9 URLs, two segments, also bind.** Not in any sitemap;
 *     found by harvesting hrefs (`/author/josh-mcdowell/`,
 *     `/author/william-lane-craig/`, …). Author archives. Blocked so a sitemap
 *     regeneration cannot admit them.
 *   - **`/page/` — root pagination.** `https://igod.co.il/page/2/` returns
 *     **200** and is two segments, so it matches the shape. A paginated index,
 *     not an article. (`/discipleship/page/2/` is three segments and is
 *     excluded by shape already.)
 *   - **`/wp-`** — honours robots.txt by hand; see above.
 *   - **`/gospel-form`** — the local analogue of the siblings' Gospel-of-John
 *     signup: `/gospel-form/` is titled "ברכות על ההחלטה שלך ללכת אחרי ישוע
 *     המשיח" ("congratulations on your decision to follow Yeshua the Messiah")
 *     and extracts **1,512 chars, which is mostly raw inline CSS leaking into
 *     the container** — form copy, not a seeker question answered. Its
 *     `/gospel-form-confirmation/` twin goes with it. Both are one-segment
 *     pages so the shape hint already excludes them; the block records the
 *     decision so a widened hint cannot readmit them.
 *   - **the homepage** — one `<loc>`, blocked by URL rather than left to the
 *     floor (extract.ts has no `<body>` to fall back to on this host; see
 *     Extraction).
 * There is **no "adventure/email series" page on this host** — measured, not
 * assumed: none of the 1,182 URLs is one, and the 16 pages are the homepage,
 * `sample-page`, `contact`, `accessibility-statement`, `radio`, `app`, the two
 * gospel-form pages, `gospel-presentation`, a duplicate marked `-copy`, and
 * five topical landing pages.
 *
 * ## No dead URLs, and the link harvest found NO article the sitemap misses
 *
 * A GET sweep of **45 random sitemap posts returned 45 × 200** with an empty
 * redirect_url — no 301/302-to-homepage, nothing to block on that ground.
 *
 * Cross-check: the site publishes **no HTML site map** (`/sitemap.html` 404s),
 * so the check was a link harvest instead — every internal `href` on the
 * homepage and on all 52 fetched pages, 349 distinct URLs. **59 were absent
 * from every sitemap, and not one is an article:** 40 date archives
 * (`/2016/04/05/`, three segments), 9 `/author/` pages, `/feed/`,
 * `/discipleship/page/2/`, `/wp-content/…` and `/wp-json/…` assets, the
 * `/יצירת-קשר/` contact page, and 3 URLs that are articles ALREADY in the
 * sitemap re-published under an alias category segment (e.g.
 * `/נבואות-משיחיות/…` for `/נבואות-על-המשיח/…`) — harmless, since discovery
 * reads sitemaps only and never follows page links. **Delta of real articles:
 * zero.** `seedPaths` is therefore intentionally absent: there is nothing to
 * pin, and this is a DISCOVERY source, not a seed-only one like
 * `everystudent-ar`.
 *
 * ## Extraction — measured on this host with node-html-parser, not inherited
 *
 * Run exactly as `src/acquisition/extract.ts` does, over 51 saved pages
 * (45 posts + 6 non-post pages), 2026-07-30. Every candidate, including zeros:
 *   - **`.elementor-widget-theme-post-content` — 1 instance, the article
 *     body.** Present on **45 of 45 posts**; after strips it yields **min 0,
 *     median 2,652, max 83,394 chars**. This is the container. THIS IS THE
 *     SHIPPED SELECTOR.
 *   - **`.entry-content` — matches on 44 of 51 pages and extracts a CONSTANT
 *     286 chars on 43 of them.** It is a related-post teaser card, and it is
 *     byte-identical across unrelated articles (the same testimonial blurb
 *     about ליאת on `/devotionals/great-hope-psalm/` and on
 *     `/נבואות-על-המשיח/prophet-daniel-knew-when-messiah-comes/`). Listing it
 *     would bind it and reduce every article to the same 286-char teaser.
 *     **Deliberately absent.**
 *   - **`.elementor-widget-container` — matches on 51 of 51 pages and extracts
 *     0 chars on every one.** A perfect zero-shadow. **Deliberately absent.**
 *   - **`.page-content` / `main` / `.site-main` — NO-MATCH on all 45 posts**;
 *     they bind only on the one-segment pages (1,512–7,171 chars), all of
 *     which `articleHints` excludes. Not shipped: nothing they could serve is
 *     ever discovered.
 *   - **`article` — 0 instances on every post.**
 *   - **`.contentpadding`, `.content4`, `#content4`, `.cb-entry-content`,
 *     `.post-content`, `.contentleftpadding`, `.article-content`, `.content`
 *     — 0 instances anywhere on this host.** All nine measured; none exists.
 *     This is a tenth generator, not one of the nine.
 *
 * ⚠️ **`<body>` DOES NOT PARSE ON THIS HOST.** The markup is malformed enough
 * that node-html-parser hoists everything to be a direct child of `<html>`:
 * `root.querySelector("body")` returns **null on all 51 pages**, and
 * `root.childNodes` is `[#text "<!doctype html>", <html>]`. So extract.ts's
 * implicit `?? root` fallback would return the whole document INCLUDING the
 * literal `<!doctype html>` text node.
 *
 * That is why **`"html"` is appended last**. It cannot shadow anything (nothing
 * follows it), it fires only when the primary finds no element at all, and it
 * strictly improves on the `?? root` fallback that already exists. Paired with
 * `"head"` in `stripSelectors`, which is a measured **0-char no-op** inside the
 * primary container and only earns its place on that fallback path, where it
 * drops the duplicated `<title>` — safe because extract.ts reads the title from
 * `root` at line 43, BEFORE the strip loop at line 52.
 *
 * ⓘ Honest caveat: on the DISCOVERED set the tail is near-unreachable, because
 * the primary was present on 45 of 45 posts. And one post
 * (`/יהודים-משיחיים/יעקב-ראה-במו-עיניו…/`, a video-only post) matches the
 * primary at **0 chars**, where the tail by design cannot fire — that page
 * correctly skips as `too-thin`. Shipping `["html"]` outright instead would be
 * actively wrong here: it extracts **46,380–84,337 chars of full-page
 * navigation** on a normal article versus the clean body.
 *
 * ## Chrome stripped — and the one selector that had to be REMOVED
 *
 * ⚠️ **`"form"` is deliberately OMITTED from `stripSelectors`, breaking parity
 * with every sibling entry.** Measured: on
 * `/טענות-רבנים-נגד-ישוע-הברית-החדשה/מה-זה-השילוש-הקדוש-וכמה-אלוהים-יש/` a
 * `<form action="http://ask.igod.co.il/…">` wraps **38,759 chars of real
 * article prose** inside the content container. Stripping forms would delete
 * 54% of that article's body. The site's actual search form lives OUTSIDE the
 * container, so omitting the selector costs nothing.
 *
 * What IS stripped, with what it actually removes:
 *   - **`.post-views`** — the "צפיות: N" view counter WordPress appends inside
 *     the container. Present on **32 of 32** measured; **343 chars total,
 *     ~10.7 per page**. Small, but it is a mutable counter and it is the only
 *     non-prose node in the container.
 *   - `script`, `style`, `noscript`, `nav`, `header`, `footer` — **0 instances
 *     inside the container on every page measured.** Retained because they are
 *     load-bearing on the `"html"` fallback path, where they are the difference
 *     between page text and 46k of inline JavaScript.
 *   - `svg` — 4 pages, **0 chars**. `head` — **0 chars**, see above.
 *   - **The FreeFind chrome is ABSENT and is NOT carried.** `sitelevel_noindex`,
 *     `.fccell`, `.fctable`, `.hr2`, `.articledivider`, `.relatedbottom`,
 *     `.a2a_kit`, `.shareiconsmenupg` were each measured on this host:
 *     **0 instances, 0 chars, on all 32 pages.** They can never bind on a
 *     WordPress/Elementor site, so they are omitted rather than carried as
 *     no-ops. The container's only direct children across the sample were 494
 *     `<p>`, 43 `<h4>`, 39 `<h3>`, 37 `<blockquote>`, 4 `<ol>`, 1 `<ul>` and
 *     the one `.post-views` div — it is already clean.
 *
 * ## Scripture — hunted for, and NOT found on this host
 *
 * Estate policy (2026-07-29) blocks complete Bible books. On a Hebrew
 * Messianic site that was a live risk, so it was checked directly rather than
 * assumed. Every slug containing a Bible-book name, `פרק` ("chapter") or
 * `מזמור` ("psalm") was enumerated (13 URLs) and fetched. **None is Scripture
 * text.** The largest, `/נבואות-על-המשיח/ישעיהו-נג-נבואה-דחייתו-וסבלו-של-המשיח/`
 * at **83,406 chars**, is an essay ON Isaiah 53, not Isaiah 53: it is
 * discursive commentary ("בפסוק 2 הם מספרים…" — "in verse 2 they tell us…"),
 * it argues with rabbinic interpretation, and it carries numbered academic
 * footnotes. Isaiah 53 itself is ~1,500 chars; this is 55× that. **How
 * scripture was told from writing about scripture:** raw Scripture pages are
 * verse-sequential with no authorial voice; these quote 0–9% of their body
 * inside `<blockquote>` and spend the rest arguing. Articles do quote the
 * Tanakh and the New Testament heavily (one devotional closes with Psalm 150
 * in full) — that is citation inside an argument, and it is kept.
 *
 * Full Bible text on this ministry lives **off-site**: the homepage's "read the
 * New Testament" link points at `bible.new`, a different host entirely. So
 * there is no Bible-society copyright on igod.co.il to misattribute, and **no
 * scripture block rule is shipped, because there is nothing for one to catch.**
 *
 * ## Language: `["he"]` — read, not inferred
 *
 * Verified 2026-07-30 by reading the extracted text. `<html dir="rtl"
 * lang="he-IL">` on every page, but the declaration was not trusted (see
 * `persoalanhidup.com`, which declares `id` and serves Malay). The article
 * "מי ברא את אלוהים? (האשליה הגדולה של ריצ'ארד דוקינס)" ("Who created God? —
 * Richard Dawkins' great delusion") opens: "ריצ'ארד דוקינס ידוע כמנהיג 'תנועת
 * האתאיזם החדש'. מאמר זה יסקור את ספרו…" — "Richard Dawkins is known as the
 * leader of the 'New Atheism movement'. This article will review his book…".
 * That is Modern Hebrew prose, not untranslated English.
 *
 * **Not Yiddish and not Judeo-Arabic**, which share the alphabet: a census of
 * that article found **4,427 Hebrew-block characters, 65 Latin (1.45%,
 * bibliographic) and ZERO Yiddish-specific orthography** — no ױ, no ײַ, no
 * אַ/אָ pointing, none of the Germanic vocabulary Yiddish would carry. Grammar
 * and vocabulary are Israeli Hebrew throughout (משיח, נבואה, רבנים, פסוק).
 *
 * The repo's detector is `tinyld`, whose table maps `heb → code "he"`; the
 * deprecated `iw` appears **0 times** in the package, and Yiddish is a separate
 * `yi`, so a misfire would be visible rather than silently folded in. The
 * stored per-document label still comes from content detection at ingest
 * (invariant 6), never from this field. No detection library was run to reach
 * the above — it is read text plus a character census.
 *
 * ## Charset and bidirectional text — both clean
 *
 * ⚠️ Checked explicitly because an older Israeli host serving ISO-8859-8 was a
 * real possibility. It does not: the response header is
 * `content-type: text/html; charset=UTF-8` **with the charset parameter
 * present** on every page measured, matching `<meta charset="UTF-8">`. No
 * `8859` string appears anywhere in the served HTML.
 *
 * **No bidi control characters survive into the extracted text** — measured
 * across 5 articles for U+200E/U+200F (LRM/RLM), U+202A–U+202E, U+2066–U+2069,
 * U+061C, U+200B–U+200D, U+FEFF and `&rlm;`/`&lrm;` entities: **zero, in the
 * extracted text AND in the container's raw HTML.** The only invisible
 * character present is NBSP (4–214 per page), which `tidy()` already collapses
 * to a space via its `[^\S\n]+` rule. So nothing invisible inflates
 * `minContentLength` or pollutes chunks here.
 *
 * ## Not walled
 *
 * Cloudflare fronts this host (`server: cloudflare`) but never blocks: ~150
 * sequential plain-HTTP GETs with a full browser UA returned 200 throughout,
 * with no `Attention Required` and no `Just a moment` block page, and no 429.
 * Classified on the block-page signature, not the CDN header — so
 * `fetchStrategy` is intentionally omitted and plain HTTP is used.
 *
 * `requestDelayMs: 1000` — the politeness default; nothing in the probes argued
 * for more. At 1,020 pages that is ~17 minutes of wall clock.
 */
import type { SourceEntry } from "./types.js"

export const everystudentHe: SourceEntry = {
  key: "everystudent-he",
  name: "EveryStudent — Hebrew (igod.co.il)",
  domain: "igod.co.il",
  trust: "partner",
  ingestionMode: "html-scrape",
  languages: ["he"],
  defaultTags: ["everystudent", "cru", "topic:seeker", "lang:he"],
  defaultCategory: "article",
  // NOT the siblings' "© <Domain> (Cru)" line: the footer reads
  // "© 2026 – כל הזכויות שמורות המכללה למקרא" and nothing on this host
  // mentions Cru at all. See the header's rights section.
  rights:
    "© המכללה למקרא (The Bible College) / igod.co.il — partner ministry content; used for retrieval/attribution.",
  crawl: {
    // Bare apex: www.igod.co.il 301-redirects here, and all 1,182 sitemap
    // <loc>s use the apex. `co.il` is the registrable suffix.
    baseUrl: "https://igod.co.il",
    // No `fetchStrategy`: verified 2026-07-30 that plain HTTP serves every page
    // (Cloudflare present, but no block page and no 429 across ~150 GETs).
    sitemaps: ["/sitemap.xml"],
    allow: ["^https://igod\\.co\\.il/"],
    // Pure shape rule: all 1,020 posts are `/<category>/<slug>/` and nothing
    // else is. `[^/]+` is MANDATORY, not stylistic — 947 slugs and 668 category
    // segments are literal (unescaped) Hebrew script in the <loc>, and
    // discover.ts filters the raw string. An ASCII-only hint discovers 73.
    articleHints: ["^https://igod\\.co\\.il/[^/]+/[^/]+/$"],
    block: [
      // Term/author archives and root pagination. All are TWO segments, so all
      // match the shape hint and would otherwise be crawled as articles:
      // 72 /category/ + 74 /tag/ in the sitemap, 9 /author/ found by link
      // harvest, and /page/2/ which returns 200.
      "^https://igod\\.co\\.il/(category|tag|author|page)/",
      // Honours robots.txt BY HAND — the acquire path does not enforce it.
      // Covers `Disallow: /wp-admin/` (whose /wp-admin/admin-ajax.php is a
      // two-segment URL that matches the hint) and
      // `Disallow: /wp-content/uploads/wpforms/`, plus wp-json assets.
      "^https://igod\\.co\\.il/wp-",
      // The decision/signup form ("congratulations on your decision to follow
      // Yeshua") and its confirmation twin — 1,512 chars of form copy and
      // leaked inline CSS. One-segment, so the hint excludes them already;
      // this records the decision against a future widening of the hint.
      "^https://igod\\.co\\.il/gospel-form",
      // The homepage. Blocked by URL, never left to minContentLength: <body>
      // does not parse on this host, so a miss falls back to the whole
      // document rather than to nothing.
      "^https://igod\\.co\\.il/?$",
    ],
    // ONE measured container, then the safe tail. `.entry-content` (a constant
    // 286-char related-post teaser on 43 of 51 pages) and
    // `.elementor-widget-container` (0 chars on 51 of 51) are deliberately
    // ABSENT: extractContent binds the first selector that MATCHES an element,
    // not the first that yields text, so either would shadow the real body.
    // "html" is last, cannot shadow, and only improves on extract.ts's implicit
    // `?? root` — which is what fires here because <body> never parses.
    contentSelectors: [".elementor-widget-theme-post-content", "html"],
    stripSelectors: [
      "script",
      "style",
      "noscript",
      "svg",
      "nav",
      "header",
      "footer",
      // 0-char no-op inside the container; earns its place only on the "html"
      // fallback path, where it drops the duplicated <title>. extract.ts reads
      // the title from `root` BEFORE stripping — keep that order.
      "head",
      // The "צפיות: N" view counter appended inside the container: 32 of 32
      // pages, 343 chars total. The only non-prose node in the body.
      ".post-views",
      // NOTE: "form" is deliberately NOT here, unlike every sibling entry — a
      // <form> wraps 38,759 chars of real article prose on
      // /טענות-רבנים-נגד-ישוע-הברית-החדשה/מה-זה-השילוש-הקדוש-וכמה-אלוהים-יש/.
      // The FreeFind chrome (sitelevel_noindex, .fccell, .fctable, .hr2,
      // .articledivider, .relatedbottom, .shareiconsmenupg) is omitted because
      // it measures 0 instances on this WordPress/Elementor host.
    ],
    requestDelayMs: 1000,
    maxPages: 1200, // 1,020 discovered articles + headroom
    minContentLength: 250,
  },
}
