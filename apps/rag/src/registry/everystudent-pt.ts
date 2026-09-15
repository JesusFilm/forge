/**
 * EveryStudent — Portuguese (suaescolha.com). The Brazilian-Portuguese banner
 * of Cru's seeker-facing Q&A ministry: short apologetics/life-issue articles
 * aimed at Portuguese-speaking students who are not believers.
 *
 * **A separate SOURCE KEY, not a language of `everystudent`** — one domain =
 * one source (ADR-0006). suaescolha.com is its own domain, so it gets its own
 * key, exactly as `everystudent-ar` (everyarabstudent.com) and
 * `everystudent-fr` (questions2vie.com) do, and as `thelife-fr` /
 * `thelife-zh` are kept separate from `thelife`.
 *
 * **NOT WALLED — `fetchStrategy` is deliberately omitted (plain HTTP).**
 * Verified 2026-07-28: 33 pages were fetched with plain `curl` and a browser
 * UA — `robots.txt`, `/sitemap.xml`, 27 `/a/*` article pages and 6 non-article
 * pages — and **every one returned HTTP 200 with real content**. Cloudflare
 * fronts the host (`server: cloudflare`, `cf-ray` on every response) but serves
 * normally: no `Attention Required`, no `Just a moment`, no 403 anywhere. This
 * is the important difference from all three of its EveryStudent siblings,
 * which are walled and billed per page through Firecrawl (ADR-0012). Nothing
 * about this source needs to cost credits. Bare `suaescolha.com` 301s to the
 * `www.` host, so `baseUrl` is pinned to `www.`.
 *
 * **robots.txt is `User-agent: * Allow: /`** — fetched live 2026-07-28 (HTTP
 * 200, `last-modified: 2018-05-03`). It is the entire file. Nothing on this
 * domain is disallowed, so no URL needed dropping on robots grounds. Same as
 * questions2vie.com and everyarabstudent.com, and UNLIKE everystudent.com,
 * which carries a real disallow list.
 *
 * **DISCOVERY MODE, not hand-listed seeds** — the opposite call from the three
 * walled siblings, and for the opposite reason. There, `/sitemap.xml` was
 * unreachable and every fetch was billed, so a pre-paid inventory was lifted in
 * by hand. Here the sitemap answers plain HTTP for free, so hand-listing would
 * just freeze a snapshot that rots. Precedent: `thelife-fr`.
 *
 * **`/sitemap.xml` → HTTP 200, 74 `<loc>` entries** (verified 2026-07-28).
 * The split is unambiguous:
 *   - **62 `/a/<slug>.html`** — the article corpus. This is the whole of it;
 *     the site has no `/faq/`, `/wires/`, `/features/` split like the English
 *     host, just one flat `/a/` directory.
 *   - **12 non-articles**, all excluded by `articleHints` and again by `block`:
 *     the homepage, the **6 `/m/*` menu indexes** (`conhecendo`, `existencia`,
 *     `faq`, `intl`, `relacionamentos`, `vida` — navigation, and `/m/intl.html`
 *     is the page linking out to the sibling language domains, dropped for the
 *     same reason the English entry drops `/menus/intl.html`), `/mapa.html`
 *     (the "Mapa do site" page — the Portuguese twin of the English
 *     `/sitemap.html` and the French `/plan.html`), `/sobre.html` (about +
 *     privacy policy), `/contato.html` (contact form), `/promocion/`
 *     ("Promova este site"), and `/joao.html`.
 *
 * ⚠️ **The sitemap is STALE — 13 articles are pinned as `seedPaths` to cover
 * the gap.** It is machine-generated (`created with Free Online Sitemap
 * Generator www.xml-sitemaps.com`) and **every single `<lastmod>` reads
 * `2021-12-24`**, which is the signature of a one-off generator run that was
 * never repeated. Cross-checked 2026-07-28 against the site's own
 * `/mapa.html`, which links **75** `/a/*.html` articles: a strict superset —
 * the sitemap's 62 plus 13 more, with nothing in the sitemap missing from the
 * map page. All 13 were fetched individually and all returned HTTP 200 with the
 * full article template and Portuguese prose. Discovery alone would therefore
 * silently miss **17% of the corpus**, so they are pinned here.
 * `acquire.ts` unions `seedPaths` with discovered URLs
 * (`[...new Set([...seeds, ...disc.urls])]`), which is exactly the "a discovery
 * source can still pin extra pages" case its docstring sanctions — so the
 * effective article set is **75**. If the sitemap is ever regenerated these 13
 * become harmless duplicates that the union dedupes.
 *
 * ⓘ Three of the 13 are video pages (`/a/pratos.html`,
 * `/a/video-ajuda-de-Deus.html`, `/a/video-conhecendo-a-Deus.html`) and were
 * checked before being pinned: each carries a full `Transcrição do vídeo`,
 * measured 1,438 / 6,143 / 6,446 chars of real prose after chrome removal —
 * genuine transcripts, not media stubs. Same call the English entry made in
 * keeping `/videos/*`.
 *
 * **`/joao.html` is blocked on sibling evidence.** It is the Gospel-of-John
 * email-study signup ("Conheça Deus Melhor com o Evangelho de João" … "Quero me
 * inscrever!!!" over a `<input type="submit">`) — the exact twin of the French
 * `/jean.html`, which slice #10 seeded provisionally, paid to fetch, then
 * dropped at Stage 1 as an email-signup landing page rather than an article.
 * That lesson is applied up front here instead of being re-learned.
 *
 * **The three `2`-suffixed pairs are NOT duplicates — measured, all kept.**
 * `/a/ceu.html` ↔ `/a/ceu2.html`, `/a/quem.html` ↔ `/a/quem2.html`,
 * `/a/reencarnacao.html` ↔ `/a/reencarnacao2.html` look like the near-duplicate
 * trap the English entry hit with `/podcasts/*` (93.8% overlap) and the French
 * one with `/jean.html` (87.9%). They are not: 12-word shingle overlap measured
 * 2026-07-28 at **12.5% / 5.4% / 11.3%**. They are article continuations —
 * `/a/quem.html` opens "[continuação do artigo «Alguma coisa»]" — so all six
 * pages stay.
 *
 * **Extraction — the shared `.content4` template does NOT bind; `.contentpadding`
 * is the container.** Re-verified 2026-07-28 by running the repo's own
 * `extractContent` against live pages, which is the only check that proves
 * anything (every one of these tokens is also declared in an inline `<style>`):
 *   - `.contentpadding` — **1 instance, the whole article**.
 *     `/a/deusexiste.html` → 19,147 chars raw, **18,807 after stripping**;
 *     `/a/coronavirus.html` → 9,604 raw / 9,384 stripped.
 *   - `.content4` — **1 instance, an empty spacer div: 0 characters.**
 *   - `.content4b` — **0 instances.** Absent from this host entirely.
 *   - `.articletitle` — an `<h1>`, 12–36 chars. A title, not a body.
 * `extractContent` scopes to the FIRST selector that MATCHES AN ELEMENT, not the
 * first that yields text, so listing `.content4` ahead of `.contentpadding`
 * bound the empty spacer and extracted **0 chars on every page** — every article
 * skipped as `too-thin` on a 200 status, with no error anywhere. That is how
 * this entry first shipped.
 *
 * **Chrome — re-counted 2026-07-28 INSIDE `.contentpadding`.** The earlier
 * figures were taken against a container that extracted nothing and are
 * superseded:
 *   - `sitelevel_noindex` is a real custom **ELEMENT**, not a class — **2
 *     instances inside `.contentpadding`, 154 chars** on both sampled pages. It
 *     is the FreeFind "no index" wrapper. ⚠️ Its nesting in the source is
 *     **malformed** — it opens inside `.contentpadding` and closes only after
 *     `.contentpadding` does, so the parser pops it early and it does **not**
 *     contain the share block (#128). Hence the belt-and-braces below.
 *   - `.shareiconsmenupg` — **added for this host and load-bearing**: 1 instance,
 *     **26 chars**. It is the div that actually holds `COMPARTILHE ESTA PÁGINA:`
 *     and the share icons, and it is the only selector that removes them.
 *   - `.fccell` — the "FEATURE CLOSE" call-to-action table ("Como começar um
 *     relacionamento com Deus", "Tenho uma pergunta…"): 6 instances / **186
 *     chars** on `deusexiste`, 4 / **66** on `coronavirus`.
 *   - `.hr2` (2 instances) and `.articledivider` (1) — empty divider divs
 *     bracketing the FEATURE CLOSE table. **0 chars**; free to strip.
 *   - `.relatedbottom` — **zero markup occurrences on all 33 pages fetched**;
 *     it exists only as a CSS rule in the stylesheet. Retained purely for
 *     parity with the sibling entries, but it is dead config on this host and
 *     should not be read as a measurement.
 *
 * ⓘ Corroborating signal: `.fccell`, `.hr2` and `.articledivider` appear on
 * **27/27 article pages and 0/6 non-article pages**. The URL-pattern filter and
 * the page structure agree on what an article is here.
 *
 * **Language: `["pt"]` — read, not assumed.** Every one of the 33 pages fetched
 * declares `<html lang="pt-br">` with `charset=utf-8`, and the prose was read
 * directly to confirm it is genuine Portuguese rather than untranslated
 * English: "Pelo menos uma vez na vida, você não adoraria que alguém
 * simplesmente lhe mostrasse a prova da existência de Deus?"
 * (`/a/deusexiste.html`). It reads as **Brazilian** rather than European
 * Portuguese — pervasive `você` as the default second person, `COMPARTILHE`
 * (rather than *partilhe*), the pre-2009-reform Brazilian spelling `idéia` in
 * `/a/inferno.html`, and Brazilian-Portuguese Bible book names throughout
 * ("João", "Apocalipse", "Deuteronômio"). Recorded as an observation for the
 * corpus, not a decision — the tag stays the ISO `pt`. The stored per-document
 * label still comes from content detection at ingest (invariant 6), never from
 * this field.
 *
 * ⚠️ **Portuguese appears to be a NEW language for this corpus** — no existing
 * registry entry declares `pt`. If that holds at Stage 4 it is a single-source
 * language, which changes the golden-case gating relative to slice #10's French
 * (where 159 `fr` documents already existed). Confirm against the live corpus
 * before assuming it.
 *
 * `requestDelayMs: 1000` — measured 2026-07-28 over 33 sequential fetches:
 * response times 0.27–1.0s, zero 429s, no throttling or degradation observed.
 * 1s is comfortably polite for a static host serving from cache.
 */
