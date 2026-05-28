---
title: Restructure apps/web Watch URL i18n to .html shape + legacy compat
type: feat
status: active
date: 2026-05-27
---

# Restructure apps/web Watch URL i18n to .html shape + legacy compat

## Enhancement Summary

**Deepened on:** 2026-05-27 (post-initial draft)
**Research agents used:** framework-docs-researcher, best-practices-researcher, architecture-strategist, code-simplicity-reviewer, performance-oracle, security-sentinel, pattern-recognition-specialist, kieran-typescript-reviewer, julik-frontend-races-reviewer, deployment-verification-agent, plus three targeted Explore probes (URL canonicalization state machines, probe-harness design, SEO migration discipline).

### Key Refinements (consolidated from §"Research Insights & Refinements" below)

1. **Phase reorder: emit canonical URLs (old Phase 4) BEFORE proxy normalization (old Phase 3).** Otherwise every internal `<Link>` click during the transition emits a bare URL that gets 307'd, breaking the latency NFR. The plan now lists implementation phases as Foundation → Routes → Hrefs+SEO → Proxy Normalization → Probe Harness.
2. **Drop the `/watch/search.html/search.html` page-render dispatch sentinel.** Serve search ONLY from `app/search/page.tsx`; treat the legacy shape as a 308 target. Removes a hand-rolled sub-router from a parameterized route.
3. **Add `parseWatchPath(pathname)` to `lib/routes.ts`.** Single source for URL → params classification, consumed by both pages (Phase 2) and the canonicalizer (Phase 4).
4. **Resolve language-slug aliases on cookie READ, not just on URL.** Otherwise `forge_watch_lang=chinese-mandarin` produces an infinite cookie ↔ alias redirect loop. This is the #1 race-condition risk in the original draft.
5. **Use a server action for `LanguagePickerModal`'s cookie write + redirect.** Eliminates the cookie-write-then-client-navigate race that caused alias-cookie loops in browser testing.
6. **Brand `LocaleSlug` and `ContentSlug` types**; collapse all `as Route` casts inside `lib/routes.ts` to a single `toRoute()` helper; replace `localeResolved: boolean` with a `reason` literal union.
7. **Replace the 30-day revalidate-overlap window with a webhook-emission counter gate.** Overlap ends after 7 consecutive days with zero bare-shape webhook emissions from admin.
8. **Tighten the proxy matcher to `_next` (not `_next/static`)** so `_next/data` (RSC payloads), `_next/image`, `_next/webpack-hmr` all pass through. RSC payload paths through canonicalize is a P0.
9. **Add `Vary: Cookie, Accept-Language` to every cookie-driven 307** (cache-poisoning defense at Cloudflare).
10. **Add a `WATCH_CANONICALIZE_DISABLED` kill-switch env var** in the Phase 4 ship so the entire canonicalize stage can be defanged from Railway without a code deploy.
11. **Phase 1 is NOT blocked by the data-layer-flip freeze.** The foundation modules are pure functions over strings. Ship them on `main` immediately; the freeze blocker only applies from Phase 2 onward.
12. **Document the alias-table sunset path:** future move to `Language.legacySlugs: [String!]` on admin (data lives where the canonical lives), with `language-aliases.ts` generated at build time from admin SDL.

### New Considerations Discovered

- **Cloudflare "Browser Cache TTL" zone setting can override origin `Cache-Control` on 30x.** Verify and disable before cutover (or set to "Respect Existing Headers").
- **`og:url` and `<link rel="canonical">` MUST be identical**; FB scrapes `og:url` for social-share preview and silently drifts when they disagree.
- **Hreflang updates ship in the SAME COMMIT as the canonical-URL change** — stale hreflang pointing at old URLs is the most-missed step per Google's site-move guide.
- **Pre-warm the top 1000 `.html` URLs through Cloudflare via the probe harness** before flipping DNS. Avoids origin-load spike from cold-cache `.html` shape.
- **`PREFERRED_LANG_SLUG` regex must be widened** to admit `.html` suffix on the locale segment (`/^[a-z0-9-]+(\.html)?$/`), otherwise CSP doesn't attach to three-segment routes.
- **Reconcile `SITE_BASE = "https://www.jesusfilm.org"`** (in [apps/web/src/lib/experience-metadata.ts:11](apps/web/src/lib/experience-metadata.ts)) **with `PUBLIC_SHARE_FALLBACK_ORIGIN = "https://jesusfilm.org"`** (in [apps/web/src/lib/share.ts:9](apps/web/src/lib/share.ts)) — they disagree on the `www` prefix. Pick one and centralize in `lib/routes.ts` as `WATCH_CANONICAL_ORIGIN` during Phase 1.

## Overview

The legacy `jesusfilm.org/watch` site serves a URL space with `.html` suffix segments and English-name kebab-case language slugs (`/watch/jesus.html/english.html`, `/watch/lumo-the-gospel-of-john.html/wedding-in-cana/english.html`, `/watch/russian.html`). The current `apps/web` rewrite serves bare two-segment URLs (`/watch/jesus/english`) and does not support three-segment series-episode shapes, the localized home shape, the all-videos index, the legacy search shape, alias-redirect tables, or any of the production normalization rules. This plan restructures apps/web's URL surface and supporting middleware so the rewrite can cut over without breaking inbound links, share URLs, search results, social embeds, partner integrations, or printed media.

The source-of-truth URL inventory is [docs/research/jesusfilm-watch-url-patterns.md](docs/research/jesusfilm-watch-url-patterns.md) (verified live 2026-05-27). The migration uses it as both the requirements doc and the integration-test matrix.

## Problem Statement

### Current state (apps/web on `main`)

Every URL apps/web emits and accepts is the bare two-segment shape `/watch/{slug}/{locale}`. Specifically:

- Page routes: [apps/web/src/app/page.tsx](apps/web/src/app/page.tsx) (`/watch`), [apps/web/src/app/[slug]/page.tsx](apps/web/src/app/[slug]/page.tsx) (`/watch/{slug}`), [apps/web/src/app/[slug]/[locale]/page.tsx](apps/web/src/app/[slug]/[locale]/page.tsx) (`/watch/{slug}/{locale}`).
- Search: [apps/web/src/app/search/page.tsx:23-29](apps/web/src/app/search/page.tsx) hard-redirects `/watch/search?q=…` → `/watch/?q=…` (floating-modal search model, not the legacy `.html/search.html` shape).
- Proxy/middleware: [apps/web/src/proxy.ts](apps/web/src/proxy.ts) handles cookie-driven language preference redirect + Accept-Language fallback redirect + watch CSP headers. No `.html` awareness, no trailing-slash strip, no case normalization, no alias resolution, no single-segment-duplicate rewrite.
- Href emission: 12+ call sites (catalogued in §3.4 below) all emit bare `/${slug}/${locale}`.
- Canonical/OG metadata: [apps/web/src/lib/experience-metadata.ts:11,38-46,180-183](apps/web/src/lib/experience-metadata.ts) builds `https://www.jesusfilm.org/watch/{slug}/{pathLocale}`.
- ISR revalidation: [apps/web/src/app/api/revalidate/route.ts:81-105](apps/web/src/app/api/revalidate/route.ts) targets `/${slug}/${locale}` and `/${slug}`.
- Locale model: [apps/web/src/lib/locale.ts](apps/web/src/lib/locale.ts) has `SUPPORTED_LOCALES = ["en","es","fr","pt","de"]` (UI template locales, bcp47), distinct from the per-variant English-name kebab slugs (`russian`, `portuguese-brazil`, `spanish-castilian`) sourced from admin's `Language.slug` field.

### Production URL contract that must be served

| Public URL pattern                           | Status                                       | Notes                                                              |
| -------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------ |
| `/watch`                                     | 200                                          | English home                                                       |
| `/watch/`                                    | 308 → `/watch`                               | trailing-slash strip                                               |
| `/watch/{lang}.html`                         | 200                                          | Localized home; lang is English-name kebab slug                    |
| `/watch/{slug}.html/{lang}.html`             | 200                                          | **Canonical two-segment** video / series / collection              |
| `/watch/{series}.html/{episode}/{lang}.html` | 200                                          | **Three-segment** series episode (note: episode segment is bare)   |
| `/watch/{slug}.html`                         | 200 _for some collections only_              | Best-effort one-segment; single videos 404                         |
| `/watch/videos`                              | 200                                          | All-videos index (no `.html`)                                      |
| `/watch/search`                              | 307 → `/watch/search.html/search.html` → 200 | Legacy search shape                                                |
| `/watch/assets/...`                          | passthrough                                  | Static assets                                                      |
| `/watch/_next/...`                           | passthrough                                  | Framework chunks (incl. `_next/data`, `_next/image`, RSC payloads) |
| `/watch/api/...`                             | passthrough                                  | Server routes                                                      |

Plus the normalization rules:

| Input                                     | Status | Output                                                         |
| ----------------------------------------- | ------ | -------------------------------------------------------------- |
| `/watch/`                                 | 308    | `/watch`                                                       |
| `/watch/jesus.html/`                      | 308    | `/watch/jesus.html`                                            |
| `/watch/jesus.html/english.html/`         | 308    | `/watch/jesus.html/english.html`                               |
| `/watch/jesus.HTML/english.html`          | 307    | `/watch/jesus.html/english.html`                               |
| `/watch/jesus.html/english`               | 307    | `/watch/jesus.html/english.html`                               |
| `/watch/foo`                              | 307    | `/watch/foo.html/foo.html` (single→duplicate)                  |
| `/watch/foo/bar`                          | 307    | `/watch/foo.html/bar.html` (per-segment `.html` append)        |
| `/watch/jesus.html/chinese-mandarin.html` | 307    | `/watch/jesus.html/mandarin-china.html` (alias)                |
| `/watch/{series}/{ep}.html/{lang}.html`   | 307    | `/watch/{series}.html/{ep}/{lang}.html` (legacy episode shape) |

### Why the gap matters

- **SEO**: Inbound search-engine results target `.html`-suffixed URLs. Cutover without compat = broken SERP entries and crawl penalties.
- **Share links**: Every shared URL on Facebook, Twitter, WhatsApp emitted by the legacy site is `.html`-shaped, with Facebook caching OG metadata of the destination for ~7 days.
- **Printed media**: Physical materials (booklets, conference handouts, partner deliverables) print canonical URLs. These cannot be reissued.
- **Series episodes**: The Lumo gospel series + Jesus film episodes are the most-deep-linked content in the legacy URL space. The current rewrite returns 404 for every three-segment URL.
- **Localized homes**: `/watch/russian.html`, `/watch/portuguese-brazil.html` are linked from partner sites and language-selector dropdowns. None of them resolve today.

## Proposed Solution

Adopt a **hybrid route + middleware** model:

