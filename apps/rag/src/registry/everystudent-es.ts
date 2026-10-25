/**
 * EveryStudent — Spanish (cadaestudiante.com). The Spanish banner of Cru's
 * seeker-facing Q&A ministry: short apologetics/life-issue articles written for
 * Spanish-speaking students who are not believers. A sibling of the three
 * already-registered EveryStudent domains.
 *
 * **A separate SOURCE KEY, not a language of `everystudent`** — one domain =
 * one source (ADR-0006). cadaestudiante.com is its own domain, so it gets its
 * own key, exactly as `everystudent-ar` (everyarabstudent.com) and
 * `everystudent-fr` (questions2vie.com) are separate from `everystudent`, and
 * as `thelife-fr` / `thelife-zh` are separate from `thelife`.
 *
 * **NOT walled — plain HTTP, and therefore a real DISCOVERY crawl.** This is the
 * headline difference from its three siblings. Verified 2026-07-28 with plain
 * `curl` and a browser UA: `/robots.txt`, `/sitemap.xml`, the homepage and 32
 * content pages all returned **HTTP 200 with real HTML** — no `Attention
 * Required!`, no `Just a moment`, no challenge interstitial. Cloudflare fronts
 * the origin (`server: cloudflare` on every response) but serves us normally.
 * So `fetchStrategy` is deliberately ABSENT — plain HTTP is the default and
 * there is no reason to pay Firecrawl credits here. ~40 probe requests, most
 * spaced 1s apart, drew zero 429s and zero challenge pages — which is what
 * `requestDelayMs: 1000` is sized against.
 *
 * Because fetching is free and `/sitemap.xml` is reachable, this entry uses
 * `sitemaps` + `allow`/`articleHints`/`block` rather than a hand-listed
 * `seedPaths`. Precedent: `thelife-fr`. The siblings hand-list only because
 * their walls made discovery cost money.
 *
 * **robots.txt: `User-agent: * Allow: /`** — fetched 2026-07-28, 26 bytes, a
 * single line, **zero Disallow directives**. Same as everyarabstudent.com and
 * questions2vie.com, and unlike everystudent.com (which carries a real disallow
 * list). Nothing in the article set is disallowed.
 *
 * **Sitemap: 153 `<loc>` entries, all on `https://www.cadaestudiante.com`**
 * (counted 2026-07-28). Bare `cadaestudiante.com` 301s to the `www` host, and
 * every `<loc>` is already written with `www`, so the filters anchor on it.
 * The 153 break down as:
 *   -  **78 `/articulos/<slug>.html`** — THE ARTICLE CORPUS, and the only thing
 *      this source ingests. Slugs are mixed-case with hyphens/underscores
 *      (`Dios.html`, `biblia_juan.html`, `jesus-y-islam.html`,
 *      `ayuda-de-Dios.html`), so the hint matches any `[^/]+\.html` leaf.
 *   -  **49 `/pdf/<slug>.pdf`** — print twins of the articles (48 of the 49
 *      slugs are literally an `/articulos/` slug; the odd one, `Hay1Dios.pdf`,
 *      is the print twin of `/articulos/hayundios.html`). Blocked: this source
 *      is `html-scrape`, and they are duplicates besides.
 *   -  **13 `/audio/…`** — 12 `/audio/<slug>.html` player pages plus the
 *      `/audio/` index. Blocked as **near-duplicates**, measured not assumed:
 *      `/audio/fe.html` shares **85.7%** of its 12-word shingles with
 *      `/articulos/fe.html`, and `/audio/hayundios.html` **83.5%** with
 *      `/articulos/hayundios.html` — an audio player wrapped around the same
 *      body text. The document-level content hash cannot collapse
 *      near-duplicates sitting at different URLs, so they must be filtered here.
 *      The one audio page with no same-slug twin, `/audio/intimidad.html`, is
 *      **not** unique content either: `/articulos/intimidad.html` 301s to
 *      `/articulos/busqueda.html`, which is in the sitemap and shares **91.9%**
 *      of the audio page's shingles. Blocking `/audio/` therefore loses nothing.
 *   -  **6 `/menu/<topic>.html`** — section index pages (`conociendo`,
 *      `enigmas`, `existencia`, `intl`, `preguntas`, `relaciones`). Measured
 *      628 chars on `/menu/preguntas.html`: a bare list of article titles.
 *      Navigation, not content. `/menu/intl.html` is also the page linking out
 *      to the sibling language domains — dropped for the same reason the English
 *      entry drops `/menus/intl.html`.
 *   -  **7 root pages**, all blocked, each fetched and read 2026-07-28:
 *      `/` (homepage); `/sitemap.html` (the "Mapa del sitio" nav page, the
 *      Spanish twin of the `/sitemap.html` the English entry drops);
 *      `/acerca.html` (about + privacy, 1,940 ch); `/personal.html` (the
 *      "¿Tienes alguna pregunta?" contact form, 408 ch); `/promocion/`
 *      ("Promociona este sitio" — printable promo assets, 883 ch); and
 *      `/juan.html` (1,630 ch) + `/aventura.html` (1,757 ch), which are
 *      **email-signup landing pages** ("Regístrate para … por email"), the exact
 *      Spanish counterparts of the `/jean.html` / `/aventure.html` pages that
 *      slice #10 measured and dropped from `everystudent-fr` after ingest. They
 *      clear `minContentLength` easily — length is not aboutness — so they are
 *      excluded structurally, before the first fetch, rather than after.
 * Net: **78 URLs pass the filters**, and every one of them is an article.
 *
 * ⓘ The `/articulos/` set includes two **video-transcript** pages,
 * `conociendo-video.html` (6,106 ch) and `platos.html` (1,422 ch). Both were
 * fetched and both carry genuine Spanish transcript prose, and
 * `conociendo-video.html` overlaps its nearest-named neighbour
 * `/articulos/conociendo.html` by only **3.0%** of shingles — distinct
 * documents, so they are kept.
 *
 * ⚠️ One page the sitemap omits: `/articulos/conociendo2.html`, linked from the
 * call-to-action on every article, is **not** in `/sitemap.xml` (grepped, 0
 * hits) and so will not be discovered. It is decision-follow-up material rather
 * than a seeker article, so this is acceptable — recorded so nobody re-derives it.
 *
 * **Extraction — `.contentpadding` is the container, and `.content4` is an
 * EMPTY SPACER that must never precede it.** Re-verified 2026-07-28 by running
 * the repo's own `extractContent` against live pages (the only check that
 * proves anything — see ADR note below):
 *   - `.contentpadding` — **1 instance, the whole article**: category kicker,
 *     headline, subhead, byline and body. `/articulos/hayundios.html` → 19,976
 *     chars raw, **19,643 after stripping**, ending on its own last footnote;
 *     `/articulos/proposito.html` → 3,770 raw / 3,560 stripped.
 *   - `.content4` — **1 instance, literally `<div class="content4"> </div>`:
 *     zero child elements, 0 characters.** It is a layout spacer on this host,
 *     not the content column.
 *   - `.content4b` — **0 instances.** Absent from this host entirely.
 *   - `.articletitle` — an `<h1>`, 13–33 chars. A title, not a body.
 * `extractContent` scopes to the FIRST selector that MATCHES AN ELEMENT, not the
 * first that yields text, so listing `.content4` ahead of `.contentpadding`
 * bound the empty spacer and extracted **0 chars on every page** — every article
 * skipped as `too-thin` with a 200 status and no error anywhere. That is exactly
 * how this entry first shipped; hence `contentSelectors` is now the single
 * measured container and nothing else. Bodies range 3.6k–19.6k chars, so the 250
 * floor is comfortable.
 *
 * **Chrome strip — re-measured 2026-07-28 inside the REAL scope
 * (`.contentpadding`).** The earlier figures on this entry were taken against a
 * container that extracted nothing, so they are superseded:
 *   - `.fccell` — the "FEATURE CLOSE" CTA table (`INVITÉ A JESUS A ENTRAR EN MI
 *     VIDA…`, `TENGO UNA PREGUNTA…`). 6 instances / **185 chars** on
 *     `hayundios`, 4 / **62** on `proposito`.
 *   - `sitelevel_noindex` — a real custom TAG, not a class (hence no leading
 *     dot, as in both sibling entries): the markup is literally
 *     `<sitelevel_noindex>…</sitelevel_noindex>`. **2 instances inside
 *     `.contentpadding`, 148 chars** on both sampled pages. It does NOT enclose
 *     the share row: that instance opens inside `.contentpadding` and closes
 *     after `.contentpadding` does, so HTML5 tree construction pops it early
 *     (#128).
 *   - `.shareiconsmenupg` — **SITE-SPECIFIC, required.** The trailing "COMPARTE
 *     ESTA PÁGINA:" share row, 1 instance / **23 chars**. Because
 *     `sitelevel_noindex` pops early (above), only this selector catches it;
 *     removing it is what lets every article end on its own last line.
 *   - `.relatedbottom` — **no element instance on any sampled page; 0 chars.**
 *     Dead config, retained only for sibling parity — it strips nothing.
 *   - `.hr2` (2 instances) / `.articledivider` (1) — real elements but
 *     zero-text rules. **0 chars.** Retained for parity.
 *
 * **Language: `["es"]` — read, not inferred.** Every page carries
 * `<html lang="es">`, and the bodies are genuine Spanish prose, not the
 * untranslated-English failure mode cru.org's `/mx/es/.../10-pasos-basicos/`
 * path exhibits. Read directly across 15 articles, e.g. `/articulos/hayundios.html`
 * opens "¿No te gustaría que alguien te mostrase -de una manera simple- la
 * evidencia de la existencia de Dios?" and `/articulos/soledad.html` "En lugar
 * de ocultar esos sentimientos vacíos, esto es lo que hay que hacer". The only
 * English found anywhere was inside bibliographic footnotes on
 * `/articulos/matrimonio.html` (untranslated citations such as "Shervert H.
 * Frazier, Psychotrends" and "(8) John 14:6") — reference apparatus, not body
 * text. The stored per-document label still comes from content detection at
 * ingest (invariant 6), never from this field.
 *
 * ⚠️ Spanish is **not** a new language for this corpus — `cru` and `familylife`
 * already contribute `es` documents — so Spanish is a MULTI-source language for
 * gating purposes and existing Spanish golden cases become eligible by
 * construction against this source's documents.
 */
