/**
 * SourceRegistry — the source list as pure data, plus lookups. Zero I/O. A
 * context (Acquisition) imports this for crawl policy; only `main.ts`/scripts
 * pick which source(s) to run. See docs/architecture.md §3–§5.
 */
import type { FetchStrategy, SourceEntry } from "./types.js"
import { startingWithGod } from "./starting-with-god.js"
import { cru } from "./cru.js"
import { jesusFilmOrg } from "./jesusfilm-org.js"
import { sightlineMinistry } from "./sightline-ministry.js"
import { thelife } from "./thelife.js"
import { thelifeFr } from "./thelife-fr.js"
import { thelifeZh } from "./thelife-zh.js"
import { familylife } from "./familylife.js"
import { gotquestions } from "./gotquestions.js"
import { everystudent } from "./everystudent.js"
import { everystudentAr } from "./everystudent-ar.js"
import { everystudentFr } from "./everystudent-fr.js"
import { everystudentDe } from "./everystudent-de.js"
import { everystudentEs } from "./everystudent-es.js"
import { everystudentJa } from "./everystudent-ja.js"
import { everystudentKo } from "./everystudent-ko.js"
import { everystudentPt } from "./everystudent-pt.js"
import { everystudentRo } from "./everystudent-ro.js"
import { everystudentRu } from "./everystudent-ru.js"
import { everystudentZhCn } from "./everystudent-zh-cn.js"
import { everystudentBg } from "./everystudent-bg.js"
import { everystudentCs } from "./everystudent-cs.js"
import { everystudentEt } from "./everystudent-et.js"
import { everystudentFa } from "./everystudent-fa.js"
import { everystudentHu } from "./everystudent-hu.js"
import { everystudentMn } from "./everystudent-mn.js"
import { everystudentPl } from "./everystudent-pl.js"
import { everystudentSq } from "./everystudent-sq.js"
import { everystudentSr } from "./everystudent-sr.js"
import { everystudentTr } from "./everystudent-tr.js"
import { everystudentVi } from "./everystudent-vi.js"
import { everystudentZhTw } from "./everystudent-zh-tw.js"
import { everystudentAm } from "./everystudent-am.js"
import { everystudentBn } from "./everystudent-bn.js"
import { everystudentEl } from "./everystudent-el.js"
import { everystudentHr } from "./everystudent-hr.js"
import { everystudentId } from "./everystudent-id.js"
import { everystudentIt } from "./everystudent-it.js"
import { everystudentLt } from "./everystudent-lt.js"
import { everystudentMk } from "./everystudent-mk.js"
import { everystudentMs } from "./everystudent-ms.js"
import { everystudentSk } from "./everystudent-sk.js"
import { everystudentTh } from "./everystudent-th.js"
import { everystudentUr } from "./everystudent-ur.js"
import { everystudentHe } from "./everystudent-he.js"
import { everystudentHi } from "./everystudent-hi.js"
import { everystudentKa } from "./everystudent-ka.js"
import { everystudentKk } from "./everystudent-kk.js"
import { everystudentMy } from "./everystudent-my.js"
import { everystudentNe } from "./everystudent-ne.js"
import { everystudentOm } from "./everystudent-om.js"
import { everystudentSl } from "./everystudent-sl.js"
import { everystudentSw } from "./everystudent-sw.js"
import { everystudentTa } from "./everystudent-ta.js"
import { everystudentTe } from "./everystudent-te.js"
import { everystudentHy } from "./everystudent-hy.js"
import { everystudentTi } from "./everystudent-ti.js"
import { everystudentRuCa } from "./everystudent-ru-ca.js"
import { everystudentUk } from "./everystudent-uk.js"

export type { SourceEntry, CrawlPolicy, FetchStrategy } from "./types.js"

