/**
 * EveryStudent — Oromo (everybarataa.com, "EveryBarataa.com"; *barataa* is Afaan
 * Oromoo for "student"). The Oromo banner of Cru's seeker-facing Q&A ministry:
 * short apologetics and life-issue articles, FAQ answers and first-person
 * testimonies written for Oromo-speaking students who are not believers. Its
 * about page names the publisher as "Dhaabbata Ministrii Gireet Komishinii
 * Itoophiyaa" — Great Commission Ministry Ethiopia, Cru's Ethiopian national
 * ministry, the same body whose postal addresses appear on the follow-up tract.
 * A sibling of `everystudent` (en), `everystudent-am` (Amharic),
 * `everystudent-pl`, `everystudent-sq`, `everystudent-ru`, `everystudent-de`.
 *
 * **A separate SOURCE KEY, not a language of `everystudent`** — one domain =
 * one source (ADR-0006). everybarataa.com is its own domain, so it gets its own
 * key, the same way `everystudent-am` (habeshastudent.com), `everystudent-sq`
 * (pyetjetejetes.com), `everystudent-fr` (questions2vie.com), `thelife-fr`
 * (laviejenparle.com) and `thelife-zh` (uwota.com) are separate entries.
 *
 * ## ⚠️ Script: LATIN (Qubee), not Ge'ez — measured, not assumed
 *
 * Verified 2026-07-30. Afaan Oromoo is normally written in the Latin-based Qubee
 * orthography, and **this host serves Qubee**: across the 19 article pages there
 * is not one Ethiopic character. That separates it cleanly from its two
 * Horn-of-Africa siblings without needing any morphological argument —
 * `everystudent-am` (habeshastudent.com, Amharic) and the future `ti` banner
 * (everytemhari.com, Tigrinya) are Ge'ez-script hosts, and a page in Ge'ez
 * script simply cannot be this one. See "Language" below for the positive
 * evidence that it is Oromo rather than another Qubee-written language.
 *
 * ## NOT walled — plain HTTP
 *
 * Verified 2026-07-30: **all 29 sitemap URLs** plus `/a/fol.html` and 11 probe
 * paths were fetched with a plain `curl` carrying a desktop-Chrome UA. Every
 * live one returned **HTTP/2 200 with real HTML**, `server: Apache`, and no
 * Cloudflare block page anywhere ("Attention Required" — 0 hits across all 29).
 * So `fetchStrategy` is intentionally OMITTED: plain HTTP is the default and
 * nothing here needs Firecrawl (ADR-0012).
 *
 * ⓘ **One page does load a Cloudflare script, and it is NOT a wall.**
 * `/contact.html` embeds `challenges.cloudflare.com/turnstile/v0/api.js` for its
 * mail form, and still returns 200 with full HTML. Classification is on the
 * BLOCK-PAGE SIGNATURE, not on the presence of a Cloudflare asset (#114); this
 * is the same false-positive shape that must not be read as a wall. That page is
 * blocked below on content grounds, not fetch grounds.
 *
 * The bare apex **301-redirects to `www`** (measured on `/robots.txt`,
 * `/sitemap.xml` and `/a/isthere.html`), `www` serves 200 directly, and every
 * `<loc>` in the sitemap is a `www` absolute URL — so `domain`, `baseUrl` and
 * every regex below are pinned to `www.`. (Checked both ways: this host is NOT
 * the `everystudent.sk` case where `www` redirects to the apex.)
 *
 * ## robots.txt — there is no robots.txt
 *
 * Verified 2026-07-30: `https://www.everybarataa.com/robots.txt` returns
 * **HTTP 404** with the site's standard 404 HTML page, and the apex form 301s to
 * that same 404. **There is no robots file at all**, so there is no Disallow
 * rule to honour and no path needed blocking by hand on robots grounds. Every
 * exclusion below is a content-quality call. (The acquire path does not enforce
 * robots.txt; here there is nothing to enforce.) Unlike pyetjetejetes.com, whose
 * one Disallow named an `/a/` article.
 *
 * ## Sitemap — 29 entries, matching prior recon exactly
 *
 * Verified 2026-07-30: `https://www.everybarataa.com/sitemap.xml` → HTTP 200,
 * **4,727 bytes**, `application/xml`, Last-Modified 2021-05-26, every `lastmod`
 * 2020-03-30. A single flat `<urlset>` (0 `<sitemapindex>` elements, so no
 * recursion). It holds 29 `<loc>` elements and **29 distinct URLs** — no
 * duplicates. **No delta from the brief's "~29" recon number.**
 *
 * `/sitemap_index.xml` was also tried: **404**. There is no Yoast-style index
 * hiding a larger inventory, so this is not the `everystudent.sk` fossil case.
 *
 * ⓘ **The `<loc>` scheme is `https://`** — all 29, checked. `discover.ts` filters
 * the RAW `<loc>` string without normalising, so the `^https://` pins below match;
 * the `^https?://` widening `everystudent.gr` needed is not required here.
 *
 * The breakdown:
 *   - **19 `/a/<slug>.html`** — the article corpus. 18 of them are the keep set.
 *   - **6 `/m/<slug>.html`** — section indexes (`existence`, `faq`, `intl`,
 *     `knowing`, `life`, `relationships`). BLOCKED, below.
 *   - **`/about.html`**, **`/contact.html`**, **`/sitemap.html`** and **`/`**
 *     (homepage). All BLOCKED, below.
 *
 * **All 29 sitemap URLs are live.** A full sweep returned **29 × HTTP 200 and 0
 * redirects** — there is no dead-URL cohort of the kind `everystudent-ro` shipped
 * 25 of, and **no sitemap URL redirects to the homepage**. Nothing needed
 * blocking on redirect grounds.
 *
 * ⚠️ **Slugs are ASCII but NOT all lowercase: `/a/Godreal.html` carries a capital
 * G.** All 29 `<loc>` values were scanned — 0 non-ASCII bytes, 0 `%XX`
 * percent-escapes, but **1 uppercase slug**. So `[^/]+` in `articleHints` is
 * load-bearing here, not merely defensive: a `[a-z0-9-]+` class would silently
 * drop a real article. The Qubee orthography never reaches the URL — every slug
 * is an English word.
 *
 * ## Cross-checked against the site's own HTML sitemap — no delta, no seeds
 *
 * These generated sitemaps are known to be stale, so `/sitemap.html` was fetched
 * and diffed, then every internal `href` on all 29 pages was harvested as a wider
 * net (31 distinct internal URLs). Verified 2026-07-30:
 *   - **`/sitemap.html` lists exactly the same 19 `/a/` articles the XML sitemap
 *     does.** Zero articles present in one map and missing from the other. So
 *     **`seedPaths` is intentionally ABSENT** — unlike `everystudent-am`, which
 *     had to pin `/a/personally.html`, there is nothing here discovery cannot
 *     reach. This is a measured absence, not an omission.
 *   - The href harvest surfaced **`/a/fol.html`** (linked from 6 pages, in
 *     neither map, HTTP 200) — a real page, deliberately excluded; see below.
 *   - **`/m/faq.html`** runs the other way: in the XML sitemap but linked from no
 *     page on the site. Blocked by the `/m/` prefix regardless.
 *   - Two links in the site's own markup are **404s**: `/a/faith.html` (linked
 *     once, and it would match `articleHints`) and `/whois.html` (linked once, a
 *     typo for `/a/whois.html`). Neither is in the sitemap, so discovery never
 *     reaches them and no block is needed.
 *
 * ## What is blocked, and the measured evidence for each
 *
 * `articleHints` already excludes everything outside `/a/`. The `block` list is
 * deliberately redundant for those, recording *why* each group is out so a later
 * widening of the hints cannot silently readmit them — same defensive posture as
 * `everystudent-am` / `everystudent-pl`. **Two entries are not redundant:**
 * `/a/whowas.html` and `/a/fol.html` sit under `/a/` and match `articleHints`, so
 * `block` is the only thing keeping them out.
 *
 * All figures are post-strip, measured with node-html-parser under this entry's
 * exact `contentSelectors` and `stripSelectors`. **Every excluded page except
 * `/m/faq.html` and `/m/intl.html` clears `minContentLength: 250`, so the floor
 * could not have caught them** — they need URL blocks:
 *
 *   - **⚠️ `/a/whowas.html` — 26,194 chars of SCRIPTURE, and it matches
 *     `articleHints`.** Titled "Yesus Eenyu Turee?" ("Who was Jesus?"), it is an
 *     **abridged Gospel of John** — 16 chapter headings ("Yohannis 1", 3, 5, 6,
 *     7, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20) of continuous biblical text.
 *     The page says so itself in its own lede: "Dubbisi kun Macaafa Qulqulluu
 *     keessa kallattii dhaan Wangeela Yohaanis irraa kan fudhatame dha. Yaadni
 *     tokkollee itti hin dabalamnee." ("This reading is taken directly from the
 *     Bible, from the Gospel of John. Not a single thought has been added to
 *     it.") and closes on the third-party attribution "Macaafa Qulqulluu Afaan
 *     Oromoo isa haara irraa." ("From the new Afaan Oromo Bible."). BLOCKED under
 *     the estate-wide scripture policy (2026-07-29): public-domain Scripture text
 *     rather than ministry writing — outside what this corpus answers from. The
 *     Bible-society attribution is the second reason: this entry's `rights` line
 *     would misattribute that text to Cru.
 *     ⓘ **How this was told apart from an essay ABOUT the Bible:** `/a/isthere.html`
 *     also cites "Tyndale Press", but that is one line in a numbered bibliography
 *     (R.E.D. Clark, *Creation*, London: Tyndale Press, 1946) inside an
 *     apologetics essay — a citation, not a text. It is KEPT. `/a/whowas.html` is
 *     the only page on the host with continuous chapter-headed biblical text and
 *     a Bible-edition credit line; a scan of all 19 articles for both markers
 *     returned exactly these two hits and nothing else.
 *   - **`/a/fol.html` — 3,867 chars, matches `articleHints`, absent from BOTH
 *     maps.** "KIRISTOS GARA JIREENYA KEE DHUFUU ISAA ATTAMIN BEEKU DANDESAA?"
 *     ("How can you know Christ has come into your life?") — the post-decision
 *     follow-up tract (the Fact/Faith/Feeling train diagram, a growth checklist,
 *     and a directory of Great Commission Ministry Ethiopia postal addresses:
 *     "P.O. Box 41303 ADDIS ABABA / 359 AWASSA / 1158 BAHIR DAR"). This host's
 *     twin of the Amharic `/a/fol.html` and of the `/aventure` · `/aventura` ·
 *     `/pack` · `/abenteuerreise` starter-kit signups. It is also the one page
 *     under `/a/` with **no `.contentpadding` at all**, so the `html` fallback
 *     would return the whole document. Absent from today's sitemap, so discovery
 *     would not reach it — the block is what makes that safe rather than lucky.
 *   - **`/` — the homepage, 887 chars.** It has **no `.contentpadding`**, so
 *     `extractContent` falls through to the `html` fallback and returns the full
 *     teaser/CTA list. It has no `<body>` element either, so the "minContentLength
 *     will drop it" argument fails twice over — only a URL block excludes it.
 *   - **`/m/*` — the section indexes.** Post-strip via the `html` fallback:
 *     `/m/existence.html` **491**, `/m/life.html` **486**, `/m/relationships.html`
 *     **407**, `/m/knowing.html` **372**, `/m/faq.html` **72**, `/m/intl.html`
 *     **43**. Only the last two are under the floor. `/m/intl.html` is the page
 *     linking out to the sibling language domains — dropped for the same reason
 *     the English entry drops `/menus/intl.html`.
 *   - **`/sitemap.html` — 881 chars** of pure link list ("Saayit Maappii"). The
 *     Oromo twin of the French `/plan.html` and the Polish `/mapa.html`.
 *   - **`/about.html` — 990 chars** of about-page boilerplate.
 *   - **`/contact.html` — 253 chars**, three characters above the floor, and the
 *     Turnstile page. Blocked so the exclusion does not depend on a threshold.
 *
 * ## ⓘ NO Gospel-of-John signup and NO adventure/pack email series — measured
 *
 * Both usually need blocking on this estate. **Neither exists on this host.**
 * Probed 2026-07-30: `/john.html`, `/a/john.html`, `/pack.html`,
 * `/adventure.html`, `/wangeela.html`, `/a/wangeela.html`, `/a/gospel.html`,
 * `/a/bible.html`, `/a/plates.html` — **all 404**. A grep of all 29 fetched pages
 * for `list-manage`, `mailchimp` and `campaign` markers returned **0 hits**: this
 * host runs no email-capture funnel at all. Reporting the measured absence rather
 * than omitting it silently.
 *
 * ## Extraction — measured on this host, not inherited on trust
 *
 * Verified 2026-07-30 by running node-html-parser exactly as
 * `src/acquisition/extract.ts` does, over **all 29 sitemap pages** plus
 * `/a/fol.html` — the only check that proves anything, because these class names
 * are also declared in the page's inline `<style>` block and a grep
 * false-positives on all of them. Raw (pre-strip) character counts:
 *   - **`.contentpadding` — matched 23/30 pages, ZERO of them empty, 154–26,391
 *     chars.** On all **19 `/a/` sitemap articles** it is 1 instance holding the
 *     whole article: section kicker, title, subhead, byline, body and footnote
 *     list. **This is the shipped selector, listed FIRST.**
 *   - **⚠️ `.content4` — matched 29/30 pages and extracts 0 chars on 23 of them,
 *     including ALL 19 articles.** An empty spacer div. (It is non-empty only on
 *     the 5 `/m/` nav indexes, 105–524 chars.) Listing it — anywhere, even "as a
 *     fallback" — would bind it first and skip every single article as `too-thin`
 *     on an HTTP 200: silent, and invisible to the unit tests. That is how five of
 *     the eight pilot entries first shipped (#128). It is the reason
 *     `contentSelectors` here is not the sibling list.
 *   - **`.articletitle` — 23/30, 14–65 chars.** A title, not a body.
 *   - **`.post-content` — 1/30, 56 chars, homepage only.** A stray class on the
 *     homepage teaser; it never appears on an article. Excluded.
 *   - **`#content4` (the ID form), `.content4b`, `.cb-entry-content`,
 *     `.entry-content`, `.contentleftpadding`, `.article-content`, `.content`,
 *     `.articlebody`, `<article>`, `<main>` — 0 matches each.** All nine
 *     generators measured across this estate were tried; only the two above exist
 *     here.
 *   - **`<body>` — 0 matches on all 19 articles** (present only on the 5 `/m/`
 *     nav indexes, 2,590–3,009 chars). So without the explicit `html` entry the
 *     fallback on an article would land on the document ROOT, which carries the
 *     literal `<!DOCTYPE html>` text node.
 *   - **`<html>` — 30/30, 12,318–38,685 chars**: the whole page including nav,
 *     share row and footer.
 *
 * **`"html"` IS appended as the LAST entry, and it is safe here.** The primary
 * `.contentpadding` has **zero matched-but-empty pages** (its minimum is 154
 * chars, on `/m/intl.html`), so it can never shadow the fallback the way
 * `pyetjetejetes.com`'s did. Nothing follows `html`, so `html` cannot shadow
 * anything either. It fires only on pages where `.contentpadding` is genuinely
 * missing — the homepage, the 5 `/m/` nav indexes and `/a/fol.html`, all of which
 * are blocked — and it beats `extract.ts`'s implicit `?? root` because `<html>`
 * is a real element carrying no `<!DOCTYPE html>` text node. It is kept as a
 * drift guard: the day a real article's container collapses on broken markup
 * (an unclosed tag), the article is recovered instead of lost.
 *
 * **Measured with `[".contentpadding", "html"]` plus the strip list below, across
 * the 18 keep articles: 2,397 – 26,099 chars, median 8,311, and 0 pages below the
 * 250 floor.** Output opens on the section kicker + title and closes on the
 * article's own last line, with no nav, share row, CTA or footer left.
 *
 * ⚠️ `.contentpadding` also binds on `/about.html`, `/contact.html` and
 * `/sitemap.html` — it does **not** discriminate article from chrome. The URL
 * filters above are what keep the corpus clean.
 *
 * ## Chrome stripped — per-selector contribution, measured across the 18 keep articles
 *
 * Marginal figures are what each selector removes *beyond* the rest of the list;
 * solo figures are what it removes on its own on top of the generic tags.
 * **All site-specific selectors together remove 167–292 chars per article.**
 *   - **`sitelevel_noindex`** is a custom ELEMENT tag, not a class:
 *     `<sitelevel_noindex> … </sitelevel_noindex>`. **2 instances on 18/18 pages,
 *     solo 111 chars, marginal 23.** Instance [0] is the share row ("FUULA KANA
 *     NAMOOTA BIROOF ERGAA" — "Send this page to other people"); instance [1] is
 *     the footer contact/nav block ("Yoo gaaffii qabaattan / ► Saayit Maappii").
 *     Hence the bare tag name with no leading `.`.
 *   - **`.shareiconsmenupg` — 1 instance on 18/18, solo 33 chars, MARGINAL 0.**
 *     ⓘ On THIS host the enclosing `<sitelevel_noindex>` is **well-formed and
 *     already contains it** (confirmed by walking the DOM: instance [0] holds both
 *     `.shareiconsmenupg` and `.a2a_kit`), so once that is stripped first this
 *     selector matches nothing — a genuine no-op in list order, NOT the
 *     `-de`/`-ru` malformed-markup case. Kept purely as a cheap drift guard.
 *     **It is not claimed to strip anything today.**
 *   - **`.fctable` (1–2 instances, solo 55–236) + `.fccell` (4–6 instances, solo
 *     56–181, marginal 0–86)** — the "FEATURE CLOSE" call-to-action block appended
 *     to every article ("► Yesuus gara jireenya koo akka seenu affeerera … ►
 *     Gaaffiin qaba"). They partly cover each other (the cells nest inside the
 *     table), but `.fccell` still measures up to 86 chars marginal on some pages,
 *     so both are listed deliberately: dropping `.fccell` would leave stray cells,
 *     and dropping `.fctable` would leave the emptied shell.
 *   - **`.hr2` (0–2 instances), `.articledivider` (1), `.a2a_kit` (2) — 0 chars
 *     each.** They bind, but are empty presentational divs and image-only AddToAny
 *     buttons whose `alt` text `structuredText` does not read. Retained so a
 *     markup change that adds text labels cannot leak them.
 *   - **`.relatedbottom` — 0 instances on this host**, as on every sibling
 *     measured so far. Retained as a harmless parity no-op on a same-template
 *     host; do not read its presence here as evidence it binds.
 *   - **`head` — 0 chars marginal on all 18 articles** (it sits outside
 *     `.contentpadding`). It earns its place only on the `html` fallback path,
 *     where it drops the duplicated `<title>` (measured 17–67 chars on the
 *     homepage and `/m/` pages). Safe because `extract.ts` reads the title from
 *     `root` at line 43, BEFORE the strip loop at line 52.
 *   - **`form` — 0 chars marginal.** Each page carries 3 forms, but **0 of them
 *     sit inside `.contentpadding`**, so on the primary path this is a generic
 *     no-op; it does real work on the `html` fallback. Listed for parity and drift.
 *
 * After the full list, all 18 keep articles were re-scanned for leftovers: **0
 * hits** for "FUULA KANA NAMOOTA", "Saayit Maappii", "► " or "Yoo gaaffii
 * qabaattan".
 *
 * ## Language: `["om"]` — Oromo in Qubee script, read rather than inferred
 *
 * Verified 2026-07-30 by reading the extracted text myself. The pages serve
 * genuine Afaan Oromoo prose in Latin/Qubee script, not untranslated English.
 * `/a/isthere.html` is titled "Waaqayyo jiraa?" ("Does God exist?") and opens
 * "Waaqayyo dhuguma jiraachuusaa kan mirkaneessan sababiiwwan kallattii ja'atu
 * jira." ("There are six direct reasons that confirm God truly exists.");
 * `/a/whydid.html` is "Yesus maaliif du'ee?" ("Why did Jesus die?");
 * `/a/marriage.html` is "Gaa'elli diigamuuf jedhu abdii qaba ta'aa?" ("Is there
 * hope for a marriage about to break up?"); `/a/women.html` is "Mirga
 * Dubartootaa" ("Women's rights").
 *
 * **The evidence that it is Oromo specifically** is the Qubee orthography's
 * signature double vowels and double consonants marking phonemic length —
 * *Waaqayyo* (God), *jaalala* (love), *dhugaa* (truth), *gaa'ela* (marriage),
 * *jireenya* (life), *Macaafa Qulqulluu* (Bible) — together with the Oromo
 * digraphs `dh`, `ph`, `ny`, `ch` and the glottal `'`. Scripture citations use
 * Oromo book abbreviations (Yoh., Mul., Qol., Ibr., Luq., HoE.).
 *
 * **Oromo, not Amharic or Tigrinya — and the separation needs no morphology
 * argument here.** Amharic (`everystudent-am`, habeshastudent.com) and Tigrinya
 * (everytemhari.com, the future `ti` banner) are written in Ge'ez script; this
 * host contains **zero Ethiopic characters** across all 19 articles. Script alone
 * is decisive. `<html lang="om">` agrees, but that was NOT relied on — the
 * `persoalanhidup.com` precedent (declares `lang="id"`, serves Malay) means the
 * declaration is corroboration, never evidence.
 *
 * ## ⚠️⚠️ OPERATOR SIGNAL: content detection CANNOT emit `om`
 *
 * `languages: ["om"]` is the honest ISO 639-1 declaration for what this host
 * serves — but **`tinyld`, the detector behind `detect-language.ts`, has no Oromo
 * model at all.** Verified 2026-07-30: `langName("om")` returns the empty string,
 * and running `detectAll` on this host's own extracted article text (leading
 * 2,000 chars, exactly as `detectLanguage` does) never once returns `om`. The top
 * candidates are Berber (`ber`, 11 of 19 articles), Finnish (`fi`, 5), Tagalog
 * (`tl`, 2), plus `id` and `pl` once each — all other Latin-script trigram
 * profiles.
 *
 * Pushed through `decideLanguage` with `CONFIDENCE_GATE = 0.75` and
 * `DETECTION_FLOOR_CHARS = 500`, the 18 keep articles land as:
 *   - **17 → `documents.language = null`** — every verdict falls below the gate
 *     (0.242 – 0.717), so the policy honestly records "not confidently detected".
 *     This is the system working as designed, not a bug.
 *   - **1 → stored as `'ber'` at confidence 0.784, WITH the out-of-set warning**
 *     — `/a/whois.html`. `decideLanguage` trusts content over the declaration by
 *     design (ADR-0007), so this single row will carry a wrong label plus the
 *     warning "detected language 'ber' … is outside the declared set [om]".
 *
 * **The orchestrator must decide what to do with this**, because no change inside
 * this entry can fix it — the gap is in the detector, not the registry. The
 * practical consequence: `om` documents will be almost entirely null-language, so
 * they stay fully retrievable unfiltered but are excluded from any
 * `language:om` filter, and they will dominate #73's `WHERE language IS NULL`
 * worklist. The 1 `ber` row is the only actively-wrong label.
 *
 * ## Encoding — UTF-8 in the markup, but NOT in the HTTP header
 *
 * Verified 2026-07-30: every page responds with a bare **`content-type:
 * text/html` carrying NO charset parameter** — the same gap `habeshastudent.com`,
 * `studentinjapan.com` and `everykoreanstudent.com` have. The bytes are UTF-8 and
 * the HTML declares it via `<meta http-equiv="content-type" content="text/html;
 * charset=utf-8" />`. Lower risk here than on the Ge'ez sibling because Qubee is
 * Latin, but the Oromo glottal apostrophe (U+2019, in *gaa'ela*, *ja'a*) is
 * multi-byte and **read clean with zero mojibake** through parsing and extraction.
 *
 * `requestDelayMs: 1000` — the politeness default, and we pay this host's
 * bandwidth directly rather than proxying through Firecrawl. ~45 sequential
 * plain-HTTP requests drew **zero 429s** and no throttling, so the sibling default
 * is kept rather than raised.
 *
 * **Expected yield: 18 documents** — the 19 sitemap articles minus the abridged
 * Gospel of John at `/a/whowas.html`.
 */