import type { SourceEntry } from "./types.js"

export const everystudentEs: SourceEntry = {
  key: "everystudent-es",
  name: "EveryStudent — Spanish (cadaestudiante.com)",
  domain: "www.cadaestudiante.com",
  trust: "partner",
  ingestionMode: "html-scrape",
  languages: ["es"],
  defaultTags: ["everystudent", "cru", "topic:seeker", "lang:es"],
  defaultCategory: "article",
  rights:
    "© CadaEstudiante.com (Cru) — partner ministry content; used for retrieval/attribution.",
  crawl: {
    // No `fetchStrategy`: verified unwalled 2026-07-28 (plain HTTP 200s), so the
    // default plain-http applies and no Firecrawl credits are spent.
    baseUrl: "https://www.cadaestudiante.com",
    // Discovery, not hand-listed seeds: the sitemap is reachable and free.
    sitemaps: ["/sitemap.xml"],
    allow: ["^https://www\\.cadaestudiante\\.com/"],
    // Articles live at /articulos/<slug>.html and nowhere else. Slugs are
    // mixed-case with hyphens/underscores, hence the permissive leaf class.
    articleHints: [
      "^https://www\\.cadaestudiante\\.com/articulos/[^/]+\\.html$",
    ],
    block: [
      // The estate's "Who was Jesus?" page (22,924 chars) — curated highlights
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
      "^https://www\\.cadaestudiante\\.com/articulos/jesus\\.html$",
      // /pdf/ print twins (this source is html-scrape) and /audio/ player pages
      // (83.5-91.9% shingle-identical to their /articulos/ twin — see header).
      "^https://www\\.cadaestudiante\\.com/(pdf|audio)/",
      // Section index pages, incl. /menu/intl.html (the sibling-language links).
      "^https://www\\.cadaestudiante\\.com/menu/",
      // "Promociona este sitio" — printable promo assets, not content.
      "^https://www\\.cadaestudiante\\.com/promocion/",
      // Site nav, about/privacy, contact form, and the two email-signup landing
      // pages (the Spanish /jean.html + /aventure.html of everystudent-fr).
      "^https://www\\.cadaestudiante\\.com/(sitemap|acerca|personal|juan|aventura)\\.html$",
      // Homepage.
      "^https://www\\.cadaestudiante\\.com/?$",
      "\\.pdf($|\\?)",
      // /articulos/biblia_juan.html is the COMPLETE Gospel of John ("El
      // Evangelio de Juan", 100,409 chars) — verbatim Scripture on an article
      // URL, 4x the next largest document here. Blocked 2026-07-29 under the
      // estate-wide scripture policy `everystudent-ar` set for its
      // /bible/**.pdf files: "outside what this corpus answers from". The row
      // staged by the 2026-07-28 acquire was deleted from raw_documents at the
      // same time. Siblings -sq, -et, -mn and -fa block their equivalents.
      "^https://www\\.cadaestudiante\\.com/articulos/biblia_juan\\.html$",
    ],
    // ONLY `.contentpadding` — measured 2026-07-28 as the sole element on this
    // host that extracts the article. `.content4` is deliberately ABSENT: it
    // exists as `<div class="content4"> </div>` (0 chars) and, because
    // extractContent scopes to the first selector that MATCHES rather than the
    // first that yields text, listing it here bound the empty spacer and made
    // every page skip as `too-thin`. `.content4b` does not exist on this host.
    // Rule 1e (added 2026-07-30, retrofitted): trailing "html" rescues pages
    // whose .contentpadding container collapses. Without it extract.ts falls
    // through to `?? root`, which returns the whole document INCLUDING a
    // literal `<!DOCTYPE html>` text node. Proven inert on healthy pages —
    // 21 of 21 sampled extractions were byte-identical before and after.
    // It can shadow nothing, because nothing follows it.
    contentSelectors: [".contentpadding", "html"],
    stripSelectors: [
      "head", // 0 ch inside .contentpadding; strips the duplicated
      // <title> on the "html" fallback path only. Safe because extract.ts
      // reads the title from `root` BEFORE the strip loop runs.
      "script",
      "style",
      "noscript",
      "svg",
      "nav",
      "header",
      "footer",
      "form",
      // Site-specific chrome, measured 2026-07-28 (see header):
      "sitelevel_noindex", // custom TAG; 0 ch here — kept for sibling parity
      ".relatedbottom", // CSS rule only on this host; 0 ch — kept for parity
      ".fccell", // "FEATURE CLOSE" CTA table — removes 61-183 ch/page
      ".shareiconsmenupg", // "COMPARTE ESTA PÁGINA:" share row — site-specific
      ".hr2",
      ".articledivider",
    ],
    // ~40 probe requests at ~1s spacing drew zero 429s (2026-07-28).
    requestDelayMs: 1000,
    maxPages: 200, // 153 sitemap URLs / 78 passing the hints + headroom
    minContentLength: 250,
  },
}