/** Every registered source. **One domain = one source** (2026-07-09) — a source may hold
 *  several languages, and language is a per-document property decided at ingest, never
 *  inferred from the source. A sibling key exists only where the *domain* differs:
 *  `thelife-fr` is laviejenparle.com and `thelife-zh` is uwota.com, so they stay separate;
 *  cru.org's Spanish lives under `/mx/es/` and therefore belongs to `cru` itself.
 *
 *  One non-English variant was investigated but NOT registered: thelife's Persian site
 *  (shagerdan.com) serves a Cloudflare 403 wall to non-JS fetchers (FOLLOW-UP G / #8).
 *  That wall is now passable in principle — `everystudent` is the first registered
 *  source to declare `fetchStrategy: "firecrawl"` (ADR-0012) — but shagerdan.com stays
 *  unregistered until someone slices it and funds the credits.
 *
 *  EveryStudent spans three WALLED domains, all registered:
 *  everystudent.com → `everystudent`, everyarabstudent.com → `everystudent-ar` and
 *  questions2vie.com → `everystudent-fr` (slice #10, closing the #112 route). All
 *  three are Cloudflare-walled and fetched through Firecrawl.
 *
 *  It ALSO spans ~48 NON-walled sibling-language domains (#111), each its own key
 *  under the same one-domain-one-source rule. **47 are registered here** — the
 *  2026-07-28 pilot batch (`-es` `-zh-cn` `-ru` `-ro` `-ja` `-pt` `-de` `-ko`),
 *  the 2026-07-29 batch 2 (`-sq` `-fa` `-mn` `-tr` `-cs` `-hu` `-pl` `-sr` `-et`
 *  `-vi` `-zh-tw` `-bg`), batch 3 (`-sk` `-id` `-ms` `-mk` `-lt` `-bn` `-th`
 *  `-hr` `-am` `-it` `-ur` `-el`), the 2026-07-30 batch 4 (`-hi` `-ta` `-my`
 *  `-te` `-sl` `-ne` `-om` `-kk` `-ka` `-sw` `-he`) and batch 5 (`-uk` `-hy`
 *  `-ti` `-ru-ca`). Unlike the walled three these are plain HTTP — no
 *  `fetchStrategy`, no Firecrawl credits.
 *
 *  Most use sitemap DISCOVERY, with `seedPaths` only to patch a stale sitemap.
 *  **Batch 5 is SEED MODE instead** — `-uk` `-hy` `-ti` `-ru-ca` publish no XML
 *  sitemap at all, so each carries `baseUrl` + `seedPaths` and NO `sitemaps`,
 *  `allow`, `articleHints` or `block`: the seed list IS the filter. Precedent:
 *  `-ar` (68 seeds) and `-bg` (84).
 *
 *  ⚠️ TWO are registered but deliberately NOT acquired, both recorded
 *  `deferred` in docs/source-status.yaml with their full reason:
 *    - `-sr` (studentskikutak.com) — DNS-blackholed from this network (#129).
 *      Do NOT add an /etc/hosts line; that was considered and rejected.
 *    - `-he` (igod.co.il) — not a Cru property (its footer reads
 *      "© המכללה למקרא"), 1,020 articles rather than the ~5 #111 recorded, and
 *      its CDATA-wrapped sitemap cannot be parsed by `discover.ts` at all.
 *
 *  ⚠️ `-ru-ca` (studentstan.com) is a MIRROR of `-ru`: 42 of its 87 articles
 *  overlap at >=95%, mean 84.1%. It seeds ONLY the 5 measured-unique articles.
 *  Do not "complete" that seed list from the site's own map.
 *
 *  **There is no shared template.** The ".content4 family" claim in the walled
 *  entries describes a MINORITY of the estate. Measured across 47 hosts with the
 *  repo's own parser (`extract.ts`, node-html-parser), containers are:
 *    - `.contentpadding` — `-es` `-ru` `-ro` `-pt` `-de` `-pl` `-hu` `-tr` `-vi`
 *      `-fa` `-sr` `-id` `-ms` `-mk` `-bn` `-th` `-hr` `-am` `-hi` `-my` `-ne`
 *      `-om` `-ka` `-sw` `-ti`. On most of these `.content4` MATCHES and
 *      extracts 0 chars.
 *    - `#contentpadding` — `-sl` (vsakstudent.com), where `contentpadding` is an
 *      ID, NOT a class. `.contentpadding` matches NOTHING there. The second host
 *      to hide its container behind the class-vs-ID distinction, after `-el`.
 *      ⚠️ ALWAYS probe both `.x` and `#x`.
 *    - `html` — `-ko` `-sq` `-mn` `-lt` `-ta` `-te` `-kk` `-uk` `-hy`. Malformed FreeFind markup pops the
 *      element stack, destroying `.content4`, `.contentpadding` AND `<body>`;
 *      the article ends up as flat children of `<html>`. On `-ko` `-sq` `-mn` the
 *      culprit is a `<sitelevel_noindex>` closing inside `.contentpadding`; on
 *      `-lt` it is two articles with an unclosed `<span>` and a `</h1>` closing
 *      an `<h2>`.
 *    - `.content4` — `-ja` only.
 *    - `#content4` — `-el`, where `content4` is an ID, NOT a class. `.content4`
 *      matches nothing there. One character between working and silent zero.
 *    - `.cb-entry-content` — `-zh-cn`, WordPress (Chosen theme).
 *    - `.entry-content` — `-zh-tw`, WordPress (Enfold/Avia), and `-sk`,
 *      WordPress + Elementor. Same selector, two unrelated themes.
 *    - `.post-content` — `-it`, WordPress (`sight2016`), and `-ru-ca`, a
 *      different WordPress theme again. A THIRD WordPress container — one WP
 *      host never predicts another.
 *    - `.elementor-widget-theme-post-content` — `-he`, WordPress + Elementor
 *      with the `hello-elementor` theme. NOT `.entry-content`, even though
 *      `-sk` is also Elementor. On `-he`, `.entry-content` is the trap: it
 *      matches 44 of 51 pages at a CONSTANT 286 chars — a related-post teaser,
 *      byte-identical across unrelated articles, and non-zero so the floor
 *      cannot catch it either.
 *    - `.contentleftpadding` — `-et`, an older hand-rolled layout. None of the
 *      .content4-family selectors exist here at all.
 *    - `.content` — `-cs`, a bespoke Yii PHP app. #111's ".content .content-13"
 *      hint was one element's class attribute; `content-13` is the article id.
 *      NOTE `-sk` is NOT this app despite the sibling domain — it is WordPress,
 *      and `.content` matches 0 of its pages.
 *    - `.article-content` — `-bg`, an Angular build.
 *
 *  Also measured on this estate and easy to trip over:
 *    - ⚠️ `.articletitle` is a SHADOW TRAP that extracts a plausible NON-zero
 *      number (4-79 chars — an `<h1>`). It sits third in the sibling selector
 *      list, so on any host where `.content4`/`.content4b` miss, inheriting
 *      that list binds the headline and stages ~20-char documents with no error
 *      anywhere. NEVER list it.
 *    - `-he`'s sitemap wraps every `<loc>` in `<![CDATA[...]]>` and
 *      `discover.ts` reads `loc.text` raw, so a sitemapindex child is queued as
 *      the literal wrapper string and `fetch` throws `Invalid URL`. A repo
 *      defect, unfixed; it is why `-he` cannot acquire.
 *    - `-el`'s sitemap publishes `http://` `<loc>`s. `discover.ts` filters the RAW
 *      `<loc>` string and never rewrites the scheme, so the `^https://` pin every
 *      sibling uses discovers ZERO URLs there. Its filters use `^https?://`.
 *    - `-sk`'s canonical host is the BARE apex (`www.` 301s away) — the reverse of
 *      every other sibling, where the apex 301s to `www.`.
 *
 *  Two traps this cost us. (1) `contentSelectors` is NOT a fallback chain —
 *  `extract.ts` binds the FIRST selector matching an ELEMENT even at 0 chars, so a
 *  zero-text match SHADOWS every working selector after it. Ship ONE measured
 *  selector. (2) Verify by extracted TEXT LENGTH, never by grepping for the class
 *  name — every FreeFind host declares .content4 in an inline <style> block, and
 *  on `-mn` the raw bytes contain `<div class="contentpadding">` that the parser
 *  never builds as an element.
 *
 *  Note `<body>` is absent from the parsed tree on MOST of these hosts, so
 *  extract.ts's `?? root` is the real fallback — it returns the whole document
 *  (including a literal "<!DOCTYPE html>" text node), not a tidy nav blob.
 *
 *  A note once recorded here — that cru.org's Spanish locale had no real Spanish content —
 *  over-generalised from a single path. Only `/mx/es/.../10-pasos-basicos/` serves
 *  untranslated English bodies; it is blocked in `cru`, while ~489 of the remaining
 *  `/mx/es/` pages are genuine Spanish (and ~39 are untranslated English that only a
 *  per-document body check can catch). See `cru.ts` and docs/sources.md. */
