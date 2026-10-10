/**
 * EveryStudent — Lithuanian (kiekvienamstudentui.lt, "KiekvienamStudentui.lt" /
 * "For Every Student"). The Lithuanian banner of Cru's seeker-facing Q&A
 * ministry: short apologetics and life-issue articles, FAQ answers and
 * first-person testimonies written for Lithuanian-speaking students who are not
 * believers. Published locally by VO „Agapė" (Cru Lithuania) — named on
 * /m/privatumo.html with a Vilnius postal address and company code 191927071.
 * A sibling of `everystudent` (en), `everystudent-pl`, `everystudent-sq`,
 * `everystudent-et` and the rest of the estate.
 *
 * **A separate SOURCE KEY, not a language of `everystudent`** — one domain =
 * one source (ADR-0006). kiekvienamstudentui.lt is its own domain, so it gets
 * its own key, the same way `everystudent-pl` (kazdystudent.pl),
 * `everystudent-fr` (questions2vie.com), `thelife-fr` (laviejenparle.com) and
 * `thelife-zh` (uwota.com) are separate entries.
 *
 * ## NOT walled — plain HTTP throughout
 *
 * Verified 2026-07-29: robots.txt, /sitemap.xml, **all 60 sitemap URLs** (48
 * articles, 10 `/m/` pages, /kontaktai.html, the homepage), the site's two HTML
 * map pages and 7 probe URLs were fetched with plain `curl` carrying a desktop
 * Chrome UA. **All 60 sitemap URLs returned HTTP/2 200 with real HTML and zero
 * redirects.** Responses are `server: Apache` with no Cloudflare layer and no
 * block page anywhere. So `fetchStrategy` is intentionally OMITTED: plain HTTP
 * is the default and nothing here needs Firecrawl (ADR-0012).
 *
 * Discovery is therefore free, making this a **discovery crawl** rather than the
 * hand-listed seed set the three walled banners were forced into. Precedent for
 * the shape: `thelife-fr`, `everystudent-pl`, `everystudent-sq`.
 *
 * The apex host **301-redirects to `www`** (measured on /robots.txt), and every
 * sitemap `<loc>` is an absolute `www` URL, so `domain`, `baseUrl` and all
 * filters below are pinned to `www.` — the regexes match the full absolute URL.
 *
 * ## robots.txt — one Disallow, and it names an /a/ article path
 *
 * Verified 2026-07-29: HTTP 200, **43 bytes**. The whole file, byte for byte, is
 * `User-agent: *` + a lone CR + `Disallow: /a/rysysfollow.html` — the two
 * directives are separated by a bare `\r` with no `\n`, which most parsers still
 * read as a line break, so the rule stands.
 *
 * That rule **points into the `/a/` article namespace** and therefore had to be
 * honoured by hand: the acquire path does not enforce robots.txt, so
 * `/a/rysysfollow.html` is blocked by URL below. It is absent from /sitemap.xml,
 * so discovery would not reach it today, but it **matches `articleHints`** and is
 * linked from the "FEATURE CLOSE" call-to-action of **13 articles** (the
 * "Aš ką tik patikėjau savo gyvenimą Jėzui…" — "I have just entrusted my life to
 * Jesus…" — post-decision follow-up, the Lithuanian counterpart of the Polish
 * `/a/nowezycie.html`). ⓘ It was **deliberately never fetched**: robots forbids
 * it, so there is no measured character count for it here and none is needed —
 * the rule alone is the reason. Nothing else on this domain is disallowed.
 *
 * ## Sitemap — 60 entries, all distinct, 48 articles
 *
 * Verified 2026-07-29: `https://www.kiekvienamstudentui.lt/sitemap.xml` → HTTP
 * 200, **9,780 bytes**, `content-type: application/xml`, Last-Modified
 * 2020-03-17, a single flat `<urlset>` (no `<sitemapindex>`, so no recursion).
 * It holds 60 `<loc>` elements and **60 distinct URLs** — no duplicates. This
 * matches the "~60" from prior recon exactly. They break down as:
 *   - **48 `/a/<slug>.html`** — the article corpus. This is the keep set.
 *   - **10 `/m/<slug>.html`** — `egzistavimas`, `gyvenimo`, `santykiai`,
 *     `pazinimas`, `forumas`, `intl`, `sitemap`, `tinklalapi`, `privatumo`,
 *     `istorija`. BLOCKED, below.
 *   - **`/kontaktai.html`** — the "ask a question" contact page. BLOCKED.
 *   - **`/`** — the homepage. BLOCKED.
 *
 * **No dead URLs.** All 60 were fetched individually without `-L`: **60 × 200,
 * 0 × 301/302**. There is no redirect-to-homepage cohort of the kind
 * `everystudent-ro` shipped 25 of, and no `.php` extension twins.
 *
 * ⚠️ **Slugs are pure lowercase ASCII — checked, not assumed.** All 60 `<loc>`
 * values were scanned for non-ASCII bytes, for `%XX` percent-encoding and for
 * uppercase letters: **zero hits on all three**. The site de-diacriticises its
 * own slugs (`/a/tustuma.html` for "tuštuma", `/a/vargsams.html` for
 * "vargšams", `/a/siaubingiems.html` for "siaubingiems"). `[^/]+` is used in
 * `articleHints` anyway, so the mixed-case hazard that exists on `-pl` and `-es`
 * cannot bite here if the site ever adds one.
 *
 * ## Cross-checked against the site's own HTML maps — XML is the superset
 *
 * These sitemaps are known to be stale elsewhere in the estate, so both HTML map
 * pages were fetched and diffed. Verified 2026-07-29:
 *   - **`/m/sitemap.html`** ("Svetainės žemėlapis") links **47 `/a/` URLs, all
 *     of them already in the XML sitemap.** The delta runs the other way: the
 *     XML has one article the HTML map omits, `/a/kritikus2.html` (17,924 ch,
 *     live, genuine) — so discovery already covers more, not less.
 *   - **`/m/tinklalapi.html`** ("Apie tinklalapį") links no `/a/` URLs at all.
 * As a wider net, every `href` on all 60 fetched pages was harvested and
 * resolved against its own page URL. The union adds exactly **four** internal
 * `.html` URLs the sitemap lacks, and **not one of them is a missing article**:
 *   - `/a/rysysfollow.html` — robots-disallowed; blocked below.
 *   - `/a/exista.html` — **HTTP 404** (a broken link on `/a/gamtos.html` and
 *     `/a/tikras.html`). acquire.ts skips `status >= 400` as `fetch-failed`.
 *   - `/m/rysys.html` — **301 → `/a/rysys.html`**, an article already in the
 *     sitemap; covered by the `/m/` block either way.
 *   - `/tikejimas.html` — **HTTP 404** (a broken root-relative link on
 *     `/a/egzistuoja.html`; the real page is `/a/tikejimas.html`).
 * So **no article is missing from discovery** and `seedPaths` is intentionally
 * absent: there is nothing to pin.
 *
 * ## Extraction — `["html"]`, measured on THIS host over all 48 articles
 *
 * Every candidate below was run through the repo's own parser
 * (`node-html-parser`, exactly as `src/acquisition/extract.ts` uses it) over all
 * 48 article pages on 2026-07-29 — **not grepped**, because every one of these
 * class names is also declared in the page's inline `<style>` block and a grep
 * false-positives on all of them. Raw (pre-strip) figures:
 *
 *   - **`.contentpadding` — matches on 46/48, extracts 2,196–20,475 ch (median
 *     7,868). Zero-char on 0 of them.** The real article container, and the
 *     obvious choice — but it MISSES two articles entirely (see below).
 *   - **`.content4` — matches on 46/48 and extracts 0 characters on every one of
 *     those 46.** An empty float-left spacer div. Listing it ahead of anything
 *     else would bind the spacer and skip every article as `too-thin` on an HTTP
 *     200 — the batch-1 failure (#128). ⓘ On the five `/m/` section indexes the
 *     same class is NOT empty (628–1,103 ch), which is exactly why a grep or a
 *     one-page spot-check is not evidence.
 *   - **`.content4b` — matches on only 2/48 and extracts 0 chars on both.**
 *     Present precisely on the two pages `.contentpadding` misses, so it is a
 *     trap, not a fallback.
 *   - **`.contentleftpadding` — 0 matches.** Checked because the Baltic
 *     neighbour `everystudent-et` (tudengielu.net) runs on that older hand-rolled
 *     layout. This host is NOT on it; it is on the standard 2019 template.
 *   - **`.cb-entry-content`, `.entry-content`, `.article-content`, `.content`,
 *     `<article>`, `<main>` — 0 matches each.** Absent from this host.
 *   - **`.articletitle` — 48/48, 3–73 ch.** An `<h1>`, not a body.
 *   - **`<body>` — 0 matches on all 48 articles.** This host emits no `<body>`
 *     the parser recognises on article pages, so `extractContent`'s fallback is
 *     the document ROOT, whose doctype node leaks the literal string
 *     `<!DOCTYPE html>` into the extracted text (measured: 26,480 vs 26,463 ch).
 *   - **`<html>` — 48/48, 13,751–38,206 ch raw.**
 *
 * ⚠️ `contentSelectors` is **NOT a fallback chain**. `extractContent` scopes to
 * the FIRST selector that MATCHES AN ELEMENT, not the first that yields text, so
 * `[".contentpadding", ".content4b"]` would bind the empty `.content4b` on the
 * two broken pages and hand back "" — a silent `too-thin` skip. Exactly one
 * selector is shipped.
 *
 * **Why `["html"]` and not `[".contentpadding"]` — the decision, measured.**
 * Both were run end-to-end with the strip list below over all 48 articles:
 *   - On the **46 well-formed** articles the two produce **byte-identical
 *     output** — delta 0 on every single page, min = median = max = 0. All the
 *     chrome that sits outside `.contentpadding` (692 ch/page) lives inside
 *     `sitelevel_noindex`, which is stripped anyway.
 *   - On the **2 malformed** articles `.contentpadding` does not match at all,
 *     so it falls through to the document root and prefixes the article with
 *     `<!DOCTYPE html>`; `["html"]` yields the same article text **without** that
 *     artefact (`/a/biblija.html` 26,463 vs 26,480 ch, `/a/rysys.html` 3,471 vs
 *     3,488 ch).
 * So `["html"]` is identical where `.contentpadding` works and strictly cleaner
 * where it does not — and, unlike the Polish sibling's `/a/biblia.html`, it
 * means **no genuine article has to be blocked for a markup bug**. Same call and
 * same reasoning as `everystudent-sq` and `everystudent-ko`.
 *
 * ⚠️ The price of `["html"]` is that the strip list, not the DOM, is what keeps
 * nav out: with only the generic strips (`script`/`style`/`nav`/`header`/…) the
 * chrome leak is **900–992 ch/page**. Do not thin the strip list below.
 *
 * ⓘ **Root cause of the two malformed pages** (recorded so a source-side fix can
 * be requested, and so a future reader does not re-derive it):
 *   - `/a/biblija.html` line 165 closes an `<h2 class="subhead">` with a
 *     **`</h1>`**. node-html-parser pops the open-element stack on that stray
 *     close, collapsing `contentpadding` → `content4b` → `content4` →
 *     `container2` in one go; the article ends up as flat direct children of
 *     `<html>`.
 *   - `/a/rysys.html` line 180 opens `<p><span style="line-height: 200%;">` and
 *     never closes the `<span>` (29 `<span>` openers vs 28 closers), with the
 *     same collapsing effect.
 * Both are genuine, substantial articles — "Kodėl tu gali tikėti Biblija?"
 * ("Why can you believe the Bible?") and "Pažinti Dievą asmeniškai" ("Knowing
 * God personally") — and both are KEPT because `["html"]` reads them correctly.
 *
 * **Measured with `["html"]` plus the strip list, across all 48 articles:
 * 1,988 – 26,463 ch, median 7,660, and 0 pages below the 250 floor.** Every
 * document opens on its section kicker + title ("Dievo pažinimas / Kaip melstis?
 * Kas yra malda?") and closes on the article's own last line, usually its
 * numbered scripture-footnote list ("(16) Psalmės 62: 8").
 *
 * ## Chrome stripped — every selector counted on this host, 2026-07-29
 *
 * Two figures are given per selector: what it removes **on its own** (added to
 * the generic strips alone) and what it removes **marginally, in the shipped
 * list order**. They differ where one selector already contains another.
 *
 *   - **`head` — 1 instance, 23–100 ch.** Needed **only because the container is
 *     `<html>`**: without it every document opens with a duplicate of its own
 *     `<title>`. Safe because `extract.ts` reads the title from `root` BEFORE
 *     the strip loop runs — a future edit that reorders those two steps loses
 *     the title, so keep them in that order.
 *   - **`sitelevel_noindex` — a custom ELEMENT tag, not a class. 4 instances on
 *     48/48 pages, 841 ch alone / 765 ch marginal.** The single largest
 *     contributor. It carries the cookie bar + top nav (387 ch, "Ši svetainė
 *     naudoja slapukus tik analizei…"), the share heading (25 ch), the
 *     related-links strip (130 ch, "Užduokite klausimą! / Pakeisti gyvenimai…")
 *     and the whole footer (333 ch, ending "© KiekvienamStudentui.lt"). Hence the
 *     bare tag name with no leading `.` — the siblings' form is correct.
 *   - **`.fctable` — 95 instances across 48 pages, 49–200 ch alone and STILL
 *     59–151 ch marginal on 47/48 pages.** The "FEATURE CLOSE" call-to-action
 *     table appended to every article ("► Kaip galite bendrauti su Dievu… ► Aš
 *     turiu klausimą…"). It sits OUTSIDE `sitelevel_noindex` on this host, so
 *     this selector is doing real work, not parity.
 *   - **`.fccell` — 216 instances, 59–151 ch alone but 0 ch marginal on 47/48**
 *     (the cells nest inside the table already removed). It is **not** a pure
 *     no-op: on the malformed `/a/rysys.html` the table shell is popped away by
 *     the parser and `.fccell` is the only thing that catches the CTA there,
 *     worth 69 ch. Both are listed; stripping only one is not equivalent.
 *   - **`.shareiconsmenupg` — 48 instances, 27 ch alone ("DALINTIS ŠIUO
 *     STRAIPSNIU:" — "SHARE THIS ARTICLE:"), 0 ch marginal.** ⓘ On THIS host the
 *     enclosing `<sitelevel_noindex>` is **well-formed and already contains it**,
 *     so in list order it matches nothing — a genuine 0-char no-op, kept as a
 *     cheap drift guard. This is the batch-2 finding, not the older `-de`/`-ru`
 *     "REQUIRED because the markup is malformed" claim, which was NOT measured
 *     here and is not asserted.
 *   - **`.a2a_kit` — 96 instances on 48/48, 0 ch.** The AddToAny share-button
 *     row; the buttons are images and `structuredText` does not read `alt`.
 *     Stripped so a future markup change adding text labels cannot leak them.
 *   - **`.hr2` (100 instances) and `.articledivider` (48)** — bind on 48/48 but
 *     are empty presentational divs drawing the rules bracketing the CTA.
 *     **0 ch.** Kept so they cannot start contributing unnoticed.
 *   - **`.relatedbottom` — 0 instances**, absent from this host, **0 ch**.
 *     Retained only as a parity no-op with the sibling entries; do not read its
 *     presence here as evidence it binds anywhere.
 * After the full list, articles were re-scanned for leftovers: no "DALINTIS", no
 * "Užduokite klausimą", no "►", no "slapuk", no "©" survives.
 *
 * ## ⚠️ minContentLength cannot catch the non-articles
 *
 * Every blocked page was fetched and extracted with the shipped config, and all
 * but one **clear the 250-char floor** — so the floor is not what excludes them.
 * Verified 2026-07-29:
 *   - **`/` — 748 ch.** The homepage teaser list ("Koks mano gyvenimo tikslas?
 *     …"). It does NOT extract to 0: `html` matches on it as readily as on an
 *     article. Only a URL block excludes it.
 *   - **`/kontaktai.html` — 538 ch.** "Klausk" — the email contact page.
 *   - **the 5 section indexes** `/m/egzistavimas|gyvenimo|santykiai|pazinimas|
 *     forumas` — **617–1,092 ch** of headline+teaser link lists.
 *   - **`/m/privatumo.html` — 22,954 ch.** The VO „Agapė" GDPR privacy policy.
 *     23k characters of boilerplate is the clearest possible demonstration that
 *     length is not aboutness.
 *   - **`/m/sitemap.html` — 1,745 ch** (site plan) and **`/m/tinklalapi.html` —
 *     1,137 ch** (about page). The Lithuanian twins of the French `/plan.html`.
 *   - **`/m/intl.html` — 12 ch** ("Kitos kalbos"), the page linking out to the
 *     sibling language domains. The only blocked page the floor would also have
 *     caught; blocked anyway so it does not depend on that.
 *
 * ⓘ **`/m/istorija.html` is the one block a reviewer might reasonably reverse.**
 * Unlike the other nine `/m/` pages it is not navigation: it is **20,148 ch of
 * genuine first-person testimony** — "Pakeisti gyvenimai" ("Changed lives"),
 * twelve stories ("Martos istorija", "Motinos rankose", "Tėvo meilės laiškas
 * man") that appear nowhere else on this host as `/a/` articles. It is blocked
 * for estate consistency (the whole `/m/` namespace is nav on every sibling) and
 * because twelve unrelated testimonies concatenated into one document chunk
 * across story boundaries. Un-blocking costs one line: narrow the `/m/` block to
 * exclude it and add `^…/m/istorija\.html$` to `articleHints`. Flagged rather
 * than decided unilaterally.
 *
 * ## Scripture policy — nothing to block on this host
 *
 * Checked explicitly against the estate-wide rule set 2026-07-29 (`-es`
 * `/articulos/biblia_juan.html`, `-sq` `/a/gjoni.html`, `-et`'s © Eesti
 * Piibliselts chapters): **this host serves no complete Bible book.** All 48
 * articles were extracted and reviewed by length and opening lines; the longest,
 * `/a/biblija.html` at 26,463 ch, is titled "Kodėl tu gali tikėti Biblija?" and
 * is an **apologetics article ABOUT the Bible** (Tacitus, Josephus, archaeology,
 * manuscript transmission, 15 numbered footnotes), not the Bible. Scripture on
 * this host appears only as inline quotations inside articles, with Lithuanian
 * book names ("Evangelija pagal Joną 3,16", "Jeremijo knyga 29,11", "Apreiškimo
 * knyga 3,20"). All 60 pages were also scanned for a Bible-society or publisher
 * credit of the kind that made `-et`'s chapters a third-party rights problem:
 * **no such credit exists**, so the `rights` line below misattributes nothing.
 *
 * Likewise there is **no Gospel-of-John email course and no "adventure/pack"
 * email series** to block. The twins of `/john`·`/jean`·`/juan` and
 * `/aventure`·`/aventura`·`/pack` were hunted for and do not exist here:
 * `/jonas.html`, `/jono.html`, `/nuotykis.html` and `/kursas.html` all return
 * **404**, no sitemap URL matches, no `<form>` on any page posts to a signup
 * (all three forms per page post to `sitelevel.com/query`, the site search), and
 * the only signup-shaped destination in the CTA is `/a/rysysfollow.html` — which
 * robots.txt already excludes. Nothing was invented to fill the slot.
 *
 * ## Language: `["lt"]` — read, not inferred
 *
 * Verified 2026-07-29 by reading the extracted text myself. The pages serve
 * genuine Lithuanian prose, not untranslated English. `/a/malda.html` is "Kaip
 * melstis? Kas yra malda?" ("How to pray? What is prayer?"); `/a/biblija.html`
 * asks "Ar gali protingas žmogus tikėti Biblija?" and answers "Taip. Biblija
 * nėra prasimanytų istorijų knyga" ("Yes. The Bible is not a book of invented
 * stories"); `/a/rysys.html` opens on Augustine in Lithuanian — „Padarei mus,
 * lemdamas linkti Tavęs link, ir nerami yra mūsų širdis, kol pailsės Tavyje";
 * `/m/istorija.html` narrates "Pamenu, tai buvo graži saulėta diena…" ("I
 * remember, it was a beautiful sunny day…"). Section headings are native
 * throughout: "Dievo egzistavimas", "Klausimai apie gyvenimą", "Santykiai",
 * "Dievo pažinimas", "DUK".
 *
 * Quantified across all 48 extracted articles: Lithuanian-specific letters
 * (ą č ę ė į š ų ū ž) appear at **44–67 per 1,000 characters on every single
 * page** — no page is an English body wearing a Lithuanian URL, which is the
 * cru.org `/mx/es/` failure mode. The most English-looking page
 * (`/a/kritikus2.html`) carries 12 English stopwords in 17,716 characters, all
 * of them inside bibliographic footnotes citing English books ("The New Evidence
 * That Demands a Verdict", "Baker Encyclopedia of Christian Apologetics") —
 * normal citation apparatus in a translated article. No language-detection
 * library was used or consulted.
 *
 * The stored per-document language label still comes from content detection at
 * ingest (invariant 6), never from this field.
 *
 * `requestDelayMs: 1000` — we pay this host's bandwidth directly rather than
 * proxying through Firecrawl, so the politeness is real. ~80 sequential
 * plain-HTTP requests drew **zero 429s** and no throttling, and at 48 pages the
 * whole crawl is under a minute of wall clock, so the sibling default is kept
 * rather than raised.
 *
 * **Expected yield: 48 documents** — the whole `/a/` corpus, nothing dropped.
 */
