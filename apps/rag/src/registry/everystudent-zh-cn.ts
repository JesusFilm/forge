/**
 * EveryStudent — Chinese Simplified (xinshengming.com, 新生命 "New Life"). The
 * Simplified-Chinese banner of Cru's seeker-facing Q&A ministry: short
 * apologetics/life-issue articles aimed at Chinese-speaking students who are not
 * believers. Site tagline 对生命的疑问 对神的疑问 ("questions about life, questions
 * about God"); the publisher name in its own schema.org markup is
 * "XinShengMing.com".
 *
 * **A separate SOURCE KEY, not a language of `everystudent`** — one domain = one
 * source = one crawl job (ADR-0006 §Decision 1). xinshengming.com is its own
 * domain, so it gets its own key, exactly as `everystudent-fr`
 * (questions2vie.com) and `thelife-zh` (uwota.com) are separate keys.
 *
 * ============================================================
 * ⚠️ TEMPLATE OUTLIER — THIS DOMAIN DOES **NOT** USE THE SHARED
 * EveryStudent TEMPLATE. Do not "harmonise" its selectors with
 * its siblings.
 * ============================================================
 * Every other EveryStudent banner is a legacy hand-rolled site whose article
 * body is `.content4` / `.content4b`, with `.articletitle` + `.contentpadding`
 * as the title/padding wrappers and `sitelevel_noindex` + `.fccell` as the
 * share/CTA chrome (#111, #112; measured binding on the English and Arabic
 * hosts). xinshengming.com is a **WordPress site on a `cb-`-prefixed theme**
 * instead — a completely different generator.
 *
 * Verified 2026-07-28 by fetching 13 distinct article pages across both content
 * sections (`/a/exist`, `/a/whois1`, `/a/godreal`, `/a/personally`,
 * `/a/followup`, `/a/pack1`, `/a/fanxuede0`, `/a/fanxuede1`, `/a/existencevid`,
 * `/john/john0`, `/john/john1`, `/john/john18`, `/john/john37`) plus the
 * `/m/existence` index page and grepping the raw HTML of each:
 *   - `content4`, `content4b`, `articletitle`, `contentpadding` — **0
 *     occurrences on every page.** The shared selectors do not bind here; with
 *     them alone extraction would silently fall through to `<body>` and ingest
 *     the full nav + footer as article text.
 *   - `sitelevel_noindex`, `fccell`, `relatedbottom` — likewise **0
 *     occurrences.** Those strip entries are dead config on this host and are
 *     deliberately omitted rather than copied over from the siblings.
 *
 * **The real container is `.cb-entry-content`** — the theme emits exactly one
 * `<section class="cb-entry-content clearfix" itemprop="articleBody">` per
 * article. Verified 2026-07-28: present exactly once on all 13 article pages
 * sampled, and **absent (0 occurrences) on the `/m/` section-index pages**, so
 * the selector itself discriminates articles from listings. Extracted body
 * lengths ran 298–11,083 chars (`/a/followup` 298, `/a/whois1` 1,235,
 * `/john/john1` 1,603, `/a/exist` 4,757, `/a/fanxuede1` 11,083).
 * Fallbacks: `article.hentry` (the WordPress post wrapper, one per article page,
 * which also pulls in the `<h1>` and featured image) then `#cb-content`.
 * `contentSelectors` is first-match-wins, not a union (`extract.ts`), so these
 * are a degradation chain, never additive — and the `<h1>` title is not needed
 * in the chain because `extractTitle` reads `<title>` independently.
 *
 * **Chrome to strip — found on this site's own markup, not inherited.** Two
 * site-specific items sit INSIDE `.cb-entry-content`:
 *   - `.a2a_kit` — the AddToAny share widget, and it is the *Chinese-market*
 *     build: QZone, Sina Weibo, WeChat, email (`.a2a_button_qzone`,
 *     `_sina_weibo`, `_wechat`, `_email`). Present on the `/a/` pages, absent on
 *     `/john/`. Its anchors are empty so it costs ~0 chars of text, but it is
 *     removed so no empty-anchor artefacts reach the chunker.
 *   - `.sectionlink` — the grey call-to-action block appended after the last
 *     paragraph of most `/a/` articles ("如何开始建立和神之间的关系？" /
 *     "我对此有疑问。" / "我刚刚祷告邀请耶稣基督进入我生命之中。"). This is the
 *     functional analogue of the siblings' `.fccell` "FEATURE CLOSE" table, under
 *     a different class name. Measured removing 23–59 chars per page across
 *     `/a/exist` (3 links), `/a/whois1` (2) and `/a/godreal` (2), and it left
 *     every article ending on its own last sentence. Inline cross-references that
 *     are NOT in the CTA block (e.g. `/a/whois1`'s 开始连接 link) carry no
 *     `.sectionlink` class and survive.
 *
 * ⓘ **`.sitemapleft` / `.sitemapright` are deliberately NOT stripped despite the
 * name.** On `/a/godreal` they are a two-column float used for inline FIGURE
 * CAPTIONS ("计算机编程:" / "DNA代码:") around article diagrams — real body text,
 * not a sitemap widget. Stripping on the class name alone would delete content.
 *
 * **NOT WALLED — plain HTTP, so `fetchStrategy` is omitted (the default).**
 * Verified 2026-07-28: 15 full page GETs all returned 200 (bar the one 301
 * noted below), and a `HEAD` sweep of the entire 132-URL article set returned
 * **131× 200 and 1× 301 — zero 403s and no Cloudflare block-page signature**,
 * unlike the English/Arabic/French banners, which are walled per ADR-0012.
 * `/sitemap.xml` also answers plain HTTP (200, 22,374 B).
 * The bare host 301-redirects to `www.`, so `www.xinshengming.com` is canonical.
 *
 * **robots.txt: THERE ISN'T ONE.** Verified 2026-07-28:
 * `https://www.xinshengming.com/robots.txt` → **404** (Apache's default
 * ErrorDocument), and `http://xinshengming.com/robots.txt` → 301 to that same
 * 404. No robots file means no `Disallow` rules, so nothing in the article set
 * is excluded on robots grounds. This is a weaker position than the siblings
 * (everystudent.com publishes a real disallow list; questions2vie.com publishes
 * `Allow: /`) — absence of a policy, not a stated permission. Re-check before
 * any future re-crawl in case one is added.
 *
 * **Discovery mode, not hand-listed seeds** — the opposite call from the three
 * walled siblings, and for the opposite reason: `/sitemap.xml` is reachable and
 * plain-HTTP fetching is free, so there is no per-page cost to amortise and
 * nothing to gain from freezing an inventory. Precedent: `thelife-fr` /
 * `thelife-zh`.
 *
 * **Sitemap shape, verified 2026-07-28.** `/sitemap.xml` is a flat `<urlset>`
 * (no `<sitemapindex>`), generated by xml-sitemaps.com, every `lastmod`
 * 2020-02-16 — the file is a one-off dump, not a live feed. **146 `<loc>`
 * entries, 145 unique** (`/m/contact.html` is listed twice; discover.ts collects
 * into a `Set`, so the dupe collapses on its own). All 146 are on-host. They
 * partition cleanly:
 *   - **94 `/a/<slug>.html`** — the seeker Q&A article corpus.
 *   - **38 `/john/john<N>.html`** — a 38-part Gospel-of-John study series.
 *   - **13 `/m/<slug>.html`** — the section-index pages (card listings of post
 *     titles + excerpts; `/m/existence` carries 13 `.cb-post-title` cards and no
 *     `.cb-entry-content`). Navigation, not articles — the same role `/m/` plays
 *     on the French banner, which drops it too.
 *   - **1 homepage.**
 * `articleHints` therefore encodes exactly the two content sections, and the
 * filters yield **129 URLs** (92 `/a/` + 37 `/john/`) — simulated against the
 * live sitemap with `allow ∧ articleHints ∧ ¬block`.
 *
 * **Three `block` entries, each a measured trap rather than a guess:**
 *   - `/a/john.html` — the ONLY redirect in the whole article set: it 301s to
 *     `/john/john1.html`, which the sitemap ALSO lists. Both URLs would fetch
 *     identical bytes and land as two documents at two URLs. Found by HEAD-ing
 *     all 132 `/a/` + `/john/` URLs (131 direct 200s, this one 301).
 *   - `/a/fanxuede0.html` — an index, not a chapter: 1,655 chars carrying **9
 *     `(…)` truncation markers**, each a teaser for one of the
 *     `/a/fanxuede1–9.html` chapters of 范学德's conversion testimony. Verified
 *     its first excerpt appears verbatim inside `/a/fanxuede1.html` (11,083
 *     chars, 0 truncation markers). Ingesting it would add a page of duplicated
 *     fragments.
 *   - `/john/john0.html` — the study series' 目录 (table of contents): 549 chars
 *     that are purely the 37 lesson titles.
 *   `/m/` and the homepage are also blocked; `articleHints` already excludes
 *   them, so those two are belt-and-braces that document intent (the same
 *   defensive style as `thelife-fr`).
 *
 * **`/john/` IS kept as content, with one caveat for the orchestrator.** These
 * are genuine devotional prose — `/john/john1` quotes and expounds John 1:1–5
 * (1,603 chars) — not signup stubs, so they are not the thing `everystudent-fr`
 * dropped (that was `/jean.html`, an email-signup landing page; the equivalent
 * signup URL here is the `/a/john.html` redirect, blocked above). BUT they are
 * WORKBOOK-formatted: each lesson interleaves 问题/答案 pairs whose answers are
 * blank rules (`答案：__________________________`, 6–7 per lesson in
 * `/john/john1` and `/john/john18`). Worth an eyeball at Stage 1 to confirm the
 * blank rules don't degrade chunk quality. Likewise `/a/pack1–7.html` are the
 * seven real instalments of the 属灵的探险 ("Spiritual Adventure") email series,
 * kept as content, and `/a/existencevid.html` is a video page with its full
 * 录像字幕 (transcript) inlined — kept on the same grounds the English banner
 * keeps `/videos/*`.
 *
 * **Language: `["zh"]`, and the content is SIMPLIFIED — measured, not assumed.**
 * `languages` declares the ISO 639-1 code content detection emits, which is bare
 * `zh`; the Simplified/Traditional distinction lives in the key, the name and
 * this docstring instead. Verified 2026-07-28 by scanning the extracted body
 * text of all 13 sampled pages for characters that exist only in one script:
 * **3,225 Simplified-only occurrences across 76 distinct forms** (们 313, 这 211,
 * 为 172, 个 138, 国 112, 来 111, 说 92, 对 91 …) and **zero Traditional-only
 * characters**. Reading it directly confirms the same: `/a/whois1` opens
 * 谁是神?…他是可知的。神，是浩瀚宇宙的创造者，是我们可以来认识的。 — 谁/创造者/我们/认识
 * are all Simplified forms (Traditional would be 誰/創造者/我們/認識). This
 * matters because **everystudent.com.tw is the separate TRADITIONAL sibling**;
 * confusing the two would be a real defect.
 *
 * ⚠️ **Observation for the orchestrator, not solved here: `zh` is a colliding
 * label.** `thelife-zh` (uwota.com) already declares `["zh"]` and also serves
 * Simplified; a future `everystudent-zh-tw` would declare `["zh"]` while serving
 * Traditional. Language-filtered retrieval (`language: "zh"`) cannot separate
 * Simplified from Traditional, nor these sources from each other — the corpus
 * has no script-level facet. Flagging only; the fix (a script sub-tag, or a
 * `script:hans`/`script:hant` tag) is an estate-wide decision.
 *
 * ⚠️ **Chinese is NOT a new language for this corpus** — `thelife-zh` already
 * contributes `zh` documents, so `zh` is a MULTI-source language once this lands
 * and existing `zh` golden cases become eligible against this source's documents
 * by construction. Stage-4 Part A re-review is real work here.
 *
 * ⓘ **`minContentLength: 250` is kept at the sibling default, but note Chinese
 * character density.** A Chinese character carries roughly the information of an
 * English word, so 250 chars here is a substantially higher bar than 250 chars
 * of French — a full 6-section article with 7 scripture quotations
 * (`/a/whois1`) is only 1,235 chars. Two sampled pages sit just above the floor
 * (`/a/followup` 298, `/john/john37` 310). Left unchanged deliberately; raised
 * for a Stage-1 call rather than tuned unilaterally. Related and more
 * consequential: **ADR-0007's 500-char detection floor stores `language = null`
 * below 500 chars**, so those same short-but-legitimate Chinese pages will be
 * excluded from `language: "zh"` filtered retrieval even though they ingest fine.
 *
 * `requestDelayMs: 1000` — the 132-URL HEAD sweep ran at 400 ms with zero
 * throttling, rate-limit headers or failures, so 1 s is comfortably polite for a
 * ~129-page crawl of a small static WordPress host.
 */