export const SOURCES: readonly SourceEntry[] = [
  startingWithGod,
  cru,
  jesusFilmOrg,
  sightlineMinistry,
  thelife,
  thelifeFr,
  thelifeZh,
  familylife,
  gotquestions,
  everystudent,
  everystudentAr,
  everystudentFr,
  // #111 non-walled sibling-language domains — pilot batch, 2026-07-28.
  everystudentEs,
  everystudentZhCn,
  everystudentRu,
  everystudentRo,
  everystudentJa,
  everystudentPt,
  everystudentDe,
  everystudentKo,
  // #111 non-walled sibling-language domains — batch 2, 2026-07-29.
  everystudentSq,
  everystudentFa,
  everystudentMn,
  everystudentTr,
  everystudentCs,
  everystudentHu,
  everystudentPl,
  everystudentSr,
  everystudentEt,
  everystudentVi,
  everystudentZhTw,
  // Pre-launch staging property, ingested on an explicit operator decision
  // (2026-07-29). Seed mode — its sitemap names the staging host. See the entry.
  everystudentBg,
  // #111 non-walled sibling-language domains — batch 3, 2026-07-29.
  everystudentSk,
  everystudentId,
  everystudentMs,
  everystudentMk,
  everystudentLt,
  everystudentBn,
  everystudentTh,
  everystudentHr,
  everystudentAm,
  everystudentIt,
  everystudentUr,
  everystudentEl,
  // #111 non-walled sibling-language domains — batch 4, 2026-07-30. The last of
  // the sitemap-reachable hosts; ordered largest expected yield first.
  everystudentHi,
  everystudentTa,
  everystudentMy,
  everystudentTe,
  everystudentSl,
  everystudentNe,
  everystudentOm,
  everystudentKk,
  everystudentKa,
  everystudentSw,
  // ⚠️ NOT YET ACQUIRABLE — wired so the gates can typecheck and test it, but
  // three things are open. (1) Its sitemap wraps every <loc> in CDATA and
  // `discover.ts` does not unwrap it, so acquire throws ERR_INVALID_URL — a repo
  // defect, not an entry defect, and deliberately not fixed on this branch (same
  // reasoning as #128 / extract.ts). (2) igod.co.il is NOT a Cru property: its
  // footer reads "© המכללה למקרא" (HaMichlala LaMikra) and no Cru/EveryStudent
  // marker appears anywhere on the site. (3) It holds 1,020 articles, not the ~5
  // #111's recon recorded. All three await the operator; see the campaign file.
  everystudentHe,
  // #111 sibling-language domains with NO XML sitemap — batch 5, 2026-07-30.
  // SEED MODE: hand-listed paths harvested from each site's own HTML map and
  // verified live with a HEAD sweep. No `sitemaps`, and therefore no `block` —
  // the seed list IS the filter. Precedent: everystudent-ar, everystudent-bg.
  everystudentUk,
  everystudentHy,
  everystudentTi,
  // ⚠️ studentstan.com is a MIRROR of everystudent-ru — 42 of its 87 articles
  // overlap at >=95%, mean 84.1%. This entry seeds ONLY the 5 articles measured
  // NOT to duplicate it. Do not "complete" its seed list from the site's map:
  // the ingest dedup gate keys on (sourceKey, canonicalUrl), so ~81 near
  // duplicates would be chunked and embedded with nothing to catch them.
  everystudentRuCa,
]