1. **Next.js App Router file tree stays observable.** Keep `app/[slug]/[locale]/page.tsx`. Add `app/[slug]/[episode]/[locale]/page.tsx` for the three-segment shape. Add `app/videos/page.tsx`. Re-purpose `app/search/page.tsx`.
2. **Param values carry the `.html` literal.** Page route segments accept `slug` values such as `jesus.html` and `english.html` — the page server-strips `.html` via a small helper before passing into the existing resolver chain. Avoids restructuring the entire file tree around literal `.html` segments.
3. **Centralized URL builder.** New `apps/web/src/lib/routes.ts` is the single source of truth for emitting watch URLs. Every href emission site replaced. One `as Route` cast at the builder boundary contains the `typedRoutes: true` blast radius.
4. **Middleware (`proxy.ts`) owns normalization.** All six normalization rules run before the route handler. Rule composition is sequenced as a single transformation that produces ONE terminal 307 (no chained redirects). Reserved subtrees (`/api/*`, `/_next/*`, `/assets/*`) are excluded at the matcher.
5. **Alias table is static + admin-validated.** Ship a hand-curated alias map in `apps/web/src/lib/language-aliases.ts` for known legacy slugs. CI validation cross-references against admin's `Language.slug` corpus and fails if any alias points to a non-existent canonical.
6. **Cache discipline on 30x responses.** Every normalization 307/308 emits `Cache-Control: private, max-age=0` for at least the first 30 days post-cutover to keep Cloudflare from caching mis-targeted redirects.
7. **Probe harness gates the deploy.** `apps/web/scripts/probe-watch-urls.ts` runs the §5 URL matrix from the research doc against (live production, rewrite preview) and reports parity. Numeric pass gate before flipping DNS.

## Technical Approach

### Architecture

```
inbound request
   │
   ▼
Cloudflare WAF / AOP                      (preserve Authorization, query params unchanged)
   │
   ▼
Railway → Next.js basePath: "/watch"      (strips /watch prefix internally)
   │
   ▼
apps/web/src/proxy.ts (middleware)
   │
   ├─ matcher excludes api|_next/*|assets/*|favicon|robots|sitemap
   ├─ apply watch-CSP headers
   ├─ run canonicalize(pathname):
   │     1. trailing-slash strip → 308
   │     2. lowercase .HTML → 307
   │     3. legacy 4-segment episode → 307
   │     4. per-segment missing .html append → 307
   │     5. single-segment → duplicate-+-.html → 307
   │     6. language-slug alias resolution → 307
   │     7. cookie-driven language preference redirect → 307
   │
   ├─ if canonicalize emitted Location: return single 307/308 with that Location + Cache-Control: private, max-age=0
   │
   ▼
Next.js App Router
   │
   ├─ /watch                    → app/page.tsx
   ├─ /watch/videos             → app/videos/page.tsx
   ├─ /watch/search.html/search.html → app/[slug]/[locale]/page.tsx (slug=search.html, locale=search.html)
   │                              page detects sentinel, renders search results UI
   ├─ /watch/{lang}.html        → app/[slug]/page.tsx (slug=russian.html)
   │                              page strips .html, calls resolveWatchPage(localeFromSlug)
   ├─ /watch/{slug}.html/{lang}.html → app/[slug]/[locale]/page.tsx
   │                              page strips .html on BOTH params, calls existing resolver chain
   └─ /watch/{series}.html/{ep}/{lang}.html → app/[slug]/[episode]/[locale]/page.tsx (NEW)
                                  page strips .html on segments 1+3, episode bare, calls new series resolver
```

### Implementation Phases

#### Phase 1 — Foundation (no behavior change)

Goal: ship the supporting primitives without altering production URL shape, so subsequent phases can land incrementally.

##### Files to add

```ts
// apps/web/src/lib/url-shape.ts
//
// .html suffix utilities. Pure functions, no side effects.

export const HTML_SUFFIX = ".html"
export const HTML_SUFFIX_REGEX = /\.html$/i

export function stripHtmlSuffix(segment: string): string {
  return segment.replace(HTML_SUFFIX_REGEX, "")
}

export function hasHtmlSuffix(segment: string): boolean {
  return HTML_SUFFIX_REGEX.test(segment)
}

export function appendHtmlSuffix(segment: string): string {
  return hasHtmlSuffix(segment) ? segment : `${segment}${HTML_SUFFIX}`
}
```

```ts
// apps/web/src/lib/routes.ts
//
// Safe to import from client + server (no node:-only imports, no next/headers).
// Every <Link href>, router.push, redirect target, and share URL inside apps/web
// flows through these builders.

import type { Route } from "next"
import { appendHtmlSuffix } from "./url-shape"
import { LOCALE_RESOLVED_PARAM } from "./locale"

declare const localeSlugBrand: unique symbol
declare const contentSlugBrand: unique symbol
export type LocaleSlug = string & { readonly [localeSlugBrand]: true }
export type ContentSlug = string & { readonly [contentSlugBrand]: true }

const SLUG_PATTERN = /^[a-z0-9-]+$/
export function asLocaleSlug(s: string): LocaleSlug {
  if (!SLUG_PATTERN.test(s)) throw new Error(`invalid LocaleSlug: ${s}`)
  return s as LocaleSlug
}
export function asContentSlug(s: string): ContentSlug {
  if (!SLUG_PATTERN.test(s)) throw new Error(`invalid ContentSlug: ${s}`)
  return s as ContentSlug
}

// `reason` documents WHY the resync sentinel is set. The literal union also
// keeps client-emitted hrefs honest: the modal can't accidentally pass
// `reason: "locale-resolved"` (which is reserved for server-side resync).
export type BuildOptions = {
  t?: number
  autoplay?: boolean
  reason?: "locale-resolved" | "alias-redirect" | "cookie-pref"
}

const ONE_SHOT_TIMESTAMP_PARAM = "t"
const ONE_SHOT_AUTOPLAY_PARAM = "autoplay"

const toRoute = (p: string): Route => p as Route

function withQuery(path: string, opts?: BuildOptions): Route {
  if (!opts) return toRoute(path)
  const params = new URLSearchParams()
  if (opts.t != null) params.set(ONE_SHOT_TIMESTAMP_PARAM, String(opts.t))
  if (opts.autoplay) params.set(ONE_SHOT_AUTOPLAY_PARAM, "1")
  if (opts.reason != null) params.set(LOCALE_RESOLVED_PARAM, "1")
  const qs = params.toString()
  return toRoute(qs ? `${path}?${qs}` : path)
}

// /watch/{lang}.html
export function localizedHomePath(lang: LocaleSlug): Route {
  return withQuery(`/${appendHtmlSuffix(lang)}`)
}

// /watch/{slug}.html/{lang}.html
export function watchVideoPath(
  slug: ContentSlug,
  lang: LocaleSlug,
  opts?: BuildOptions,
): Route {
  return withQuery(`/${appendHtmlSuffix(slug)}/${appendHtmlSuffix(lang)}`, opts)
}

// /watch/{series}.html/{episode}/{lang}.html
export function watchEpisodePath(
  series: ContentSlug,
  episode: ContentSlug,
  lang: LocaleSlug,
  opts?: BuildOptions,
): Route {
  return withQuery(
    `/${appendHtmlSuffix(series)}/${episode}/${appendHtmlSuffix(lang)}`,
    opts,
  )
}

// /watch/videos
export function videosIndexPath(): Route {
  return toRoute("/videos")
}

// /watch/search — public canonical. NEVER emits .html/search.html shape from
// the builder; that legacy shape exists only as a 308 target from the proxy.
export function searchPath(q?: string): Route {
  const params = new URLSearchParams()
  if (q) params.set("q", q)
  const qs = params.toString()
  return toRoute(qs ? `/search?${qs}` : "/search")
}

// Inverse of the builders. Pages (Phase 2) AND the canonicalizer (Phase 4)
// call this. Single source of truth for URL → params classification, so the
// two halves can never silently diverge.
export type ParsedWatchPath =
  | { kind: "home" }
  | { kind: "localized-home"; lang: LocaleSlug }
  | { kind: "video"; slug: ContentSlug; lang: LocaleSlug }
  | {
      kind: "episode"
      series: ContentSlug
      episode: ContentSlug
      lang: LocaleSlug
    }
  | { kind: "videos" }
  | { kind: "search"; q?: string }
  | { kind: "reserved"; prefix: string } // api | _next | assets | favicon | robots | sitemap
  | { kind: "unknown"; raw: string }

export function parseWatchPath(
  pathname: string,
  search?: URLSearchParams,
): ParsedWatchPath {
  /* … */
}

// WATCH_CANONICAL_ORIGIN consolidates SITE_BASE (experience-metadata.ts:11)
// and PUBLIC_SHARE_FALLBACK_ORIGIN (share.ts:9). Today they disagree on the
// `www` prefix — pick ONE and migrate both call sites to import from here.
// Read from process.env.NEXT_PUBLIC_CANONICAL_ORIGIN; never hardcode.
export const WATCH_CANONICAL_ORIGIN =
  process.env.NEXT_PUBLIC_CANONICAL_ORIGIN ?? "https://www.jesusfilm.org"
export const WATCH_BASE_PATH = "/watch" // mirrors next.config.mjs basePath; CI grep test enforces invariant

export function watchVideoAbsolute(
  slug: ContentSlug,
  lang: LocaleSlug,
): string {
  return `${WATCH_CANONICAL_ORIGIN}${WATCH_BASE_PATH}${watchVideoPath(slug, lang)}`
}
export function watchEpisodeAbsolute(
  series: ContentSlug,
  ep: ContentSlug,
  lang: LocaleSlug,
): string {
  return `${WATCH_CANONICAL_ORIGIN}${WATCH_BASE_PATH}${watchEpisodePath(series, ep, lang)}`
}
export function localizedHomeAbsolute(lang: LocaleSlug): string {
  return `${WATCH_CANONICAL_ORIGIN}${WATCH_BASE_PATH}${localizedHomePath(lang)}`
}
```

**Constraints enforced by CI grep:**

- Zero `as Route` casts outside `lib/routes.ts`.
- Exactly one `toRoute(...)` cast inside `lib/routes.ts` (via `withQuery`).
- Zero raw `${origin}/watch/${slug}/${lang}` string templates in `apps/web/src/{app,components}/`.
- Zero references to `process.env.NEXT_PUBLIC_BASE_PATH` outside `lib/routes.ts`.

```ts
// apps/web/src/lib/language-aliases.ts
//
// Static legacy-slug → canonical-slug alias table. CI validation in
// apps/web/src/lib/language-aliases.test.ts cross-references against admin's
// Language.slug corpus + checks acyclicity (no a → b → a) + static-shape
// invariant (every value matches /^[a-z0-9-]+$/, no `/`, `.`, scheme).
//
// `as const satisfies` keeps the literal keys statically known. CI assertion
// `CanonicalLanguageSlug extends KnownAdminSlug` fails the build if any alias
// canonical doesn't exist in admin's corpus.

export const LANGUAGE_SLUG_ALIASES = {
  "chinese-mandarin": "mandarin-china",
} as const satisfies Record<string, string>

export type LegacyLanguageSlug = keyof typeof LANGUAGE_SLUG_ALIASES
export type CanonicalLanguageSlug =
  (typeof LANGUAGE_SLUG_ALIASES)[LegacyLanguageSlug]

const SAFE_SLUG = /^[a-z0-9-]+$/

// tryResolveLanguageAlias: returns canonical iff input is a known legacy slug.
// Uses Object.hasOwn (not bracket access) so a future dynamic data source
// can't smuggle in prototype-pollution keys (__proto__, constructor). Also
// re-validates the resolved value against SAFE_SLUG so a corrupted alias map
// can't return a relative-path or scheme-prefixed string.
export function tryResolveLanguageAlias(slug: string): string | null {
  if (!Object.hasOwn(LANGUAGE_SLUG_ALIASES, slug)) return null
  const canonical = LANGUAGE_SLUG_ALIASES[slug as LegacyLanguageSlug]
  return SAFE_SLUG.test(canonical) ? canonical : null
}
```

