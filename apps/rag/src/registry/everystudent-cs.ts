/**
 * EveryStudent — Czech (everystudent.cz). The Czech banner of Cru's
 * seeker-facing Q&A ministry: short apologetics/life-issue articles aimed at
 * Czech-speaking students who are not believers. The site describes itself as
 * "bezpečné místo, kde můžete zkoumat otázky ohledně toho, kým je Bůh" ("a safe
 * place to explore questions about who God is", /7/o_nas).
 *
 * **A separate SOURCE KEY, not a language of `everystudent`** — one domain =
 * one source = one crawl job (ADR-0006 §Decision 1). everystudent.cz is its own
 * domain, so it gets its own key, exactly as `everystudent-fr`
 * (questions2vie.com) and `everystudent-zh-cn` (xinshengming.com) are separate.
 * NB `everystudent.sk` is a DIFFERENT sibling domain (Slovak) and must never be
 * folded in here — see the language section below, which found real Slovak text
 * on this host.
 *
 * ============================================================
 * ⚠️ TEMPLATE OUTLIER — THIS DOMAIN DOES **NOT** USE THE SHARED
 * EveryStudent TEMPLATE. Do not "harmonise" its selectors with
 * its siblings. (Flagged in #111; measured here.)
 * ============================================================
 * The English/Arabic/French banners are a legacy hand-rolled site whose article
 * body is `.content4` / `.contentpadding`, with `sitelevel_noindex` + `.fccell`
 * as chrome. everystudent.cz is a **bespoke PHP application on the Yii
 * framework** — `nginx`, `PHPSESSID`, Yii's auto-published `/assets/<hash>/…`
 * bundles, Yii `CListView` widget ids (`#yw0`, `#yw2`, `.list-view`, `.items`,
 * `.keys`), and Yii route URLs for pagination
 * (`/index.php/stranka/19?text=zivot_s_bohem&Text_page=2`). It is NOT
 * WordPress either, so it is a third distinct generator in this family.
 *
 * Verified 2026-07-29 by fetching **all 97 sitemap URLs plus 20 off-sitemap
 * pages** and parsing each with node-html-parser exactly as `extract.ts` does:
 * `.content4`, `.content4b`, `.articletitle`, `.contentpadding`,
 * `sitelevel_noindex`, `.fccell`, `.fctable`, `.hr2`, `.articledivider`,
 * `.relatedbottom` and `.shareiconsmenupg` occur **0 times on 0 of 97 pages**.
 * Every one of those sibling selectors is dead config here and is deliberately
 * omitted rather than copied across.
 *
 * **Extraction — `.content`, a SINGLE selector, measured not guessed.** The page
 * nests `.content.content-<articleId>` › `.pad` › `.main` › `.padMain`, all four
 * wrapping identical text. Measured extracted char counts (verified 2026-07-29,
 * `/in/13/existuje_buh` · `/in/59/je_jezis_buh` · `/in/25/…vnitrni_klid` ·
 * `/1/existence` section index):
 *   - `.content4` / `.content4b` / `.articletitle` / `.contentpadding` — **NO
 *     MATCH, 0 chars**, on all 97 pages.
 *   - `.content` — matched exactly **once** on **97 of 97** pages;
 *     12,420 / 21,083 / 2,705 / 2,149 ch. ✅ SHIPPED.
 *   - `.main` — 12,420 / 21,083 / 2,705 ch on articles, but **NO MATCH on all 12
 *     non-`/in/` pages** (it lives inside the article partial only).
 *   - `.padMain` — identical to `.main`, same gap.
 *   - `.textDetail` — 12,249 / 20,979 / 2,564 ch: the tightest wrapper, but a
 *     **trap**. A second `.textDetail` (31 ch, "Napiš otázku - dostaneš
 *     odpověď") sits in the sidebar, and on the 26 empty pages below it is the
 *     FIRST one in document order, so first-match-wins would bind the sidebar.
 *   - `.wrapper3` / `.wrapper2` / `.wrapper1` / `.wrapper0` — 13,822 / 15,031 /
 *     15,050 / 15,050 ch: nav + menu + footer included. Rejected.
 *   - `article` — 12,295 ch on articles but **15 matches** on `/1/existence`
 *     (one per teaser card, first = 188 ch). Rejected.
 *   - `main` — NO MATCH anywhere. `body` — 16,604 ch (whole page).
 * `contentSelectors` is FIRST-MATCH-WINS, not a fallback chain (`extract.ts`
 * binds the first selector that matches an ELEMENT and stops, even at 0 chars),
 * so exactly one selector is declared. No fallback is added on purpose: `.content`
 * was present on 117/117 pages fetched, and every candidate that could sit
 * behind it is either a strict superset (nav noise) or the sidebar trap.
 *
 * **Strip list — every entry measured removing something, on this host.**
 * Across the 85 `/in/` pages, chars removed from inside `.content`:
 *   - `.breadCrumb` 4,081 ch total / 85 pages (48 avg) — "Úvod > Otázky o
 *     životě > …".
 *   - `.listing` 4,306 ch / 85 pages (51 avg) — the `<< previous` / `next >>`
 *     article pager.
 *   - `.shareButs` 2,704 ch / 59 pages (32 avg) — the usefulness-vote counter
 *     ("43 návštěvníků označilo článek jako užitečný").
 *   - `.backFromLong` 510 ch / 85 pages (6 avg) — the "Zpět" back link.
 *   - `.keys` 245 ch / 85 pages (3 avg) — Yii's raw record id leaking as text.
 * **Proof the list is exactly right:** `.content` + this strip produced text
 * BYTE-IDENTICAL to the pure `.textDetail` article body on **59 of 59** real
 * articles (the other 26 `/in/` pages are the empty stubs below). So the entry
 * gets `.textDetail`'s cleanliness without `.textDetail`'s sidebar trap.
 *
 * ⓘ **Deliberately NOT stripped, though the names invite it:**
 *   - `.articleimageright` — sounds like an image float, and is empty on most
 *     pages, but on `/in/36/proc_je_zivot_tak_tezky` an unclosed `<div>` makes it
 *     wrap **7,916 chars of the article body**. Stripping it would delete a
 *     whole article. Measured, not assumed.
 *   - `.addthissidebar` / `.a2a_kit` (AddToAny share widget) and `#cookie-notice`
 *     — real elements on the page, but **0 occurrences inside `.content`** on all
 *     85 `/in/` pages; they sit in the `<aside>`, which `.content` never
 *     contains. Shipping them would be unmeasured dead config.
 *   - The trailing call-to-action list ("Jak poznat Boha… / Mám otázku nebo
 *     komentář…", ~46 ch, this host's analogue of the siblings' `.fccell`) is a
 *     bare `<ul>` with **no class at all**, structurally identical to the `<ul>`s
 *     that carry real article section headings. It is unstrippable without
 *     deleting content, so ~46 ch of CTA survives per article. Known cost.
 *
 * **NOT WALLED — plain HTTP, so `fetchStrategy` is omitted (the default).**
 * Verified 2026-07-29: 117 full GETs (97 sitemap + 20 off-sitemap) all returned
 * **200 — zero 403s, no Cloudflare block page**, and `/sitemap.xml` answers
 * plain HTTP (200, 15,644 B). Unlike the English/Arabic/French banners
 * (ADR-0012). `https://everystudent.cz/` also serves 200 directly, but
 * `http://everystudent.cz/` 302s to `https://www.everystudent.cz/` and the
 * sitemap emits `www.` throughout, so `www.` is canonical. There is no
 * `<link rel="canonical">` on any page.
 *
 * **robots.txt: THERE ISN'T ONE.** Verified 2026-07-29:
 * `https://www.everystudent.cz/robots.txt` → **404**, served as the Yii app's own
 * error page (`Error 404 Nepodařilo se zpracovat požadavek "robots.txt".`), same
 * on the bare host. No robots file means no `Disallow` rules, so nothing is
 * excluded on robots grounds. Weaker than a stated permission — but every page
 * does carry `<meta name="robots" content="all, follow"/>`, an explicit
 * page-level allow. Re-check before any future re-crawl.
 *
 * **Discovery mode, not hand-listed seeds** — `/sitemap.xml` is reachable and
 * plain-HTTP fetching is free, so there is nothing to amortise. Precedent:
 * `thelife-fr`, `everystudent-zh-cn`. `seedPaths` is used ONLY to pin the
 * sitemap's gap (below), which `acquire.ts` unions with discovered URLs.
 *
 * **Sitemap shape, verified 2026-07-29.** `/sitemap.xml` is a flat `<urlset>`
 * (no `<sitemapindex>`) generated by xml-sitemaps.com, **every `lastmod`
 * 2018-04-17** — a one-off dump eight years stale, not a live feed. **97 `<loc>`
 * entries, all unique, all on-host.** They partition cleanly:
 *   - **85 `/in/<id>/<slug>`** — the article namespace.
 *   - **11 `/<n>/<slug>`** — section indexes (`/1/existence`,
 *     `/2/otazky_o_zivote`, `/3/sex__vztahy`, `/4/jezis`, `/5/jak_poznat_boha`,
 *     `/6/otazky_a_odpovedi`, `/7/o_nas`, `/8/kontakt`, `/9/akce_v_praze`,
 *     `/22/cesta_k_bohu`, `/24/mapa_stranek`). Navigation, not articles — but
 *     they extract **189–2,842 chars**, i.e. WELL OVER `minContentLength`, so the
 *     floor would never drop them. They are blocked by URL.
 *   - **1 homepage** (1,445 ch — likewise over the floor).
 * `allow ∧ articleHints ∧ ¬block` simulated against the live file yields **83
 * URLs**; plus the 17 pinned seeds = **100 pages fetched**.
 *
 * ⚠️ **The `<slug>` in `/in/<id>/<slug>` is DECORATIVE — the id alone selects the
 * article.** Proved 2026-07-29: `/in/13/naprosty_nesmysl_slug` (an invented slug)
 * returns 200 and extracts text byte-identical to `/in/13/existuje_buh`. A
 * nonexistent id returns HTTP 500, not 404. The sitemap lists **two ids twice
 * under different slugs**, which would land as two documents at two URLs that no
 * content hash can collapse. Both twins are blocked, keeping the variant the site
 * itself links to most (inbound-link counts measured over all 97 pages):
 *   - id 64: keep `…/kdyby_slo_poznat_boha_osobne___` (107 inbound links, it is
 *     in the global nav), block `…/poznat_boha_osobne` (63).
 *   - id 18: keep `…/bylo_nekdy_nic_uvahy_o_pocatku_vesmiru_i` (103), block
 *     `…/bylo_nekdy_nic__uvahy…` (3) — they differ only by a doubled underscore.
 *
 * **`/22/cesta_k_bohu` is BLOCKED: it is the email-series signup page.** 1,233
 * chars, so it clears the floor comfortably — only a URL block catches it. Read
 * 2026-07-29: "Je to série sedmi zamyšlení, které si můžeš přečíst buď formou
 * online kurzu, nebo jako sedm e-mailů, které ti pošlu, přihlásit se můžeš
 * vpravo." ("a series of seven reflections… as seven e-mails I'll send you; you
 * can sign up on the right"). This is this host's equivalent of the French
 * banner's `/aventure.html` and the Arabic banner's `/pack.html` — the "Spiritual
 * Adventure" 7-email series, under a Czech name. It is covered structurally by
 * the `/\d+/` nav block; the dedicated entry is kept so narrowing that rule later
 * cannot silently re-admit it.
 *
 * ⓘ **26 of the 85 `/in/` URLs are DEAD event stubs and need no block.** They are
 * the leftovers of the `/9/akce_v_praze` ("events in Prague") section — ids 85,
 * 86, 87, 95, 96, 99, 100, 101, 109, 110, 111, 112, 116, 117, 119, 122–128, 130,
 * 138, 151, 162 — and every one extracts the SAME 25 chars: "Nenalezeny žádné
 * záznamy." ("No records found."). `.content` DOES bind on them, so there is no
 * `<body>` fallback; they are dropped cleanly by `minContentLength: 250`.
 * Left unblocked on purpose: they are not URL-patterned (their ids interleave
 * with live articles), and 26 cheap 200s that fail the floor is the correct
 * outcome. **57 real articles remain from the sitemap** (1,742–25,314 ch).
 *
 * **HTML-map cross-check — the sitemap is missing an ENTIRE SECTION (17
 * articles), pinned in `seedPaths`.** The site's own map page `/24/mapa_stranek`
 * plus a full 1-hop link scan of all 97 fetched pages surfaced 8 off-sitemap
 * URLs; following those found `/19/zivot_s_bohem` ("Life with God") — a
 * two-page-paginated section that the 2018 sitemap does not list at all, and the
 * only paginated section on the site (the other 11 have no pager). All 17 of its
 * articles were fetched 2026-07-29: **200, 621–7,695 chars, all above the floor,
 * all Czech, none duplicating a sitemap document** (SHA-1 compared). That is a
 * 30% increase on the sitemap's 57 real articles, so pinning them matters.
 * Rejected from the seed list, with reasons:
 *   - `/in/163/koronavirus_jak_prekonat_strach` — see the language note; SLOVAK.
 *   - `/in/22/proc_zrovna_buh_bible` and `/in/164/jarni_kurzy_alfa` — both the
 *     dead 25-char "Nenalezeny žádné záznamy." stub.
 *   - `/in/143/` — HTTP 404.
 *   - `/in/26/zivot_s_nadeji` — id 26 again, byte-identical to the sitemap's
 *     `/in/26/hiv_zivot_s_nadeji`; the decorative-slug duplicate trap.
 *   - `/08/kontakt` (a leading-zero twin of `/8/kontakt`, 189 ch) and
 *     `/25/jine_jazyky` (11 ch, the page linking out to the sibling language
 *     domains — dropped for the same reason the French entry drops
 *     `/m/intl.html`). Both are caught by the `/\d+/` nav block anyway.
 *
 * **Language: `["cs"]` — read, not assumed, and it is Czech, NOT Slovak.**
 * Verified 2026-07-29 by reading the content directly: `/in/25/…` opens "Někdy to
 * vypadá, jako by se všechno v životě spiklo proti tomu, abychom mohli mít klid."
 * ("Sometimes it seems everything in life conspires against our having peace.")
 * and `/in/13/existuje_buh` opens „Nemůžete dokázat, že Bůh existuje, a nemůžete
 * dokázat ani to, že neexistuje." — natural Czech prose (ř/ě/ů, the Czech-only
 * letters), not machine-translated and certainly not untranslated English.
 * Cross-checked orthographically across every extracted body ≥250 ch: the
 * Czech-only letters ř/ě/ů occur **16,470 times, and appear on 73 of 73 pages** —
 * no page lacks them.
 *
 * ⚠️ **One page on this host really is SLOVAK, and it is deliberately excluded.**
 * The Slovak-only letters ľ/ĺ/ŕ/ô/ä occur 99 times in total, and **97 of those 99
 * sit on the single page `/in/163/koronavirus_jak_prekonat_strach`**, whose body
 * begins "Prinášame ti spoľahlivý spôsob, ako prekonať úzkosť a strach z
 * koronavírusu" — Slovak text under a Czech headline, evidently lifted from
 * everystudent.sk and never translated. (The remaining 2 are its teaser excerpt
 * on `/2/otazky_o_zivote`, which is blocked as a nav index.) It is NOT in the
 * sitemap, so discovery cannot reach it, and it is NOT pinned as a seed. If a
 * future agent widens the seed list, leave this one out.
 *
 * `requestDelayMs: 2000`, above the sibling default of 1000, on measurement: a
 * 97-URL sweep at 400 ms spacing produced **3 hard timeouts (20 s, zero bytes
 * received)** from this slow legacy PHP host, all of which succeeded on retry at
 * 1 s. 100 pages × 2 s is ~3½ minutes, which is cheap insurance. Precedent for
 * exceeding the default: `thelife-fr` uses 2000 for the same reason.
 *
 * ⚠️ **Czech is a NEW language for this corpus** — no existing source declares
 * `cs`, so no existing golden case becomes eligible against these documents by
 * construction, and Stage-4 needs fresh Czech cases rather than a Part A
 * re-review (contrast `everystudent-fr`/`-zh-cn`, where the language already
 * existed). Note also ADR-0007's 500-char detection floor: the four shortest
 * seeded articles (`/in/104/` 621, `/in/105/` 830, `/in/103/` 834, `/in/102/`
 * 1,360) clear it, so every kept document should get a stored `cs` label.
 */
