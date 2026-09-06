/**
 * EveryStudent — Croatian (vrlovazno.com, "vrlo važno" / "very important";
 * strapline "potraga za odgovorima na pitanja o životu i Bogu" — "a search for
 * answers to questions about life and God"). The Croatian banner of Cru's
 * seeker-facing Q&A ministry: short apologetics and life-issue articles plus
 * first-person testimonies, written for Croatian-speaking students who are not
 * believers. A sibling of `everystudent` (en), `everystudent-sr`,
 * `everystudent-sq`, `everystudent-pl`.
 *
 * **A separate SOURCE KEY, not a language of `everystudent`** — one domain =
 * one source (ADR-0006). vrlovazno.com is its own domain, so it gets its own
 * key, the same way `everystudent-sr` (studentskikutak.com), `everystudent-fr`
 * (questions2vie.com), `thelife-fr` (laviejenparle.com) and `thelife-zh`
 * (uwota.com) are separate entries.
 *
 * ## NOT walled — plain HTTP
 *
 * Verified 2026-07-29: **~70 plain-HTTP GETs** with a full desktop-Chrome UA
 * (robots.txt, /sitemap.xml, all 54 sitemap URLs, /a/osobno2.html and 9 probe
 * URLs) — every reachable one returned **HTTP/2 200, `server: Apache`**, with no
 * Cloudflare layer, no `Attention Required`, no `Just a moment` and no
 * `cf-error-details` anywhere. So `fetchStrategy` is intentionally OMITTED:
 * plain HTTP is the default and nothing here needs Firecrawl (ADR-0012).
 * Discovery is therefore free, making this a **discovery crawl**. Precedent for
 * the shape: `thelife-fr`, `everystudent-sr`, `everystudent-pl`.
 *
 * ⓘ **Two pages DO load a Cloudflare script, and it is not a wall.**
 * `/kontakt.html` and `/a/osobno2.html` embed
 * `challenges.cloudflare.com/turnstile/v0/api.js` plus a `.cf-turnstile` div —
 * a CAPTCHA widget guarding their mail forms. Both still served **HTTP 200 with
 * full readable HTML** to plain curl. Classifying on the block-page signature
 * rather than on the mere presence of a Cloudflare script is the #114 lesson;
 * both pages are blocked below for content reasons anyway.
 *
 * The bare host **301-redirects to `www`** (measured on `/robots.txt` and on
 * `/`), so `www.vrlovazno.com` is canonical and the host every `<loc>` uses.
 *
 * ## robots.txt — THERE ISN'T ONE
 *
 * Verified 2026-07-29: `https://www.vrlovazno.com/robots.txt` → **HTTP 404**
 * (`server: Apache`, `content-type: text/html`, 35,139 bytes of the site's own
 * `<title>vrlovazno.com - 404</title>` page). The apex 301s to www first; the
 * www URL is a genuine 404, not a redirect or a soft block. **No robots.txt
 * exists on this host, so nothing is disallowed** and no URL below is dropped
 * on robots grounds — every exclusion here is a content-quality call.
 *
 * This differs from every sibling measured so far: `-sq` serves a real
 * `Disallow: /a/ungjillin2.html`, `-pl` a `Disallow: /logo/`, and `-sr`/`-fr`
 * an explicit `Allow: /`. Nothing needed blocking BY HAND to honour robots
 * (the acquire path does not enforce robots.txt — a known gap), because there
 * is no rule to honour.
 *
 * ## Sitemap — 54 entries, all distinct, all live
 *
 * Verified 2026-07-29: `https://www.vrlovazno.com/sitemap.xml` → HTTP 200,
 * **8,325 bytes**, `application/xml`, `Last-Modified: 2021-12-27`, every
 * `<lastmod>` reading `2021-12-24T15:47:01+00:00` — a single flat `<urlset>`
 * (no `<sitemapindex>`, so no recursion). It holds 54 `<loc>` elements and **54
 * distinct URLs**, matching the "~54" from prior recon exactly. The breakdown:
 *   - **41 `/a/<slug>.html`** — the article corpus. This is the keep set.
 *   - **9 `/m/<slug>.html`** — section indexes (`faq`, `intl`, `o`, `odnosi`,
 *     `pitanja`, `postojanje`, `sitemap`, `upoznati`, `zastiti`). BLOCKED.
 *   - **`/duhovni-izazovi.html`**, **`/upoznajmo-Boga-zajedno.html`**,
 *     **`/kontakt.html`** — two email-series signups and the contact form.
 *     BLOCKED, on measured evidence below.
 *   - **`/`** — the homepage. BLOCKED.
 *
 * **All 54 are live.** A full GET sweep returned **54 × HTTP 200 with zero
 * redirects** — no 301, no 302, no 404. There is no dead-URL cohort of the kind
 * `everystudent-ro` shipped 25 of, and nothing redirects to the homepage, so
 * **no dead-URL blocks are needed** and none are written.
 *
 * ## HTML-map cross-check — zero delta, so NO `seedPaths`
 *
 * These sitemaps are known to be stale (a sibling's was 17% short; `-mn` was
 * missing 11 articles, `-sr` 7), so the site's own HTML map was fetched and
 * diffed. There is no `/mapa.html` or `/sitemap.html` at the root here (both
 * 404) — the map lives at **`/m/sitemap.html`** ("Mapa weba"). Verified
 * 2026-07-29: it links **41 `/a/` URLs, and the two sets are IDENTICAL** — 0 in
 * the HTML map the XML lacks, 0 the other way. So `seedPaths` is deliberately
 * absent: there is nothing to pin.
 *
 * As a wider net, every `href` on all 54 pages was harvested: **44 distinct
 * `/a/` URLs**, i.e. three beyond both maps. All three were fetched:
 *   - **`/a/cunoasterea.html` → 404.** A *Romanian* slug ("cunoașterea" =
 *     "knowing"), leaked into `/a/koronavirus.html` — a cross-domain link from
 *     the sibling estate that was never localized. Dead; nothing to do.
 *   - **`/a/upoznajmo-Boga-zajedno.html` → 404.** Only the root-level twin
 *     exists; the `/a/` form is a broken link on the root page itself.
 *   - **`/a/osobno2.html` → 200, and it is the one real find.** Live, linked
 *     from the CTA of 13 articles, and **absent from both maps** — so discovery
 *     cannot reach it today. It is not an article (see the block list), so it is
 *     BLOCKED rather than pinned.
 *
 * ## Script: LATIN ONLY — no parallel Cyrillic tree, no duplicate-content call
 *
 * The Serbian neighbour is digraphic, so this was checked rather than inherited.
 * Verified 2026-07-29 by scanning the raw HTML of all 55 fetched pages for
 * codepoints in U+0400–U+04FF: there are exactly **8 Cyrillic characters on the
 * entire site**, and they are the single word **"поглавје" on
 * `/a/prirode.html`** — which is *Macedonian* for "chapter" (Croatian is
 * "poglavlje"), one more untranslated leak from the sibling estate. Everything
 * else is Croatian Latin (gajica: č ć đ š ž).
 *
 * All 54 pages declare **`<html lang="hr">`**, and there is **no `hreflang`, no
 * `<link rel="alternate">`, and no `/cir/`- or `/lat/`-style parallel URL tree**
 * anywhere in the sitemap or in the harvested link inventory of any page.
 * **There is no second script variant to de-duplicate**, so no script tree
 * needed blocking and there is no duplicate-content decision to make here.
 *
 * ## Language: `["hr"]` — CROATIAN, read and counted, not inferred
 *
 * Verified 2026-07-29 by reading the extracted text. `/a/postoji.html` asks
 * "Postoji li Bog?" and offers "Šest izravnih razloga za uvjerenje da Bog
 * zaista postoji"; `/a/molitve.html` is "Odgovara li Bog na naše molitve?" and
 * opens "Znate li nekoga za koga možete reći da uistinu vjeruje Bogu, da ima
 * povjerenja u Boga?"; `/a/trojstvo.html` is "Možete li objasniti Trojstvo?"
 * ("Vi i ja živimo u trodimenzionalnom svijetu"); `/a/tkojebio.html` is "Tko je
 * bio Isus?". Genuine Croatian prose, not untranslated English.
 *
 * **Croatian (Ijekavian), NOT Serbian (Ekavian).** Counted with word boundaries
 * across all 42 articles (374,806 chars) on 2026-07-29 — the Croatian form
 * first, its Serbian counterpart second:
 *
 *     tko 126 / ko 0          čovjek 67 / čovek 0     vjerovati 37 / verovati 0
 *     vjera 34 / vera 0       vrijeme 37 / vreme 0    mjesto 62 / mesto 0
 *     ovdje 38 / ovde 0       poslije 15 / posle 2    kršćan 64 / hrišćan 0
 *     znanstven 37 / naučn 0  povijest 14 / istorij 0 tisuć 15 / hiljad 0
 *     kruh 14 / hleb 0        opće 20 / opšte 0       uvjet 7 / uslov 0
 *
 * The interrogative alone settles it: **"tko" 126, "ko" 0** — the reverse of
 * the Serbian sibling's "ko 201 / tko 0". Scripture citations use the Croatian
 * book names throughout ("Evanđelje po Ivanu" 86 occurrences vs "Jevanđelje po
 * Jovanu" 0; also "Poslanica Rimljanima", "Djela apostolska", "Otkrivenje").
 *
 * ⚠️ Note for anyone re-running this: naive substring counts LIE here. `vreme`
 * appears to score 75 as a substring because Croatian "suvremen"/"istovremeno"
 * contain it, and `ko` scores 1,354 inside "kako"/"tko"/"netko". Both collapse
 * to **0** under `(?<!\p{L})…(?!\p{L})` word boundaries. Use word boundaries.
 *
 * **A DISTINCT translation, not a copy of the Serbian host.** Same-topic
 * articles were diffed against studentskikutak.com by 8-word shingle overlap:
 * Trinity (hr 4,648 ch vs sr 5,192 ch) shares **0.9%**; Prayer (hr 10,179 vs sr
 * 8,859) shares **0.4%**. Independently translated — even the subheads differ
 * ("Odgovara li Bog na naše molitve?" vs "Da li Bog uslišuje naše molitve?").
 * No de-duplication against `everystudent-sr` is warranted.
 *
 * The only English on these pages is bibliographic: footnotes citing
 * English-language books with a bracketed Croatian gloss (e.g. "Wilkins,
 * Michael J. & Moreland, J.P. Jesus Under Fire [Isus pod vatrom]"). Normal
 * citation apparatus in a translated article, not an untranslated body.
 *
 * The stored per-document language label still comes from content detection at
 * ingest (invariant 6), never from this field.
 *
 * ## Extraction — every candidate measured on THIS host, including the zeros
 *
 * Verified 2026-07-29 by running the repo's own `extractContent`
 * (node-html-parser, exactly as `src/acquisition/extract.ts` uses it) over all
 * 54 sitemap pages. This is the only check that proves anything: **every one of
 * these tokens is also declared in each page's inline `<style>` block**, so
 * grepping for a class name false-positives on all of them. Match counts are
 * out of 54 pages; char counts are post-`tidy`, pre-strip:
 *
 *   - **`.contentpadding` — matches 46/54, ZERO of them empty**, 155–22,215 ch,
 *     median 5,185. The whole article: kicker, title, subhead, body, footnotes.
 *     **This is the one shipped.**
 *   - **`.content4` — matches 51/54, and extracts 0 chars on 46 of them**,
 *     including **0 chars on all 39 articles where it matches**. (Its only
 *     non-zero hits are 379–993 ch on 5 `/m/` nav pages, which are blocked.) An
 *     empty spacer div on every article. **This is the trap that broke 5 pilot
 *     entries** — see the warning below.
 *   - **`.content4b` — matches 2/54, 0 chars on both.**
 *   - **`.articletitle` — matches 48/54, 4–69 ch.** A title, not a body.
 *   - **`.content4c` — 0 matches. `.contentleftpadding` — 0. `.cb-entry-content`
 *     — 0. `.entry-content` — 0. `.article-content` — 0. `.content` — 0.
 *     `<article>` — 0. `<main>` — 0.** None of the other six generators measured
 *     across this estate exist here.
 *   - **`<body>` — matches only 6/54**, and **on ZERO of the 42 article pages**.
 *     It is present only on the homepage and 5 `/m/` indexes (9,951–10,565 ch).
 *     Same absence documented for `-hu`, `-fa` and `-sr`; confirmed here
 *     specifically rather than assumed.
 *   - **`<html>` — matches 54/54, 19,429–48,136 ch.** The whole document.
 *
 * ⚠️ **`contentSelectors` is NOT a fallback chain.** `extractContent` scopes to
 * the FIRST selector that MATCHES AN ELEMENT, not the first that yields text.
 * Listing `.content4` "outermost first as a fallback" would bind the empty
 * spacer and extract **0 chars on every article**, skipping all 41 as
 * `too-thin` on an HTTP 200 — silent, and invisible to the unit tests. So
 * `contentSelectors` is the ONE measured container and nothing else.
 *
 * ⓘ **Two articles intentionally use the implicit root fallback, and both
 * extract correctly.** `/a/bibliji.html` and `/a/osobno.html` have no
 * `.contentpadding` (their only container is an empty `.content4b`), and this
 * host emits no `<body>` on article pages, so `extractContent` falls through to
 * the document root. Measured under the shipped config: **28,617 ch and 6,783
 * ch of clean article prose**, each opening on its own title and closing on its
 * own footnote list, with the page nav removed by the `sitelevel_noindex` strip
 * (971 ch on these two vs 115 elsewhere). The only artifact is a leading
 * `<!DOCTYPE html>` token. Adding `.content4b` as a fallback would bind an
 * empty div and drop **both** pages, which is exactly why it is absent — the
 * same call `-sr` made for `/a/zajednistvo.html` and `-pl` rejected for
 * `/a/biblia.html`.
 *
 * **Across all 41 sitemap articles under the exact shipped config: 1,266 –
 * 28,617 chars, median 6,783, and 0 pages below the 250 floor.**
 *
 * ⚠️ `.contentpadding` also binds on `/kontakt.html`, `/duhovni-izazovi.html`,
 * `/upoznajmo-Boga-zajedno.html`, `/m/sitemap.html` and 3 other `/m/` pages —
 * it does **not** discriminate article from chrome. The URL filters are what
 * keep the corpus clean; the selector must not be relied on to do it.
 *
 * ## ⚠️ No full Scripture on this host — checked, not assumed
 *
 * The estate-wide scripture policy (2026-07-29) blocks complete Bible books
 * served on article URLs, as `-es` (`/articulos/biblia_juan.html`, 100,409 ch)
 * and `-sq` (`/a/gjoni.html`, 98,887 ch) do. **This host has no such page.**
 * The Croatian slug shapes were probed and all 404: `/ivan.html`,
 * `/a/ivan.html`, `/a/ivana.html`, `/biblija.html`, `/a/biblija.html`.
 *
 * The one candidate, **`/a/bibliji.html` at 28,617 ch (4× the median), is a
 * genuine apologetics ARTICLE, not scripture** — "Zašto možete vjerovati
 * Bibliji" ("Why you can believe the Bible"). Analysed 2026-07-29: of its 303
 * paragraphs only **8 are quoted scripture, totalling 1,874 ch — 6.5% of the
 * page**. The rest is manuscript-transmission and Dead Sea Scrolls argument
 * citing McDowell, Strobel, Geisler, F.F. Bruce and Tacitus, and it ends on its
 * own 13-item footnote list. It is kept, and there is no third-party
 * Bible-society copyright notice anywhere on the host.
 *
 * ## Chrome stripped — measured in LIST ORDER, honestly
 *
 * Two numbers matter and they differ: what a selector removes **on its own**
 * (isolated), and what it still removes **given the selectors before it**
 * (list order). List order is what actually ships. Measured on
 * `/a/postoji.html`, `/a/trojstvo.html`, `/a/bibliji.html` and
 * `/a/osobno.html`:
 *   - **`sitelevel_noindex`** is a custom ELEMENT tag, not a class — hence the
 *     bare tag name with no leading `.`; the siblings' form is correct, not a
 *     typo. **2 instances / 115 ch** on `.contentpadding` pages, **4 instances /
 *     971 ch** on the two root-fallback pages. It carries "POŠALJI PRIJATELJU:"
 *     ("SEND TO A FRIEND:") and the "Imate pitanje? / Duhovni izazovi /
 *     Upoznajmo Boga zajedno / ► Mapa weba" related block. **The largest
 *     contributor by far, and the only one that matters on the root-fallback
 *     pages.**
 *   - **`.shareiconsmenupg` — 1 instance, 21 ch isolated, but 0 ch in list
 *     order.** On THIS host the enclosing `<sitelevel_noindex>` is
 *     **well-formed** and already contains it, so once that is stripped first
 *     this matches nothing. It is a **no-op**, kept as a cheap drift guard —
 *     the day the markup breaks the way `-de`/`-ru`/`-sr` broke (#128),
 *     "POŠALJI PRIJATELJU:" would otherwise trail every extraction. It is NOT
 *     claimed to strip anything today.
 *   - **`.fctable` — 2 instances, 70–195 ch**, the "FEATURE CLOSE"
 *     call-to-action table ("► Upravo sam pozvao Krista u svoj život… ► Imam
 *     pitanje…"). Real work in list order.
 *   - **`.fccell` — 4–6 instances.** 0 ch in list order on the `.contentpadding`
 *     pages, because the cells nest inside `.fctable` which is stripped first —
 *     **but 140 ch on `/a/osobno.html`**, where `.fctable` has 0 instances and
 *     the cells stand alone. Both selectors are therefore load-bearing; neither
 *     can be dropped.
 *   - **`.sidebar` — 2 instances, 94 ch isolated, 0 ch in list order** (fully
 *     contained in the second `<sitelevel_noindex>`). Audited: it holds only nav
 *     chrome — "Imate pitanje? / Duhovni izazovi / Upoznajmo Boga zajedno" and
 *     "► Mapa weba / ► Pošalji prijatelju" — and never article text, so it is
 *     safe. Kept as a drift guard, same posture as `.shareiconsmenupg`.
 *   - **`.hr2` (2 instances) and `.articledivider` (1)** — empty presentational
 *     divs drawing the rules bracketing the CTA block. **0 chars**, confirmed.
 *   - **`.relatedbottom` — 0 instances on every page measured.** Dead config
 *     here, as on every host measured so far. Retained only for sibling parity;
 *     do not read its presence as evidence it binds.
 *
 * ## What is blocked, and the evidence for each
 *
 * Every page below was fetched and extracted under this entry's exact shipped
 * config, and **every single one clears the 250-char floor**. `minContentLength`
 * could not have excluded any of them — only a URL block can. That is not a
 * theoretical point: when no `contentSelector` matches, `extractContent` does
 * NOT return empty, it falls back to `<body> ?? root`, and on this host `<body>`
 * is absent from article pages, so the real fallback is the whole document.
 *   - **`/` — the homepage, 935 ch** via the `<body>` fallback (this is one of
 *     the 6 pages that does have a `<body>`). A teaser list: "Koji je smisao
 *     moga života? / Postoji li Bog? / …". Blocked, or discovery stages it.
 *   - **`/m/*` — the 9 section indexes, 40–1,598 ch.** Navigation, not content:
 *     `postojanje` 972, `pitanja` 915, `upoznati` 901, `odnosi` 361, `faq` 358
 *     (headline+teaser link lists, 4 of them reached only via the `<body>`
 *     fallback), `sitemap` 1,598 ("Mapa weba", the site plan — the Croatian twin
 *     of the French `/plan.html`), `o` 1,176 (about), `zastiti` 674 (privacy),
 *     and `intl` 40 — the "vrlovazno.com na drugim stranim jezicima" page
 *     linking out to the sibling language domains, dropped for the same reason
 *     the English entry drops `/menus/intl.html`.
 *   - **`/upoznajmo-Boga-zajedno.html` — the Gospel-of-John email study, 1,832
 *     ch.** "Upoznajmo Boga zajedno — proučavanje Evanđelja po Ivanu" ("Let's
 *     get to know God together — a study of the Gospel of John"): "Ovo
 *     proučavanje sastoji se od niza lekcija koje ćete primiti u sandučić svoje
 *     elektronske pošte". The Croatian twin of the French `/jean.html`, Spanish
 *     `/juan`, Polish `/jan.html` and Albanian `/gjonit.html`.
 *   - **`/duhovni-izazovi.html` — the 7-email series, 1,515 ch.** "Duhovni
 *     izazovi" ("Spiritual Challenges"): "To je serija od sedam poruka putem
 *     e-pošte". The Croatian twin of the French `/aventure.html`, Arabic
 *     `/pack.html`, German `/abenteuerreise.html` and Serbian `/ranac.html`.
 *   - **`/kontakt.html` — the contact form, 359 ch.** *Over* the 250 floor, so
 *     blocking is what excludes it. Carries a Cloudflare Turnstile widget.
 *   - **`/a/osobno2.html` — 1,064 ch, and it MATCHES `articleHints`, so `block`
 *     is the ONLY thing keeping it out.** "Što sada kad ste započeli osoban
 *     odnos s Bogom?" ("What now that you've begun a personal relationship with
 *     God?") — a post-decision follow-up that *poses* six seeker questions and
 *     then answers none of them, inviting an email instead ("javite nam se!
 *     Ispunite niže navedena polja"), followed by a privacy notice and a
 *     Turnstile-guarded form. It shares **0.0% of its 12-word shingles** with
 *     `/a/osobno.html`, so it is not a duplicate — it is simply a form page.
 *     Absent from both sitemaps today but linked from 13 articles' CTA; blocked
 *     so a regenerated sitemap or a later hand-added seed cannot admit it. Same
 *     call as `-pl`'s `/a/nowezycie.html`.
 *
 * **Expected yield: 41 documents** — all 41 sitemap articles are kept; nothing
 * under `/a/` in the sitemap is blocked.
 *
 * ⓘ **One judgement call left open for review: `/a/razbijeni-tanjuri.html` is
 * KEPT.** It is the Croatian "Falling Plates" film page — 1,321 ch, of which
 * the bulk is the film's narration under a "Video tekst:" heading ("Ti. Pogledaj
 * u svoje oči… Ja te volim."). `-pl` blocked its equivalent (`/wideo.html`,
 * 1,490 ch) and `-sr` blocked `/a/tanjiri.html`, but both differ from this one:
 * the Polish transcript extracts as ~60 one-line blocks that chunk badly against
 * paragraph boundaries (invariant 4), and the Serbian page is a 33-char stub
 * under the floor. Here the transcript is genuine paragraph-shaped prose, 5×
 * over the floor, and the site lists it as an article in BOTH its XML sitemap
 * and its HTML map. Kept on that evidence rather than dropped on my own
 * judgement; blocking it is a one-line addition if the orchestrator disagrees,
 * and it costs one document either way.
 *
 * `requestDelayMs: 1000` — the politeness default. We pay this host's bandwidth
 * directly rather than proxying through Firecrawl, so it is real; ~70 sequential
 * plain-HTTP requests drew **zero 429s** and no throttling, so the sibling
 * default is kept rather than raised.
 */