```ts
// apps/web/src/lib/url-canonicalize.ts
//
// Pure single-pass canonicalizer. No loops. Each rule applied at most once.
// Operates on the RAW (un-decoded) pathname to preserve percent-encoding;
// the WHATWG URL parser silently re-encodes reserved chars and we don't
// want that surface in our state machine.
//
// Termination guarantee (proof sketch): each rule is deterministic and
// idempotent (re-applying produces same output); rules are applied in fixed
// order; no rule re-enters the sequence. Therefore canonicalize(x) reaches
// a fixed point in one pass and canonicalize(canonicalize(x)) === canonicalize(x).
// Property test in url-canonicalize.test.ts asserts this for every URL in
// docs/research/jesusfilm-watch-url-patterns.md §5 + every alias-table key.

import { tryResolveLanguageAlias } from "./language-aliases"

// `cache` declares per-rule cache intent. Middleware translates intent → header.
// Keeps cache policy out of regex code; operational tightening of cutover
// becomes one mapping table, not a regex sweep.
export type CanonicalizeResult =
  | { kind: "canonical" }
  | {
      kind: "redirect"
      pathname: string
      status: 307 | 308
      cache: "no-store" | "short" | "long"
    }

type CanonicalizeInput = {
  rawPathname: string // basePath already stripped (Next 16 proxy.ts semantics)
}

const MAX_PATH_LEN = 2048
// Tightened to `_next` (not `_next/static`) so RSC payload paths (`_next/data`),
// image optimizer (`_next/image`), and webpack-hmr all bypass canonicalize.
// `RESERVED_PREFIXES` is defense-in-depth alongside the proxy.ts matcher.
const RESERVED_PREFIXES = new Set([
  "api",
  "_next",
  "assets",
  "favicon.ico",
  "robots.txt",
  "sitemap.xml",
])

// Origin-invariance + injection guards. Any input that fails MUST short-circuit
// to `{kind: "canonical"}` (let the route handler 404 it). NEVER emit a Location
// derived from a path that could escape origin (//, \, CRLF) or carry traversal.
const UNSAFE_INPUT = /(^\/\/)|(\/\/)|[\\\r\n]|(%0[ad])|\.\./i

export function canonicalizeWatchPath(
  input: CanonicalizeInput,
): CanonicalizeResult {
  const raw = input.rawPathname

  // Step 0a: length cap (ReDoS defense)
  if (raw.length > MAX_PATH_LEN) return { kind: "canonical" }

  // Step 0b: reserved subtree exclusion
  const firstSegment = raw.split("/").filter(Boolean)[0]
  if (firstSegment && RESERVED_PREFIXES.has(firstSegment))
    return { kind: "canonical" }

  // Step 0c: injection guard — origin invariance + CRLF + traversal
  if (UNSAFE_INPUT.test(raw)) return { kind: "canonical" }

  // Step 0d: fast-path — most production traffic is already canonical. Skip
  // the regex chain when the path can't possibly match any rule.
  if (!raw.includes(".") && !raw.endsWith("/") && raw === raw.toLowerCase()) {
    return { kind: "canonical" }
  }

  // Rules 1-6 applied in deterministic order. Each is a pure function
  // (path → path). After all rules, if `path !== raw` emit ONE redirect.
  let path = raw
  path = stripTrailingSlash(path) // rule 1 → 308
  path = lowercaseHtmlSuffix(path) // rule 2 → 307
  path = rewriteLegacyEpisode(path) // rule 3 → 307
  path = appendMissingHtmlPerSegment(path) // rule 4 → 307
  path = expandSingleSegment(path) // rule 5 → 307
  path = resolveAliasInLocaleSegment(path) // rule 6 → 307

  if (path === raw) return { kind: "canonical" }

  // Status precedence: any non-trailing-slash transformation forces 307.
  // Trailing-slash-only → 308 (matches production semantics).
  const onlyTrailingSlashChanged =
    raw.endsWith("/") && path === raw.slice(0, -1)
  return {
    kind: "redirect",
    pathname: path,
    status: onlyTrailingSlashChanged ? 308 : 307,
    cache: onlyTrailingSlashChanged ? "long" : "short", // alias + lowercase are stable; cookie-pref is no-store (set elsewhere)
  }
}
```

**Tests for `url-canonicalize.test.ts` must include:**

- Every rule fires once on a representative input.
- Idempotence: `canonicalize(canonicalize(x).pathname) === { kind: "canonical" }` for every URL in `docs/research/jesusfilm-watch-url-patterns.md` §5 + every alias-table key.
- Reserved subtrees (`api`, `_next`, `_next/data`, `_next/image`, `assets`, `favicon.ico`, `robots.txt`, `sitemap.xml`) bypass canonicalize.
- Length cap: path of 5KB returns `{kind: "canonical"}` (no exception, no ReDoS).
- Injection guards: `/watch//attacker.com`, `/watch/foo%0d%0a`, `/watch/..%2Fevil`, `/watch/\evil` all return `{kind: "canonical"}` (let the route 404).
- Adversarial fixture: `/watch/Jesus.HTML/?_lr=1&t=120` → single 307 to `/watch/jesus.html?_lr=1&t=120` (no chain, `_lr=1` preserved, `t=120` preserved).
- Empty-segment paths handled without crash.
- URL encoding preserved end-to-end (no decode/re-encode round trip).
- Status precedence: trailing-slash-only → 308; any other transform → 307.

##### Tests for Phase 1

- `apps/web/src/lib/url-shape.test.ts` — unit
- `apps/web/src/lib/routes.test.ts` — every builder output matches research doc shapes
- `apps/web/src/lib/url-canonicalize.test.ts` — every row in `docs/research/jesusfilm-watch-url-patterns.md` §5.4 + §5.6
- `apps/web/src/lib/__tests__/language-aliases-corpus.test.ts` — loads admin's `Language` corpus via a fixture snapshot, asserts every alias canonical exists

##### Done criteria for Phase 1

- All four modules ship.
- 100% branch coverage on `canonicalizeWatchPath`.
- No production behavior change yet (modules not wired into proxy or routes).

#### Phase 2 — Routes accept `.html` params (servers, no proxy yet)

Goal: page routes server-strip `.html` from params before resolver. Three-segment route lands. `/videos` lands. `/search` re-purposed.

##### Files to modify

```ts
// apps/web/src/app/[slug]/page.tsx
//
// Now handles BOTH:
//   - bare /watch/{slug} (current shape, kept for transitional rewrites)
//   - /watch/{slug}.html (new shape: localized home OR fallback collection)
//
// After basePath strip, the param value is e.g. "russian.html" or "easter.html".
// Page must:
//   1. stripHtmlSuffix(param) → "russian" or "easter"
//   2. check isLocaleSlug(stripped) — is this a localized home OR a content slug?
//   3. dispatch to resolveWatchPage(localeBcp47ForSlug(stripped)) OR resolveWatchPage(DEFAULT_LOCALE, stripped)

import { stripHtmlSuffix } from "@/lib/url-shape"
// existing imports
```

```ts
// apps/web/src/app/[slug]/[locale]/page.tsx
//
// Strip .html from BOTH params before any resolver call. The selectedVariant resync
// redirect at line 146 now uses watchVideoPath() from lib/routes.ts:
//   redirect(watchVideoPath(slug, actualSlug, { localeResolved: true }))
//
// Edge case: slug="search.html" + locale="search.html" → render the search results page
//   (legacy /watch/search.html/search.html shape from research doc §1.6).

import { stripHtmlSuffix } from "@/lib/url-shape"
import { watchVideoPath } from "@/lib/routes"

// inside the page component:
const rawSlug = stripHtmlSuffix(awaitedParams.slug)
const rawLocale = stripHtmlSuffix(awaitedParams.locale)

if (rawSlug === "search" && rawLocale === "search") {
  return <SearchResultsPage searchParams={searchParams} />
}
```

```ts
// apps/web/src/app/[slug]/[episode]/[locale]/page.tsx (NEW)
//
// Three-segment series-episode page. Param shape after basePath strip:
//   slug="lumo-the-gospel-of-john.html"  (HAS .html)
//   episode="wedding-in-cana"             (BARE — by production contract)
//   locale="english.html"                 (HAS .html)
//
// Strip .html from slug + locale; episode is passed bare to resolver.
// Resolver chain: resolveSeriesEpisode(seriesSlug, episodeSlug, localeSlug).
// Mirror the URL↔variant resync redirect pattern from [slug]/[locale]/page.tsx.

import { stripHtmlSuffix } from "@/lib/url-shape"
import { watchEpisodePath } from "@/lib/routes"

export default async function SeriesEpisodePage({ params, searchParams }: PageProps) {
  const { slug, episode, locale } = await params
  const seriesSlug = stripHtmlSuffix(slug)
  const episodeSlug = episode  // bare by production contract
  const localeSlug = stripHtmlSuffix(locale)

  const resolved = await resolveSeriesEpisodeBySlug(seriesSlug, episodeSlug, localeSlug)
  if (!resolved) notFound()

  // resync redirect mirroring two-segment behavior at line 146
  if (resolved.variant.language.slug !== localeSlug) {
    redirect(watchEpisodePath(seriesSlug, episodeSlug, resolved.variant.language.slug, { localeResolved: true }))
  }

  return <SeriesEpisodePageClient ... />
}
```

```ts
// apps/web/src/app/videos/page.tsx (NEW)
//
// All-videos index. Server component, ISR with revalidate = 60.
// Reads from existing search-style endpoint (whatever apps/web/src/lib/search.ts
// uses for the floating modal) but renders a paginated grid.
```

```ts
// apps/web/src/app/search/page.tsx (MODIFY)
//
// Replace the existing hard-redirect to /?q=. Two roles:
//   - GET /watch/search (no q) → return 307 to /watch/search.html/search.html (legacy parity).
//   - GET /watch/search?q=... → same (the search.html/search.html shape carries q in the query string).
//
// Then the [slug]/[locale]/page.tsx dispatches to <SearchResultsPage> on (slug="search", locale="search").
```

```ts
// apps/web/src/lib/content.ts
//
// Add resolveSeriesEpisodeBySlug(seriesSlug, episodeSlug, localeSlug).
// Reuses resolveSeriesBySlug + per-episode variant selection. Mirrors the 4-tier
// locale priority chain documented in docs/solutions/logic-errors/strapi-graphql-pagination-cap-wrong-language-watch-page-20260504.md.
```

##### Tests for Phase 2

- `apps/web/src/app/[slug]/[locale]/__tests__/page-routing.test.tsx` — expand fixtures to cover `.html`-suffix params, including the `search.html/search.html` dispatch path
- `apps/web/src/app/[slug]/[episode]/[locale]/__tests__/page-routing.test.tsx` (NEW) — fixtures from research doc §5.3
- `apps/web/src/app/videos/__tests__/page.test.tsx` (NEW)
- `apps/web/src/app/search/page.test.ts` — updated for new redirect behavior
- `apps/web/src/lib/content.test.ts` — `resolveSeriesEpisodeBySlug` precedence chain

##### Done criteria for Phase 2

- All §5.2, §5.3, §5.1 URLs in the research doc resolve 200 when hit DIRECTLY with `.html` suffix (no normalization needed).
- Reserved subtrees still pass through.
- Vitest suite green.

#### Phase 3 — Proxy normalization

Goal: middleware ships the six normalization rules + alias resolution + reserved-subtree exclusion. Bare-shape URLs 307 to `.html` shape. Cookie redirect now operates on `.html` URLs and handles three-segment shape correctly.

