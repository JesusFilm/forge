/**
 * EveryStudent — Italian (ognistudente.com, "OgniStudente.com" / "Every
 * student"). The Italian banner of Cru's seeker-facing Q&A ministry: short
 * apologetics and life-issue articles, FAQ answers and first-person testimonies
 * written for Italian-speaking students who are not believers. Run by Agape
 * Italia (Campus Crusade for Christ). A sibling of `everystudent` (en),
 * `everystudent-pl`, `everystudent-sq`, `everystudent-ru`, `everystudent-de`.
 *
 * **A separate SOURCE KEY, not a language of `everystudent`** — one domain =
 * one source (ADR-0006). ognistudente.com is its own domain, so it gets its own
 * key, the same way `everystudent-pl` (kazdystudent.pl), `everystudent-fr`
 * (questions2vie.com), `thelife-fr` (laviejenparle.com) and `thelife-zh`
 * (uwota.com) are separate entries.
 *
 * ## ⚠️ THIS HOST IS NOT THE SHARED EVERYSTUDENT TEMPLATE — it is WordPress
 *
 * Every other sibling in this estate is a hand-built static FreeFind site
 * serving `/a/<slug>.html`. This one is **WordPress 6.7.5 running the theme
 * `sight2016`** (verified 2026-07-29 from `<meta name="generator">` and the
 * `wp-content/themes/sight2016` asset paths). Nothing about the sibling
 * template carries over:
 *   - URLs are flat WordPress permalinks, `/<slug>/` **with a trailing slash** —
 *     there is no `/a/` namespace, no `/m/` namespace, and no `.html` suffix.
 *   - The content container is `.post-content`, an eighth distinct generator
 *     across the 21 siblings measured so far.
 *   - **`sitelevel_noindex`, `.fccell`, `.fctable`, `.hr2`, `.articledivider`,
 *     `.relatedbottom` and `.shareiconsmenupg` do not exist on this host at
 *     all** — 0 occurrences of each in the raw HTML of every page fetched, not
 *     merely 0 extracted chars. They are deliberately ABSENT from
 *     `stripSelectors` below rather than kept as parity no-ops, because on this
 *     generator they are not "the same chrome that happens not to bind" — the
 *     chrome itself is different markup.
 *
 * ## NOT walled — plain HTTP throughout
 *
 * Verified 2026-07-29: robots.txt, /sitemap.xml, **all 50 sitemap URLs**, and 15
 * extra slug probes were fetched with plain `curl` carrying a desktop-Chrome UA.
 * **All 50 sitemap URLs returned HTTP/2 200 with real HTML and no redirect**,
 * and not one page in the corpus carries a Cloudflare block-page signature
 * (grepped for "Attention Required", "cf-error-details", "Just a moment": 0
 * hits). Responses are `server: Apache` with no Cloudflare layer.
 *
 * So `fetchStrategy` is intentionally OMITTED: plain HTTP is the default and
 * nothing here needs Firecrawl (ADR-0012). Discovery is therefore free, making
 * this a **discovery crawl** rather than the hand-listed seed set the three
 * walled banners were forced into. Precedent: `thelife-fr`, `everystudent-sq`.
 *
 * The bare apex **301-redirects to `www`** (measured on /robots.txt: the apex
 * returned 301 → `https://www.ognistudente.com/robots.txt`), so `www.` is the
 * canonical host, it is what every `<loc>` emits, and it is what `domain`,
 * `baseUrl` and every regex below are pinned to.
 *
 * ## robots.txt — six Disallow rules, and ONE of them names a live sitemap URL
 *
 * Verified 2026-07-29: HTTP 200, 160 bytes. The whole file is:
 *
 *     User-agent: *
 *     Disallow: http://www.ognistudente.com/personalmente2/
 *     Disallow: /articoli/
 *     Disallow: /articles/
 *     Disallow: /menu/
 *     Disallow: /menus/
 *     Disallow: /ssi/
 *
 * ⚠️ **The acquire path does not enforce robots.txt (known gap), so these are
 * honoured BY HAND in `block` below.** Checked one by one against the 50
 * sitemap URLs:
 *   - `/articoli/`, `/articles/`, `/menu/`, `/menus/`, `/ssi/` — **0 sitemap
 *     hits each.** These are legacy paths from the pre-WordPress static site;
 *     the current permalink scheme has no such prefixes. Mirrored into `block`
 *     anyway so the rules are enforced rather than merely observed.
 *   - **`Disallow: http://www.ognistudente.com/personalmente2/` — 1 sitemap
 *     hit, and it is the one that matters.** The directive is malformed by the
 *     robots spec (a Disallow value must be a path, not an absolute URL), so a
 *     strict parser would treat it as the literal path
 *     `/http://www.ognistudente.com/personalmente2/` and match nothing. The
 *     INTENT is unmistakable, `/personalmente2/` is live in the sitemap
 *     (HTTP 200, 624 chars extracted), and it matches `articleHints` — so it is
 *     blocked explicitly. This is the one block on this entry made on robots
 *     grounds rather than content quality.
 *
 * ## Sitemap — 50 entries, all distinct, 38 articles
 *
 * Verified 2026-07-29: `https://www.ognistudente.com/sitemap.xml` → HTTP 200,
 * **7,611 bytes**, `application/xml`, a single flat `<urlset>` (no
 * `<sitemapindex>`, so no recursion). It holds 50 `<loc>` elements and **50
 * distinct URLs** — no duplicates. This matches the "~50" from prior recon
 * exactly. The breakdown:
 *   - **38 `/<slug>/` article permalinks** — the keep set.
 *   - **6 `/category/<name>/`** — the WordPress category indexes
 *     (`conoscere-dio`, `domande-e-risposte`, `domande`, `lesistenza`,
 *     `problemi`, `uncategorized`). Excluded by `articleHints`, which requires
 *     a SINGLE path segment; blocked as well, below.
 *   - **`/`** — the homepage. BLOCKED.
 *   - **5 non-article single-segment pages** — `/crediti/`,
 *     `/hai-una-domanda/`, `/mappa-del-sito/`, `/personalmente2/`,
 *     `/lavventura-spirituale-post/`. These match `articleHints` (they are flat
 *     slugs like every article), so **`block` is the only thing excluding
 *     them**. Evidence for each is below.
 *
 * **All 50 are live.** Every one returned 200 with an empty `redirect_url` —
 * there is no dead-redirect cohort of the kind `everystudent-ro` shipped 25 of.
 *
 * Slugs are **pure lowercase ASCII**: all 50 `<loc>` values were scanned for
 * non-ASCII bytes, for `%XX` percent-encoding and for uppercase letters —
 * **zero hits on all three**. The mixed-case hazard (`/a/Dios.html` on `es`,
 * `/a/Boza-pomoc.html` on `pl`) did not materialise here, and that was checked
 * rather than assumed. `[^/]+` is used in the hint regardless, so a future
 * mixed-case slug cannot be silently dropped.
 *
 * ## Cross-checked against the site's own HTML map — no article is missing
 *
 * These sitemaps are known to be stale, so `/mappa-del-sito/` ("Mappa del sito")
 * was fetched and diffed against the XML, and then every internal `href` on all
 * 50 fetched pages was harvested as a wider net. Verified 2026-07-29, after
 * discarding WordPress plumbing (`/wp-json/*`, `/feed/`, `/comments/feed/`,
 * `/xmlrpc.php`, theme assets), the union turned up exactly **four** on-site
 * URLs the XML sitemap lacks — and **all four are 301 redirects to pages
 * already in the sitemap**:
 *
 *   | Link found on-site              | 301 →                            |
 *   |---------------------------------|----------------------------------|
 *   | `/allinizio-era-il-nulla/`      | `/nulla/`                        |
 *   | `/oltre-la-fede-cieca/`         | `/fede/`                         |
 *   | `/personalmente/`               | `/conoscere-dio-personalmente/`  |
 *   | `/lavventura-spirituale/`       | `/lavventura-spirituale-post/`   |
 *
 * These are pre-migration permalinks kept alive as redirects. Every target is
 * already discovered, so **`seedPaths` is deliberately absent: there is nothing
 * to pin.** Unlike `mn` (11 missing live articles) and `cs` (a whole missing
 * section), this host's XML sitemap is complete.
 *
 * ## ⚠️ EXTRACTION — `.post-content`, measured, and NOTHING from the sibling list
 *
 * This is the decision that would silently destroy the source if undone, so
 * every candidate was run through the repo's own parser (`node-html-parser`,
 * exactly as `src/acquisition/extract.ts` uses it) over **all 50 fetched
 * pages** on 2026-07-29 — not grepped. Measured element counts and extracted
 * character counts, across the whole corpus:
 *
 *   | Candidate              | Matches (of 50 pages) | Extracted chars |
 *   |------------------------|-----------------------|-----------------|
 *   | `.post-content`        | 50/50                 | **1,443–28,485**|
 *   | `.contentpadding`      | **0/50**              | n/a (no match)  |
 *   | `.content4`            | **0/50**              | n/a (no match)  |
 *   | `.content4b`           | **0/50**              | n/a (no match)  |
 *   | `.cb-entry-content`    | **0/50**              | n/a (no match)  |
 *   | `.entry-content`       | **0/50**              | n/a (no match)  |
 *   | `.contentleftpadding`  | **0/50**              | n/a (no match)  |
 *   | `.article-content`     | **0/50**              | n/a (no match)  |
 *   | `.articletitle`        | **0/50**              | n/a (no match)  |
 *   | `.content`, `article`, `main` | **0/50**       | n/a (no match)  |
 *   | `body`                 | 50/50                 | 2,462–29,521    |
 *   | `html`                 | 50/50                 | 2,495–29,579    |
 *
 * All seven previously-catalogued container classes are **absent from this
 * host's markup entirely** — 0 matches, which is a stronger result than the
 * `sq` failure mode (matched but extracted 0 chars). There is no zero-char
 * shadowing hazard here because there is nothing to shadow.
 *
 * `.post-content` is ~950–1,000 chars tighter than `body` on every page; the
 * difference is the site-wide chrome `body` folds in and `.post-content`
 * excludes by construction — the tagline "OgniStudente.com: La piazza virtuale
 * dove poter confrontare…", the top nav (Home / Crediti / Hai una domanda? /
 * Mappa del sito), the five section links, and the "INDICE / CERCA" sidebar.
 *
 * ⚠️ `contentSelectors` is **NOT a fallback chain**. `extractContent` scopes to
 * the FIRST selector that MATCHES AN ELEMENT, not the first that yields text.
 * `contentSelectors` here is therefore the single measured container and
 * nothing else — no sibling selectors are listed "as fallbacks", because on
 * this host they cannot bind and listing dead selectors only invites a later
 * reader to copy the pattern onto a host where they DO bind-and-yield-nothing.
 *
 * ⓘ **Unlike most of this estate, `<body>` IS present in the parsed tree here**
 * (WordPress emits well-formed markup; the stray `</sitelevel_noindex>` tags
 * that destroy `<body>` on the FreeFind siblings do not exist). So if
 * `.post-content` ever stopped matching, the fallback would be `<body>` —
 * ~1,000 chars of nav-polluted page, not the whole document with a literal
 * `<!DOCTYPE html>` text node. Still far above the 250 floor, so the URL blocks
 * below remain load-bearing either way.
 *
 * **Measured with `[".post-content"]` plus the strip list below, across the 38
 * kept articles: 1,443 – 28,485 chars, median 9,888, and 0 pages below the 250
 * floor.** Five leftover-chrome probes were then run over all 38 extractions —
 * "Cómo empezar", "Ho una domanda", "Politica di Riservatezza", "INDICE",
 * "Mappa del sito", "<!DOCTYPE" — **0 hits for every one**.
 *
 * ## Chrome stripped — measured inside `.post-content`, 2026-07-29
 *
 * Per-selector figures are the marginal characters each removes, measured by
 * re-running the full extraction with that one selector withheld, on seven
 * articles (`trinita`, `esisteundio`, `preghiere`, `atea`,
 * `ecco-perche-puoi-credere-nella-bibbia`, `chi-2`, `gesu-e-islam`):
 *
 *   - **`.sectionlink` — 2–3 instances, 58–159 chars.** The only real strip on
 *     this host. It is the "FEATURE CLOSE" call-to-action pair appended inside
 *     every article body: an inline-styled `<div>` (no class of its own)
 *     holding two `<a class="sectionlink">` links. This host's equivalent of
 *     the siblings' `.fccell`.
 *     ⓘ Curiosity worth recording: the first link's TEXT is untranslated
 *     **Spanish** — "Cómo empezar una relación con Dios…" — while its `href`
 *     correctly points at the Italian `/conoscere-dio-personalmente/`. The
 *     second, "Ho una domanda…", is Italian. A source-side copy-paste from the
 *     Spanish banner. It is stripped either way, so it never reaches the
 *     corpus; noted so a reader who greps the raw HTML for Spanish is not
 *     alarmed. This does NOT indicate an untranslated body — see Language.
 *   - **`.a2a_kit` — 1 instance inside `.post-content`, 0 chars.** The AddToAny
 *     share-button row. The buttons are images and `structuredText` does not
 *     read `alt`, so it contributes nothing today. Stripped anyway so a future
 *     markup change that adds text labels cannot leak them into every article.
 *     This is the share widget this host actually uses.
 *   - **`sitelevel_noindex`, `.fccell`, `.fctable`, `.hr2`, `.articledivider`,
 *     `.relatedbottom`, `.shareiconsmenupg` — checked, and each is 0 instances
 *     / 0 chars.** Not "0 chars extracted" but **0 occurrences of the token
 *     anywhere in the raw HTML**, because this is WordPress and not the
 *     FreeFind template. They are omitted from `stripSelectors` rather than
 *     retained as parity no-ops: on this generator they cannot drift into
 *     existence, so a guard against that drift would be theatre.
 *     (`.relatedbottom` has now been dead config on every host measured.)
 *
 * ## ⚠️ The blocked pages, and what `minContentLength` can and cannot catch
 *
 * Every excluded page was fetched and extracted. Post-strip figures via
 * `.post-content`, verified 2026-07-29:
 *
 *   - **`/lavventura-spirituale-post/` — 1,364 chars. CLEARS the floor.** "«L'Avventura
 *     Spirituale»", the 7-email series signup: "È una serie di 7 email
 *     intitolato 'L'Avventura Spirituale.' … È completamente gratuito, e ti
 *     invito a registrarti." The Italian twin of the French `/aventure.html`,
 *     German `/abenteuerreise.html`, Albanian `/aventures.html` and Arabic
 *     `/pack.html`.
 *   - **`/personalmente2/` — 624 chars. CLEARS the floor.** "Inizia con Dio",
 *     the post-decision follow-up page ("Bravo per la tua decisione di invitare
 *     Gesù Cristo nella tua vita"), which ends by pushing the reader off-site to
 *     `https://apartiredadio.com`. Blocked on **robots.txt grounds** first and
 *     content grounds second.
 *   - **`/mappa-del-sito/` — 1,454 chars. CLEARS the floor.** The site plan: a
 *     bare "Pages / Posts" link list. Italian twin of the French `/plan.html`
 *     and Polish `/mapa.html`.
 *   - **`/crediti/` — 982 chars. CLEARS the floor.** The about/credits page
 *     ("Questo sito è stato sviluppato da un'organizzazione cristiana
 *     interconfessionale, Agape Italia") plus a privacy-policy link.
 *   - **`/hai-una-domanda/` — 207 chars.** The contact form. This one falls
 *     *below* 250 and the floor would catch it; blocked anyway so the exclusion
 *     is a decision on the record rather than an accident of length.
 *   - **`/` — 76 chars via `.post-content`** (the first of 10 teaser blocks),
 *     **but 2,138 chars if `.post-content` ever stops matching and `<body>`
 *     takes over.** Blocked by URL, not left to the floor.
 *   - **the 6 `/category/<slug>/` indexes — 45–204 chars via `.post-content`,
 *     1,205–2,294 chars via the `<body>` fallback.** Today the floor would
 *     catch all six; on the fallback path none of them would. `articleHints`
 *     excludes them structurally (they carry two path segments) and `block`
 *     records why.
 *
 * ## ⓘ NO full-Scripture page on this host — checked, not assumed
 *
 * Five siblings carry complete Bible books on article URLs (`es`
 * `/articulos/biblia_juan.html` 100,409 ch; `sq` `/a/gjoni.html` 98,887 ch),
 * blocked under the estate-wide scripture policy of 2026-07-29. **This host has
 * no equivalent.** The two Bible-shaped slugs were read in full:
 *   - **`/bibbia/` — 16,001 chars, "Perché scegliere il Dio della Bibbia?"** —
 *     an apologetics essay arguing from the character of God, numbered
 *     sections ("1. Un Dio più grande di noi"), attributed "da: Everystudent.com".
 *     Ministry writing, not Scripture. KEPT.
 *   - **`/ecco-perche-puoi-credere-nella-bibbia/` — 28,485 chars, "Ecco perché
 *     puoi credere nella Bibbia"** — the longest page on the site, and it is an
 *     essay on the Bible's authorship, transmission and archaeology ("La Bibbia
 *     fu scritta da 40 autori in un lasso di tempo di 1500 anni"). KEPT.
 * The longest article is 28,485 chars — 2.9× the median, nowhere near the ~14×
 * outlier that flagged the scripture carriers. Scripture appears only as
 * inline quotation with Italian footnote citations. No third-party
 * Bible-society copyright notice appears on any page.
 *
 * ## ⓘ No `/audio/` or `/v/` pages exist — so there is no overlap call to make
 *
 * `cadaestudiante.com` (`es`) and `duentscheidest.com` (`de`) needed their audio
 * pages blocked as 73–86% reflowed duplicates; `everystudent.ro` kept its `/v/`
 * transcripts. Neither applies here: `/audio/` and `/v/` both return **404**
 * (probed 2026-07-29), and no sitemap URL or on-site link carries either prefix.
 *
 * ## ⓘ The four near-twin slugs are a CONTINUATION SERIES — 0.0% overlap
 *
 * `/nulla/`, `/qualcosa/`, `/chi/` and `/chi-2/` look like the `ceu`/`ceu2`
 * duplicate hazard, so they were measured rather than judged. Verified
 * 2026-07-29 by 12-word shingle comparison of the extracted text: **every pair
 * scores 0.0% overlap** (chi↔chi-2, chi↔qualcosa, qualcosa↔nulla,
 * chi-2↔nulla). They are a deliberate four-part cosmological argument, and each
 * says so in its own first line — `/chi/` opens "Nota: questo è il seguito
 * dell'articolo intitolato: Qualcosa" and `/chi-2/` opens "Nota: questo è il
 * seguito dell'articolo intitolato Chi … Queste sono le conclusioni finali
 * delle discussioni iniziate in All'inizio era il nulla?, seguite da Qualcosa,
 * e poi da Chi." All four are KEPT. `/bibbia/` ↔
 * `/ecco-perche-puoi-credere-nella-bibbia/` and `/dio/` ↔ `/esisteundio/` were
 * measured on the same suspicion: also 0.0%.
 *
 * ## Language: `["it"]` — read, not inferred
 *
 * Verified 2026-07-29 by reading the extracted text myself. The pages serve
 * genuine Italian prose, not untranslated English. `/trinita/` asks "Puoi
 * spiegare la Trinità?" and answers "Quindi il termine: 'Tri' significando tre,
 * e 'Unità' significando uno, Tri+Unità=Trinità. È un modo per riconoscere
 * quello che la Bibbia ci rivela su Dio, il quale è tre 'Persone' aventi la
 * stessa essenza della deità"; `/bibbia/` opens "La natura umana preferisce la
 * libertà di scegliere un Dio 'personale'. Perché quindi scegliere il Dio
 * rivelato nella Bibbia?"; `/lavventura-spirituale-post/` narrates "«Quando ero
 * atea, per me non c'era nulla di più misterioso di questo: 'avere fede in
 * Dio.'»"; `/crediti/` describes the site as "un luogo sicuro in cui esplorare
 * cercare quesiti su Dio e cosa significa conoscerlo". Titles are Italian
 * throughout ("Chi era Gesù?", "Dio risponde alle nostre preghiere?", "Perché
 * adorare un Dio che permette cose terribili?"), scripture citations use
 * Italian book abbreviations (Deut., Isa., 1Cor., Mat., Giov., Rom., Luca) under
 * the Italian heading "Note a piè di pagina:", and the site declares
 * `charset=UTF-8`. No page showed the cru.org `/mx/es/` failure mode of a
 * localized URL serving an English body.
 *
 * ⓘ The **one** non-Italian string on these pages is the CTA link text "Cómo
 * empezar una relación con Dios…" (Spanish), documented under Chrome above. It
 * is stripped by `.sectionlink` and never reaches the corpus.
 *
 * The stored per-document language label still comes from content detection at
 * ingest (invariant 6), never from this field.
 *
 * `requestDelayMs: 1000` — we pay this host's bandwidth directly rather than
 * proxying through Firecrawl, so the politeness is real. Two sequential sweeps
 * of all 50 sitemap URLs plus ~15 slug probes drew **zero 429s and no
 * throttling**, so the sibling default is kept rather than raised. At 38 pages
 * the whole crawl is well under a minute of wall clock.
 *
 * **Expected yield: 38 documents.**
 */