import type { SourceEntry } from "./types.js"

export const everystudentOm: SourceEntry = {
  key: "everystudent-om",
  name: "EveryStudent — Oromo (EveryBarataa.com)",
  domain: "www.everybarataa.com",
  trust: "partner",
  ingestionMode: "html-scrape",
  languages: ["om"],
  defaultTags: ["everystudent", "cru", "topic:seeker", "lang:om"],
  defaultCategory: "article",
  rights:
    "© EveryBarataa.com (Cru) — partner ministry content; used for retrieval/attribution.",
  crawl: {
    baseUrl: "https://www.everybarataa.com",
    // No `fetchStrategy`: verified 2026-07-30 that plain HTTP serves every page
    // on this host (bare Apache, 29/29 × HTTP 200, no Cloudflare block page).
    // The Turnstile script on /contact.html is a mail-form widget on a page that
    // still returns 200 — not a wall. See header.
    sitemaps: ["/sitemap.xml"],
    // No `seedPaths`: the site's own /sitemap.html lists exactly the same 19
    // articles as /sitemap.xml, and an href harvest across all 29 pages found no
    // article the XML map lacks. Measured absence, not an omission. (The one
    // unlisted live page, /a/fol.html, is deliberately excluded — see `block`.)
    allow: ["^https://www\\.everybarataa\\.com/"],
    // The whole article corpus: 19 of the 29 sitemap URLs. `[^/]+` is REQUIRED,
    // not defensive: /a/Godreal.html carries a capital G, so a `[a-z0-9-]+` class
    // would silently drop a real article. (Verified across all 29 <loc> values:
    // 0 non-ASCII bytes, 0 %XX escapes, 1 uppercase slug.)
    articleHints: ["^https://www\\.everybarataa\\.com/a/[^/]+\\.html$"],
    block: [
      // ── These two MATCH articleHints; `block` is the ONLY thing excluding them.
      // SCRIPTURE (estate-wide policy, 2026-07-29): an abridged Gospel of John,
      // 26,194 ch, 16 "Yohannis <n>" chapter headings. Its own lede says the text
      // is taken directly from the Bible with nothing added, and it closes on the
      // third-party credit "Macaafa Qulqulluu Afaan Oromoo isa haara irraa"
      // ("from the new Afaan Oromo Bible") — which this entry's `rights` line
      // would misattribute. Public-domain Scripture, not ministry writing.
      // (Contrast /a/isthere.html, kept: its "Tyndale Press" hit is one line of a
      // numbered bibliography inside an apologetics essay.)
      "^https://www\\.everybarataa\\.com/a/whowas\\.html$",
      // The post-decision follow-up tract, 3,867 ch: "KIRISTOS GARA JIREENYA KEE
      // DHUFUU ISAA ATTAMIN BEEKU DANDESAA?" plus a directory of Great Commission
      // Ministry Ethiopia postal addresses. This host's twin of the Amharic
      // /a/fol.html and the /aventure · /pack starter-kit signups. Also the one
      // /a/ page with no .contentpadding, so the `html` fallback would return the
      // whole document. Absent from today's sitemap, so the block makes that safe
      // rather than lucky.
      "^https://www\\.everybarataa\\.com/a/fol\\.html$",
      // ── Below here articleHints already excludes them; these record WHY.
      // The 6 section indexes. None has .contentpadding, so the `html` fallback
      // returns 43-491 ch of headline+teaser links; only /m/faq.html (72) and
      // /m/intl.html (43) are under the 250 floor. /m/intl.html is the page
      // linking out to the sibling language domains.
      "^https://www\\.everybarataa\\.com/m/",
      // "Saayit Maappii": 881 ch of pure link list. Oromo twin of the French
      // /plan.html and the Polish /mapa.html.
      "^https://www\\.everybarataa\\.com/sitemap\\.html$",
      // About-page boilerplate (990 ch) and the contact form (253 ch — three
      // chars above the floor, and the page carrying the Cloudflare Turnstile
      // widget). Blocked so neither exclusion depends on a threshold.
      "^https://www\\.everybarataa\\.com/(about|contact)\\.html$",
      // The homepage — no .contentpadding AND no <body>, so the `html` fallback
      // returns 887 ch of teaser headlines and CTA copy rather than nothing. Only
      // a URL block excludes it; minContentLength cannot.
      "^https://www\\.everybarataa\\.com/?$",
    ],
    // `.contentpadding` FIRST — measured 2026-07-30 as the sole element on this
    // host that extracts the article (2,397-26,099 ch post-strip across the 18
    // keep articles, median 8,311, none under the 250 floor).
    // ⚠️ `.content4` is deliberately ABSENT: it MATCHES on 29 of 30 pages and
    // extracts 0 chars on all 19 articles. extractContent scopes to the first
    // selector that MATCHES, not the first that yields text, so listing it here —
    // even "as a fallback" — would bind an empty spacer div and skip every page
    // as `too-thin` on an HTTP 200. This is NOT a fallback chain.
    // `html` is appended LAST and is safe: `.contentpadding` has zero
    // matched-but-empty pages (min 154 ch), so it can never shadow the fallback,
    // and nothing follows `html` for `html` to shadow. It beats the implicit
    // `?? root` because <html> carries no literal `<!DOCTYPE html>` text node.
    contentSelectors: [".contentpadding", "html"],
    stripSelectors: [
      // 0 chars whenever `.contentpadding` binds (it is outside the div); fires
      // only on the `html` fallback, where it drops the duplicated <title>
      // (17-67 ch). Safe because extract.ts reads the title from `root` BEFORE
      // this strip loop runs (extract.ts:43 vs :52).
      "head",
      "script",
      "style",
      "noscript",
      "svg",
      "nav",
      "header",
      "footer",
      "form", // 0 marginal: 3 forms per page, none inside .contentpadding
      // Site-specific chrome — all instance counts and char deltas measured on
      // this host across the 18 keep articles (see header):
      "sitelevel_noindex", // custom ELEMENT tag, 2 inst: share row + footer contact/nav — 111 ch solo, 23 marginal
      ".shareiconsmenupg", // 33 ch solo but 0 MARGINAL — sitelevel_noindex is
      // well-formed on THIS host and already contains it. Kept as a drift guard,
      // not because it strips anything today.
      ".fctable", // the "FEATURE CLOSE" CTA table shell — 55-236 ch solo
      ".fccell", // its cells: "► Yesuus gara jireenya koo akka seenu affeerera…"
      // — 56-181 ch solo, 0-86 MARGINAL beyond .fctable, so both are needed.
      ".hr2", // empty divs drawing the rules bracketing the CTA — 0 ch
      ".articledivider", // 0 ch
      ".a2a_kit", // AddToAny share row — 0 ch (image-only buttons)
      ".relatedbottom", // 0 instances on this host; kept for sibling parity
    ],
    requestDelayMs: 1000, // direct fetches, no Firecrawl proxy; 0 × 429 observed
    maxPages: 60, // 29 sitemap URLs + headroom
    minContentLength: 250,
  },
}