import type { SourceEntry } from "./types.js"

export const everystudentPt: SourceEntry = {
  key: "everystudent-pt",
  name: "EveryStudent — Portuguese (suaescolha.com)",
  domain: "www.suaescolha.com",
  trust: "partner",
  ingestionMode: "html-scrape",
  languages: ["pt"],
  defaultTags: ["everystudent", "cru", "topic:seeker", "lang:pt"],
  defaultCategory: "article",
  rights:
    "© SuaEscolha.com (Cru) — partner ministry content; used for retrieval/attribution.",
  crawl: {
    baseUrl: "https://www.suaescolha.com",
    // No `fetchStrategy`: this host is NOT walled — 33/33 plain-HTTP probes
    // returned 200 on 2026-07-28. Plain HTTP is the default (ADR-0012).
    sitemaps: ["/sitemap.xml"],
    // The 13 `/a/` articles the stale 2021-12-24 sitemap omits, recovered from
    // the site's own /mapa.html and each verified HTTP 200 with the full
    // article template on 2026-07-28. acquire.ts unions these with the
    // discovered set, so the effective corpus is 62 + 13 = 75. See the header.
    seedPaths: [
      "/a/astrologia.html",
      "/a/ateia.html",
      "/a/blues.html",
      "/a/bondade.html",
      "/a/casamento.html",
      "/a/chakras.html",
      "/a/conhecer.html",
      "/a/dezenove.html",
      "/a/filosofia.html",
      "/a/pratos.html",
      "/a/solidao.html",
      "/a/video-ajuda-de-Deus.html",
      "/a/video-conhecendo-a-Deus.html",
    ],
    allow: ["^https://www\\.suaescolha\\.com/"],
    // Articles live in one flat /a/ directory; nothing else on the host is one.
    articleHints: ["^https://www\\.suaescolha\\.com/a/[^/]+\\.html$"],
    block: [
      // /m/* are the menu section indexes — navigation, not articles.
      // /m/intl.html is also the page linking out to the sibling language domains.
      "^https://www\\.suaescolha\\.com/(m|menu|menus)/",
      // mapa = "Mapa do site" (the /sitemap.html twin); sobre = about + privacy;
      // contato = contact form; joao = the Gospel-of-John email-signup landing
      // page (the French /jean.html twin, dropped at slice #10 Stage 1).
      "^https://www\\.suaescolha\\.com/(mapa|contato|sobre|joao)\\.html$",
      // "Promova este site" — promotional chrome.
      "^https://www\\.suaescolha\\.com/promocion/",
      "\\.pdf($|\\?)",
    ],
    // ONLY `.contentpadding` — measured 2026-07-28 as the sole element on this
    // host that extracts the article. `.content4` is deliberately ABSENT: it is
    // an empty spacer div (0 chars) and, because extractContent scopes to the
    // first selector that MATCHES rather than the first that yields text,
    // listing it here made every page skip as `too-thin`. `.content4b` does not
    // exist on this host.
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
      // Site-specific chrome, measured on THIS host 2026-07-28 (see header):
      "sitelevel_noindex", // custom ELEMENT: cookie/nav wrapper + share block; malformed nesting
      ".shareiconsmenupg", // "COMPARTILHE ESTA PÁGINA:" + AddToAny icons — 27/27 pages
      ".fccell", // "FEATURE CLOSE" CTA table — 4-8 per page, 64-183 ch of chrome
      ".hr2", // empty dividers bracketing the CTA table — 2-4 per page
      ".articledivider", // 24/27 pages
      ".relatedbottom", // parity with siblings only — 0 markup occurrences here
    ],
    requestDelayMs: 1000, // measured 0.27-1.0s/page, zero 429s over 33 fetches
    maxPages: 120, // 62 discovered + 13 pinned = 75 articles, + headroom
    minContentLength: 250,
  },
}