import type { SourceEntry } from "./types.js"

export const everystudentIt: SourceEntry = {
  key: "everystudent-it",
  name: "EveryStudent — Italian (OgniStudente.com)",
  domain: "www.ognistudente.com",
  trust: "partner",
  ingestionMode: "html-scrape",
  languages: ["it"],
  defaultTags: ["everystudent", "cru", "topic:seeker", "lang:it"],
  defaultCategory: "article",
  rights:
    "© OgniStudente.com (Agape Italia / Cru) — partner ministry content; used for retrieval/attribution.",
  crawl: {
    baseUrl: "https://www.ognistudente.com",
    // No `fetchStrategy`: verified 2026-07-29 that plain HTTP serves every page
    // on this host (bare Apache, no Cloudflare). See header.
    sitemaps: ["/sitemap.xml"],
    allow: ["^https://www\\.ognistudente\\.com/"],
    // WordPress flat permalinks: exactly ONE path segment with a trailing
    // slash. This alone excludes the homepage (no segment) and the 6
    // /category/<name>/ indexes (two segments). `[^/]+` rather than a
    // lowercase class — all 50 slugs are lowercase ASCII today (verified: zero
    // uppercase, zero non-ASCII, zero %XX escapes), but a future mixed-case
    // slug must not be silently dropped the way `es`/`pl` nearly were.
    articleHints: ["^https://www\\.ognistudente\\.com/[^/]+/$"],
    block: [
      // ── robots.txt, fetched live 2026-07-29. The acquire path does NOT
      // enforce robots.txt, so all six rules are honoured by hand here.
      // This one is the only rule that names a LIVE sitemap URL. The directive
      // is written as an absolute URL (malformed per the robots spec, which
      // wants a path), so a strict parser would match nothing — but the intent
      // is plain. /personalmente2/ is "Inizia con Dio", a 624-char
      // post-decision page that pushes readers to apartiredadio.com. It is a
      // flat slug, so it MATCHES articleHints and only a block excludes it.
      "^https://www\\.ognistudente\\.com/personalmente2/?$",
      // The other five robots rules. All are legacy pre-WordPress paths with
      // 0 sitemap hits today; mirrored so the rules are enforced, not merely
      // noted, if the permalink scheme ever changes back.
      "^https://www\\.ognistudente\\.com/(articoli|articles|menu|menus|ssi)/",
      // ── These match articleHints; `block` is the ONLY thing excluding them.
      // The 7-email "L'Avventura Spirituale" signup ("una serie di 7 email…
      // È completamente gratuito, e ti invito a registrarti"), 1,364 ch — the
      // Italian twin of the French /aventure.html and Arabic /pack.html.
      // ⓘ There is NO Gospel-of-John signup twin on this host: /giovanni/,
      // /vangelo/ and /vangelo-di-giovanni/ all 404 (probed 2026-07-29).
      "^https://www\\.ognistudente\\.com/lavventura-spirituale-post/?$",
      // The site plan: 1,454 ch of pure link list. Italian twin of the French
      // /plan.html and the Polish /mapa.html.
      "^https://www\\.ognistudente\\.com/mappa-del-sito/?$",
      // About + credits ("sviluppato da … Agape Italia") + privacy link, 982 ch.
      "^https://www\\.ognistudente\\.com/crediti/?$",
      // The contact form, 207 ch. Below the 250 floor today, so this block is
      // belt-and-braces — but it records the decision rather than relying on a
      // length that could change with one edit to the form copy.
      "^https://www\\.ognistudente\\.com/hai-una-domanda/?$",
      // ── Below here articleHints already excludes them; these record WHY.
      // The 6 WordPress category indexes (conoscere-dio, domande-e-risposte,
      // domande, lesistenza, problemi, uncategorized) — teaser link lists.
      // 45-204 ch via .post-content, but 1,205-2,294 ch if that selector ever
      // stops matching and <body> takes over. Never left to the floor.
      "^https://www\\.ognistudente\\.com/category/",
      // WordPress plumbing linked from every page but absent from the sitemap.
      "^https://www\\.ognistudente\\.com/(wp-json|wp-content|wp-admin|xmlrpc\\.php)",
      "/feed/?$",
      // The homepage — 76 ch via .post-content but 2,138 ch via the <body>
      // fallback. Only a URL block excludes it in both worlds.
      "^https://www\\.ognistudente\\.com/?$",
    ],
    // ⚠️ WordPress 6.7.5 / theme `sight2016` — NOT the shared EveryStudent
    // FreeFind template. Measured 2026-07-29 over all 50 fetched pages with the
    // repo's own extractContent: `.post-content` matches 50/50 and yields
    // 1,443-28,485 ch on the 38 articles, while `.contentpadding`, `.content4`,
    // `.content4b`, `.cb-entry-content`, `.entry-content`, `.contentleftpadding`,
    // `.article-content` and `.articletitle` are ALL 0 matches — absent from
    // this host's markup entirely, not merely empty. extractContent binds the
    // first selector that MATCHES rather than the first that yields text, so
    // this stays a single measured container and not a chain.
    contentSelectors: [".post-content"],
    stripSelectors: [
      "script",
      "style",
      "noscript",
      "svg",
      "nav",
      "header",
      "footer",
      "form",
      // Site-specific chrome — both counted inside .post-content on this host:
      ".sectionlink", // 2-3 inst / 58-159 ch: the CTA link pair closing every
      // article. This host's equivalent of the siblings' .fccell. ⓘ The first
      // link's text is untranslated SPANISH ("Cómo empezar una relación con
      // Dios…") though its href is the Italian page — a source-side copy-paste.
      // Stripped, so it never reaches the corpus.
      ".a2a_kit", // 1 inst / 0 ch: the AddToAny share row, image-only buttons
      // today. Kept as a guard against a markup change adding text labels.
      //
      // ⓘ DELIBERATELY ABSENT: sitelevel_noindex, .fccell, .fctable, .hr2,
      // .articledivider, .relatedbottom, .shareiconsmenupg. All seven were
      // checked and each has ZERO occurrences in this host's raw HTML — not
      // zero extracted chars, zero markup. This is WordPress, so they cannot
      // drift into existence and a parity no-op would be theatre. Do not add
      // them back by copying from a FreeFind sibling.
    ],
    requestDelayMs: 1000, // direct fetches, no Firecrawl proxy; 0 x 429 observed
    maxPages: 80, // 50 sitemap URLs (38 kept after filtering) + headroom
    minContentLength: 250,
  },
}
