/**
 * EveryStudent — Burmese (everymyanmarstudent.com). The Burmese banner of Cru's
 * seeker-facing Q&A ministry: short apologetics and life-issue articles, plus
 * first-person testimonies, written for Burmese-speaking students who are not
 * believers. A sibling of `everystudent` (en), `everystudent-sq`,
 * `everystudent-pl`, `everystudent-ru`, `everystudent-ko`.
 *
 * **A separate SOURCE KEY, not a language of `everystudent`** — one domain =
 * one source (ADR-0006). everymyanmarstudent.com is its own domain, so it gets
 * its own key, the same way `everystudent-fr` (questions2vie.com), `thelife-fr`
 * (laviejenparle.com) and `thelife-zh` (uwota.com) are separate entries.
 *
 * ## NOT walled — plain HTTP throughout
 *
 * Verified 2026-07-30: robots.txt, `/sitemap.xml`, **all 38 sitemap URLs**
 * (31 articles, 4 section indexes, contact, the HTML site map, the homepage),
 * plus 8 off-sitemap probes, were fetched with a plain `curl` carrying a full
 * desktop-Chrome UA. **Every one of the 38 returned HTTP/2 200 with real HTML
 * and no redirect.** Responses are bare `server: Apache` with no Cloudflare
 * layer at all — no block page, no challenge script. So `fetchStrategy` is
 * intentionally OMITTED: plain HTTP is the default and nothing here needs
 * Firecrawl (ADR-0012). Discovery is therefore free, making this a **discovery
 * crawl** rather than the hand-listed seed set the three walled banners
 * (everystudent.com, everyarabstudent.com, questions2vie.com) were forced into.
 * Precedent for the shape: `thelife-fr`, `everystudent-sq`, `everystudent-pl`.
 *
 * **Canonical host is `www.`, checked both ways.** Verified 2026-07-30: the bare
 * apex 301s to `https://www.everymyanmarstudent.com/`, and so does plain-HTTP
 * `www.` (an http→https upgrade). This is the usual direction, NOT the reverse
 * `everystudent.sk` takes — but it was measured rather than assumed, because
 * `domain`, `baseUrl` and every regex below are pinned to `www.` and the filters
 * match the full absolute URL. Every `<loc>` in the sitemap is `www.` too.
 *
 * ⓘ **This host serves UTF-8 with a bare `content-type: text/html` and NO
 * charset parameter** (measured on `/a/isthere.html`, 2026-07-30). The encoding
 * is declared only in-document, via
 * `<meta http-equiv="content-type" content="text/html; charset=utf-8">`. Any
 * fetch path that trusts the response header alone will mis-decode this source.
 *
 * ## ⚠️ Burmese encoding: UNICODE, not Zawgyi — measured at the codepoint level
 *
 * Burmese carries a hazard no charset check can catch: Zawgyi and Unicode both
 * live in the Myanmar block (U+1000–U+109F) but assign different meanings to the
 * same codepoints, so a Zawgyi page decodes as valid UTF-8 and still renders as
 * nonsense under Unicode. **This host is Unicode.** Three independent lines of
 * evidence, all taken 2026-07-30:
 *
 *   1. **No Zawgyi font is declared anywhere.** The string "zawgyi" (any case)
 *      appears **0 times across all 38 fetched pages** — no `Zawgyi-One` in the
 *      inline CSS, no `@font-face`. The one Myanmar font declared is
 *      `font-family:'Myanmar Sans Pro',arial,sans-serif`, a Unicode-compliant
 *      face.
 *   2. **The asat/virama ratio is decisively Unicode.** Over the extracted text
 *      of all 31 articles (365,063 Myanmar-block characters): **U+103A
 *      (MYANMAR SIGN ASAT) = 38,109** against **U+1039 (VIRAMA) = 1,101**, a
 *      ~35:1 split. Unicode uses U+103A for the very common "killed consonant"
 *      sign and reserves U+1039 for genuine stacked consonants; Zawgyi does the
 *      opposite, spelling that same sign as U+1039 and essentially never
 *      emitting U+103A. Zawgyi text would show this ratio inverted.
 *   3. **Zawgyi's telltale repurposed codepoints are entirely absent.**
 *      U+1033 = 0, U+1034 = 0, U+1064 = 0. Across the whole U+1060–U+1097 range
 *      — where Zawgyi keeps its variant medial and stacked forms — there is
 *      exactly **1 character in 365,063** (a stray U+108B). The Unicode medials
 *      are all present in the thousands instead: U+103B 6,601, U+103C 9,947,
 *      U+103D 5,291, U+103E 7,636.
 *
 * So the stored text is genuine, retrievable Unicode Burmese. No transcoding
 * step is needed, and none should be added.
 *
 * ## robots.txt — two Disallows, and one of them names an article
 *
 * Verified 2026-07-30: HTTP 200, **63 bytes**, Last-Modified 2017-04-05. The
 * whole file is:
 *
 *     User-agent: *
 *     Disallow: /a/followup.html
 *     Disallow: /m/intl.html
 *
 * The acquire path does not enforce robots.txt, so both are blocked BY HAND
 * below. `/a/followup.html` is the one that matters: it sits inside the `/a/`
 * article namespace and **matches `articleHints`**, returns 200, and extracts
 * **3,499 chars**, so neither the 250-char floor nor the hint regex would have
 * excluded it. It is absent from `/sitemap.xml` (so discovery cannot reach it
 * today) but is linked from the call-to-action of every article, which is
 * exactly how a later widening of the filters could quietly readmit it. The
 * block makes the rule enforced rather than merely lucky. `/m/intl.html` is the
 * sibling-language switcher; it is already covered by the `/m/` block, and is
 * named separately so the robots rule is legible in the config.
 *
 * ## Sitemap — 38 entries, all distinct, all `https`
 *
 * Verified 2026-07-30: `https://www.everymyanmarstudent.com/sitemap.xml` →
 * HTTP 200, **3,301 bytes**, `application/xml`, Last-Modified **2020-09-29**, a
 * single flat `<urlset>` (no `<sitemapindex>`, so no recursion), generated by
 * xml-sitemaps.com. `/sitemap_index.xml` **404s**, so there is no newer Yoast
 * index hiding behind the flat file — the `everystudent.sk` "2014 fossil" trap
 * was checked for and does not apply here. 38 `<loc>` elements, **38 distinct
 * URLs**, no duplicates. This matches the brief's recon of ~38 exactly: **delta
 * zero.**
 *
 * **Every `<loc>` uses the `https://` scheme** (38/38, grepped), unlike
 * `everystudent.gr`, so the `^https://` pin in `allow`/`articleHints` is correct
 * and discovers the full set. `discover.ts` filters the raw `<loc>` string
 * without normalising, so this had to be checked rather than assumed.
 *
 * The 38 break down as:
 *   - **31 `/a/<slug>.html`** — the article corpus. This is the keep set.
 *   - **4 `/m/<slug>.html`** — section indexes (`existence`, `life`, `knowing`,
 *     `about`). BLOCKED.
 *   - **`/contact.html`** and **`/sitemap.html`** — contact form and site plan.
 *     BLOCKED.
 *   - **`/`** — the homepage. BLOCKED.
 * So `articleHints` is exactly `/a/<slug>.html` and the **expected yield is 31
 * documents**.
 *
 * **All 38 are live.** A full sweep on 2026-07-30 returned **38 × HTTP 200 with
 * an empty redirect URL** — zero 301s, zero 302s. There is no dead-URL cohort of
 * the kind `everystudent-ro` shipped 25 of, and nothing redirects to the
 * homepage, so no dead-redirect blocks are needed. Reported as a measured
 * absence, not an omission.
 *
 * ## HTML-map cross-check — no delta, and the wider href sweep found one page
 *
 * These generated sitemaps are known to run stale, so the site's own HTML map
 * `/sitemap.html` ("ဆိုဒ်လမ်းပြ", "site guide") was fetched and diffed against
 * the XML. Verified 2026-07-30: it links **31 `/a/` URLs**, and the two sets are
 * **identical** — 0 in the HTML map that the XML lacks, 0 the other way. So
 * `seedPaths` is intentionally absent: there is nothing to pin.
 *
 * As a wider net, every internal `href` across all 38 fetched pages was
 * harvested — **54 distinct internal paths**. Exactly one `/a/` URL sits outside
 * the XML sitemap, and it is **`/a/followup.html`, the robots-disallowed page**
 * (above). The remaining off-sitemap paths were probed individually:
 *   - **`/m/relationships.html` — 200**, a fifth section index (321 chars).
 *     Covered by the `/m/` block.
 *   - **`/knowingGod.html` — 404** and **`/m/tentang.html` — 404**: dead links
 *     left in the template ("tentang" is Indonesian — a leftover from the
 *     sibling banner this site was cloned from).
 *   - **`/m/intl.html` — 200**, 17 chars, robots-disallowed.
 * Nothing else. No article exists that discovery would miss.
 *
 * ## No signup landing pages on this host, and no Scripture — both MEASURED
 *
 * The siblings' two standing blocks do not apply here, and that was checked
 * rather than silently skipped. Verified 2026-07-30:
 *   - **`/john.html`, `/pack.html` and `/adventure.html` all return HTTP 404.**
 *     This banner publishes no Gospel-of-John email study and no
 *     "adventure/pack" email series — the pages the French `/jean.html`,
 *     Albanian `/gjonit.html`, Polish `/jan.html` and Arabic `/pack.html` blocks
 *     exist for simply do not exist here. Nothing to block.
 *   - **No page carries full or abridged Scripture.** The largest article is
 *     `/a/whowas.html` at 33,557 chars ("ယေရှုဘယ်သူဖြစ်ခဲ့သလဲ?" — "Who was
 *     Jesus?"), nowhere near the 98k–100k Gospel-of-John pages the estate-wide
 *     2026-07-29 policy targets on `-sq`, `-et`, `-mn` and `-fa`. All 31
 *     articles were scanned for continuous numbered-verse runs: only two show
 *     any numbered line-starts at all (`/a/bible.html` 19, `/a/whypick.html` 7)
 *     and in both cases they are the article's own footnote list.
 *   - **`/a/bible.html` (29,319 chars) is an apologetics essay ABOUT the Bible,
 *     and is KEPT.** It is titled "သင်ဘာကြောင့်သမ္မာကျမ်းစာကိုယုံကြည်နိုင်သလဲ?"
 *     ("Why can you believe the Bible?") and runs a historical argument —
 *     "သမ္မာကျမ်းစာကို နှစ်ပေါင်း ၁၅ဝဝ အတောအတွင်းမှာ ကျမ်းရေးသူပေါင်း ၄ဝ ခန့်မှ
 *     ရေးသားခဲ့ကြတယ်" ("the Bible was written by some 40 authors across 1,500
 *     years"). Ministry writing, not scripture text: it discusses the Bible in
 *     the third person and cites it, rather than reproducing it. The Polish twin
 *     `/a/biblia.html` is the same article.
 *   - **No third-party Bible-society copyright anywhere.** All 31 articles were
 *     scanned for the misattribution hazard. The only publisher names that
 *     appear (Zondervan, Tyndale Press, Biblica) sit inside articles' own
 *     footnote lists ("အောက်ခြေမှတ်စုများ-") citing English-language books —
 *     Strobel's "The Case for Christ", Cloud & Townsend's "Boundaries". The only
 *     `©` marks are an author credit ("© ၁၉၉၇ ရစ်ချတ်ပရ်နယ်လ်" — Richard
 *     Purnell) and a photo credit ("© Worldwide Challenge"). Nothing the
 *     `rights` line below would misattribute.
 *
 * ## Extraction — measured on THIS host, not inherited
 *
 * Every candidate was run through the repo's own parser (`node-html-parser`,
 * exactly as `src/acquisition/extract.ts` uses it) over all 38 fetched pages on
 * 2026-07-30 — measured by EXTRACTED TEXT LENGTH, not grepped, because these
 * class names are also declared in each page's inline `<style>` block and a grep
 * false-positives on every one of them. Raw (pre-strip) figures:
 *
 *   - **`.contentpadding` — matches on 33/38 pages, and extracts 0 chars on NONE
 *     of them.** Range 452 – 33,712 chars; on the 31 articles, 2,911 – 33,712.
 *     This is the container, and it is shipped FIRST.
 *   - **`.content4` — matches on 36/38 pages and extracts 0 chars on 33 of
 *     them.** On the article set specifically it matches 30 of 31 and is **0
 *     chars on all 30**. (Its only non-zero matches are the three `/m/` indexes,
 *     761/878/1,129 chars — all blocked anyway.) Listing it first would bind an
 *     empty spacer div and skip 30 of 31 articles as `too-thin` on an HTTP 200:
 *     silent, and invisible to the unit tests. This is the batch-1 failure
 *     (#128) and the reason `.content4` is deliberately ABSENT below.
 *   - **`#content4` (the ID form) — 0 matches.** Absent from this host.
 *   - **`.content4b` — 1 match, 0 chars.**
 *   - **`.cb-entry-content`, `.entry-content`, `.contentleftpadding`,
 *     `.article-content`, `.content`, `article`, `main` — 0 matches each.**
 *   - **`.post-content` — 1 match (the homepage), 59 chars.**
 *   - **`.articletitle` — 34 matches, 11 – 79 chars.** A headline, not a body.
 *   - **`<body>` — matches on only 4 of 38 pages** (the homepage and three `/m/`
 *     indexes) and is **absent from all 31 articles**, so `extractContent`'s
 *     implicit `body ?? root` fallback would land on the document root here.
 *   - **`html` — 38/38, 20,099 – 53,047 chars.**
 *
 * **`"html"` is appended as the LAST entry, and it earns its place.** The
 * primary has **zero matched-but-empty pages**, so it can never be shadowed —
 * the fallback fires only where `.contentpadding` genuinely misses. It misses on
 * exactly one article: **`/a/prayers.html`**, whose markup collapses the div
 * stack. That page is a **genuine, substantial article**
 * ("ဘုရားသခင် ကျွန်တော်တို့ရဲ့ဆုတောင်းချက်တွေကို အဖြေပေးပါသလား?" — "Does God
 * answer our prayers?"), and the `html` fallback recovers it at **12,240 chars**
 * post-strip, opening on its title and closing on its own scripture-reference
 * footnote list. Without the fallback it would be lost; blocking it as "broken
 * markup" would have thrown away a real document, which is the mistake batch 3
 * nearly made three times. `"html"` is written explicitly rather than left to
 * the implicit `root` fallback because `<html>` is a real element and carries no
 * literal `<!DOCTYPE html>` text node.
 *
 * **Measured end to end over the 31 kept articles, selectors + strips applied:
 * 2,756 – 33,557 chars, median 12,240, and 0 pages below the 250 floor.**
 *
 * ## Chrome stripped — every figure counted on this host, zeros included
 *
 * Marginal characters, measured by re-running the full extraction with one
 * selector withheld:
 *
 *   - **`script` — 0 chars on the 32 `.contentpadding`-bound pages, but
 *     **+8,271 chars** on every `html`-bound page, including the kept
 *     `/a/prayers.html` (8 instances).** Load-bearing precisely BECAUSE of the
 *     `html` fallback: without it that article would carry 8k of FreeFind and
 *     analytics JavaScript.
 *   - **`head` — 0 chars on the `.contentpadding` pages, **+106 chars** on
 *     `/a/prayers.html`.** Also needed only on the fallback path, where it drops
 *     the duplicated `<title>`. Safe because `extract.ts` reads the title from
 *     `root` at line 43, BEFORE the strip loop at line 52 — a future edit that
 *     reorders those two steps would lose the title, so keep them in that order.
 *   - **`sitelevel_noindex`** is a custom ELEMENT tag, not a class:
 *     `<sitelevel_noindex> … </sitelevel_noindex>`. **Matches on 46/46 pages
 *     probed, 98 instances.** Removes **61 chars** on the `.contentpadding`
 *     pages (2 instances: the share row and the related-links block) and
 *     **817 chars** on `/a/prayers.html` (4 instances, because the `html`
 *     container also exposes the cookie bar and top nav). The missing leading
 *     `.` is correct, not a typo.
 *   - **`.fctable` (31 instances) + `.fccell` (146 instances)** — the "FEATURE
 *     CLOSE" call-to-action table appended to every article. **As a pair they
 *     remove 67 – 246 chars.** Each measures **0 marginal chars on its own**,
 *     because the cells nest inside the table and either selector alone already
 *     takes the text; both are listed so that stripping cells does not leave the
 *     table shell and vice versa. ⓘ Unlike `everystudent-sq`, `.fctable` DOES
 *     bind on this host.
 *   - **`.a2a_kit` — 75 instances across 45/46 pages, 0 chars.** The AddToAny
 *     share-button row; the buttons are images and `structuredText` does not
 *     read `alt`. Kept as a drift guard against text labels appearing later.
 *   - **`.shareiconsmenupg` — 44/46 pages, and a 0-char NO-OP on every KEPT
 *     page.** Measured in isolation it holds 25 chars, but this host's
 *     `sitelevel_noindex` is **well-formed and already contains it**, so once
 *     that is stripped first this selector has nothing left to match. It earns
 *     +27 chars only on the `/m/` indexes, which are blocked. It is NOT
 *     "required because the markup is malformed" — the markup is fine here.
 *     Kept purely as a guard against that wrapper drifting, as on
 *     `everystudent-pl`.
 *   - **`.hr2` (60 instances) and `.articledivider` (31)** — empty
 *     presentational divs drawing the rules that bracket the CTA block.
 *     **0 chars**, confirmed.
 *   - **`.relatedbottom` — 0 instances on this host, and therefore OMITTED**
 *     rather than carried as a parity no-op that can never bind.
 *   - `style` (91 instances), `form` (18 instances, +1 char on
 *     `/a/prayers.html`), and `noscript` / `svg` / `nav` / `header` / `footer`
 *     (**0 instances each** — this is a 2000s-era table layout with no HTML5
 *     landmark elements) are the shared base list, kept for consistency.
 *
 * ## ⚠️ minContentLength cannot catch a single non-article here
 *
 * Every page blocked below was fetched and extracted, and **every one clears the
 * 250-char floor**, so the `block` list is doing real work rather than
 * decorating. Verified 2026-07-30:
 *   - **`/` — 802 chars.** It does NOT extract to 0: `html` matches on the
 *     homepage as readily as anywhere, so it yields its full teaser list of
 *     headline + strapline pairs. Only a URL block excludes it.
 *   - **the 4 sitemap `/m/` indexes — 734 / 851 / 1,102 / 1,129 chars**
 *     (`existence`, `knowing`, `life`, `about`), plus the off-sitemap
 *     `/m/relationships.html` at 321. Headline+teaser link lists; navigation,
 *     not content.
 *   - **`/sitemap.html` — 1,201 chars.** The site plan, a pure link list. The
 *     Burmese twin of the French `/plan.html` and the Polish `/mapa.html`.
 *   - **`/contact.html` — 364 chars.** The contact form. Note it clears 250,
 *     unlike the Russian sibling's 85-char `/vopros.html`.
 *   - **`/a/followup.html` — 3,499 chars**, and it matches `articleHints`. See
 *     robots.txt above.
 *
 * ⓘ The host's 404 page returns a real HTTP 404 (checked on five paths), so the
 * fetcher skips it — but note that it would extract ~298 chars ("ဝမ်းနည်းပါတယ်",
 * "sorry") and thus clear the floor if any code path ever ignored the status.
 *
 * ## Language: `["my"]` — read, not inferred
 *
 * Verified 2026-07-30 by reading the extracted text myself. The pages serve
 * genuine Burmese prose, not untranslated English. `/a/isthere.html` opens
 * "ဘုရားရှိသလား?" ("Is there a God?") and continues
 * "ဘုရား အမှန်တကယ်ရှိတယ်ဆိုတာယုံကြည်ဖို့ ရှင်းလင်းတိကျသော အကြောင်းပြချက်များ
 * (၆)ချက် ပြောပြပါမယ်။" — "let me give six clear reasons to believe God really
 * exists" — under the Burmese byline "မေရီလင်းအာဒမ်ဆင်ထံမှ" ("from Marilyn
 * Adamson", EveryStudent's own author). `/a/prayers.html` narrates
 * "ကျမ ဘုရားမဲ့ဝါဒီ ဖြစ်တုန်းက မကြာခဏ ဆုတောင်းတတ်တဲ့သူငယ်ချင်းကောင်းတစ်ယောက်
 * ရှိခဲ့ပါတယ်" ("when I was an atheist, I had a good friend who prayed often").
 * Numerals are Burmese throughout (၆ = 6, ၁၅ဝဝ = 1500), and scripture citations
 * use Burmese book names — ရှင်ယောဟန် (John), ဆာလံ (Psalms), ရောမ (Romans),
 * ယေရမိ (Jeremiah), ဟေရှာယ (Isaiah), ဖိလိပ္ပိ (Philippians).
 *
 * The clearest proof it is real translation work rather than a machine
 * pass-through is a translator's note at the end of `/a/prayers.html`:
 * "ဘာသာပြန်ဆိုသူ၏မှတ်ချက်- the Golden Gate Bridge ကို မြန်မာဒေသံအရ
 * 'စစ်ကိုင်းတံတား' ဟု အမည်ပြောင်းထားခြင်းသာ ဖြစ်သည်။" — the translator explains
 * that the Golden Gate Bridge was renamed to the Sagaing Bridge to suit a
 * Myanmar readership.
 *
 * The only English on these pages is bibliographic — footnotes citing
 * English-language books — which is normal citation apparatus in a translated
 * article, not an untranslated body. No page showed the cru.org `/mx/es/` failure
 * mode of a localized URL serving an English body.
 *
 * ⓘ The site declares `<html lang="my">`, which agrees with what was read — but
 * the reading is the evidence, not the attribute. `persoalanhidup.com` declares
 * `lang="id"` and serves Malay. The stored per-document language label still
 * comes from content detection at ingest (invariant 6), never from this field.
 *
 * ## Slugs are pure ASCII — checked, not assumed
 *
 * Burmese script in URLs would have broken an ASCII-only hint, so all 38 `<loc>`
 * values were byte-scanned on 2026-07-30: **zero non-ASCII bytes and zero `%XX`
 * percent-encodings**. The site transliterates its slugs to English
 * (`/a/isthere.html`, `/a/whocreated.html`). One slug carries an **uppercase**
 * letter — **`/a/Godreal.html`** — so the hint must not be lowercase-only: a
 * `[a-z0-9-]+` class was simulated against the live sitemap and keeps 30 of 31
 * articles, silently dropping that one. `[^/]+` keeps all 31.
 *
 * `requestDelayMs: 1000` — we pay this host's bandwidth directly rather than
 * proxying through Firecrawl, so the politeness is real. ~50 sequential
 * plain-HTTP requests drew **zero 429s** and no throttling, and at 31 pages the
 * whole crawl is well under a minute of wall clock, so the sibling default is
 * kept rather than raised.
 *
 * **Expected yield: 31 documents.**
 */