##### Files to modify

```ts
// apps/web/src/proxy.ts
//
// Replace ad-hoc redirect logic with composed canonicalizer:
//   1. matcher excludes api|_next/static|_next/image|_next/data|_next/webpack-hmr
//                       |assets|favicon|robots|sitemap
//   2. apply watch-CSP headers on 2-segment AND 3-segment watch routes
//   3. canonicalizeWatchPath(input) → if redirect, return single 307/308
//      with Cache-Control: private, max-age=0
//   4. THEN maybeRedirectToPreferredLanguage(...) — but now:
//      - operates on .html-suffix URLs
//      - reads the second segment for 2-segment routes (existing behavior)
//      - reads the THIRD segment for 3-segment routes (NEW — detect by segment count)
//      - bypasses on ?_lr=1 (existing)
//      - strips ONE_SHOT_QUERY_PARAMS (?t=, ?autoplay=1) on redirect (existing)
//
// Critical safety: every redirect emits Cache-Control: private, max-age=0 for the
// first 30 days post-cutover. Implement as a single setHeader call in the redirect
// builder, with a feature flag REDIRECT_CACHE_CONTROL_STRICT controlling lifetime.
```

##### Tests for Phase 3

- `apps/web/src/proxy.test.ts` — expand fixtures to cover:
  - Every normalization row in research doc §5.4
  - Reserved-subtree pass-through (api, \_next/data, \_next/image, assets)
  - Redirect chain length: any input reaches terminal in ≤1 hop (assertion test)
  - Three-segment cookie-redirect behavior (locale at `segments[2]`, not `segments[1]`)
  - `?_lr=1` survives normalization for cookie-redirect bypass
  - Empty-segment paths and double-`.html` handled without crash
  - URL-encoded paths (cyrillic, %20) handled

##### Done criteria for Phase 3

- Every URL in research doc §5.4 produces the exact (status, Location) tuple documented.
- Probe script (Phase 6) shows zero regressions vs production on the §5 matrix.
- Cookie redirect works correctly on three-segment URLs.

#### Phase 4 — Href emission migration

Goal: every internal URL emission flows through `lib/routes.ts`. Catalogued sites:

| Site                                                                                                                   | Old emission                                                                    | New emission                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| [apps/web/src/components/watch/SeriesEpisodeCard.tsx:60](apps/web/src/components/watch/SeriesEpisodeCard.tsx)          | `` `/${episode.slug}/${locale}` ``                                              | `watchEpisodePath(seriesSlug, episode.slug, locale)`                                                                                            |
| [apps/web/src/components/watch/SiblingCarousel.tsx:138](apps/web/src/components/watch/SiblingCarousel.tsx)             | `` `/${encodeURIComponent(child.slug)}/${encodeURIComponent(currentLocale)}` `` | `watchVideoPath(child.slug, currentLocale)`                                                                                                     |
| [apps/web/src/components/watch/LanguagePickerModal.tsx:222,226](apps/web/src/components/watch/LanguagePickerModal.tsx) | `` `/${videoSlug}/${draftSlug}` `` ± `?t=&autoplay=1`                           | `watchVideoPath(videoSlug, draftSlug, { t, autoplay })`                                                                                         |
| [apps/web/src/components/watch/SeriesPageClient.tsx:171](apps/web/src/components/watch/SeriesPageClient.tsx)           | `` `/${seriesSlug}/${nextSlug}` ``                                              | `watchVideoPath(seriesSlug, nextSlug)`                                                                                                          |
| [apps/web/src/components/watch/ShareModal.tsx:76](apps/web/src/components/watch/ShareModal.tsx)                        | `` `${origin}/watch/${videoSlug}/${currentLanguageSlug}` ``                     | `watchVideoAbsolute(origin, videoSlug, currentLanguageSlug)`                                                                                    |
| [apps/web/src/components/sections/MediaCollection.tsx:249](apps/web/src/components/sections/MediaCollection.tsx)       | `` `/watch/${item.videoSlug}` ``                                                | `\`/watch${watchVideoPath(item.videoSlug, item.defaultLanguage)}\``(raw`<a>` needs basePath)                                                    |
| [apps/web/src/components/search/VideoCard.tsx:15](apps/web/src/components/search/VideoCard.tsx)                        | `` `/${result.slug}/en` ``                                                      | `watchVideoPath(result.slug, "english")`                                                                                                        |
| [apps/web/src/app/[slug]/[locale]/page.tsx:146](apps/web/src/app/[slug]/[locale]/page.tsx)                             | `` `/${slug}/${actualSlug}?_lr=1` ``                                            | `watchVideoPath(slug, actualSlug, { localeResolved: true })`                                                                                    |
| [apps/web/src/lib/experience-metadata.ts:38-46,180-183](apps/web/src/lib/experience-metadata.ts)                       | `${SITE_BASE}${prefix}${pathSuffix}`                                            | `watchVideoAbsolute(SITE_BASE, slug, langSlug)` etc                                                                                             |
| [apps/web/src/app/api/revalidate/route.ts:81-105](apps/web/src/app/api/revalidate/route.ts)                            | `` `/${slug}/${locale}`, `/${slug}`, `/${loc}` ``                               | `revalidatePath(watchVideoPath(slug, locale))` etc — emit BOTH old + new shape during a 30-day overlap so any inflight admin webhook still hits |
| [apps/web/src/components/**tests**/](apps/web/src/components/__tests__) and `lib/__tests__/` test fixtures             | bare-shape literals                                                             | `.html`-shape literals via builder                                                                                                              |

The `typedRoutes: true` constraint means every direct `<Link href>` taking a string today must now go through the builder. The builder returns `Route` (single cast inside), so call sites stay typed-route compliant.

##### Tests for Phase 4

- Snapshot tests for every modified component's emitted href.
- ShareModal test: canonical URL is the new `.html` shape.
- experience-metadata test: `alternates.canonical` is `.html` shape.
- revalidate webhook test: both shapes are revalidated during overlap window.

##### Done criteria for Phase 4

