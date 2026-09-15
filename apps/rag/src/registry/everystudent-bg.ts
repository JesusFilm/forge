/**
 * EveryStudent — Bulgarian (everystudent.bg). The Bulgarian banner of Cru's
 * EveryStudent estate, and the 20th registered source (#111).
 *
 * ⚠️ **PRE-LAUNCH PROPERTY — ingested on an explicit operator decision
 * (2026-07-29).** This host is a self-declared staging environment and every
 * automated signal says keep out. Verified live 2026-07-29:
 *   - `robots.txt` (200, 92 bytes) is exactly:
 *       `# staging environment (non-production) — keep all crawlers out.`
 *       `User-agent: *` / `Disallow: /`
 *     served identically on `www.` and `staging.`.
 *   - every page carries `<meta name="robots" content="noindex, nofollow">`
 *     AND an `x-robots-tag: noindex, nofollow` response header.
 *   - every `<link rel="canonical">` points at `staging.everystudent.bg`,
 *     even when the page is fetched from `www`.
 *   - all 95 sitemap `<loc>` values are `https://staging.everystudent.bg/…`.
 * Cru owns the property and Jaco took the call to ingest ahead of launch.
 * Nothing here is a defect to be "fixed" — revisit when the site goes live and
 * `robots.txt` flips. Note the repo does NOT currently enforce robots at all
 * (the `robots_cache` table and `FetchStateStore.getRobots` port exist, but no
 * caller in `src/acquisition/` invokes them), so this entry crawls regardless.
 *
 * **SEED MODE, deliberately — this is the point of the entry's shape.** The XML
 * sitemap is complete and accurate, but its 84 article `<loc>`s all name the
 * `staging.` host. Discovery mode would therefore stamp `staging.…` into
 * `canonical_url` for all 84 documents — the dedup key — and every one would
 * have to be rewritten at launch. `www.` serves the identical pages at HTTP 200
 * (verified 2026-07-29), so the 84 paths are hand-listed against a `www`
 * `baseUrl` instead. Discovery is off; there is no `sitemaps` field and hence,
 * per the `everystudent-ar` precedent, no `block` array — the seed list IS the
 * filter.
 *
 * **A FOURTH platform, and the shared template is entirely absent.** Not the
 * legacy FreeFind/Apache banner: an Angular static build
 * (`data-beasties-container`) with Pagefind search. Measured with the repo's own
 * parser (`extract.ts`, node-html-parser) across 9 articles + 5 nav pages on
 * 2026-07-29 — `.content4`, `.content4b`, `.contentpadding` and `.articletitle`
 * are **MISS, 0 instances, on every page**; not even the empty spacer the
 * siblings carry. Container is **`.article-content`** (3,047–20,793 chars,
 * binds 9/9). `.article-body` / `main` / `[data-pagefind-body]` are the same
 * element one level out and add the 351–481-char "Други езици" language
 * switcher plus `section.related`, so the tighter selector ships — ALONE, never
 * a chain (rule 1b: a zero-text match shadows everything after it).
 *
 * **The legacy strip list is 100% dead here** — `sitelevel_noindex`, `.fccell`,
 * `.fctable`, `.hr2`, `.articledivider`, `.relatedbottom` and
 * `.shareiconsmenupg` all measured 0 instances on every page, so none are
 * carried over (shipping them would be dead config). This host's real chrome
 * sits OUTSIDE `.article-content` and needs no stripping; `.footnotes`
 * (147–374 ch) sits inside and is genuine citation apparatus — kept.
 *
 * **Excluded from the seed list** (all measured ABOVE the 250 floor, so only
 * omission catches them — rule 1c): the homepage (6,706 ch), the 5 section
 * indexes (3,850–4,884 ch), `/за-нас.html`, `/карта.html`, `/контакти.html`,
 * and the two email-signup landers `/евангелието-на-Йоан.html` (1,906 ch, the
 * Gospel-of-John series) and `/духовно-приключение.html` (1,881 ch, the 7-email
 * series). Also omitted: `/да-познаваме-Бог/начало-с-Бог.html`, linked from the
 * HTML map but absent from the XML sitemap — an 855-char post-decision landing
 * page whose payload is a referral off-domain to NachalosBog.bg, and the only
 * two-segment page lacking `data-pagefind-body`.
 *
 * **Language.** Genuinely Bulgarian, read directly 2026-07-29 — «Как си
 * обясняваме онова, което виждаме в този свят?» The suffixed definite article
 * (свят → светът), the analytic `на`-genitive and the absent case system
 * distinguish it from Russian; ъ/щ usage rules out Macedonian.
 *
 * **Estate note.** This sitemap's hreflang set names 49 other EveryStudent
 * hosts, all still on their legacy domains. If `bg` is the pilot of a
 * platform-wide migration, sibling containers will go stale as others follow —
 * assume per-host re-verification, never inherit a selector (rule 2).
 *
 * One domain = one source (ADR-0006): everystudent.bg is its own key, never a
 * language variant of `everystudent`.
 */
import type { SourceEntry } from "./types.js"

