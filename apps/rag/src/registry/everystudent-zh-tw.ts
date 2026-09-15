/**
 * EveryStudent — Chinese Traditional (everystudent.com.tw). The
 * Traditional-Chinese banner of Cru's seeker-facing Q&A ministry (Taiwan;
 * 台灣學園傳道會 / Cru Taiwan), aimed at Chinese-speaking students who are not
 * believers. Site self-description, verified 2026-07-29 on `/about-us/`:
 * 「EveryStudent.com.tw 是一個能讓你安心來探索有關上帝是誰和認識祂會帶給你生命
 * 什麼樣的不同這一類的問題的地方。」
 *
 * **A separate SOURCE KEY, not a language of `everystudent`** — one domain = one
 * source = one crawl job (ADR-0006 §Decision 1). everystudent.com.tw is its own
 * domain, so it gets its own key, exactly as `everystudent-fr`
 * (questions2vie.com), `everystudent-zh-cn` (xinshengming.com) and `thelife-zh`
 * (uwota.com) are separate keys.
 *
 * **Canonical host is the BARE domain — the reverse of the zh-cn sibling.**
 * Verified 2026-07-29: `https://www.everystudent.com.tw/` → **301** to
 * `https://everystudent.com.tw/`, and `robots.txt` answers only on the bare
 * host (the `www.` copy 301s too). So `baseUrl` carries no `www.`. Every
 * `<loc>` in the sitemap is already written on the bare host.
 *
 * **NOT WALLED — plain HTTP, so `fetchStrategy` is omitted (the default).**
 * Verified 2026-07-29: Cloudflare fronts the origin (`server: cloudflare`) but
 * serves normally — a HEAD sweep of **all 70 sitemap URLs returned 70× 200,
 * zero 3xx, zero 403, and no Cloudflare block-page signature**, and
 * `/sitemap.xml` answers plain HTTP (200, 6,405 B). Unlike the
 * English/Arabic/French banners, which are walled per ADR-0012.
 *
 * **robots.txt — the stock WordPress file, and it does not touch articles.**
 * Verified 2026-07-29 at `https://everystudent.com.tw/robots.txt` (200):
 *     User-agent: *
 *     Disallow: /wp-admin/
 *     Allow: /wp-admin/admin-ajax.php
 *     Sitemap: https://everystudent.com.tw/sitemap.xml
 * The single `Disallow` covers the admin console only. Nothing in the article
 * set is excluded on robots grounds, and the sitemap is explicitly advertised.
 *
 * ============================================================
 * ⚠️ A **THIRD** TEMPLATE. This host matches NEITHER the shared
 * legacy EveryStudent template NOR the zh-cn WordPress theme.
 * Do not "harmonise" its selectors with any sibling.
 * ============================================================
 * It is **WordPress on the Enfold theme (Avia page builder)** — the markup is
 * `av_textblock_section` / `avia_textblock` / `av_promobox` / `avia-builder-el`.
 * Verified 2026-07-29 by parsing fetched HTML with node-html-parser exactly as
 * `extract.ts` does, across all 70 sitemap pages:
 *   - `.content4`, `.content4b`, `.articletitle`, `.contentpadding` — **0
 *     element matches, and 0 raw-text occurrences** (not even inside an inline
 *     `<style>` block, which is where the shared-template hosts declare
 *     `.content4` and where a naive grep false-positives).
 *   - `.cb-entry-content`, `#cb-content` — **0 matches.** The zh-cn sibling's
 *     `cb-`-prefixed theme is absent here.
 *   - `sitelevel_noindex`, `.fccell`, `.fctable`, `.hr2`, `.articledivider`,
 *     `.relatedbottom`, `.shareiconsmenupg` — **0 occurrences each.** All of the
 *     shared-template strip entries are dead config on this host and are
 *     deliberately NOT copied over.
 *
 * **The container is `.entry-content`, shipped as the SINGLE content selector.**
 * `contentSelectors` is first-match-wins in `extract.ts` — the first selector
 * that matches an ELEMENT binds and the loop stops, even if that element yields
 * 0 characters — so a chain here would only create shadowing risk for no gain.
 * Measured first-match extraction on four articles (raw, before strip):
 *
 *   selector          nothing102   faith201   LifePurpose   Suffering631
 *   .entry-content         1,884     11,833         1,629          2,806   ← shipped
 *   article.hentry         2,121     12,097         1,865          3,048
 *   article                2,121     12,097         1,865          3,048
 *   main / .content        5,021     16,441         5,540          4,363
 *   #main                 11,035     22,469        11,544         10,379
 *   <body> fallback       23,620     34,948        24,043         22,926
 *
 * `article.hentry` is a true superset (+236…+264 ch of title/date/meta header,
 * and `extractTitle` reads `<title>` independently so the `<h1>` is not needed);
 * `main`/`#main` drag in ~3,100–11,000 ch of nav. `.entry-content` is the
 * tightest correct container, present exactly once per article.
 *
 * **`.entry-content` is also the article/non-article DISCRIMINATOR.** Of the 70
 * sitemap URLs, **52 carry `.entry-content` and 18 do not** — and all 46 URLs
 * this policy keeps carry it. See the block notes for why the 18 matter.
 *
 * **Chrome to strip — measured on this host's own markup across all 46 kept
 * articles (chars removed / pages affected):**
 *   - `noscript` — **70,746 ch across 43/46 pages.** Already a stock entry on
 *     every sibling, but here it is LOAD-BEARING, not boilerplate: the EWWW
 *     Image Optimizer lazy-loader emits `<noscript><img src="…" srcset="…"></noscript>`
 *     beside every image, and node-html-parser treats `<noscript>` content as
 *     RAW TEXT — so its attributes surface as body text. On `/content/WhoIsHe/faith201/`
 *     that is 6,276 of 11,833 chars; on `/content/lifeissues/facing-anxiety/`,
 *     7,059 of 11,595. Roughly half the corpus by volume. Never remove it.
 *   - `.av_promobox` — 1,466 ch / 23 pages. The Avia promo box holding the
 *     trailing 「相關文章:」 ("Related articles:") link list.
 *   - `.relatedlink` — 1,370 ch / 24 pages. Usually nested inside
 *     `.av_promobox`, but on `/content/WhoIsHe/whichdenom/` it is authored bare
 *     inside `.avia_textblock` with no promo-box wrapper, so both selectors are
 *     needed. Both were measured removing text; neither is a speculative
 *     fallback.
 *   - `.heateor_sss_sharing_container` — 368 ch / **46 of 46 pages**. The Heateor
 *     share widget, labelled 「分享這篇文章」 ("share this article"), with
 *     empty-anchor Line/Facebook/WhatsApp buttons. Universal on this host.
 *   - `.bottomlink` — 211 ch / 8 pages. The trailing call-to-action link
 *     (「我有問題想問……」 — "I have a question I'd like to ask"). This host's
 *     analogue of the siblings' `.fccell` and zh-cn's `.sectionlink`.
 *
 * ⓘ **Measured and deliberately NOT shipped:** `.heateorSssClear`,
 * `.avia-post-nav` and `.av_toc_container` each removed **0 chars on 0 pages**.
 * `.heateorSssClear` exists (as empty clearfix divs) but costs nothing.
 *
 * ⓘ **One known 5-char residue, accepted.** `/content/WhoIsHe/whichdenom/`
 * leaves a bare `<h4>相關文章:</h4>` heading (the sibling of its unwrapped
 * `.relatedlink`). Stripping `h4` would be worse: 18 `<h4>` elements across the
 * corpus are real article subheadings (「寬恕的七個步驟」, 「4 個實證研究支持聖經
 * 的可信度」, 「一、耶穌在十字架上的死亡」). 5 chars on 1 of 46 pages is cheaper
 * than deleting content.
 *
 * **Discovery mode, not hand-listed seeds** — same call as `everystudent-zh-cn`
 * and for the same reason: `/sitemap.xml` is reachable and plain-HTTP fetching
 * is free, so there is no per-page cost to amortise. Precedent: `thelife-fr`.
 *
 * **Sitemap shape, verified 2026-07-29.** `/sitemap.xml` is a flat `<urlset>`
 * (no `<sitemapindex>`), stamped `Sitemap is generated on 2026-07-23 09:22:44
 * GMT` — six days old at time of writing, so unlike the zh-cn sibling's frozen
 * 2020 dump this one is live. **70 `<loc>` entries, all 70 unique, all 70 on the
 * bare host, all 70 returning HTTP 200.** They partition as:
 *   - **46 `/content/<Section>/<slug>/`** — the seeker Q&A corpus (kept).
 *   - **4 `/content/<section>/`** — the section indexes (`enigmas`, `lifeIssues`,
 *     `theexperience`, `whoishe`). Card listings; their own `.entry-content` is
 *     a near-empty 27–91 ch shell because the cards live outside it.
 *   - **17 KnowHimPersonally pages** + `/about-us/`, `/world-language-list/`,
 *     `/content/ContactUs/` — see the block notes.
 *   - **1 homepage.**
 *
 * **HTML-sitemap cross-check: this site has none, and the XML sitemap is NOT
 * stale — delta is ZERO.** Verified 2026-07-29: `/sitemap.html`, `/mapa.html`,
 * `/plan.html`, `/sitemap`, `/sitemap_page`, `/site-map` **all 404**. The four
 * section index pages serve that role instead, so all four were fetched and
 * every internal link harvested (105 distinct) and diffed against the sitemap.
 * **No article is linked that the XML sitemap lacks**, so `seedPaths` is
 * intentionally absent. The only non-sitemap links found were:
 *   - 4 lower-cased twins of URLs already listed
 *     (`/content/lifeissues/lonely532/`, `…/parents540/`, `…/search501/` each
 *     **301 to the CamelCase canonical**; `/content/enigmas/suffering631/`
 *     serves **200** as a genuine case-insensitive alias) and one
 *     slash-less `/content/whoishe/exist207` (301). None are in the sitemap, and
 *     discovery reads only the sitemap, so no duplicate can enter the corpus.
 *   - 50 `/content/tag/<utf8-tag>/` WordPress tag archives — blocked, see below.
 *
 * **`articleHints` matches path SHAPE, not a section allow-list, on purpose.**
 * `discover.ts` compiles patterns with `new RegExp(p)` — **no `i` flag**, so
 * matching is case-sensitive, and this sitemap mixes casings for the SAME
 * section: `/content/WhoIsHe/faith201/` sits beside `/content/whoishe/bible220/`,
 * and `/content/LifeIssues/…` beside `/content/lifeissues/facing-anxiety/`. A
 * literal section list would silently drop the lower-cased articles. The
 * three-segment shape `/content/<any>/<any>/` selects exactly the 46 article
 * URLs and nothing else: the 2-segment section indexes and `/content/ContactUs/`
 * fail it for want of a second segment, and the 4-segment
 * `/content/knowhimpersonally/index/old` fails it for having one too many.
 * Filters simulated against the live sitemap (`allow ∧ articleHints ∧ ¬block`)
 * yield **46 URLs, every one of which carries `.entry-content`.**
 *
 * **The `block` list, every entry a measured trap.**
 * ⚠️ These are blocked BY URL and not left to `minContentLength`, because when
 * no `contentSelector` matches, `extract.ts` does **not** return empty — it
 * falls back to `<body>` and returns the whole nav/footer page. Measured on this
 * host: the 18 sitemap pages without `.entry-content` fall back to 195–3,238
 * chars, and **11 of the 18 clear the 250 floor**. The floor cannot catch them.
 *   - **The whole KnowHimPersonally family (17 URLs).** This is the localized
 *     「你想親自認識神嗎？」 gospel tract and its decision flow — the
 *     Traditional-Chinese counterpart of the Gospel-of-John signup page and the
 *     "adventure/pack" email series the sibling entries drop. It spans three
 *     URL shapes, hence three block patterns: root-level `/knowhimpersonally02/`
 *     … `/knowhimpersonally10/` (9 paginated tract steps, body-fallback
 *     195–588 ch) and `/knowhimpersonally-video/`; `/contentknowhimpersonallyindex-2/`
 *     (3,238 ch, and its own `<title>` says 「(備份，勿刪)」 — "backup, do not
 *     delete"); and under `/content/`, `/content/KnowHimPersonally2/` (1,795 ch),
 *     `/content/knowhimpersonally/index/` (253 ch), `/content/knowhimpersonally/index/old`
 *     (1,505 ch — the legacy Four Spiritual Laws text, a duplicate of the tract),
 *     `/content/KnowHimPersonally/ReceiveJesus/` (1,567 ch, the "I just prayed
 *     to receive Jesus" follow-up) and `/content/KnowHimPersonally/ReceiveJesus_question/`
 *     (1,144 ch). Sixteen of the seventeen have **no `.entry-content` at all**;
 *     only `/content/knowhimpersonally/index/old` does, and it is a backup
 *     duplicate. The patterns use `[Kk]now[Hh]im[Pp]ersonally` because both
 *     casings occur live and the regexes are case-sensitive.
 *   - **`/content/ContactUs/`** (880 ch body-fallback), **`/about-us/`** (368 ch)
 *     and **`/world-language-list/`** (2,573 ch — the 35+ sibling-language
 *     directory, this banner's twin of the `/m/intl.html` the French entry
 *     drops). All three clear 250 on the `<body>` fallback.
 *   - **`/content/tag/`** — the WordPress tag archives. Not in today's sitemap,
 *     but they are the one 3-segment shape that WOULD satisfy `articleHints` if
 *     the plugin ever adds them, and a spot-check returned 200. A real guard,
 *     not decoration.
 *   - **the homepage** and the 4 section indexes, which `articleHints` already
 *     excludes — belt-and-braces that documents intent, the same defensive style
 *     as `thelife-fr`.
 *
 * **Language: `["zh"]`, and the content is TRADITIONAL — measured, not assumed.**
 * `languages` declares the ISO 639-1 base code that content detection emits,
 * which is bare `zh`; the regional/script variant lives in the key, the name and
 * this docstring only. Verified 2026-07-29 by scanning the extracted body text
 * of all 46 kept articles for characters that exist in only one script:
 * **7,963 Traditional-only occurrences across 30 distinct forms** (們 1,255,
 * 這 727, 個 580, 為 485, 來 453, 會 406, 說 366, 時 342, 對 295, 經 283, 愛 275,
 * 麼 230 …) and **zero Simplified-only characters**. The text is 98.8% CJK
 * (70,955 CJK chars vs 849 Latin letters), so it is genuinely Chinese and not an
 * untranslated English body. Reading it directly agrees:
 * `/content/WhoIsHe/nothing102/` opens 「你是否思考過萬物的起源？」 and
 * `/content/Enigmas/Suffering631/` asks 「如果上帝是美善的，為什麼祂允許這麼多苦難
 * 發生呢？」 — 過/萬/這/為/發 are all Traditional forms (Simplified: 过/万/这/为/发).
 * This matters because **xinshengming.com is the separate SIMPLIFIED sibling**
 * (`everystudent-zh-cn`); confusing the two would be a real defect.
 *
 * ⚠️ **KNOWN, ACCEPTED COLLISION — not solved here.** `zh` is now a three-way
 * colliding label: `thelife-zh` (uwota.com, Simplified), `everystudent-zh-cn`
 * (xinshengming.com, Simplified) and this source (Traditional) all declare
 * `["zh"]`. Language-filtered retrieval (`language: "zh"`) cannot separate
 * Traditional from Simplified, nor these three sources from each other — the
 * corpus has no script-level facet. Recorded as an observation for the estate;
 * the fix (a script sub-tag, or `script:hans` / `script:hant` tags) is an
 * estate-wide decision, deliberately not taken unilaterally in this entry.
 *
 * ⚠️ **Chinese is NOT a new language for this corpus** — `thelife-zh` and
 * `everystudent-zh-cn` already contribute `zh` documents, so existing `zh`
 * golden cases become eligible against this source's documents by construction.
 * Stage-4 Part A re-review is real work here.
 *
 * ⓘ **Extraction volume, for Phase 3 planning. CJK runs short by character
 * count — this is normal, not thin.** Measured over the 46 kept articles after
 * the full strip: **min 646, p25 994, median 1,204, mean 1,796, p75 1,748, max
 * 6,735 chars.** A Chinese character carries roughly the information of an
 * English word, so a 1,200-char article here is a full piece of prose, not a
 * stub. Two consequences worth knowing:
 *   - **0 of 46 fall below `minContentLength: 250`** — the floor drops nothing
 *     on this host, so it is kept at the sibling default.
 *   - **0 of 46 fall below ADR-0007's 500-char language-detection floor**, so
 *     unlike `everystudent-zh-cn` (which has pages that will store
 *     `language = null`), every document from this source should carry a `zh`
 *     label and remain eligible for language-filtered retrieval.
 *
 * `requestDelayMs: 1000` — the 70-URL HEAD sweep and a subsequent full-body
 * fetch of all 70 pages both ran at ~400–500 ms with zero throttling, zero
 * rate-limit headers and zero failures, so 1 s is comfortably polite for a
 * 46-page crawl of a small WordPress host.
 */