import type { SourceEntry } from "./types.js"

export const everystudentZhCn: SourceEntry = {
  key: "everystudent-zh-cn",
  name: "EveryStudent — Chinese Simplified (XinShengMing / 新生命)",
  domain: "www.xinshengming.com",
  trust: "partner",
  ingestionMode: "html-scrape",
  // ISO 639-1, the code content detection emits. Simplified-vs-Traditional is
  // recorded in the key/name/docstring — see the colliding-label note above.
  languages: ["zh"],
  defaultTags: ["everystudent", "cru", "topic:seeker", "lang:zh"],
  defaultCategory: "article",
  rights:
    "© XinShengMing.com (Cru) — partner ministry content; used for retrieval/attribution.",
  crawl: {
    // No `fetchStrategy`: verified unwalled 2026-07-28, so plain HTTP (default).
    baseUrl: "https://www.xinshengming.com",
    sitemaps: ["/sitemap.xml"],
    allow: ["^https://www\\.xinshengming\\.com/"],
    articleHints: [
      // 94 seeker Q&A articles.
      "^https://www\\.xinshengming\\.com/a/[^/]+\\.html$",
      // 38-part Gospel of John study series.
      "^https://www\\.xinshengming\\.com/john/john\\d+\\.html$",
    ],
    block: [
      // The estate's "Who was Jesus?" page (6,438 chars) — curated highlights
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
      // 6,438 chars reads short only because Chinese runs 3-5x denser per
      // character than Latin script — it is the same full article.
      // It matches the article shape, so only a URL block catches it.
      "^https://www\\.xinshengming\\.com/a/whowas\\.html$",
      // Section-index card listings — navigation, not articles.
      "^https://www\\.xinshengming\\.com/m/",
      // 301s to /john/john1.html, which the sitemap already lists.
      "^https://www\\.xinshengming\\.com/a/john\\.html$",
      // Excerpt index for the /a/fanxuede1-9.html chapters (9 "(…)" teasers).
      "^https://www\\.xinshengming\\.com/a/fanxuede0\\.html$",
      // The study series' 目录 (table of contents).
      "^https://www\\.xinshengming\\.com/john/john0\\.html$",
      "^https://www\\.xinshengming\\.com/?$",
    ],
    // NOT the shared .content4 template — this host is WordPress. See header.
    // First-match-wins, so this is a degradation chain, not a union.
    contentSelectors: [".cb-entry-content", "article.hentry", "#cb-content"],
    stripSelectors: [
      "script",
      "style",
      "noscript",
      "svg",
      "nav",
      "header",
      "footer",
      "form",
      // Site-specific chrome, measured on THIS host's markup (see header):
      ".a2a_kit", // AddToAny share widget (QZone / Weibo / WeChat / email)
      ".sectionlink", // trailing CTA block — this site's analogue of .fccell
      ".cb-breadcrumbs", // breadcrumb trail (matters for the fallback selectors)
      ".cb-entry-header", // title + meta strip inside article.hentry
      "#cb-featured-image", // hero image block inside article.hentry
      // NB: .sitemapleft/.sitemapright are NOT stripped — despite the name they
      // hold inline figure captions, i.e. real body text. See header.
    ],
    requestDelayMs: 1000, // 132-URL HEAD sweep at 400ms saw zero throttling
    maxPages: 200, // 146 sitemap URLs (129 kept after filters) + headroom
    minContentLength: 250,
  },
}