import type { SourceEntry } from "./types.js"

export const everystudentMy: SourceEntry = {
  key: "everystudent-my",
  name: "EveryStudent — Burmese (EveryMyanmarStudent.com)",
  domain: "www.everymyanmarstudent.com",
  trust: "partner",
  ingestionMode: "html-scrape",
  languages: ["my"],
  defaultTags: ["everystudent", "cru", "topic:seeker", "lang:my"],
  defaultCategory: "article",
  rights:
    "© EveryMyanmarStudent.com (Cru) — partner ministry content; used for retrieval/attribution.",
  crawl: {
    baseUrl: "https://www.everymyanmarstudent.com",
    // No `fetchStrategy`: verified 2026-07-30 that plain HTTP serves every page
    // on this host (bare Apache, no Cloudflare). See header.
    sitemaps: ["/sitemap.xml"],
    // Every <loc> is https (38/38, grepped) — discover.ts filters the raw <loc>
    // string without normalising, so the scheme had to be checked.
    allow: ["^https://www\\.everymyanmarstudent\\.com/"],
    // The whole article corpus: 31 of the 38 sitemap URLs. `[^/]+` rather than
    // a lowercase class — /a/Godreal.html carries an uppercase G, and a
    // [a-z0-9-]+ hint was simulated and drops it. Slugs are transliterated
    // ASCII: zero Myanmar-script bytes and zero %XX escapes across all 38 <loc>.
    articleHints: ["^https://www\\.everymyanmarstudent\\.com/a/[^/]+\\.html$"],
    block: [
      // The estate's "Who was Jesus?" page (33,557 chars) — curated highlights
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
      "^https://www\\.everymyanmarstudent\\.com/a/whowas\\.html$",
      // ── robots.txt, fetched live 2026-07-30 (63 bytes, two Disallow lines).
      // The acquire path does NOT enforce robots.txt, so both are honoured here
      // by hand. /a/followup.html is the one that matters: it sits under /a/ and
      // MATCHES articleHints, returns 200 and extracts 3,499 chars, so neither
      // the hints nor the 250 floor would exclude it. Absent from the sitemap
      // today but linked from every article's CTA cell.
      "^https://www\\.everymyanmarstudent\\.com/a/followup\\.html$",
      // The second Disallow — the sibling-language switcher. Covered by the /m/
      // rule below; named separately so the robots rule stays legible.
      "^https://www\\.everymyanmarstudent\\.com/m/intl\\.html$",
      // ── Below here articleHints already excludes them; these record WHY.
      // The 4 sitemap section indexes (existence, life, knowing, about) plus the
      // off-sitemap /m/relationships.html — headline+teaser link lists at
      // 321-1,129 chars, all clear of the 250 floor.
      "^https://www\\.everymyanmarstudent\\.com/m/",
      // The site plan (1,201 ch of pure link list) and the contact form (364 ch,
      // so unlike the Russian /vopros.html at 85 ch this one CLEARS the floor).
      "^https://www\\.everymyanmarstudent\\.com/(sitemap|contact)\\.html$",
      // The homepage. It does NOT extract to 0 — `html` matches on it too, so it
      // yields its 802-char teaser list. Only a URL block excludes it.
      "^https://www\\.everymyanmarstudent\\.com/?$",
      // ⓘ No scripture block and no email-signup block: measured 2026-07-30 that
      // /john.html, /pack.html and /adventure.html all 404, and that no page
      // carries Bible text (largest article 33,557 ch; /a/bible.html is an essay
      // ABOUT the Bible and is kept). Absences measured, not omitted.
    ],
    // `.contentpadding` FIRST — measured 2026-07-30 with the repo's own
    // extractContent over all 38 pages: it matches on 33 and extracts 0 chars on
    // NONE of them (452-33,712 raw). `.content4` is deliberately ABSENT: it
    // matches 30 of the 31 articles and yields 0 chars on all 30, and because
    // extractContent binds the FIRST selector that MATCHES rather than the first
    // that yields text, listing it would shadow this one and skip 30 articles as
    // `too-thin` on an HTTP 200. `#content4`, `.content4b`, `.entry-content`,
    // `.article-content`, `.content`, `article` and `main` do not bind here.
    // `html` LAST as a real fallback: it cannot shadow anything, and it recovers
    // /a/prayers.html — a genuine 12,240-char article whose div stack collapses
    // so `.contentpadding` never forms. <body> is absent from all 31 articles,
    // so without this the fallback would be the whole document root.
    contentSelectors: [".contentpadding", "html"],
    stripSelectors: [
      "script", // 0 ch on .contentpadding pages, +8,271 ch on the html-bound /a/prayers.html
      "style",
      "noscript",
      "svg",
      "nav",
      "header",
      "footer",
      "form",
      // Needed only on the `html` fallback path: drops the duplicated <title>.
      // extract.ts reads the title from `root` BEFORE stripping — keep that order.
      "head",
      // Site-specific chrome, all counted on this host 2026-07-30 (see header):
      "sitelevel_noindex", // custom ELEMENT tag, 46/46 pages: 61 ch normally, 817 ch on /a/prayers.html
      ".fctable", // the "FEATURE CLOSE" CTA table — with .fccell the pair removes 67-246 ch
      ".fccell", // its cells; each alone measures 0 marginal because they cover the same text
      ".a2a_kit", // AddToAny share row — 75 instances, 0 ch (image-only buttons); drift guard
      ".shareiconsmenupg", // 0-ch NO-OP on every kept page: sitelevel_noindex is well-formed
      // here and already contains it. Kept only as a guard against that drifting.
      ".hr2", // empty divs drawing the rules bracketing the CTA block — 0 ch
      ".articledivider", // 0 ch
      // `.relatedbottom` is deliberately OMITTED: 0 instances measured on this host.
    ],
    requestDelayMs: 1000, // direct fetches, no Firecrawl proxy; 0 × 429 observed
    maxPages: 60, // 38 sitemap URLs (31 kept after filtering) + headroom
    minContentLength: 250,
  },
}