import type { SourceEntry } from "./types.js"

export const everystudentZhTw: SourceEntry = {
  key: "everystudent-zh-tw",
  name: "EveryStudent — Chinese Traditional (everystudent.com.tw)",
  // Bare host is canonical: www. 301s here (verified 2026-07-29).
  domain: "everystudent.com.tw",
  trust: "partner",
  ingestionMode: "html-scrape",
  // ISO 639-1, the code content detection emits. Traditional-vs-Simplified is
  // recorded in the key/name/docstring — see the colliding-label note above.
  languages: ["zh"],
  defaultTags: ["everystudent", "cru", "topic:seeker", "lang:zh"],
  defaultCategory: "article",
  rights:
    "© EveryStudent.com.tw (Cru) — partner ministry content; used for retrieval/attribution.",
  crawl: {
    // No `fetchStrategy`: verified unwalled 2026-07-29, so plain HTTP (default).
    baseUrl: "https://everystudent.com.tw",
    sitemaps: ["/sitemap.xml"],
    allow: ["^https://everystudent\\.com\\.tw/"],
    articleHints: [
      // Path SHAPE, not a section allow-list: discover.ts compiles these with
      // no `i` flag and the sitemap mixes casings for the same section
      // (/content/WhoIsHe/... beside /content/whoishe/...). Three segments
      // selects exactly the 46 articles. See header.
      "^https://everystudent\\.com\\.tw/content/[^/]+/[^/]+/?$",
    ],
    block: [
      // The localized 「你想親自認識神嗎？」 gospel tract + decision flow — this
      // banner's Gospel-of-John-signup / email-series analogue. 16 of its 17
      // URLs have no .entry-content and fall back to <body> at 195-3,238 ch,
      // clearing the 250 floor. Three URL shapes, three patterns; case-varied
      // classes because the regexes are case-sensitive. See header.
      "^https://everystudent\\.com\\.tw/content/[Kk]now[Hh]im[Pp]ersonally",
      "^https://everystudent\\.com\\.tw/[Kk]now[Hh]im[Pp]ersonally",
      "^https://everystudent\\.com\\.tw/content[Kk]now[Hh]im[Pp]ersonally",
      // Site chrome that clears 250 on the <body> fallback (880 / 368 / 2,573 ch).
      // /world-language-list/ is the 35+ sibling-language directory.
      "^https://everystudent\\.com\\.tw/content/[Cc]ontact[Uu]s/?$",
      "^https://everystudent\\.com\\.tw/(about-us|world-language-list)/?$",
      // WordPress tag archives: absent from today's sitemap, but the one
      // 3-segment shape that would satisfy articleHints if added. Returns 200.
      "^https://everystudent\\.com\\.tw/content/tag/",
      // Section indexes + homepage — articleHints already excludes these
      // (2 segments); defensive, and documents intent.
      "^https://everystudent\\.com\\.tw/content/[^/]+/?$",
      "^https://everystudent\\.com\\.tw/?$",
    ],
    // NOT the shared .content4 template, and NOT zh-cn's cb- theme — this host
    // is WordPress/Enfold. A SINGLE selector by design: extract.ts binds the
    // first matching ELEMENT and stops, so a chain only risks shadowing. See header.
    contentSelectors: [".entry-content"],
    stripSelectors: [
      "script",
      "style",
      // LOAD-BEARING here, not boilerplate: EWWW lazy-load emits
      // <noscript><img srcset="..."></noscript>, and node-html-parser treats
      // noscript content as RAW TEXT. Removes 70,746 ch across 43/46 articles.
      "noscript",
      "svg",
      "nav",
      "header",
      "footer",
      "form",
      // Site-specific chrome, each measured removing text on THIS host:
      ".av_promobox", // 「相關文章:」 related-links promo box — 1,466 ch / 23 pages
      ".relatedlink", // the same list unwrapped on /content/WhoIsHe/whichdenom/ — 1,370 ch / 24 pages
      ".heateor_sss_sharing_container", // 「分享這篇文章」 share widget — 368 ch / 46 of 46 pages
      ".bottomlink", // 「我有問題想問……」 CTA, this host's .fccell — 211 ch / 8 pages
      // NB: .heateorSssClear, .avia-post-nav and .av_toc_container were measured
      // removing 0 chars on 0 pages and are deliberately omitted.
    ],
    requestDelayMs: 1000, // 70-URL sweep at ~400ms saw zero throttling
    maxPages: 120, // 70 sitemap URLs (46 kept after filters) + headroom
    minContentLength: 250, // 0 of 46 articles fall below it; sibling default
  },
}