import type { SourceEntry } from "./types.js"

export const everystudentCs: SourceEntry = {
  key: "everystudent-cs",
  name: "EveryStudent — Czech (everystudent.cz)",
  domain: "www.everystudent.cz",
  trust: "partner",
  ingestionMode: "html-scrape",
  languages: ["cs"],
  defaultTags: ["everystudent", "cru", "topic:seeker", "lang:cs"],
  defaultCategory: "article",
  rights:
    "© EveryStudent.cz (Cru) — partner ministry content; used for retrieval/attribution.",
  crawl: {
    // No `fetchStrategy`: verified unwalled 2026-07-29 (117/117 GETs → 200).
    baseUrl: "https://www.everystudent.cz",
    sitemaps: ["/sitemap.xml"],
    allow: ["^https://www\\.everystudent\\.cz/"],
    // The whole article namespace. Excludes the homepage and every /<n>/<slug>
    // section index by construction.
    articleHints: ["^https://www\\.everystudent\\.cz/in/\\d+/[^/]+$"],
    block: [
      // Homepage — extracts 1,445 ch, far above minContentLength.
      "^https://www\\.everystudent\\.cz/?$",
      // Every /<n>/<slug> nav page: the 11 section indexes, the HTML site map
      // (/24/mapa_stranek), the other-languages page (/25/jine_jazyky), contact
      // and its /08/ leading-zero twin. They extract 11-2,842 ch, so the floor
      // cannot be relied on. See header.
      "^https://www\\.everystudent\\.cz/\\d+/",
      // The "Cesta k Bohu" SEVEN-EMAIL series signup (1,233 ch). Redundant with
      // the rule above, kept explicit so narrowing that rule cannot re-admit it.
      "^https://www\\.everystudent\\.cz/22/cesta_k_bohu/?$",
      // Decorative-slug duplicates: the id alone selects the article, so these
      // two are byte-identical to the twins kept above. See header.
      "^https://www\\.everystudent\\.cz/in/64/poznat_boha_osobne$",
      "^https://www\\.everystudent\\.cz/in/18/bylo_nekdy_nic__uvahy_o_pocatku_vesmiru_i$",
    ],
    // The /19/zivot_s_bohem section — 17 articles the 2018 sitemap omits
    // entirely. Found via the site's own map + a 1-hop link scan; all fetched
    // and measured 2026-07-29 (621-7,695 ch, Czech, no duplicates). See header.
    seedPaths: [
      "/in/102/zacatek_s_bohem",
      "/in/103/nejbeznejsi_otazky_o_krestanskem_zivote",
      "/in/104/co_se_stane_kdyz_prijmete_jezise",
      "/in/105/jistota_ve_vztahu_s_bohem",
      "/in/106/prozivani_bozi_lasky_a_odpusteni",
      "/in/107/sila_ke_krestanskemu_zivotu",
      "/in/108/rust_ve_vztahu_s_jezisem",
      "/in/147/bozi_jedinecna_laska",
      "/in/148/je_ted_buh_v_mem_zivote",
      "/in/149/kdyz_se_provinime",
      "/in/150/podstata_viry",
      "/in/152/vydrzi_to",
      "/in/153/biblicke_studium_5",
      "/in/154/biblicke_studium_4",
      "/in/155/biblicke_studium_3",
      "/in/156/biblicke_studium_2",
      "/in/157/biblicke_studium_1",
    ],
    // NOT the shared .content4 template — this host is a bespoke Yii app.
    // ONE selector: first-match-wins, and every alternative was measured either
    // as a nav-inclusive superset or as the sidebar trap. See header.
    contentSelectors: [".content"],
    stripSelectors: [
      "script",
      "style",
      "noscript",
      "svg",
      "nav",
      "header",
      "footer",
      "form",
      // Site-specific chrome, each measured removing text from inside .content
      // on this host (see header for per-selector totals):
      ".breadCrumb", // "Úvod > Otázky o životě > ..." trail (48 ch avg)
      ".listing", // << previous / next >> article pager (51 ch avg)
      ".shareButs", // "N návštěvníků označilo článek jako užitečný" (32 ch avg)
      ".backFromLong", // the "Zpět" back link (6 ch avg)
      ".keys", // Yii CListView leaking the raw record id as text (3 ch avg)
      // NB: .articleimageright is NOT stripped — on /in/36 an unclosed <div>
      // makes it wrap 7,916 ch of article body. See header.
    ],
    requestDelayMs: 2000, // 3/97 hard timeouts at 400ms on this slow PHP host
    maxPages: 150, // 83 discovered + 17 seeds = 100, plus headroom
    minContentLength: 250,
  },
}