import type { SourceEntry } from "./types.js"

export const everystudentLt: SourceEntry = {
  key: "everystudent-lt",
  name: "EveryStudent — Lithuanian (KiekvienamStudentui.lt)",
  domain: "www.kiekvienamstudentui.lt",
  trust: "partner",
  ingestionMode: "html-scrape",
  languages: ["lt"],
  defaultTags: ["everystudent", "cru", "topic:seeker", "lang:lt"],
  defaultCategory: "article",
  rights:
    "© KiekvienamStudentui.lt (Cru) — partner ministry content; used for retrieval/attribution.",
  crawl: {
    baseUrl: "https://www.kiekvienamstudentui.lt",
    // No `fetchStrategy`: verified 2026-07-29 that plain HTTP serves every page
    // on this host (bare Apache, no Cloudflare). See header.
    sitemaps: ["/sitemap.xml"],
    allow: ["^https://www\\.kiekvienamstudentui\\.lt/"],
    // The whole article corpus and nothing else: 48 of the 60 sitemap URLs.
    // `[^/]+` rather than a lowercase class — slugs here are pure lowercase
    // ASCII today (verified: zero non-ASCII bytes, zero %XX escapes, zero
    // uppercase across all 60 <loc> values), and this keeps that from becoming
    // load-bearing if the site ever adds a mixed-case or diacritic slug.
    articleHints: [
      "^https://www\\.kiekvienamstudentui\\.lt/a/[^/]+\\.html$",
      // The one /m/ page that is content, not nav — 20,148 ch of testimony.
      // Orchestrator call, 2026-07-29; see the note on the /m/ block below.
      "^https://www\\.kiekvienamstudentui\\.lt/m/istorija\\.html$",
    ],
    block: [
      // robots.txt Disallow, fetched live 2026-07-29 — the ONE rule on this
      // host, and it names an /a/ path. The acquire path does not enforce
      // robots.txt, so this line IS the enforcement. The page matches
      // articleHints and is linked from 13 articles' CTA cells, but is absent
      // from the sitemap; blocked so neither a hand-added seed nor a regenerated
      // sitemap can admit it. Deliberately never fetched, so no char count.
      "^https://www\\.kiekvienamstudentui\\.lt/a/rysysfollow\\.html$",
      // The 10 /m/ pages. Nine are nav or chrome and all clear the 250 floor
      // except /m/intl.html: the 5 section indexes are 617-1,092 ch of
      // headline+teaser links, /m/privatumo.html is a 22,954-ch GDPR policy,
      // /m/sitemap.html a 1,745-ch site plan, /m/tinklalapi.html a 1,137-ch
      // about page, /m/intl.html 12 ch of language links.
      // ⓘ The tenth, /m/istorija.html, is NOT nav — 20,148 ch of genuine
      // testimony ("Pakeisti gyvenimai"), and the negative lookahead below
      // EXEMPTS it. Orchestrator call, 2026-07-29, reversing this entry's
      // original block: a probe of the /m/ namespace on -ru, -pl, -hu and -tr
      // found nothing above 3,589 ch, so this page is a genuine one-off rather
      // than a pattern the blanket /m/ block has been quietly eating. Dropping
      // 20k chars of ministry content to keep a URL convention tidy is the
      // wrong trade; it is also in articleHints above.
      "^https://www\\.kiekvienamstudentui\\.lt/m/(?!istorija\\.html$)",
      // "Klausk" — the email contact page, 538 ch, so the floor cannot catch it.
      "^https://www\\.kiekvienamstudentui\\.lt/kontaktai\\.html$",
      // The homepage. It does NOT extract to 0 — `html` matches on it too, so it
      // yields its 748-ch teaser list. Only a URL block excludes it.
      "^https://www\\.kiekvienamstudentui\\.lt/?$",
    ],
    // ⚠️ Exactly one selector, and it is `html` — measured 2026-07-29 over all
    // 48 articles. `.contentpadding` holds the article on 46/48 and produces
    // BYTE-IDENTICAL output to this once the strips below run (delta 0 on every
    // one of the 46), but misses two articles whose markup collapses the div
    // tree, where it falls back to the document root and prefixes the text with
    // a literal "<!DOCTYPE html>". `html` reads those two correctly, so no
    // genuine article has to be blocked.
    // Do NOT add `.content4` (matches 46/48, extracts 0 chars) or `.content4b`
    // (matches only the 2 broken pages, 0 chars): extractContent binds the first
    // selector that MATCHES, not the first that yields text, so either would win
    // and silently skip every page as `too-thin` on an HTTP 200.
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
      // Required because the container is <html>: drops the duplicate <title>,
      // 23-100 ch. extract.ts reads the title from `root` BEFORE stripping —
      // keep those two steps in that order.
      "head",
      // Site-specific chrome, all counted on this host 2026-07-29 (see header):
      "sitelevel_noindex", // custom TAG, 4/page on 48/48: cookie bar + nav, share heading, related links, footer — 841 ch alone / 765 ch marginal
      ".shareiconsmenupg", // "DALINTIS ŠIUO STRAIPSNIU:", 27 ch alone but 0 ch marginal — its sitelevel_noindex wrapper is well-formed HERE and already contains it. A drift guard, not a stripper.
      ".fctable", // the "FEATURE CLOSE" CTA table — OUTSIDE sitelevel_noindex on this host, so a real 59-151 ch marginal on 47/48 pages
      ".fccell", // its cells: 0 ch marginal on 47/48, but the only thing catching the CTA on the malformed /a/rysys.html (69 ch)
      ".a2a_kit", // AddToAny share-button row, 96 instances, 0 ch (image-only buttons); stripped against future text labels
      ".hr2", // empty divs drawing the rules bracketing the CTA block — 0 ch
      ".articledivider", // likewise — 0 ch
      ".relatedbottom", // 0 INSTANCES on this host; kept only for sibling parity
    ],
    requestDelayMs: 1000, // direct fetches, no Firecrawl proxy; 0 × 429 observed
    maxPages: 90, // 60 distinct sitemap URLs (48 kept after filtering) + headroom
    minContentLength: 250,
  },
}