export const everystudentBg: SourceEntry = {
  key: "everystudent-bg",
  name: "EveryStudent — Bulgarian (everystudent.bg)",
  domain: "www.everystudent.bg",
  trust: "partner",
  ingestionMode: "html-scrape",
  languages: ["bg"],
  defaultTags: ["everystudent", "cru", "topic:seeker", "lang:bg"],
  defaultCategory: "article",
  rights:
    "© EveryStudent.bg (Cru) — partner ministry content; used for retrieval/attribution.",
  crawl: {
    baseUrl: "https://www.everystudent.bg",
    // Hand-listed, NOT discovered: the sitemap's <loc>s all name staging.
    // See the header — this keeps canonical_url on the www host.
    seedPaths: [
      "/%D0%B2%D0%B7%D0%B0%D0%B8%D0%BC%D0%BE%D0%BE%D1%82%D0%BD%D0%BE%D1%88%D0%B5%D0%BD%D0%B8%D1%8F/%D0%B4%D0%B5%D0%B2%D0%B5%D1%82%D0%BD%D0%B0%D0%B4%D0%B5%D1%81%D0%B5%D1%82-%D0%BC%D1%8A%D0%B6%D0%B5-%D0%BF%D0%BE-%D0%BA%D1%8A%D1%81%D0%BD%D0%BE.html",
      "/%D0%B2%D0%B7%D0%B0%D0%B8%D0%BC%D0%BE%D0%BE%D1%82%D0%BD%D0%BE%D1%88%D0%B5%D0%BD%D0%B8%D1%8F/%D0%B4%D0%BE%D0%B1%D1%80%D0%B8%D1%82%D0%B5-%D0%B4%D0%B5%D0%BB%D0%B0-%D0%BD%D0%B0-%D1%85%D0%BE%D1%80%D0%B0%D1%82%D0%B0.html",
      "/%D0%B2%D0%B7%D0%B0%D0%B8%D0%BC%D0%BE%D0%BE%D1%82%D0%BD%D0%BE%D1%88%D0%B5%D0%BD%D0%B8%D1%8F/%D0%B7%D0%B0-%D0%BF%D1%80%D0%BE%D1%82%D0%B8%D0%B2-%D0%B0%D0%B1%D0%BE%D1%80%D1%82%D0%B0.html",
      "/%D0%B2%D0%B7%D0%B0%D0%B8%D0%BC%D0%BE%D0%BE%D1%82%D0%BD%D0%BE%D1%88%D0%B5%D0%BD%D0%B8%D1%8F/%D0%B8%D0%BC%D0%B0-%D0%BB%D0%B8-%D0%BD%D0%B0%D0%B4%D0%B5%D0%B6%D0%B4%D0%B0-%D0%B7%D0%B0-%D0%B4%D1%8A%D0%BB%D0%B3%D0%BE%D1%82%D1%80%D0%B0%D0%B5%D0%BD-%D0%B1%D1%80%D0%B0%D0%BA.html",
      "/%D0%B2%D0%B7%D0%B0%D0%B8%D0%BC%D0%BE%D0%BE%D1%82%D0%BD%D0%BE%D1%88%D0%B5%D0%BD%D0%B8%D1%8F/%D0%BA%D0%B0%D0%BA-%D0%B4%D0%B0-%D1%81%D0%B5-%D1%81%D0%BF%D1%80%D0%B0%D0%B2%D0%B8%D0%BC-%D1%81%D1%8A%D1%81-%D1%81%D0%B0%D0%BC%D0%BE%D1%82%D0%B0%D1%82%D0%B0.html",
      "/%D0%B2%D0%B7%D0%B0%D0%B8%D0%BC%D0%BE%D0%BE%D1%82%D0%BD%D0%BE%D1%88%D0%B5%D0%BD%D0%B8%D1%8F/%D0%BA%D0%B0%D0%BA-%D0%B4%D0%B0-%D1%81%D0%BB%D0%BE%D0%B6%D0%B8%D0%BC-%D0%BA%D1%80%D0%B0%D0%B9-%D0%BD%D0%B0-%D0%B4%D0%B5%D0%BF%D1%80%D0%B5%D1%81%D0%B8%D1%8F%D1%82%D0%B0.html",
      "/%D0%B2%D0%B7%D0%B0%D0%B8%D0%BC%D0%BE%D0%BE%D1%82%D0%BD%D0%BE%D1%88%D0%B5%D0%BD%D0%B8%D1%8F/%D0%BF%D1%80%D0%B0%D0%B2%D0%B0%D1%82%D0%B0-%D0%BD%D0%B0-%D0%B6%D0%B5%D0%BD%D0%B8%D1%82%D0%B5.html",
      "/%D0%B2%D0%B7%D0%B0%D0%B8%D0%BC%D0%BE%D0%BE%D1%82%D0%BD%D0%BE%D1%88%D0%B5%D0%BD%D0%B8%D1%8F/%D1%80%D0%BE%D0%BC%D0%B0%D0%BD%D1%82%D0%B8%D0%BA%D0%B0-%D1%81-%D0%B2%D1%8A%D0%BB%D1%86%D0%B8.html",
      "/%D0%B2%D0%B7%D0%B0%D0%B8%D0%BC%D0%BE%D0%BE%D1%82%D0%BD%D0%BE%D1%88%D0%B5%D0%BD%D0%B8%D1%8F/%D1%81%D0%B0%D0%BC%D0%B0-%D0%B2-%D0%B1%D0%BE%D1%80%D0%B1%D0%B0%D1%82%D0%B0-%D1%81-%D0%BF%D0%BE%D1%80%D0%BD%D0%BE%D0%B3%D1%80%D0%B0%D1%84%D0%B8%D1%8F%D1%82%D0%B0.html",
      "/%D0%B2%D0%B7%D0%B0%D0%B8%D0%BC%D0%BE%D0%BE%D1%82%D0%BD%D0%BE%D1%88%D0%B5%D0%BD%D0%B8%D1%8F/%D1%81%D0%B5%D0%BA%D1%81%D1%83%D0%B0%D0%BB%D0%BD%D0%B8-%D1%81%D1%82%D0%B0%D0%BD%D0%B4%D0%B0%D1%80%D1%82%D0%B8.html",
      "/%D0%B2%D0%B7%D0%B0%D0%B8%D0%BC%D0%BE%D0%BE%D1%82%D0%BD%D0%BE%D1%88%D0%B5%D0%BD%D0%B8%D1%8F/%D1%81%D0%B5%D0%BA%D1%81-%D0%B8-%D1%82%D1%8A%D1%80%D1%81%D0%B5%D0%BD%D0%B5%D1%82%D0%BE-%D0%BD%D0%B0-%D0%B8%D0%BD%D1%82%D0%B8%D0%BC%D0%BD%D0%BE%D1%81%D1%82.html",
      "/%D0%B2%D0%B7%D0%B0%D0%B8%D0%BC%D0%BE%D0%BE%D1%82%D0%BD%D0%BE%D1%88%D0%B5%D0%BD%D0%B8%D1%8F/%D1%82%D0%BE%D0%BA%D1%81%D0%B8%D1%87%D0%BD%D0%BE-%D0%BF%D0%BE%D1%80%D0%BD%D0%BE.html",
      "/%D0%B2%D0%B7%D0%B0%D0%B8%D0%BC%D0%BE%D0%BE%D1%82%D0%BD%D0%BE%D1%88%D0%B5%D0%BD%D0%B8%D1%8F/%D1%83%D1%82%D0%BE%D0%BB%D0%B5%D1%82%D0%B5-%D0%B8%D1%81%D1%82%D0%B8%D0%BD%D1%81%D0%BA%D0%B0%D1%82%D0%B0-%D1%81%D0%B8-%D0%B6%D0%B0%D0%B6%D0%B4%D0%B0.html",
      "/%D0%B2%D0%B7%D0%B0%D0%B8%D0%BC%D0%BE%D0%BE%D1%82%D0%BD%D0%BE%D1%88%D0%B5%D0%BD%D0%B8%D1%8F/%D1%85%D0%BE%D0%BC%D0%BE%D1%81%D0%B5%D0%BA%D1%81%D1%83%D0%B0%D0%BB%D0%B8%D1%81%D1%82%D0%B8.html",
      "/%D0%B2%D1%8A%D0%BF%D1%80%D0%BE%D1%81%D0%B8-%D0%B7%D0%B0-%D0%91%D0%BE%D0%B3/%D0%91%D0%BE%D0%B3-%D0%BB%D0%B8-%D1%81%D1%8A%D0%B7%D0%B4%D0%B0%D0%B4%D0%B5-%D0%B2%D1%81%D0%B5%D0%BB%D0%B5%D0%BD%D0%B0%D1%82%D0%B0.html",
      "/%D0%B2%D1%8A%D0%BF%D1%80%D0%BE%D1%81%D0%B8-%D0%B7%D0%B0-%D0%91%D0%BE%D0%B3/%D0%B2-%D1%82%D1%8A%D1%80%D1%81%D0%B5%D0%BD%D0%B5-%D0%BD%D0%B0-%D0%B8%D1%81%D1%82%D0%B8%D0%BD%D1%81%D0%BA%D0%B0%D1%82%D0%B0-%D0%B2%D1%8F%D1%80%D0%B0.html",
      "/%D0%B2%D1%8A%D0%BF%D1%80%D0%BE%D1%81%D0%B8-%D0%B7%D0%B0-%D0%91%D0%BE%D0%B3/%D0%B7%D0%B0%D1%89%D0%BE-%D0%B5%D0%B4%D0%B8%D0%BD-%D1%80%D0%B0%D1%86%D0%B8%D0%BE%D0%BD%D0%B0%D0%BB%D0%B5%D0%BD-%D1%87%D0%BE%D0%B2%D0%B5%D0%BA-%D0%B2%D1%8F%D1%80%D0%B2%D0%B0-%D0%B2-%D0%91%D0%BE%D0%B3.html",
      "/%D0%B2%D1%8A%D0%BF%D1%80%D0%BE%D1%81%D0%B8-%D0%B7%D0%B0-%D0%91%D0%BE%D0%B3/%D0%B8%D0%BC%D0%B0-%D0%BB%D0%B8-%D0%91%D0%BE%D0%B3.html",
      "/%D0%B2%D1%8A%D0%BF%D1%80%D0%BE%D1%81%D0%B8-%D0%B7%D0%B0-%D0%91%D0%BE%D0%B3/%D0%BA%D0%B0%D0%BA-%D0%B5%D0%B4%D0%B8%D0%BD-%D0%B0%D1%82%D0%B5%D0%B8%D1%81%D1%82-%D0%B5-%D0%BD%D0%B0%D0%BC%D0%B5%D1%80%D0%B8%D0%BB-%D0%91%D0%BE%D0%B3.html",
      "/%D0%B2%D1%8A%D0%BF%D1%80%D0%BE%D1%81%D0%B8-%D0%B7%D0%B0-%D0%91%D0%BE%D0%B3/%D0%BA%D0%BE%D0%B9-%D0%B5-%D0%91%D0%BE%D0%B3.html",
      "/%D0%B2%D1%8A%D0%BF%D1%80%D0%BE%D1%81%D0%B8-%D0%B7%D0%B0-%D0%91%D0%BE%D0%B3/%D0%BA%D0%BE%D0%B9-%D1%81%D1%8A%D0%B7%D0%B4%D0%B0%D0%B4%D0%B5-%D0%91%D0%BE%D0%B3.html",
      "/%D0%B2%D1%8A%D0%BF%D1%80%D0%BE%D1%81%D0%B8-%D0%B7%D0%B0-%D0%91%D0%BE%D0%B3/%D0%BA%D0%BE%D0%B9-2.html",
      "/%D0%B2%D1%8A%D0%BF%D1%80%D0%BE%D1%81%D0%B8-%D0%B7%D0%B0-%D0%91%D0%BE%D0%B3/%D0%BA%D0%BE%D0%B9.html",
      "/%D0%B2%D1%8A%D0%BF%D1%80%D0%BE%D1%81%D0%B8-%D0%B7%D0%B0-%D0%91%D0%BE%D0%B3/%D0%BA%D1%8A%D0%B4%D0%B5-%D0%B5-%D0%91%D0%BE%D0%B3.html",
      "/%D0%B2%D1%8A%D0%BF%D1%80%D0%BE%D1%81%D0%B8-%D0%B7%D0%B0-%D0%91%D0%BE%D0%B3/%D0%BD%D0%B5%D1%89%D0%BE.html",
      "/%D0%B2%D1%8A%D0%BF%D1%80%D0%BE%D1%81%D0%B8-%D0%B7%D0%B0-%D0%91%D0%BE%D0%B3/%D0%BD%D0%B8%D1%89%D0%BE-%D0%BB%D0%B8-%D0%B5-%D0%BD%D1%8F%D0%BC%D0%B0%D0%BB%D0%BE-%D0%BF%D1%80%D0%B5%D0%B4%D0%B8.html",
      "/%D0%B2%D1%8A%D0%BF%D1%80%D0%BE%D1%81%D0%B8-%D0%B7%D0%B0-%D0%91%D0%BE%D0%B3/%D0%BF%D1%80%D0%B8%D1%80%D0%BE%D0%B4%D0%BD%D0%B8-%D0%B7%D0%B0%D0%BA%D0%BE%D0%BD%D0%B8.html",
      "/%D0%B2%D1%8A%D0%BF%D1%80%D0%BE%D1%81%D0%B8-%D0%B7%D0%B0-%D0%91%D0%BE%D0%B3/%D1%80%D0%B5%D0%B0%D0%BB%D0%B5%D0%BD-%D0%BB%D0%B8-%D0%B5-%D0%91%D0%BE%D0%B3.html",
      "/%D0%B2%D1%8A%D0%BF%D1%80%D0%BE%D1%81%D0%B8-%D0%B7%D0%B0-%D0%91%D0%BE%D0%B3/%D1%82%D1%8A%D1%80%D1%81%D0%B5%D0%BD%D0%B5-%D0%BD%D0%B0-%D0%B8%D0%B4%D0%B5%D0%B0%D0%BB%D0%BD%D0%B8%D1%8F-%D0%91%D0%BE%D0%B3.html",
      "/%D0%B2%D1%8A%D0%BF%D1%80%D0%BE%D1%81%D0%B8-%D0%B7%D0%B0-%D0%91%D0%BE%D0%B3/%D1%83%D1%87%D0%B5%D0%BD-%D0%B4%D0%B0%D0%B2%D0%B0-%D0%B4%D0%BE%D0%BA%D0%B0%D0%B7%D0%B0%D1%82%D0%B5%D0%BB%D1%81%D1%82%D0%B2%D0%B0-%D0%BD%D0%B0%D1%81%D0%BE%D1%87%D0%B2%D0%B0%D1%89%D0%B8-%D0%BA%D1%8A%D0%BC-%D0%91%D0%BE%D0%B3.html",
      "/%D0%B2%D1%8A%D0%BF%D1%80%D0%BE%D1%81%D0%B8-%D0%B7%D0%B0-%D0%B6%D0%B8%D0%B2%D0%BE%D1%82%D0%B0/%D0%91%D0%BE%D0%B3-%D0%BD%D0%B0%D0%B8%D1%81%D1%82%D0%B8%D0%BD%D0%B0-%D0%BB%D0%B8-%D0%BD%D0%B0%D0%BF%D1%80%D0%B0%D0%B2%D0%BB%D1%8F%D0%B2%D0%B0-%D0%B6%D0%B8%D0%B2%D0%BE%D1%82%D0%B0-%D1%82%D0%B8.html",
      "/%D0%B2%D1%8A%D0%BF%D1%80%D0%BE%D1%81%D0%B8-%D0%B7%D0%B0-%D0%B6%D0%B8%D0%B2%D0%BE%D1%82%D0%B0/%D0%9F%D0%BE%D0%BC%D0%BE%D1%89-%D0%BE%D1%82-%D0%91%D0%BE%D0%B3-%D0%B2%D1%8A%D0%B2-%D0%B2%D1%81%D1%8F%D0%BA%D0%B0-%D1%81%D0%B8%D1%82%D1%83%D0%B0%D1%86%D0%B8%D1%8F.html",
      "/%D0%B2%D1%8A%D0%BF%D1%80%D0%BE%D1%81%D0%B8-%D0%B7%D0%B0-%D0%B6%D0%B8%D0%B2%D0%BE%D1%82%D0%B0/%D0%B4%D0%BE%D0%B1%D1%8A%D1%80-%D0%BB%D0%B8-%D0%B5-%D0%91%D0%BE%D0%B3.html",
      "/%D0%B2%D1%8A%D0%BF%D1%80%D0%BE%D1%81%D0%B8-%D0%B7%D0%B0-%D0%B6%D0%B8%D0%B2%D0%BE%D1%82%D0%B0/%D0%B7%D0%B0%D1%89%D0%BE-%D0%B8%D0%BC%D0%B0-%D1%81%D1%82%D1%80%D0%B0%D0%B4%D0%B0%D0%BD%D0%B8%D0%B5.html",
      "/%D0%B2%D1%8A%D0%BF%D1%80%D0%BE%D1%81%D0%B8-%D0%B7%D0%B0-%D0%B6%D0%B8%D0%B2%D0%BE%D1%82%D0%B0/%D0%B8%D0%B7%D1%82%D0%BE%D1%87%D0%BD%D0%B8%D0%BA%D1%8A%D1%82-%D0%BD%D0%B0-%D0%BF%D1%80%D0%BE%D0%BC%D0%B5%D0%BD%D0%B5%D0%BD-%D0%B6%D0%B8%D0%B2%D0%BE%D1%82.html",
      "/%D0%B2%D1%8A%D0%BF%D1%80%D0%BE%D1%81%D0%B8-%D0%B7%D0%B0-%D0%B6%D0%B8%D0%B2%D0%BE%D1%82%D0%B0/%D0%B8%D1%81%D1%82%D0%B8%D0%BD%D1%81%D0%BA%D0%B8-%D0%B6%D0%B8%D0%B2%D0%BE%D1%82.html",
      "/%D0%B2%D1%8A%D0%BF%D1%80%D0%BE%D1%81%D0%B8-%D0%B7%D0%B0-%D0%B6%D0%B8%D0%B2%D0%BE%D1%82%D0%B0/%D0%BA%D0%B0%D0%BA%D0%B2%D0%BE-%D1%81%D0%B5-%D1%81%D0%BB%D1%83%D1%87%D0%B2%D0%B0-%D0%BA%D0%BE%D0%B3%D0%B0%D1%82%D0%BE-%D1%83%D0%BC%D1%80%D0%B5%D0%BC.html",
      "/%D0%B2%D1%8A%D0%BF%D1%80%D0%BE%D1%81%D0%B8-%D0%B7%D0%B0-%D0%B6%D0%B8%D0%B2%D0%BE%D1%82%D0%B0/%D0%BA%D0%B0%D0%BA-%D0%B4%D0%B0-%D0%B8%D0%BC%D0%B0%D0%BC%D0%B5-%D0%BD%D0%B0%D0%B4%D0%B5%D0%B6%D0%B4%D0%B0.html",
      "/%D0%B2%D1%8A%D0%BF%D1%80%D0%BE%D1%81%D0%B8-%D0%B7%D0%B0-%D0%B6%D0%B8%D0%B2%D0%BE%D1%82%D0%B0/%D0%BA%D1%8A%D0%B4%D0%B5-%D0%B5-%D0%91%D0%BE%D0%B3-%D0%B2-%D1%82%D1%80%D1%83%D0%B4%D0%BD%D0%B8%D1%82%D0%B5-%D0%B2%D1%80%D0%B5%D0%BC%D0%B5%D0%BD%D0%B0.html",
      "/%D0%B2%D1%8A%D0%BF%D1%80%D0%BE%D1%81%D0%B8-%D0%B7%D0%B0-%D0%B6%D0%B8%D0%B2%D0%BE%D1%82%D0%B0/%D0%BF%D0%BE%D0%B2%D0%B5%D1%87%D0%B5-%D0%B2-%D1%82%D0%BE%D0%B7%D0%B8-%D0%B6%D0%B8%D0%B2%D0%BE%D1%82.html",
      "/%D0%B2%D1%8A%D0%BF%D1%80%D0%BE%D1%81%D0%B8-%D0%B7%D0%B0-%D0%B6%D0%B8%D0%B2%D0%BE%D1%82%D0%B0/%D1%81%D0%B2%D0%BE%D0%B1%D0%BE%D0%B4%D0%B0-%D0%BE%D1%82-%D0%B6%D0%B8%D0%B2%D0%BE%D1%82%D0%B0-%D0%B2-%D1%81%D1%82%D0%B8%D0%BB-%D0%BF%D0%BE%D0%BC%D0%BE%D0%B3%D0%BD%D0%B8-%D1%81%D0%B8-%D1%81%D0%B0%D0%BC.html",
      "/%D0%B2%D1%8A%D0%BF%D1%80%D0%BE%D1%81%D0%B8-%D0%B7%D0%B0-%D0%B6%D0%B8%D0%B2%D0%BE%D1%82%D0%B0/%D1%81%D0%B2%D0%BE%D0%B1%D0%BE%D0%B4%D0%B5%D0%BD-%D0%BE%D1%82-%D1%85%D0%B5%D1%80%D0%BE%D0%B8%D0%BD%D0%B0.html",
      "/%D0%B2%D1%8A%D0%BF%D1%80%D0%BE%D1%81%D0%B8-%D0%B7%D0%B0-%D0%B6%D0%B8%D0%B2%D0%BE%D1%82%D0%B0/%D1%81%D0%BC%D0%B8%D1%81%D1%8A%D0%BB%D1%8A%D1%82-%D0%BD%D0%B0-%D0%B6%D0%B8%D0%B2%D0%BE%D1%82%D0%B0.html",
      "/%D0%B2%D1%8A%D0%BF%D1%80%D0%BE%D1%81%D0%B8-%D0%B7%D0%B0-%D0%B6%D0%B8%D0%B2%D0%BE%D1%82%D0%B0/%D1%81%D0%BF%D0%BE%D0%BA%D0%BE%D0%B9%D1%81%D1%82%D0%B2%D0%B8%D0%B5-%D0%B2-%D0%BD%D0%B5%D1%81%D0%BF%D0%BE%D0%BA%D0%BE%D0%B5%D0%BD-%D1%81%D0%B2%D1%8F%D1%82.html",
      "/%D0%B2%D1%8A%D0%BF%D1%80%D0%BE%D1%81%D0%B8-%D0%B7%D0%B0-%D0%B6%D0%B8%D0%B2%D0%BE%D1%82%D0%B0/%D1%81%D0%BF%D1%80%D0%B0%D0%B2%D1%8F%D0%BD%D0%B5-%D1%81-%D0%B1%D0%B5%D0%B7%D0%BF%D0%BE%D0%BA%D0%BE%D0%B9%D1%81%D1%82%D0%B2%D0%BE%D1%82%D0%BE.html",
      "/%D0%B2%D1%8A%D0%BF%D1%80%D0%BE%D1%81%D0%B8-%D0%B7%D0%B0-%D0%B6%D0%B8%D0%B2%D0%BE%D1%82%D0%B0/%D1%81%D1%82%D1%80%D0%B0%D1%85-%D0%BE%D1%82-%D1%81%D0%BC%D1%8A%D1%80%D1%82%D1%82%D0%B0.html",
      "/%D0%B2%D1%8A%D0%BF%D1%80%D0%BE%D1%81%D0%B8-%D0%B7%D0%B0-%D0%B6%D0%B8%D0%B2%D0%BE%D1%82%D0%B0/%D1%84%D1%83%D0%BD%D0%B4%D0%B0%D0%BC%D0%B5%D0%BD%D1%82%D0%B0%D0%BB%D0%BD%D0%B8%D1%82%D0%B5-%D0%B2%D1%8A%D0%BF%D1%80%D0%BE%D1%81%D0%B8-%D0%B7%D0%B0-%D0%B6%D0%B8%D0%B2%D0%BE%D1%82%D0%B0.html",
      "/%D0%B4%D0%B0-%D0%BF%D0%BE%D0%B7%D0%BD%D0%B0%D0%B2%D0%B0%D0%BC%D0%B5-%D0%91%D0%BE%D0%B3/%D0%94%D0%B0-%D0%BF%D0%BE%D0%B7%D0%BD%D0%B0%D0%B2%D0%B0%D0%BC%D0%B5-%D0%91%D0%BE%D0%B3-%D0%BB%D0%B8%D1%87%D0%BD%D0%BE.html",
      "/%D0%B4%D0%B0-%D0%BF%D0%BE%D0%B7%D0%BD%D0%B0%D0%B2%D0%B0%D0%BC%D0%B5-%D0%91%D0%BE%D0%B3/%D0%98%D1%81%D1%83%D1%81-%D0%91%D0%BE%D0%B3-%D0%BB%D0%B8-%D0%B5.html",
      "/%D0%B4%D0%B0-%D0%BF%D0%BE%D0%B7%D0%BD%D0%B0%D0%B2%D0%B0%D0%BC%D0%B5-%D0%91%D0%BE%D0%B3/%D0%B4%D0%B0-%D0%BF%D0%BE%D0%B7%D0%BD%D0%B0%D0%B2%D0%B0%D0%BC%D0%B5-%D0%91%D0%BE%D0%B3.html",
      "/%D0%B4%D0%B0-%D0%BF%D0%BE%D0%B7%D0%BD%D0%B0%D0%B2%D0%B0%D0%BC%D0%B5-%D0%91%D0%BE%D0%B3/%D0%B7%D0%B0%D1%89%D0%BE-%D0%B4%D0%B0-%D0%B2%D1%8F%D1%80%D0%B2%D0%B0%D0%BC-%D0%BD%D0%B0-%D0%91%D0%B8%D0%B1%D0%BB%D0%B8%D1%8F%D1%82%D0%B0.html",
      "/%D0%B4%D0%B0-%D0%BF%D0%BE%D0%B7%D0%BD%D0%B0%D0%B2%D0%B0%D0%BC%D0%B5-%D0%91%D0%BE%D0%B3/%D0%B7%D0%B0%D1%89%D0%BE-%D1%83%D0%BC%D1%80%D1%8F-%D0%98%D1%81%D1%83%D1%81.html",
      "/%D0%B4%D0%B0-%D0%BF%D0%BE%D0%B7%D0%BD%D0%B0%D0%B2%D0%B0%D0%BC%D0%B5-%D0%91%D0%BE%D0%B3/%D0%BA%D0%B0%D0%BA%D0%B2%D0%BE-%D0%B7%D0%BD%D0%B0%D1%87%D0%B8-%D0%B4%D0%B0-%D0%BF%D0%BE%D0%B7%D0%BD%D0%B0%D0%B2%D0%B0%D0%BC%D0%B5-%D0%91%D0%BE%D0%B3%D0%B0.html",
      "/%D0%B4%D0%B0-%D0%BF%D0%BE%D0%B7%D0%BD%D0%B0%D0%B2%D0%B0%D0%BC%D0%B5-%D0%91%D0%BE%D0%B3/%D0%BA%D0%B0%D0%BA-%D0%BC%D0%BE%D0%B6%D0%B5%D0%BC-%D0%B4%D0%B0-%D0%BF%D0%BE%D0%B7%D0%BD%D0%B0%D0%B2%D0%B0%D0%BC%D0%B5-%D0%91%D0%BE%D0%B3.html",
      "/%D0%B4%D0%B0-%D0%BF%D0%BE%D0%B7%D0%BD%D0%B0%D0%B2%D0%B0%D0%BC%D0%B5-%D0%91%D0%BE%D0%B3/%D0%BA%D0%BE%D0%B9-%D0%B5-%D0%A1%D0%B2%D0%B5%D1%82%D0%B8%D1%8F%D1%82-%D0%94%D1%83%D1%85.html",
      "/%D0%B4%D0%B0-%D0%BF%D0%BE%D0%B7%D0%BD%D0%B0%D0%B2%D0%B0%D0%BC%D0%B5-%D0%91%D0%BE%D0%B3/%D0%BA%D0%BE%D0%B9-%D0%B5-%D0%B1%D0%B8%D0%BB-%D0%98%D1%81%D1%83%D1%81.html",
      "/%D0%B4%D0%B0-%D0%BF%D0%BE%D0%B7%D0%BD%D0%B0%D0%B2%D0%B0%D0%BC%D0%B5-%D0%91%D0%BE%D0%B3/%D0%BC%D0%BE%D0%B6%D0%B5%D1%82%D0%B5-%D0%BB%D0%B8-%D0%B4%D0%B0-%D0%BE%D0%B1%D1%8F%D1%81%D0%BD%D0%B8%D1%82%D0%B5-%D0%A2%D1%80%D0%BE%D0%B8%D1%86%D0%B0%D1%82%D0%B0.html",
      "/%D0%B4%D0%B0-%D0%BF%D0%BE%D0%B7%D0%BD%D0%B0%D0%B2%D0%B0%D0%BC%D0%B5-%D0%91%D0%BE%D0%B3/%D0%BE%D1%82%D0%B3%D0%BE%D0%B2%D0%B0%D1%80%D1%8F-%D0%BB%D0%B8-%D0%91%D0%BE%D0%B3-%D0%BD%D0%B0-%D0%BC%D0%BE%D0%BB%D0%B8%D1%82%D0%B2%D0%B8%D1%82%D0%B5-%D0%BD%D0%B8.html",
      "/%D0%B4%D0%B0-%D0%BF%D0%BE%D0%B7%D0%BD%D0%B0%D0%B2%D0%B0%D0%BC%D0%B5-%D0%91%D0%BE%D0%B3/%D0%BF%D0%B0%D0%B4%D0%B0%D1%89%D0%B8-%D1%87%D0%B8%D0%BD%D0%B8%D0%B8.html",
      "/%D0%B4%D0%B0-%D0%BF%D0%BE%D0%B7%D0%BD%D0%B0%D0%B2%D0%B0%D0%BC%D0%B5-%D0%91%D0%BE%D0%B3/%D1%81%D0%B2%D1%8A%D1%80%D0%B7%D0%B2%D0%B0%D0%BD%D0%B5-%D1%81-%D0%91%D0%BE%D0%B6%D0%B5%D1%81%D1%82%D0%B2%D0%B5%D0%BD%D0%BE%D1%82%D0%BE.html",
      "/%D0%B4%D0%B0-%D0%BF%D0%BE%D0%B7%D0%BD%D0%B0%D0%B2%D0%B0%D0%BC%D0%B5-%D0%91%D0%BE%D0%B3/%D1%82%D0%B2%D1%8A%D1%80%D0%B4%D0%B8-%D0%BB%D0%B8-%D0%98%D1%81%D1%83%D1%81-%D1%87%D0%B5-%D0%B5-%D0%91%D0%BE%D0%B3.html",
      "/%D0%B4%D0%B0-%D0%BF%D0%BE%D0%B7%D0%BD%D0%B0%D0%B2%D0%B0%D0%BC%D0%B5-%D0%91%D0%BE%D0%B3/%D1%83%D0%B4%D0%B8%D0%B2%D0%B5%D0%BD%D0%B8-%D0%BE%D1%82-%D0%B4%D0%BE%D0%B1%D1%80%D0%BE%D1%82%D0%B0%D1%82%D0%B0-%D0%BD%D0%B0-%D0%91%D0%BE%D0%B3%D0%B0.html",
      "/%D0%B4%D1%80%D1%83%D0%B3%D0%B8-%D0%B2%D1%8A%D0%BF%D1%80%D0%BE%D1%81%D0%B8/%D0%98%D1%81%D1%83%D1%81-%D0%B8-%D0%B8%D1%81%D0%BB%D1%8F%D0%BC%D1%8A%D1%82.html",
      "/%D0%B4%D1%80%D1%83%D0%B3%D0%B8-%D0%B2%D1%8A%D0%BF%D1%80%D0%BE%D1%81%D0%B8/%D0%B2%D1%8A%D0%B7%D0%BC%D0%BE%D0%B6%D0%BD%D0%BE-%D0%BB%D0%B8-%D0%B5-%D0%91%D0%BE%D0%B3-%D0%B4%D0%B0-%D0%B5-%D0%B6%D0%B5%D0%BD%D0%B0.html",
      "/%D0%B4%D1%80%D1%83%D0%B3%D0%B8-%D0%B2%D1%8A%D0%BF%D1%80%D0%BE%D1%81%D0%B8/%D0%B5%D0%B4%D0%BD%D0%BE-%D1%81%D1%82%D1%80%D0%B0%D0%BD%D0%BD%D0%BE-%D0%BD%D0%BE-%D1%80%D0%B5%D0%B0%D0%BB%D0%BD%D0%BE-%D0%B4%D1%83%D1%85%D0%BE%D0%B2%D0%BD%D0%BE-%D0%BF%D1%8A%D1%82%D1%83%D0%B2%D0%B0%D0%BD%D0%B5.html",
      "/%D0%B4%D1%80%D1%83%D0%B3%D0%B8-%D0%B2%D1%8A%D0%BF%D1%80%D0%BE%D1%81%D0%B8/%D0%B7%D0%B0%D1%89%D0%BE-%D0%91%D0%BE%D0%B3-%D0%BD%D0%B5-%D0%B8%D0%B7%D0%B2%D1%8A%D1%80%D1%88%D0%B8-%D0%B3%D1%80%D0%B0%D0%BD%D0%B4%D0%B8%D0%BE%D0%B7%D0%BD%D0%BE-%D1%87%D1%83%D0%B4%D0%BE.html",
      "/%D0%B4%D1%80%D1%83%D0%B3%D0%B8-%D0%B2%D1%8A%D0%BF%D1%80%D0%BE%D1%81%D0%B8/%D0%B7%D0%B0%D1%89%D0%BE-%D0%B4%D0%B0-%D0%BF%D0%BE%D1%87%D0%B8%D1%82%D0%B0%D0%BC-%D0%91%D0%BE%D0%B3.html",
      "/%D0%B4%D1%80%D1%83%D0%B3%D0%B8-%D0%B2%D1%8A%D0%BF%D1%80%D0%BE%D1%81%D0%B8/%D0%B8%D0%BC%D0%B0-%D0%BB%D0%B8-%D0%BF%D1%80%D0%B5%D1%80%D0%B0%D0%B6%D0%B4%D0%B0%D0%BD%D0%B5.html",
      "/%D0%B4%D1%80%D1%83%D0%B3%D0%B8-%D0%B2%D1%8A%D0%BF%D1%80%D0%BE%D1%81%D0%B8/%D0%B8%D0%BC%D0%B0-%D0%BB%D0%B8-%D0%BF%D1%80%D0%BE%D1%82%D0%B8%D0%B2%D0%BE%D1%80%D0%B5%D1%87%D0%B8%D1%8F-%D0%B2-%D0%91%D0%B8%D0%B1%D0%BB%D0%B8%D1%8F%D1%82%D0%B0.html",
      "/%D0%B4%D1%80%D1%83%D0%B3%D0%B8-%D0%B2%D1%8A%D0%BF%D1%80%D0%BE%D1%81%D0%B8/%D0%B8%D0%BC%D0%B0-%D0%BB%D0%B8-%D1%80%D0%B0%D0%B9.html",
      "/%D0%B4%D1%80%D1%83%D0%B3%D0%B8-%D0%B2%D1%8A%D0%BF%D1%80%D0%BE%D1%81%D0%B8/%D0%BA%D0%B0%D0%B7%D0%B2%D0%B0%D0%BB-%D0%BB%D0%B8-%D0%B5-%D0%BD%D1%8F%D0%BA%D0%BE%D0%B3%D0%B0-%D0%98%D1%81%D1%83%D1%81-%D1%87%D0%B5-%D0%B5-%D0%91%D0%BE%D0%B3.html",
      "/%D0%B4%D1%80%D1%83%D0%B3%D0%B8-%D0%B2%D1%8A%D0%BF%D1%80%D0%BE%D1%81%D0%B8/%D0%BA%D0%B0%D0%BA%D0%B2%D0%BE-%D0%BD%D0%B8-%D0%BF%D1%80%D0%B5%D0%B4%D0%BB%D0%B0%D0%B3%D0%B0-%D0%98%D1%81%D1%83%D1%81.html",
      "/%D0%B4%D1%80%D1%83%D0%B3%D0%B8-%D0%B2%D1%8A%D0%BF%D1%80%D0%BE%D1%81%D0%B8/%D0%BA%D0%B0%D0%BA-%D0%B4%D0%B0-%D1%81%D0%BC%D0%B5-%D1%81%D0%B8%D0%B3%D1%83%D1%80%D0%BD%D0%B8-%D1%87%D0%B5-%D1%89%D0%B5-%D0%BE%D1%82%D0%B8%D0%B4%D0%B5%D0%BC-%D0%B2-%D1%80%D0%B0%D1%8F.html",
      "/%D0%B4%D1%80%D1%83%D0%B3%D0%B8-%D0%B2%D1%8A%D0%BF%D1%80%D0%BE%D1%81%D0%B8/%D0%BA%D0%B0%D0%BA-%D0%BF%D1%80%D0%BE%D0%BC%D0%B5%D0%BD%D0%B8%D1%85-%D1%81%D0%B2%D0%BE%D0%B8%D1%82%D0%B5-%D0%9C%D0%BE%D1%80%D0%BC%D0%BE%D0%BD%D1%81%D0%BA%D0%B8-%D0%B2%D1%8F%D1%80%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F.html",
      "/%D0%B4%D1%80%D1%83%D0%B3%D0%B8-%D0%B2%D1%8A%D0%BF%D1%80%D0%BE%D1%81%D0%B8/%D0%BA%D0%BE%D0%B9-%D0%B5-%D0%B4%D1%8F%D0%B2%D0%BE%D0%BB%D1%8A%D1%82.html",
      "/%D0%B4%D1%80%D1%83%D0%B3%D0%B8-%D0%B2%D1%8A%D0%BF%D1%80%D0%BE%D1%81%D0%B8/%D0%BA%D0%BE%D1%8F-%D0%B4%D0%B5%D0%BD%D0%BE%D0%BC%D0%B8%D0%BD%D0%B0%D1%86%D0%B8%D1%8F-%D0%B4%D0%B0-%D0%B8%D0%B7%D0%B1%D0%B5%D1%80%D0%B0.html",
      "/%D0%B4%D1%80%D1%83%D0%B3%D0%B8-%D0%B2%D1%8A%D0%BF%D1%80%D0%BE%D1%81%D0%B8/%D0%BA%D1%80%D0%B0%D1%8F%D1%82-%D0%BD%D0%B0-%D1%81%D0%B2%D0%B5%D1%82%D0%B0.html",
      "/%D0%B4%D1%80%D1%83%D0%B3%D0%B8-%D0%B2%D1%8A%D0%BF%D1%80%D0%BE%D1%81%D0%B8/%D0%BD%D1%83%D0%B6%D0%B5%D0%BD-%D0%BB%D0%B8-%D0%BC%D0%B8-%D0%B5-%D0%91%D0%BE%D0%B3-%D0%B7%D0%B0-%D0%B4%D0%B0-%D0%B1%D1%8A%D0%B4%D0%B0-%D1%89%D0%B0%D1%81%D1%82%D0%BB%D0%B8%D0%B2.html",
      "/%D0%B4%D1%80%D1%83%D0%B3%D0%B8-%D0%B2%D1%8A%D0%BF%D1%80%D0%BE%D1%81%D0%B8/%D0%BF%D1%8A%D1%80%D0%B2%D0%BE%D1%80%D0%BE%D0%B4%D0%BD%D0%B8%D1%8F-%D0%B3%D1%80%D1%8F%D1%85-%D0%BD%D0%B0-%D0%B0%D0%B4%D0%B0%D0%BC-%D0%B8-%D0%B5%D0%B2%D0%B0.html",
      "/%D0%B4%D1%80%D1%83%D0%B3%D0%B8-%D0%B2%D1%8A%D0%BF%D1%80%D0%BE%D1%81%D0%B8/%D1%80%D0%B0%D0%B4%D0%B8%D0%BA%D0%B0%D0%BB%D0%B5%D0%BD-%D0%BC%D1%8E%D1%81%D1%8E%D0%BB%D0%BC%D0%B0%D0%BD%D0%B8%D0%BD.html",
      "/%D0%B4%D1%80%D1%83%D0%B3%D0%B8-%D0%B2%D1%8A%D0%BF%D1%80%D0%BE%D1%81%D0%B8/%D1%81%D0%BC%D0%B8%D1%81%D1%8A%D0%BB%D1%8A%D1%82-%D0%BD%D0%B0-%D0%A0%D0%BE%D0%B6%D0%B4%D0%B5%D1%81%D1%82%D0%B2%D0%BE.html",
      "/%D0%B4%D1%80%D1%83%D0%B3%D0%B8-%D0%B2%D1%8A%D0%BF%D1%80%D0%BE%D1%81%D0%B8/%D1%81%D1%8A%D0%B7%D0%B4%D0%B0%D0%B4%D0%B5-%D0%BB%D0%B8-%D0%91%D0%BE%D0%B3-%D0%B2%D1%81%D0%B5%D0%BB%D0%B5%D0%BD%D0%B0%D1%82%D0%B0-%D0%B7%D0%B0-%D1%88%D0%B5%D1%81%D1%82-%D0%B4%D0%BD%D0%B8.html",
      "/%D0%B4%D1%80%D1%83%D0%B3%D0%B8-%D0%B2%D1%8A%D0%BF%D1%80%D0%BE%D1%81%D0%B8/%D1%82%D0%BE%D1%80%D0%BC%D0%BE%D0%B7.html",
      "/%D0%B4%D1%80%D1%83%D0%B3%D0%B8-%D0%B2%D1%8A%D0%BF%D1%80%D0%BE%D1%81%D0%B8/%D1%8E%D0%B4%D0%B0%D0%B8%D0%B7%D1%8A%D0%BC-%D1%85%D1%80%D0%B8%D1%81%D1%82%D0%B8%D1%8F%D0%BD%D1%81%D1%82%D0%B2%D0%BE.html",
    ],
    // Measured 2026-07-29: the ONLY element wrapping the prose. The legacy
    // .content4 family does not exist on this host at all.
    contentSelectors: [".article-content"],
    // This host's chrome sits outside .article-content; only the base
    // structural tags need removing. The legacy EveryStudent strip list
    // measured 0 instances on every page and is deliberately not carried over.
    stripSelectors: ["script", "style", "noscript", "svg", "nav", "form"],
    requestDelayMs: 1000,
    maxPages: 120,
    minContentLength: 250,
  },
}