/** Look up a source by its stable key; undefined if unknown. */
export function getSource(key: string): SourceEntry | undefined {
  return SOURCES.find((s) => s.key === key)
}

/** All registered sources. */
export function allSources(): readonly SourceEntry[] {
  return SOURCES
}

/** Sources that an operator may acquire with the current registry policy. */
export function acquirableSources(): readonly SourceEntry[] {
  return SOURCES.filter((source) => source.acquisition?.enabled !== false)
}

export function disabledAcquisitionSources(): readonly SourceEntry[] {
  return SOURCES.filter((source) => source.acquisition?.enabled === false)
}

export function acquisitionDisabledReason(entry: SourceEntry): string | null {
  return entry.acquisition?.enabled === false ? entry.acquisition.reason : null
}

/** The source's declared fetch strategy; absent means plain HTTP (the
 *  zero-config norm — Firecrawl is strictly opt-in, per source, at slice time).
 *  The single decision point for strategy selection: main.ts's fetcherFor()
 *  builds the matching adapter from this, and nothing re-decides at runtime. */
export function resolveFetchStrategy(entry: SourceEntry): FetchStrategy {
  return entry.crawl.fetchStrategy ?? "plain-http"
}

/** Resolve a source's hand-listed seed paths into absolute URLs (against its
 *  baseUrl). Empty for a pure discovery source (its URLs come from the sitemap). */
export function seedUrls(entry: SourceEntry): string[] {
  return (entry.crawl.seedPaths ?? []).map(
    (path) => new URL(path, entry.crawl.baseUrl).href,
  )
}