import type { SourceEntry } from "./types.js"

export const everystudentHr: SourceEntry = {
  key: "everystudent-hr",
  name: "EveryStudent — Croatian (vrlovazno.com)",
  domain: "www.vrlovazno.com",
  trust: "partner",
  ingestionMode: "html-scrape",
  languages: ["hr"],
  defaultTags: ["everystudent", "cru", "topic:seeker", "lang:hr"],
  defaultCategory: "article",
  rights:
    "© vrlovazno.com (Cru) — partner ministry content; used for retrieval/attribution.",
  crawl: {
    baseUrl: "https://www.vrlovazno.com",
    // No `fetchStrategy`: verified 2026-07-29 that plain HTTP (Apache/HTTP2)
    // serves all 54 sitemap URLs. The Cloudflare Turnstile script on the two
    // form pages is a CAPTCHA widget, not a bot wall — both returned 200 with
    // full HTML to plain curl. See header.
    sitemaps: ["/sitemap.xml"],
    // No `seedPaths`: the site's own HTML map (/m/sitemap.html, "Mapa weba")
    // lists exactly the same 41 /a/ URLs as the XML sitemap — zero delta in
    // BOTH directions, so there is nothing to pin. The only live /a/ URL either
    // map omits is /a/osobno2.html, which is a form page and is blocked below.
    allow: ["^https://www\\.vrlovazno\\.com/"],
    // The whole article corpus and nothing else: 41 of the 54 sitemap URLs.
    // `[^/]+` rather than a lowercase class — checked 2026-07-29 that all 54
    // <loc> values are lowercase ASCII with zero non-ASCII bytes and zero %XX
    // escapes (the site de-diacriticises: /a/savrsenog.html for "savršenog"),
    // but a mixed-case slug elsewhere on this estate must not silently vanish.
    articleHints: ["^https://www\\.vrlovazno\\.com/a/[^/]+\\.html$"],
    block: [
      // ── This one matches articleHints; `block` is the ONLY thing excluding it.
      // "Što sada kad ste započeli osoban odnos s Bogom?" — a post-decision
      // follow-up that poses six questions, answers none, and asks for an email
      // (1,064 ch, Turnstile-guarded form). Absent from both sitemaps but linked
      // from 13 articles' CTA. Same call as -pl's /a/nowezycie.html.
      "^https://www\\.vrlovazno\\.com/a/osobno2\\.html$",
      // ── Below here articleHints already excludes them; these record WHY, so a
      // later widening of the hints cannot silently readmit them.
      // The 9 section indexes (faq, intl, o, odnosi, pitanja, postojanje,
      // sitemap, upoznati, zastiti) — 40-1,598 ch of headline+teaser link list,
      // four of them reached only via the <body> fallback, so ALL clear the 250
      // floor. /m/sitemap.html is the site plan ("Mapa weba"); /m/o.html is the
      // about page; /m/zastiti.html is the privacy statement; /m/intl.html is
      // the page linking out to the sibling language domains.
      "^https://www\\.vrlovazno\\.com/m/",
      // The two email-series signups, both well over the floor:
      // upoznajmo-Boga-zajedno = "proučavanje Evanđelja po Ivanu", the
      // Gospel-of-John email study (1,832 ch) — Croatian twin of the French
      // /jean.html and Polish /jan.html;
      // duhovni-izazovi = "Duhovni izazovi", "serija od sedam poruka putem
      // e-pošte" (1,515 ch) — Croatian twin of the French /aventure.html and
      // Arabic /pack.html;
      // kontakt = the contact form (359 ch, ABOVE the floor).
      "^https://www\\.vrlovazno\\.com/(upoznajmo-Boga-zajedno|duhovni-izazovi|kontakt)\\.html$",
      // The homepage — 935 ch of teaser headlines via the <body> fallback, NOT
      // 0. Only a URL block excludes it.
      "^https://www\\.vrlovazno\\.com/?$",
      // NOTE: no dead-URL blocks. All 54 sitemap URLs were GET-swept 2026-07-29
      // and returned 54 x 200 with ZERO redirects — nothing 301s to the
      // homepage or to a nav index here.
    ],
    // ONLY `.contentpadding` — measured 2026-07-29 across all 54 sitemap pages
    // as the sole element on this host that extracts the article (46/54 match,
    // none empty, 155-22,215 ch; 1,266-28,617 ch over the 41 articles).
    // `.content4` is deliberately ABSENT: it matches 39/41 articles and extracts
    // 0 chars on every one of them, and because extractContent scopes to the
    // FIRST selector that MATCHES rather than the first that yields text,
    // listing it here would make every article skip as `too-thin` on an HTTP
    // 200. `.content4b` matches 2 pages and is also empty; adding it would drop
    // /a/bibliji.html and /a/osobno.html, which the implicit root fallback
    // extracts correctly at 28,617 and 6,783 ch. `.content4c`,
    // `.contentleftpadding`, `.cb-entry-content`, `.entry-content`,
    // `.article-content`, `.content`, <article> and <main> are all 0 matches
    // here, and <body> is absent from all 42 article pages. See header.
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
      "form",
      // Site-specific chrome — all counted in THIS host's markup (see header):
      "sitelevel_noindex", // custom ELEMENT tag: 2 inst / 115 ch ("POŠALJI PRIJATELJU:" + related block); 4 inst / 971 ch on the two root-fallback pages
      ".shareiconsmenupg", // NO-OP in list order (0 ch) — sitelevel_noindex is well-formed here and already contains it. Drift guard only; 21 ch if measured alone.
      ".fctable", // the "FEATURE CLOSE" CTA table — 70-195 ch, real work
      ".fccell", // its cells: 0 ch where nested in .fctable, but 140 ch on /a/osobno.html where .fctable has 0 instances. Both are load-bearing.
      ".sidebar", // NO-OP in list order (0 ch); 94 ch alone. Pure nav ("Imate pitanje?…", "► Mapa weba…"), never article text. Drift guard.
      ".hr2", // empty divs drawing the rules bracketing the CTA block, 0 ch
      ".articledivider", // 0 ch
      ".relatedbottom", // 0 instances on this host; kept for sibling parity
    ],
    requestDelayMs: 1000, // direct fetches, no Firecrawl proxy; 0 x 429 observed
    maxPages: 80, // 54 sitemap entries (41 articles kept) + headroom
    minContentLength: 250,
  },
}