- Zero string-template URL emissions remain outside the builder (grep for `` `/${ `` and `` `/watch/${ `` in `apps/web/src/components/` and `apps/web/src/app/`).
- All previously-bare hrefs now emit `.html` shape end-to-end.

#### Phase 5 — SEO + revalidation + sitemap

Goal: search engines see the canonical `.html` shape on the new site. ISR revalidation hits the new paths.

##### Files to modify / add

- [apps/web/src/lib/experience-metadata.ts](apps/web/src/lib/experience-metadata.ts) — canonical and `alternates.languages` emit `.html` URLs via `watchVideoAbsolute`/`localizedHomeAbsolute`. Hreflang alternates list every language variant on the same `.html` shape.
- [apps/web/src/app/api/revalidate/route.ts](apps/web/src/app/api/revalidate/route.ts) — revalidate `[slug.html]/[locale.html]`, `[lang.html]`, and the three-segment series episode shape. During the 30-day overlap, also revalidate the bare shapes so any inflight webhook from an older admin deploy still works.
- `apps/web/src/app/sitemap.ts` (NEW) — emit `.html`-shape URLs for every (slug, language) combination. Source the language list from admin's `Language` corpus.
- `apps/web/src/app/robots.ts` (NEW or modify) — confirm allow-list matches new shape.

##### Tests for Phase 5

- `experience-metadata.test.ts` — canonical/OG URL is `.html` shape.
- `apps/web/src/app/sitemap.test.ts` (NEW) — sitemap contains §5.2 fixtures.
- `apps/web/src/app/api/revalidate/route.test.ts` — emits both old + new shape during overlap; only new shape after overlap.

##### Done criteria for Phase 5

- `<link rel="canonical">` on every video page matches the production `.html` shape exactly.
- `<link rel="alternate" hreflang>` emits every available language variant URL.
- Sitemap.xml lists `.html`-shape URLs only.

#### Phase 6 — Probe harness + cutover verification

Goal: empirical proof the rewrite serves the production URL contract.

##### Files to add

```ts
// apps/web/scripts/probe-watch-urls.ts
//
// Runs the URL matrix from docs/research/jesusfilm-watch-url-patterns.md §5
// against (live production, rewrite preview). For each URL, captures:
//   (HTTP status, final URL after up-to-5 redirects, response time)
// Outputs JSON diff. Distinguishes:
//   - hard regression: prod 200 → preview 4xx (FAIL)
//   - soft regression: same status, different final URL (WARN, requires SEO review)
//   - acceptable: prod 307 → preview 200 direct (skipped redundant redirect)
//
// Numeric pass gate: 0 hard regressions, ≤2% soft regressions.
//
// CLI: pnpm --filter @forge/web probe:watch-urls \
//        --production https://www.jesusfilm.org \
//        --preview https://<railway-preview-url>
```

##### Tests for Phase 6

- The probe script itself includes a self-test against a known fixtures file.

##### Done criteria for Phase 6

- Probe report: 0 hard regressions on every URL in §5 (Roots, Two-Segment Content, Series Episodes, Normalization Redirects, Query Params, Expected 404s, Reserved Subtrees).
- Soft regressions reviewed + signed off by stakeholder.

### Phase ordering rationale + freeze coordination

**Deepen-revision (2026-05-27):** the phase numbering above is preserved for chronological readability of the original draft, but the actual ship order is REVISED below. The headline change is **Phase 4 (href emission) ships before Phase 3 (proxy normalization)** — otherwise every internal `<Link>` click during the transition emits a bare URL that gets 307'd by the proxy, breaking the <5ms p95 latency NFR and adding a confusing redirect hop to every internal nav.

**Revised ship order:**

| Order | Old name                                        | Why this position                                                                                                                       |
| ----- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Phase 1 — Foundation                            | Pure additions; unblocked from data-layer-flip freeze; can ship today.                                                                  |
| 2     | Phase 2 — Routes accept `.html`                 | Post-flip merge. Internal pages now accept both shapes.                                                                                 |
| 3     | **Phase 4 — Href emission** (was Phase 3)       | Emit canonical URLs from internal nav FIRST so the proxy never sees a bare-shape internal click.                                        |
| 4     | **Phase 5 — SEO + revalidate** (was Phase 4)    | Ships in the SAME COMMIT as Phase 4 — hreflang/canonical/sitemap MUST land together with the href change per Google site-move guidance. |
| 5     | **Phase 3 — Proxy normalization** (was Phase 5) | Now catches only INBOUND legacy URLs (search engines, partner links, printed materials). Internal traffic already speaks `.html`.       |
| 6     | Phase 6 — Probe harness + cutover               | Validates the §5 matrix against the new endpoint with all surfaces converged.                                                           |

> **CRITICAL freeze coordination**: `apps/web` UI feature work is frozen on `main` (see project-level [CLAUDE.md](CLAUDE.md) "Active Freeze") while the `feat/web-admin-data-layer-flip` branch is live. This restructure straddles `apps/web/src/lib/`, `apps/web/src/app/`, and shared types — all three frozen surfaces. The migration branch MUST rebase from `feat/web-admin-data-layer-flip` once that branch ships, and CANNOT begin Phase 2 onwards until then.
>
> **Phase 1 has NO hard blocker.** The foundation modules (`url-shape.ts`, `routes.ts`, `language-aliases.ts`, `url-canonicalize.ts`) are pure functions over strings with zero dependency on `lib/content.ts` resolvers. They can land on `main` today, unblocking ~25% of the plan immediately and de-risking the rebase against the flip branch.

**Phase content adjustments folded into the revised order:**

- **Phase 4 (hrefs) MUST include the kill-switch env var** `WATCH_CANONICALIZE_DISABLED` so that, when Phase 3 (proxy) lands later, ops can defang the canonicalize stage without a code deploy.
- **Phase 4 (hrefs) MUST include `LanguagePickerModal` server-action refactor.** The cookie-write-then-`router.push` sequence races; replace with `"use server"` action that writes the cookie via `cookies().set()` and emits the redirect server-side in one response.
- **Phase 4 ALSO MUST resolve `LANGUAGE_SLUG_ALIASES` on cookie WRITE.** If a user picks `chinese-mandarin` from the picker, the cookie value stored is `mandarin-china`. Otherwise the cookie-pref redirect (Phase 3) loops infinitely against canonicalize's alias rule.
- **Phase 3 (proxy) MUST update `PREFERRED_LANG_SLUG` regex** to admit the `.html` suffix: `/^[a-z0-9-]+(\.html)?$/`. Otherwise CSP doesn't attach to three-segment routes.
- **Phase 3 (proxy) MUST add `Vary: Cookie, Accept-Language`** to every cookie-driven 307 alongside `Cache-Control: private, max-age=0`. Without `Vary`, Cloudflare can cache one user's redirect target and serve it to others.
- **Phase 3 (proxy) MUST emit a typed log line** on canonicalize loop detection: `event=canonicalize_loop_detected pathname=<safe> rules_fired=<list>` so post-deploy monitoring (deployment-verification §4) has a signal to alert on.
- **Phase 5 (SEO) MUST replace the 30-day overlap window** with a webhook-emission-counter gate: overlap ends after 7 consecutive days with zero bare-shape webhook emissions from admin. Add admin-side log counter `revalidate_emission_shape{shape="bare"}`.

## Alternative Approaches Considered

### A: File-tree `.html` literals (`app/[slug].html/[locale].html/page.tsx`)

Move `.html` into the file tree so routing is observable from `app/`. Rejected because:

- Next.js dynamic segments don't support literal suffixes inside `[slug]`. The only path is a catch-all `[[...path]]/page.tsx` which collapses to a single resolver — that resolver becomes a hand-rolled router and Next's optimizations (parallel routes, ISR per-route, route handlers) are lost.
- Every test fixture and `<Link href>` would type-fail on day one.

### B: Middleware rewrites `.html` to bare shape (incoming) and bare to `.html` (outgoing)

Keep current `app/[slug]/[locale]/page.tsx` unchanged; proxy rewrites incoming `.html` URLs to bare shape internally. Rejected because:

- Internal `<Link href>` would still need to emit `.html` shape for SEO/share — every emission still needs `as Route` cast (no win vs the hybrid approach).
- proxy.ts becomes load-bearing — a rewrite bug 500s every route silently. The hybrid approach lets pages still handle bare-shape URLs as a fallback during transition.

### C (chosen): Hybrid — pages strip `.html` from params, builder emits `.html`, proxy normalizes legacy shapes to canonical

This document.

### D: Reverse proxy at Cloudflare / Railway

Cloudflare Workers do the canonicalization before requests reach Next.js. Rejected because:

- Adds a Cloudflare Worker codebase to a project that doesn't have one (per [CLAUDE.md](CLAUDE.md) "Architecture" section: WAF + AOP, not compute).
- Splits routing logic across two stacks — every future URL change requires Cloudflare deploy + Railway deploy in sync.

## System-Wide Impact

### Interaction Graph

```
User clicks /watch link
   │
   ▼
proxy.ts canonicalize → may emit 307/308 with Cache-Control: private, max-age=0
   │
   ▼ (canonical URL)
proxy.ts cookie-pref redirect → may emit 307 (skipped if ?_lr=1)
   │
   ▼ (final canonical URL on Next.js)
app/[slug]/[locale]/page.tsx (or three-segment / videos / search)
   │
   ├─ stripHtmlSuffix(params) → rawSlug, rawLocale
   ├─ resolveWatchPage / resolveWatchVideoBySlug / resolveSeriesEpisodeBySlug
   │     ├─ EITHER returns rendered page with selectedVariant
   │     └─ OR returns selectedVariant ≠ requested → redirect with ?_lr=1 sentinel
   ▼
generateMetadata(params) → <link rel="canonical"> via experience-metadata.ts
   │     uses watchVideoAbsolute() — same shape as the URL the user sees
   ▼
Page renders. Client hydrates. WatchPageClient strips ?_lr=1 via history.replaceState.
```

### Error & Failure Propagation

- `stripHtmlSuffix("")` → `""` — must not crash; downstream resolver returns `notFound()`.
- `resolveSeriesEpisodeBySlug` returning null → `notFound()` (matches existing pattern).
- `canonicalizeWatchPath` throwing (e.g. malformed URL) → middleware error boundary returns 500; Cloudflare serves cached error. Mitigation: every regex `match()` defensively `?? null`.
- Cookie-redirect-after-canonicalize emitting bad slug from `forge_watch_lang` cookie (user tampering) → existing regex check in [proxy.ts:95](apps/web/src/proxy.ts) blocks. Add test for an alias-cookie value (`chinese-mandarin`) — should NOT bypass alias normalization.

### State Lifecycle Risks

- **ISR cache invalidation drift**: during the 30-day overlap, both shapes are revalidated. After overlap, only new shape. Bug risk: any admin webhook still emitting bare-shape URLs becomes silent no-ops. Mitigation: monitor admin's revalidation webhook stream for bare-shape emissions; deferred deletion of overlap until count is zero.
- **Cloudflare 30x caching**: if `Cache-Control: private, max-age=0` is misemitted, edge caches a redirect for hours. Mitigation: deploy with a Lighthouse + curl smoke that asserts the header on a representative redirect URL.
- **Social-share OG cache pollution**: Facebook caches OG metadata 7 days. On cutover, every shared URL becomes a 307; FB scrapes the destination and caches THAT. Mitigation: warm new URLs through OG Debugger (Sharing Debugger) for the top 200 shared URLs the day before cutover.

### API Surface Parity

- **`apps/mobile`** and **`apps/tv`** read from `@forge/admin-graphql` but build their own deep links. Likely emit web URLs for "open in browser" / "share" actions. Out of scope for this plan — but flagged: those apps' URL emitters must be audited separately and updated to the `.html` shape. Track as a follow-up.
- **`apps/admin`** revalidation webhook ([apps/admin/src/services/revalidate-webhook.ts](apps/admin/src/services/revalidate-webhook.ts)) sends `slug + locale` to web's `/api/revalidate`. Web's handler translates to the new shape — admin does NOT need to change.

### Integration Test Scenarios

These cannot be caught by unit tests with mocks; need a Playwright suite against the real Next.js production build:

1. **Cookie + alias + `_lr=1` interaction**: user with `forge_watch_lang=mandarin-china` hits `/watch/jesus.html/chinese-mandarin.html`. Assert: ONE 307 redirect to `/watch/jesus.html/mandarin-china.html` (alias wins, cookie skipped because target matches cookie). NOT two redirects.
2. **Cookie + three-segment**: user with `forge_watch_lang=russian` hits `/watch/lumo-the-gospel-of-john.html/wedding-in-cana/english.html`. Assert: 307 to same path with `russian.html` in segment 3, NOT segment 2.
3. **Reserved subtree depth**: `/watch/_next/data/.../jesus.json` (RSC payload) passes through untouched. No 307, no 308, no CSP header injection.
4. **Probe harness against live prod**: 100% parity on §5.4 + §5.6, ≥98% parity on §5.2 (allowing collection-slug variance).
5. **`<Link>` typed-route compliance**: build succeeds with `experimental.typedRoutes: true` after Phase 4. No `as Route` casts outside `lib/routes.ts`.
6. **Cloudflare cache header**: probe the Cloudflare cache after a deploy and a known-redirect URL. Assert `cf-cache-status: BYPASS` (or equivalent) on 30x responses during the cache-discipline window.

## Acceptance Criteria

### Functional Requirements

- [ ] Every URL in [docs/research/jesusfilm-watch-url-patterns.md](docs/research/jesusfilm-watch-url-patterns.md) §5.1 resolves with the documented status.
- [ ] Every URL in §5.2 (two-segment content) resolves 200 OR 404 matching production.
- [ ] Every URL in §5.3 (three-segment series episodes) resolves 200.
- [ ] Every URL in §5.4 (normalization redirects) produces a single 307/308 with the documented Location.
- [ ] Every URL in §5.5 (query param pass-through) resolves 200 with query params preserved.
- [ ] Every URL in §5.6 (expected 404s) returns 404 — must NOT become 200 or 301.
- [ ] Every URL in §5.7 (asset + framework subtrees) returns its normal asset/route response — must NOT be caught by the wildcard rule.
- [ ] `<link rel="canonical">` on every video page matches the production `.html` shape.
- [ ] `<link rel="alternate" hreflang>` lists every available language variant in the `.html` shape.
- [ ] Sitemap.xml lists only `.html`-shape URLs.
- [ ] `/api/revalidate` webhook supports both bare and `.html` shape for the 30-day overlap.
- [ ] Every internal href emission flows through `lib/routes.ts`; zero string-template `/watch/...` URLs outside it (grep gate in CI).

### Non-Functional Requirements

- [ ] No redirect chain exceeds 1 hop for any input that matches a normalization rule.
- [ ] Middleware adds <5ms p95 latency over current baseline.
- [ ] ISR cache hit rate on canonical URLs ≥ pre-migration baseline within 7 days post-cutover.
- [ ] Cloudflare cache-status `BYPASS` (or `EXPIRED`) on every 30x response for the first 30 days post-cutover.

### Quality Gates

- [ ] 100% branch coverage on `canonicalizeWatchPath` and `stripHtmlSuffix`.
- [ ] Probe harness numeric gate: 0 hard regressions on §5.1/§5.3/§5.4/§5.6/§5.7, ≤2% soft regressions on §5.2, signed off by stakeholder.
- [ ] Playwright integration suite ships before the proxy normalization phase lands. Suite covers: cookie + alias + `_lr=1` interaction, three-segment cookie redirect, RSC payload bypass, redirect-chain length ≤ 1 hop.
- [ ] `pnpm --filter @forge/web build` succeeds with `typedRoutes: true` (note: stable in Next 16; the `experimental.` prefix is dropped) after the href-emission phase.
- [ ] Tier-2 `/ce-code-review` mandatory before merge (sensitive surface: public URL contract; see project [CLAUDE.md](CLAUDE.md) "Known Patterns").
- [ ] CI grep gates pass: zero `as Route` casts outside `lib/routes.ts`; exactly one `toRoute(...)` inside it; zero string-template `/watch/...` URLs in `apps/web/src/{app,components}/`; zero references to `WEB_ADMIN_API_KEYS` / `process.env.*_API_KEY*` in `apps/web/scripts/probe-watch-urls.ts`.
- [ ] Alias-table acyclicity property test + static-shape invariant test + admin-corpus cross-reference test all pass in CI.
- [ ] Snapshot test asserts `og:url` === `<link rel="canonical">` on every video page.
- [ ] Smoke test asserts `Cache-Control: private, max-age=0` AND `Vary: Cookie, Accept-Language` headers present on every cookie-driven 307.
- [ ] Phase 3 ships with `WATCH_CANONICALIZE_DISABLED` env var (kill-switch); Railway service config tested before merge.
- [ ] Phase 5 ships with `WATCH_REDIRECT_CACHE_MODE=cutover|stable` env var; default `cutover` for first 30 days post-cutover.

## Success Metrics

- **Inbound traffic**: 100% of top-1000 production URLs in Search Console index data resolve 200 on the new site within 7 days post-cutover.
- **Bounce on 404**: <0.1% bounce on URLs in the §5.2/§5.3 inventory.
- **Social-share preview parity**: OG metadata for new URLs matches production (FB Debugger spot-check on 50 top-shared URLs).
- **SEO impressions**: no >5% drop in Search Console impressions for the watch surface within 14 days.
- **Probe harness regression rate**: <1% hard regressions on the §5 matrix at deploy gate.

## Dependencies & Prerequisites

- **HARD BLOCKER**: `feat/web-admin-data-layer-flip` (U9–U22) must merge before Phase 2 ships. See [docs/plans/2026-05-14-001-feat-adapt-web-data-layer-to-admin-plan.md](docs/plans/2026-05-14-001-feat-adapt-web-data-layer-to-admin-plan.md).
- Admin must expose `Language.slug` + `Language.bcp47` on every playable variant — already present per [apps/admin/schema.graphql:414-430](apps/admin/schema.graphql).
- Cloudflare must permit `Cache-Control` overrides on 30x responses for the watch domain — already does per project [CLAUDE.md](CLAUDE.md).
- Probe harness must accept both production HTTPS endpoint and Railway preview endpoint as inputs.

## Risk Analysis & Mitigation

| Risk                                                                              | Likelihood | Impact | Mitigation                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------------- | ---------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cloudflare caches a wrong 30x redirect → users stuck on broken URL                | M          | H      | `Cache-Control: private, max-age=0` for first 30 days; emergency cache-purge runbook (see deployment §6); verify Cloudflare "Browser Cache TTL" zone setting set to "Respect Existing Headers" (otherwise it overrides origin Cache-Control on 30x)                                                |
| `typedRoutes: true` blocks build during Phase 4 migration                         | H          | M      | Confine `toRoute()` cast to one site in `lib/routes.ts`; CI grep gate `rg "as Route" apps/web/src --glob '!lib/routes.ts'` returns empty                                                                                                                                                           |
| Three-segment cookie redirect reads wrong segment                                 | M          | M      | Integration test in Phase 3; segment-count branch in proxy code; `PREFERRED_LANG_SLUG` widened to accept `.html` suffix                                                                                                                                                                            |
| SEO drop during canonical URL change                                              | L          | H      | Phase 4+5 ship sitemap + hreflang + canonical in the SAME commit (Google site-move guidance); Search Console + GSC URL Inspection API daily monitoring for 14 days; `og:url` MUST equal `<link rel="canonical">` (snapshot test)                                                                   |
| Social-share OG cache pollution post-cutover                                      | M          | M      | Force-rescrape top 200 shared URLs via FB Sharing Debugger pre-cutover; programmatic batch via Graph API `?scrape=true`; WhatsApp/X refresh naturally (no API exists)                                                                                                                              |
| Alias table goes stale → silent 404 on legacy slug                                | M          | M      | CI test validates aliases against admin `Language.slug` corpus; acyclicity property test; static-shape invariant (`SAFE_SLUG` regex on every value)                                                                                                                                                |
| `feat/web-admin-data-layer-flip` reshuffles `lib/content.ts` resolvers under us   | H          | M      | Phase 1 unblocked (no `content.ts` coupling); stack Phase 2+ on top of the flip branch; rebase aggressively                                                                                                                                                                                        |
| Probe harness misses an inbound URL shape in actual partner integrations          | L          | H      | Expand §5 from production access logs before deploy gate; schedule daily probe for 30 days post-cutover                                                                                                                                                                                            |
| **`_next/data` RSC payloads caught by canonicalize → 2× RSC traffic**             | M          | H      | **P0**: matcher `'/((?!api\|_next\|assets\|favicon\|robots\|sitemap).*)'` (note `_next` not `_next/static`); defense-in-depth via `RESERVED_PREFIXES` in canonicalize step 0b; integration test for RSC payload URL                                                                                |
| Redirect-rule composition produces unintended chain                               | L          | H      | Fixed-point property test in `url-canonicalize.test.ts`; integration-level test `simulateMiddleware(simulateMiddleware(x)) === simulateMiddleware(x)` covering full proxy pipeline incl. cookie redirect                                                                                           |
| **Cookie/alias infinite-loop** (`forge_watch_lang=chinese-mandarin` + alias rule) | M          | H      | **P0**: resolve alias on cookie WRITE in `LanguagePickerModal` (store canonical); resolve alias on cookie READ in proxy.ts BEFORE comparison; integration test with alias cookie value                                                                                                             |
| **Cache poisoning via cookie-driven 30x without `Vary`**                          | M          | H      | Emit `Vary: Cookie, Accept-Language` on every cookie-driven 307; proxy test asserts both headers present                                                                                                                                                                                           |
| **Open redirect via `//attacker.com` / CRLF / traversal in canonicalize**         | L          | H      | `UNSAFE_INPUT` guard at canonicalize step 0c rejects `//`, `\`, `\r`, `\n`, `%0a`, `%0d`, `..`; never emit a Location derived from rejected input                                                                                                                                                  |
| Origin RPS spike during cutover from uncached 30x                                 | H          | M      | Pre-scale Railway to 2× baseline; pre-warm top 1000 `.html` URLs through Cloudflare via probe harness before DNS flip; tier `Cache-Control`: stable normalizations (trailing-slash, lowercase, alias) → `max-age=3600` after 30-day window via env var `WATCH_REDIRECT_CACHE_MODE=cutover\|stable` |
| ReDoS via crafted long URL through regex chain                                    | L          | M      | `MAX_PATH_LEN = 2048` short-circuit at canonicalize step 0a; every regex anchored with `$`/`^`, no `.*` quantifiers                                                                                                                                                                                |
| Cookie-write-then-navigate race in `LanguagePickerModal`                          | H          | M      | Refactor to `"use server"` action that writes cookie via `cookies().set()` and emits redirect server-side in one response — eliminates the race                                                                                                                                                    |
| `_lr=1` sentinel persists into share URL via `window.location.href`               | M          | M      | `ShareModal` MUST compose via `watchVideoAbsolute()`, not read from `window.location`; snapshot test with `?_lr=1&t=42` in `window.location.search` asserts share URL is clean                                                                                                                     |
| `<Link>` prefetch desync between requested URL and rendered RSC                   | M          | M      | CI grep gate (zero bare-shape emissions); proxy reject prefetch requests with 204 on bare-shape during transition (`sec-purpose: prefetch` header check)                                                                                                                                           |
| Probe harness self-DDoS / WAF self-ban                                            | L          | M      | `p-limit` at 8 concurrency; 500ms stagger between prod + preview batches; whitelist probe IP in Cloudflare during runs; `Promise.allSettled` so one timeout doesn't kill the batch                                                                                                                 |
| Probe harness leaks bearer credentials in logs                                    | L          | H      | CI grep gate: `probe-watch-urls.ts` must not reference `process.env.*_API_KEY*`; JSON output must redact request headers; probe runs unauthenticated against production (public surface only)                                                                                                      |
| Search Console / GSC URL Inspection API quota exhaustion                          | L          | L      | Quota is 2000/day, 600/min — daily probe of top 100 canonical URLs uses 5%                                                                                                                                                                                                                         |

## Resource Requirements

- **People**: 1 engineer for Phase 1-4 (~3-4 weeks), 0.25 engineer for Phase 5-6 (~1 week with stakeholder QA).
- **Timeline**: ~5 weeks engineering + 1 week observation post-cutover. Gated on data-layer-flip merge.
- **Infrastructure**: Railway preview environment for probe harness; Cloudflare cache-purge access for ops handoff.

## Future Considerations

- **Localized homes for ALL language slugs**: legacy site exposes `/watch/{lang}.html` for every dub slug. Today's localized home in apps/web only handles UI template locales (bcp47, 5 values). Generalizing to dynamic per-dub localized home is in scope here and the foundation for a richer language-discovery page.
- **One-segment collection landings** (research doc §1.4 "best-effort"): not addressed in this plan beyond their place in the wildcard normalization. Could be promoted to canonical for collections in a follow-up.
- **Tag-based revalidation** (per [docs/solutions/web/nextjs16-cachecomponents-isr.md](docs/solutions/web/nextjs16-cachecomponents-isr.md)): the alias + multi-locale + multi-shape revalidation matrix is fragile. A future PR replaces path-based with tag-based.
- **Apps/mobile + apps/tv URL emitters**: separate follow-up plan to align mobile/TV "share" / "open in browser" deep links with the new `.html` shape.

## Research Insights & Refinements

Findings consolidated from 13 parallel research + review agents on 2026-05-27. Grouped by domain. Each finding has been incorporated into the inline plan sections above; this appendix preserves the reasoning trail.

### A. Next.js 16 framework specifics (from framework-docs-researcher)

**Best practices:**

- `middleware.ts` is deprecated in Next 16 → file MUST be `proxy.ts`; exported function MUST be `proxy` (not `middleware`); config flag rename: `skipMiddlewareUrlNormalize` → `skipProxyUrlNormalize`. Runtime is Node.js and is **not configurable** in `proxy.ts` (no edge runtime).
- `experimental.typedRoutes: true` → top-level `typedRoutes: true` (stable in 16). Update `next.config.mjs` as part of Phase 1 housekeeping.
- `params` and `searchParams` are both `Promise<...>` in Next 16 — every page route MUST `await` them. Already correct in the existing apps/web routes; the new three-segment route MUST follow suit.
- `PageProps<'/[slug]/[episode]/[locale]'>` is the autogenerated typed prop helper — use it explicitly instead of `any` or local re-declaration.

**Code examples:**

```ts
// proxy.ts with Cache-Control on redirect
import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

export function proxy(request: NextRequest) {
  // …canonicalize…
  return NextResponse.redirect(url, {
    status: 308,
    headers: {
      "Cache-Control": "private, max-age=0, must-revalidate",
      Vary: "Cookie, Accept-Language",
      "X-Redirect-Reason": "watch-canonicalize-trailing-slash",
    },
  })
}
```

```ts
// Metadata alternates shape Next 16 consumes
export const metadata = {
  metadataBase: new URL("https://www.jesusfilm.org"),
  alternates: {
    canonical: "/watch/jesus.html/english.html",
    languages: {
      en: "/watch/jesus.html/english.html",
      ru: "/watch/jesus.html/russian.html",
      "pt-BR": "/watch/jesus.html/portuguese-brazil.html",
      "x-default": "/watch/jesus.html/english.html",
    },
  },
}
```

**Edge cases:**

- `revalidatePath()` operates on the route-file structure, NOT user-visible URL. `basePath` is NOT included in the argument — call `revalidatePath("/jesus.html/english.html")`, not `"/watch/jesus.html/english.html"`. Same for `revalidateTag`.
- `app/sitemap.ts` and `app/robots.ts` serve at `<basePath>/sitemap.xml` and `<basePath>/robots.txt` respectively. The URLs you emit inside the sitemap body are absolute — include the full origin yourself; Next.js does NOT auto-prepend `basePath` to URL strings inside the response body.

**References:**

- [Next.js 16 upgrade guide](https://nextjs.org/docs/app/guides/upgrading/version-16)
- [Next.js Proxy file convention](https://nextjs.org/docs/app/api-reference/file-conventions/proxy)
- [generateMetadata API reference](https://nextjs.org/docs/app/api-reference/functions/generate-metadata)
- [revalidatePath API reference](https://nextjs.org/docs/app/api-reference/functions/revalidatePath)
- [sitemap.ts file convention](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/sitemap)
- [NextResponse API](https://nextjs.org/docs/app/api-reference/functions/next-response)

### B. URL canonicalization state machine (from Explore on rewrite engines)

**Recommended state-machine shape (incorporated into `lib/url-canonicalize.ts` skeleton above):**

1. Length cap (ReDoS defense) → short-circuit.
2. Reserved subtree exclusion → short-circuit.
3. Injection guard (`//`, `\`, CRLF, traversal) → short-circuit.
4. Fast-path pre-check (`!includes(".") && !endsWith("/") && === toLowerCase()`) → short-circuit.
5. Rules 1-6 applied in fixed deterministic order, each idempotent and pure-functional (path → path).
6. Single terminal redirect with explicit `cache` intent: `"no-store" | "short" | "long"`.

**Termination proof sketch:** each rule is deterministic and applied once in linear sequence; no rule re-enters the sequence; each rule's output is a fixed point of itself (re-applying produces same output). Therefore `canonicalize(canonicalize(x)) === canonicalize(x)`. Property-test this for every URL in §5 and every alias-table key.

**Anti-patterns to avoid:**

- Don't implement canonicalization across multiple layers (CDN page rules + framework middleware + page-level redirects). The redirect-loop pattern is the #1 root cause of production redirect loops per nginx's guide.
- Don't use Apache's `[L]` flag or nginx's `last` flag analogues — they re-enter location matching and can re-match the rewritten URL. The Next.js equivalent is: apply ALL transformations in one pass inside `proxy.ts`, emit ONE `NextResponse.redirect()`.

**References:**

- [Apache mod_rewrite Flags](https://httpd.apache.org/docs/current/rewrite/flags.html)
- [Nginx break vs. last](https://www.baeldung.com/linux/nginx-flags-break-last)
- [WHATWG URL Standard](https://url.spec.whatwg.org/)

### C. SEO migration discipline (from Explore + best-practices-researcher)

**Best practices:**

- **Use 308 for permanent moves** (Next 16's default `permanent: true`). Google treats 308 and 301 identically for PageRank transfer; 308 preserves HTTP method.
- **Self-referencing canonicals per locale.** Each language version canonicalizes to itself, not to a default. Hreflang lists all variants including self-reference. Mistake rate across international sites is ~65% of canonicals pointing wrong way per industry audits.
- **Sitemap timing**: submit new `.html`-shape sitemap AFTER redirects are live in production; then drop the old sitemap from Search Console after a few crawl cycles. Don't run both in parallel for long.
- **`og:url` MUST equal `<link rel="canonical">`.** FB scrapes `og:url` for social-share preview; drift produces silent preview cache misses. Add a snapshot test.
- **Update all internal links BEFORE cutover.** Prevents crawl-budget waste on internal redirect chains and preserves internal PageRank flow.
- **Hreflang + canonical updates ship in the SAME commit as the redirect cutover.** Stale hreflang pointing at old URLs is the most-missed step per Google's site-move doc.
- **Keep redirects in place ≥ 1 year**, ideally indefinitely. There is no SEO penalty for keeping permanent redirects.
- **Monitor via Google Search Console URL Inspection API** (quota: 2000 queries/day, 600/min). Daily batch of top 100 canonical URLs uses 5% of quota.

**Critical risks:**

- Canonical/hreflang misalignment fragments indexing — each variant competes against itself. Audit `generateMetadata()` template before cutover. Validate with Google Rich Results Test on staging.
- Social preview breakage if `og:url` differs from canonical. Test with Twitter Card Validator and FB Sharing Debugger before going live.
- Redirect-chain overcrawling if internal links still emit bare URLs at cutover. Atomic deploy of internal-link updates is mandatory.

**References:**

- [Consolidate Duplicate URLs (Google)](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls)
- [Localized Versions of Your Pages](https://developers.google.com/search/docs/specialty/international/localized-versions)
- [Site Moves & Migrations (Google)](https://developers.google.com/search/docs/crawling-indexing/site-move-with-url-changes)
- [Redirects and Google Search](https://developers.google.com/search/docs/crawling-indexing/301-redirects)

### D. Cloudflare cache discipline on 30x (from best-practices-researcher)

**Best practices:**

- Send `Cache-Control: private, max-age=0, must-revalidate` on every 30x during cutover (first 30 days). Cloudflare's default cache behavior doc confirms the edge does NOT cache responses with `private`, `no-store`, `no-cache`, or `max-age=0`.
- After 30 stable days, flip env var to relax to `Cache-Control: public, max-age=3600, s-maxage=86400` on stable normalization redirects (trailing-slash, lowercase, alias). The cookie-driven redirect MUST stay `no-store` permanently.
- **Verify Cloudflare's "Browser Cache TTL" zone setting** before launch. If set to a value other than "Respect Existing Headers", it silently overrides origin `Cache-Control` on 30x and breaks the cutover discipline. (Multiple community reports of this footgun.)
- Wire the Cloudflare cache-purge API by URL prefix into the rollback runbook (see `deployment §6`). Single-URL purge first, prefix purge only if > 10 slugs affected, nuclear `purge_everything` is last resort and rate-limited.
- Tier the cache lifetime: stable normalizations (trailing-slash, lowercase, legacy-episode shape, alias) get `max-age=3600` after 30-day window; cookie-pref redirect stays `no-store` (it's user-state-dependent).

**Anti-patterns:**

- Don't omit `Cache-Control` on 30x and rely on Cloudflare defaults — default Edge TTL for 301 is 120 minutes, for 302 is 20 minutes. Once cached at edge, rollback requires global purge.
- Don't put redirect `Cache-Control` headers in `next.config.js` `headers()` for `:path*` glob — globs can't distinguish redirect responses from 200 pages.

**References:**

- [Cloudflare Default Cache Behavior](https://developers.cloudflare.com/cache/concepts/default-cache-behavior/)
- [Cloudflare Origin Cache Control](https://developers.cloudflare.com/cache/concepts/cache-control/)
- [Cloudflare Purge by prefix](https://developers.cloudflare.com/cache/how-to/purge-cache/purge_by_prefix/)

### E. Social-share cache invalidation (from best-practices-researcher)

- **FB Sharing Debugger** rescrape: click "Scrape Again" 2-3 times per URL (first scrape often returns intermediate stale). Use Batch Invalidator for bulk URLs.
- **Programmatic FB invalidation** via Graph API: `POST https://graph.facebook.com/v18.0/?id={url}&scrape=true&access_token={token}`. Wire into cutover script for top-N URLs by share volume.
- Emit `og:updated_time` on every page; bump on cutover. Belt-and-suspenders alongside `?scrape=true`.
- **WhatsApp: accept the cache.** No debugger, no API. The migration's URL-shape change IS the cache-bust — new `.html` URLs are "new URLs" to WhatsApp's cache.
- **Twitter/X**: re-validate via Card Validator. Twitter cards inherit from `og:*` if `twitter:*` absent → OG-first approach covers both.

**References:**

- [Facebook Sharing Debugger](https://developers.facebook.com/tools/debug/)
- [How to Clear Facebook/Twitter/LinkedIn Cache](https://www.socialmediaexaminer.com/how-to-clear-facebook-cache-twitter-cache-linkedin-cache/)

### F. Probe harness design (from Explore)

**Architecture incorporated into `apps/web/scripts/probe-watch-urls.ts`:**

- `p-limit` at 8 concurrency (already a monorepo dep). Drop to 4 + exponential backoff if either endpoint returns 429.
- HEAD probe first (fast), fallback to GET if 405. Capture full redirect chain via `redirect: "manual"` + manual loop with `maxRedirects = 10`.
- Stagger prod vs preview batches by 500ms to avoid thundering-herd.
- `Promise.allSettled` (not `Promise.all`) so one timeout doesn't kill the batch.
- Authenticate Railway preview via env var `PREVIEW_AUTH="user:pass"` Base64'd; NEVER inline.
- Output JSON for CI gate + Markdown table for human review.

**Diff classification:**

- **Hard regression**: production 2xx/3xx → preview 4xx/5xx (FAIL).
- **Soft regression**: same status, different final URL after redirects (WARN, requires SEO review).
- **Acceptable**: production 307 → preview 200 direct (skipped redundant redirect).
- **Levenshtein threshold ≤ 3 chars** = trivially equivalent (URL normalization noise); > 3 chars = soft regression flag.

**Numeric gate:** 0 hard regressions on §5.1/§5.3/§5.4/§5.6/§5.7; ≤ 2% soft regressions on §5.2.

**Failure-mode taxonomy:** see deployment-verification §4 monitoring plan.

### G. Cutover Go/No-Go checklist (from deployment-verification-agent)

The full checklist with curl probes, Search Console snapshot procedure, partner-email template, Cloudflare cache-purge runbook (single-URL → prefix → nuclear), and three rollback runbooks (bad hrefs, redirect loop with kill-switch, SEO drop with canonical revert) is incorporated into the inline "Quality Gates" + "Risk Analysis" sections above. Communication channels:

- `#watch-cutover-warroom` (ephemeral, T-0 → T+14d)
- `#seo-watch-monitoring` (persistent, daily GSC reports for 14 days)
- Partner email blast T-7d (owner: Content lead).

### H. Architectural integrity (from architecture-strategist + pattern-recognition-specialist)

- **Drop the `search.html/search.html` page-render dispatch sentinel.** Serve search ONLY from `app/search/page.tsx`. The legacy `.html/search.html` shape becomes a 308 target from the proxy, not a render path. Keeps search rendering in one route; removes a hand-rolled sub-router from a parameterized route.
- **Add `parseWatchPath(pathname)` to `lib/routes.ts`** — single source for URL → params classification, consumed by both pages (Phase 2 `stripHtmlSuffix(params)`) and the canonicalizer (Phase 4 `pathname.split("/")`). Otherwise the two halves silently drift, which is the failure mode documented in [docs/solutions/best-practices/nextjs-route-shape-migration-cross-cutting-contract-drift-20260430.md](docs/solutions/best-practices/nextjs-route-shape-migration-cross-cutting-contract-drift-20260430.md).
- **Extract `selectPlayableVariant(playableVariants, locale, primaryLanguageId)` helper** from [apps/web/src/lib/content.ts:1182-1199](apps/web/src/lib/content.ts) BEFORE adding `resolveSeriesEpisodeBySlug`. Both resolvers MUST call the same function (not "mirror" it) — "mirror" is the danger word that produced the bug documented in [docs/solutions/logic-errors/strapi-graphql-pagination-cap-wrong-language-watch-page-20260504.md](docs/solutions/logic-errors/strapi-graphql-pagination-cap-wrong-language-watch-page-20260504.md).
- **Introduce `isLocaleSlug()` in `lib/locale.ts`** (NOT a new module) for slug-form check against the dynamic admin `Language.slug` corpus. Keep distinct from `isLocale()` (bcp47-only). Per the lesson in [docs/solutions/ui-bugs/series-page-locale-normalized-to-default-on-slug-form-urls-2026-05-14.md](docs/solutions/ui-bugs/series-page-locale-normalized-to-default-on-slug-form-urls-2026-05-14.md), conflating the two silently normalizes `spanish-castilian` → `DEFAULT_LOCALE`.
- **Document the route-shape ceiling**: any new segment shape requires a new parallel route file; if the count exceeds 4 shapes, revisit catch-all `[[...path]]`. Hard architectural ceiling.
- **Alias-table sunset path**: future move of `legacySlugs: [String!]` onto admin's `Language` type — data lives where the canonical lives, generate the static map at build time from admin SDL. Note in "Future Considerations".
- **Fix `MediaCollection.tsx:249` raw-`<a>` leak** by adding `watchHrefWithBasePath()` to `lib/routes.ts` (or switching to `<Link>`). Once a caller has to know about `BASE_PATH`, the builder abstraction has failed.

### I. TypeScript type-safety refinements (from kieran-typescript-reviewer)

All incorporated into the inline code skeletons above:

- Brand `LocaleSlug` and `ContentSlug` types (zero runtime cost, catches arg-swap bugs).
- Single `toRoute()` cast inside `lib/routes.ts` (every cast funnels through one site; CI grep gate enforces this).
- Replace `localeResolved: boolean` with `reason: "locale-resolved" | "alias-redirect" | "cookie-pref"` literal union (boolean params kill grepability).
- `LANGUAGE_SLUG_ALIASES` declared with `as const satisfies Record<string, string>` so literal keys are statically known; derive `LegacyLanguageSlug` and `CanonicalLanguageSlug` types.
- `assertNever` discipline on `CanonicalizeResult.kind` switches.
- Use generated `PageProps<'/[slug]/[episode]/[locale]'>` explicitly.

### J. Race conditions + frontend timing (from julik-frontend-races-reviewer)

All incorporated into the Risk table + Phase ordering revisions:

- Resolve alias on cookie WRITE (`LanguagePickerModal` stores canonical, not raw alias).
- Resolve alias on cookie READ in proxy.ts BEFORE comparison.
- `useLayoutEffect` (not `useEffect`) for `?_lr=1` strip — eliminates the hydration-race window where early clicks capture the sentinel.
- `ShareModal` MUST compose via `watchVideoAbsolute()`, not read `window.location.href`.
- Strip `searchParams` entirely from share URLs (test fixture with `?_lr=1&t=42`).
- `BuildOptions.reason: "locale-resolved"` is server-only (no client emission); enforce by code review (the literal-union arrangement makes this auditable).
- Server action for cookie + redirect combined eliminates the cookie-write-then-`router.push` race.
- Update `PREFERRED_LANG_SLUG` regex to admit `.html` suffix in proxy's `isWatchRoute` matcher.

### K. Performance hardening (from performance-oracle)

All incorporated into `url-canonicalize.ts` skeleton + Risk table:

- Fast-path pre-check in canonicalize step 0d (95% of canonical traffic skips all 6 rules).
- `MAX_PATH_LEN = 2048` short-circuit (ReDoS defense).
- Tighten matcher to `_next` (not `_next/static`) for RSC-payload bypass (P0).
- Pre-scale Railway to 2× baseline before cutover.
- Pre-warm top 1000 `.html` URLs via probe harness before DNS flip.
- Tier `Cache-Control` lifetime via `WATCH_REDIRECT_CACHE_MODE` env var.
- Batch dual revalidation in `Promise.allSettled` (not sequential) in 30-day overlap.

### L. Security hardening (from security-sentinel)

All incorporated into the `url-canonicalize.ts` and `language-aliases.ts` skeletons:

- Origin-invariance guard (reject `//`, `\`, CRLF, `..` traversal).
- `Object.hasOwn` for alias lookup (prototype-pollution defense for future dynamic data source).
- Validate cookie regex BEFORE alias lookup.
- Reject segments containing `%`, `..`, `\`, control chars before duplicate-segment rule.
- Static-shape invariant on `LANGUAGE_SLUG_ALIASES` values (SAFE_SLUG regex).
- `Vary: Cookie, Accept-Language` on every cookie-driven 307.
- Probe harness unauthenticated; CI grep forbids `*_API_KEY*` references.
- CSP `frame-ancestors 'self'`: before deploy, query Cloudflare logs for inbound `Sec-Fetch-Dest: iframe` referers and allowlist legitimate embedders.

### M. Simplicity counterweight (from code-simplicity-reviewer)

The deepening added significant API surface (parseWatchPath, BuildOptions reason union, etc.). Simplicity reviewer pushed back hard. Selectively accepted:

- **Phase merge** (Phase 4 + Phase 5 ship in same commit): ACCEPTED — already implied by SEO-migration discipline (hreflang + canonical + redirect ship together).
- **Drop 30-day overlap window**: ACCEPTED, replaced with webhook-emission counter gate (7 consecutive days at zero bare-shape emissions). Lower bound: 14 days minimum to give Cloudflare cache and FB OG cache time to age out.
- **Inline alias table**: REJECTED. The CI corpus + acyclicity tests need a real module with a real export, and the sunset path (move to admin SDL) needs a single place to migrate.
- **Cut `lib/routes.ts` to 3 functions**: REJECTED. The `parseWatchPath` addition + the `watchEpisodePath` 3-segment route + the `localizedHomePath` use case make ≥6 functions load-bearing. The simplicity gain doesn't justify forcing callers to compose paths inline.
- **Strip 30-day overlap**: PARTIAL — replaced with counter gate (see above).
- **WHAT-comments**: ACCEPTED across the skeletons. The deepened skeletons above only include WHY-comments (cache intent, race-condition reasoning, prototype-pollution defense). What-comments removed.

## Documentation Plan

- Update [apps/web/CLAUDE.md](apps/web/CLAUDE.md) "Routing" section with the `lib/routes.ts` central-builder rule and the `.html` shape contract.
- Add a "Known Patterns" entry in root [CLAUDE.md](CLAUDE.md) summarizing the canonicalize-once invariant and the alias-table CI gate.
- Create `docs/solutions/best-practices/watch-url-html-shape-restructure-<date>.md` post-cutover with what landed, what regressed during the cutover, and the operational levers (cache-purge runbook, OG Debugger script).
- Update [docs/research/jesusfilm-watch-url-patterns.md](docs/research/jesusfilm-watch-url-patterns.md) "Open Questions / Unknowns" section to mark which were resolved by this migration.

## Sources & References

### Origin / inputs

- **Verified URL inventory**: [docs/research/jesusfilm-watch-url-patterns.md](docs/research/jesusfilm-watch-url-patterns.md) (committed 2026-05-27, commit `969c9c5f`). The migration test plan. Every public URL shape that must resolve post-migration.

### Prior learnings (from `docs/solutions/`)

- [docs/solutions/best-practices/nextjs-route-shape-migration-cross-cutting-contract-drift-20260430.md](docs/solutions/best-practices/nextjs-route-shape-migration-cross-cutting-contract-drift-20260430.md) — the previous `/watch/[collection]/[video]/[locale]` → 2-segment migration. **Highest-leverage prior art.** Cites every fan-out site that drifted; explicit recommendation to centralize URL builders in one `routes.ts` (now implemented as the plan's lib/routes.ts).
- [docs/solutions/ui-bugs/series-page-locale-normalized-to-default-on-slug-form-urls-2026-05-14.md](docs/solutions/ui-bugs/series-page-locale-normalized-to-default-on-slug-form-urls-2026-05-14.md) — `isLocale()` is bcp47-only; do not use as a generic language-identifier validator. Default to `rawLocale` for user-facing language identifiers.
- [docs/solutions/web/nextjs-headers-defeats-route-cache.md](docs/solutions/web/nextjs-headers-defeats-route-cache.md) — request-dependent logic (Accept-Language, cookies) lives in `proxy.ts`, NOT in page routes. Page routes must be pure functions of URL params.
- [docs/solutions/web/nextjs16-cachecomponents-isr.md](docs/solutions/web/nextjs16-cachecomponents-isr.md) — `cacheComponents: true` + `"use cache"` rejected for apps/web; sticks with route-level `revalidate = 60` + `revalidatePath()` webhooks.
- [docs/solutions/best-practices/watch-single-video-template-pages-strapi-nextjs-2026-04-11.md](docs/solutions/best-practices/watch-single-video-template-pages-strapi-nextjs-2026-04-11.md) — keeps watch route precedence in one server-side resolver shared by page rendering and metadata, preventing canonical/OG drift.
- [docs/solutions/best-practices/nextjs-search-overlay-ui-patterns-20260415.md](docs/solutions/best-practices/nextjs-search-overlay-ui-patterns-20260415.md) — `searchParams` is a Promise in Next 16; `basePath` does NOT auto-prefix `next/image` for local files; server-only imports poison the file for client imports.
- [docs/solutions/best-practices/nextjs-cross-suspense-action-queue-with-url-params-20260421.md](docs/solutions/best-practices/nextjs-cross-suspense-action-queue-with-url-params-20260421.md) — one-shot URL params (`?t=`, `?autoplay=1`, `?_lr=1`) stripped via `window.history.replaceState`, not `router.replace`, to avoid RSC round-trip.
- [docs/solutions/logic-errors/strapi-graphql-pagination-cap-wrong-language-watch-page-20260504.md](docs/solutions/logic-errors/strapi-graphql-pagination-cap-wrong-language-watch-page-20260504.md) — 4-tier locale priority chain in `fetchResolvedWatchVideoBySlug`; the rewrite must preserve it identically for three-segment series episodes.
- [docs/solutions/performance-issues/web-watch-route-lighthouse-perf-campaign-lcp-bundle-fonts-20260527.md](docs/solutions/performance-issues/web-watch-route-lighthouse-perf-campaign-lcp-bundle-fonts-20260527.md) — preconnect / link-preload tuning on the watch route; the URL rewrite must preserve these LCP optimizations.

### Internal references

- [apps/web/src/proxy.ts](apps/web/src/proxy.ts) — middleware (Next 16 auto-discovers `proxy.ts`)
- [apps/web/src/app/[slug]/[locale]/page.tsx](apps/web/src/app/[slug]/[locale]/page.tsx) — current canonical 2-segment route
- [apps/web/src/app/[slug]/page.tsx](apps/web/src/app/[slug]/page.tsx) — current 1-segment route
- [apps/web/src/lib/content.ts](apps/web/src/lib/content.ts) — resolver chain (must extend for series-episode three-segment)
- [apps/web/src/lib/locale.ts](apps/web/src/lib/locale.ts) — `LOCALE_RESOLVED_PARAM = "_lr"`, `SUPPORTED_LOCALES` (bcp47)
- [apps/web/src/lib/language-preference-constants.ts](apps/web/src/lib/language-preference-constants.ts) — `LANGUAGE_PREFERENCE_COOKIE = "forge_watch_lang"`
- [apps/web/next.config.mjs](apps/web/next.config.mjs) — `basePath: "/watch"`, `typedRoutes: true`
- [apps/admin/schema.graphql:414-430](apps/admin/schema.graphql) — `Language` type, `slug` + `bcp47` fields
- [docs/plans/2026-05-14-001-feat-adapt-web-data-layer-to-admin-plan.md](docs/plans/2026-05-14-001-feat-adapt-web-data-layer-to-admin-plan.md) — the active freeze plan; this URL restructure stacks on top

### Related work

- [#1047](https://github.com/jesusfilm/forge/pull/1047) — research doc inventory commit (`969c9c5f`)
- [#1038](https://github.com/jesusfilm/forge/pull/1038) — recent watch-page work (subtitle transcript section); illustrates the surface this migration touches
- [#939](https://github.com/jesusfilm/forge/pull/939) — data-layer flip U1-U8 baseline
