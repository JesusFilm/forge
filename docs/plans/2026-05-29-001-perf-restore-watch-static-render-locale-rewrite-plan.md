---
title: Restore static rendering for /watch routes via an internal [locale] rewrite
type: perf
status: planned
date: 2026-05-29
---

# Restore static rendering for /watch routes via an internal [locale] rewrite

## Overview

The watch and collection pages currently render **dynamically on every request**. Not because the pages need to — they're deliberately clean — but because the root layout reads a request header (`headers()`) to learn the locale for `<html lang>`. Per Next.js semantics, any `headers()` call in the root layout flips the entire app to dynamic rendering, disabling the Full Route Cache.

This plan restores **static rendering + ISR** (prerender once, cache, serve from cache for follow-up visitors) by moving the locale into the route tree as an **internal-only** first segment via a middleware rewrite. The **public `.html` URL contract is byte-identical** — users, links, and search engines keep seeing `/watch/jesus.html/spanish-latin-american.html`; only Next's internal router sees `/{ui-locale}/{original-path}`.

It reverses one decision from the next-intl plan ([2026-05-28-001](2026-05-28-001-feat-i18n-migration-next-intl-plan.md), decision #5 "`<html lang>` becomes dynamic") and relaxes another for the **internal tree only** (decision #1 "no `[locale]` segment" — the _public_ guarantee is preserved). Both were deliberate, one-day-old decisions by the plan owner (Vlad), who **owns this plan and has approved the direction** (public URL preserved; relax the file-tree rule for the internal segment).

**Deployment context — this is low-risk.** `apps/web` is currently a _hidden staging_ environment; live `/watch` traffic still serves from the legacy prod. Traffic is steered at the **DNS level**, so rollback is "point DNS back at legacy" — there is no need for env-flag gating, parallel route trees, or a phased prod cutover. We can land the change on staging, validate with the probe harness, and only repoint DNS once satisfied.

## Problem Statement

### Current state

- `apps/web/src/app/layout.tsx` calls `await headers()` (`deriveLocaleFromUrl`, reading the proxy-set `WATCH_PATHNAME_HEADER`) to set `<html lang>` + `setRequestLocale`. Added 2026-05-28 in #1053 (next-intl wiring).
- Per Next.js: `headers()` in the root layout makes **every** descendant route dynamic. The app's own CLAUDE.md confirms "the watch routes were already dynamic."
- The **pages are clean** — `app/[slug]/page.tsx` and `app/[slug]/[...rest]/page.tsx` use no `headers()`/`cookies()` (there's an explicit `// keeping cookies() out of this page` comment), and both declare `export const revalidate = 60`. **The root layout is the sole blocker.**

### Two caches; only one is active today

| Cache                         | Stores                                          | Active on watch routes?                        |
| ----------------------------- | ----------------------------------------------- | ---------------------------------------------- |
| Full Route Cache              | Rendered HTML/RSC, served with zero render work | ❌ No — route is dynamic                       |
| Data Cache (`unstable_cache`) | Admin GraphQL fetch results                     | ✅ Yes — 60 s content, 1 h `childDubLanguages` |

So follow-up visitors avoid the **admin DB work** (amortized by the data cache) but still pay for a per-request RSC render + payload generation. There is no CDN/edge HTML caching.

### Why it matters

Render CPU, payload generation, and TTFB on repeat views scale with traffic instead of being served from cache. For high-traffic collection pages this is avoidable cost. The expensive **data** half is already solved (the `durationSeconds` + `childDubLanguages` + 1 h cache work); this plan addresses the **render** half.

### The fundamental constraint

A root layout cannot learn the locale statically _unless the locale is in its `params`_ — i.e. a route segment. With `<html lang>` living in the root layout (Next requires `<html>` there) **and** no locale segment, dynamic rendering is unavoidable. The next-intl plan hit exactly this wall and chose dynamic. This plan removes the wall by giving the root layout a locale segment — invisibly.

## Proposed Solution

### Core idea

Middleware derives the UI locale from the URL and **prepends** it as an internal route segment. The root layout then receives `params.locale` and sets `<html lang>` with no request-time API → static rendering + ISR return. Public URL unchanged (rewrite, not redirect).

### Route tree (target)

```
app/[locale]/layout.tsx            ← SOLE root layout (delete app/layout.tsx)
                                     renders <html lang={resolveHtmlLang(params.locale)}>,
                                     NextIntlClientProvider, fonts;
                                     generateStaticParams = [] or small hot-set;
                                     export const dynamicParams = true
app/[locale]/[[...rest]]/page.tsx  ← optional catch-all; runs parseWatchPath(rest.join("/"))
                                     → home | localized-home | video | episode | videos | search | unknown
app/api/**                         ← unaffected (API routes need no root layout)
```

### The rewrite — framing decision (important)

`[locale]` carries the **resolved UI-locale family** (`resolveUiLocale(...)` → bounded by `messages/*.json`), **not** the raw audio-language slug. `params.rest` keeps the **entire original path** (audio slug included). Rationale: the trailing audio-language slug does double duty — it's both the chrome-locale source _and_ the audio-dub selector. Stripping it would lose dub precision; **prepend the family, preserve the full path**. Bonus: `rest.join("/")` is byte-identical to what `parseWatchPath` parses today, so the classifier is unchanged.

| Public URL (under `/watch` basePath)                                                | Internal rewrite target                                                                    | `params.locale`            | `params.rest`                          |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------- | -------------------------------------- |
| `/jesus.html/spanish.html`                                                          | `/es/jesus.html/spanish.html`                                                              | `es`                       | `["jesus.html","spanish.html"]`        |
| `/book-of-acts.html/the-holy-spirit-comes-at-pentecost/spanish-latin-american.html` | `/es-419/book-of-acts.html/the-holy-spirit-comes-at-pentecost/spanish-latin-american.html` | `es-419` (→ `es` fallback) | 3 segs preserved (bare episode intact) |
| `/conversation-starters.html/spanish-latin-american.html` (no-trailer collection)   | `/es-419/conversation-starters.html/spanish-latin-american.html`                           | `es-419`→`es`              | 2 segs                                 |
| `/spanish.html` (localized-home)                                                    | `/es/spanish.html`                                                                         | `es`                       | `["spanish.html"]`                     |
| `/` (home)                                                                          | `/en`                                                                                      | `en` (default)             | `[]`                                   |
| `/videos`                                                                           | `/en/videos`                                                                               | `en` (default)             | `["videos"]`                           |
| `/search`                                                                           | `/en/search`                                                                               | `en` (default)             | `["search"]`                           |

### `generateStaticParams` / ISR guidance

The UI-locale set is **all catalogs on the translation platform** (5 today, potentially hundreds). This affects **only** the build-time prebuild list:

- **Never enumerate the full catalog** in `generateStaticParams`. Return `[]` (cold-first-then-cached) or a small curated hot-set (e.g. `en/es/fr/pt`) to pre-warm top-traffic locales.
- `dynamicParams = true` + `revalidate` → **on-demand ISR** for every `(locale, path)` not prebuilt. First visitor renders + caches; followers are served the cached copy until revalidate lapses. Build time stays bounded regardless of catalog count.
- The middleware normalizes unknown/garbage locale slugs to the default **before** the rewrite, so the `[locale]` segment that reaches Next is always a real catalog (or default) — bounded by `messages/*.json`, never arbitrary user input. This prevents ISR cache-key spray from hostile crawlers and means unknown locales degrade gracefully (default messages + `<html lang>`).

### Relationship to the next-intl plan (what this supersedes)

- **Decision #5 ("`<html lang>` becomes dynamic")** — **reversed.** It becomes static, derived from `params.locale`.
- **Decision #1 ("no `[locale]` segment / URL contract UNCHANGED")** — **public guarantee preserved**, file-tree rule relaxed for the _internal_ tree only. The user-facing URL is byte-identical; the `[locale]` segment is invisible (rewrite, not redirect). This is materially different from the visible `/es/...` subpath that decision #1 and Alternative D rejected.
- **Decision #4 ("no middleware")** — **amended.** A rewrite step is added to the existing `proxy.ts` (which already does canonicalize + header injection). Net change is one terminal rewrite hop.
- The `WATCH_PATHNAME_HEADER` + `deriveLocaleFromUrl` plumbing in `layout.tsx` is **removed** — the layout reads `params.locale` instead.

## Technical Approach

### Architecture decisions

1. **`[locale]` = resolved UI family, internal only.** Public `.html` URL untouched.
2. **One optional catch-all + `parseWatchPath` dispatch.** No per-shape folders — the classifier already discriminates the shapes; one dispatch point, no drift.
3. **Sole root layout at `app/[locale]/layout.tsx`** (delete `app/layout.tsx`). This is next-intl's documented static-rendering setup. API routes are unaffected (no root layout needed). Non-watch _page_ surfaces (`demo-search`, `demo-recommendations`, `videos`, `search`, home) must either move under `[locale]` or get a route-group root layout — see Risks.
4. **Middleware order: canonicalize → prepend-family rewrite.** Canonicalize (legacy → `.html`, may 307/308) runs first; the locale prepend is the terminal internal hop on already-canonical paths only.
5. **`generateStaticParams` bounded; `dynamicParams = true`.** Never enumerate the catalog.
6. **Locale-less shapes get the default family** (home/videos/search) so they fit under `[locale]`.
7. **Preserve the full original path in `rest`** so the audio-dub slug survives and `parseWatchPath` input is unchanged.

### Implementation phases

#### Phase 0 — Framework spike (de-risk)

Validate on a throwaway branch, before touching real routes:

- `app/[locale]/layout.tsx` as the **sole** root (no `app/layout.tsx`) renders `<html lang>` from `params` and prerenders statically.
- An optional catch-all `[[...rest]]` matches the zero-segment (home) and N-segment cases.
- A middleware **rewrite** (not redirect) under `basePath: /watch` reaches the rewritten path, and `nextUrl.pathname` semantics vs basePath are confirmed.
- ISR: `dynamicParams: true` + `revalidate` serves a cached copy on the second request (verify a cache HIT / no upstream call).

**Done criteria:** a minimal route demonstrates static prerender of `<html lang>` from a middleware-injected segment, public URL unchanged, second request cache-served.

#### Phase 1 — Introduce the `[locale]` root + catch-all page

- Add `app/[locale]/layout.tsx` (port `<html>`, `NextIntlClientProvider`, fonts from current `layout.tsx`); read `params.locale`.
- Add `app/[locale]/[[...rest]]/page.tsx`; port the shape dispatch from `app/[slug]/page.tsx` + `app/[slug]/[...rest]/page.tsx` (`parseWatchPath` → render WatchPageClient / SeriesPageClient / home). The video-vs-series-landing fallback and 1-seg-collection handling move over mostly unchanged.
- Decide non-watch surfaces: move `home`/`videos`/`search` under `[locale]`; move or route-group `demo-*`.
- This is a **direct route-tree swap** (Next allows only one root layout). Safe to do bluntly on staging — DNS is the rollback (see Deployment context). Delete the old `app/layout.tsx` + `app/[slug]/**` page routes in the same change.

**Done criteria:** every shape renders under the new tree in dev with a hard-coded/default locale; old route files deleted.

#### Phase 2 — Middleware rewrite

- After the existing `canonicalizeWatchPath` pass, derive the UI family via `resolveUiLocale` (reuse, do not reimplement) and **prepend** it; keep the full path as the remainder. Default family for locale-less shapes.
- Reuse `parseWatchPath` / `getWatchLocaleSegmentIndex` to find the locale segment per shape.

**Done criteria:** `proxy.test.ts` extended — every canonical shape rewrites to the correct `/{family}/{path}`; legacy shapes still 307/308 first; reserved/asset subtrees untouched; output paths pass `isUnsafeRedirectPath` guards.

#### Phase 3 — Remove the `headers()` plumbing

- Delete `deriveLocaleFromUrl` + `WATCH_PATHNAME_HEADER` consumption from the layout (and the producer in `proxy.ts` if now unused elsewhere). Layout uses `params.locale` + `setRequestLocale(params.locale)`.

**Done criteria:** no `headers()`/`cookies()` anywhere in the layout tree; `next build` lists the watch routes as static/ISR, **not** ƒ (Dynamic).

#### Phase 4 — Metadata reconstruction

- `generateMetadata` rebuilds the **public** canonical/OG/hreflang URLs from `(params.locale, params.rest)` via the existing `routes.ts` builders. Public shapes unchanged; hreflang per-dub emission (i18n Phase 6) preserved.

**Done criteria:** canonical/OG/hreflang tags byte-identical to pre-change for the §5 URL matrix.

#### Phase 5 — Prebuild tuning + ISR

- `generateStaticParams` returns `[]` or a curated hot-set; set `dynamicParams = true` + `revalidate`.

**Done criteria:** build output + size bounded irrespective of catalog count; second request to a cold `(locale, slug)` is cache-served.

#### Phase 6 — Verification

- Run the watch-url probe harness (`src/lib/watch-url-probe.ts`) over the research-doc §5 matrix.
- Confirm prerendered HTML carries correct `<html lang>` per locale (curl, no-JS).
- Measure TTFB / cache HIT on repeat views.

**Done criteria:** probe matrix green; static/ISR confirmed in build manifest; repeat-view served from cache with no admin round-trip.

### Risks & system-wide impact

- **Single root layout is a direct swap, but the safety net is DNS.** Next allows only one root layout, so old + new trees can't run in parallel under one app. That's fine here: `apps/web` is hidden staging and traffic is steered at DNS, so rollback is repointing DNS at legacy — no env-flag gating or parallel trees required. Validate on staging with the probe harness before repointing DNS at this app.
- **basePath `/watch` + middleware path semantics.** Confirm `nextUrl.pathname` excludes the basePath and the rewrite target is basePath-relative (Phase 0).
- **Non-watch page surfaces.** `demo-search`, `demo-recommendations`, `videos`, `search`, home need a root layout — move under `[locale]` or use a route-group root. API routes are exempt.
- **Metadata must reconstruct public URLs** from the new params (Phase 4) — easy to regress canonical/OG silently; cover with the §5 assertions.
- **404 contract preserved.** `parseWatchPath` already returns `unknown` for 4+ segments → `notFound()`; the catch-all must keep that.
- **Audio-dub precision preserved** because `rest` carries the original audio slug.
- **Cache-key abuse prevented** by middleware normalization to a real catalog/default.
- **next-intl request-mode timing.** `setRequestLocale` now runs in the layout (has `params`); confirm `getRequestConfig`'s request-scoped store is populated before child message loads.

### Alternatives considered

- **A — Status quo (dynamic render + data cache).** What we have. DB work amortized; render not. Repeat views not free. Rejected as the end state; it's the baseline this improves on.
- **B — Visible `/es/...` subpath.** Rejected by the i18n plan (URL-contract change). This plan's internal rewrite preserves the public URL, so it does not reopen B.
- **C — Default `<html lang>` + client-side correction.** Keeps static but ships wrong `lang` in prerendered HTML to crawlers/no-JS — SEO/a11y regression for a multilingual site. Rejected.
- **D — Partial Prerendering (PPR).** Doesn't fit: a dynamic attribute on `<html>` isn't a Suspense-able hole, and locale-dependent messages pervade the tree, so the dynamic region would be ~everything. Rejected.

## Acceptance criteria

- Watch + collection routes render **static/ISR** (build manifest shows non-dynamic); repeat visits served from cache with no admin round-trip.
- **Public `.html` URLs byte-identical** across every research-doc §5 shape; legacy normalization still 307/308; expected 404s stay 404.
- `<html lang>` correct per locale in **prerendered** HTML.
- `generateStaticParams` does not enumerate the full catalog; build time bounded.
- `typecheck` + `lint` + `build` + existing tests green; `proxy.test.ts` / `url-shape.test.ts` extended; probe harness passes.

## Ownership & sequencing

- **Direction approved** by the next-intl plan owner (Vlad): reverse decision #5, relax decision #1's file-tree rule for the internal segment (public URL guarantee intact). No further sign-off gate.
- **Low operational risk** — hidden-staging env + DNS-level traffic steering is the rollback (see Deployment context). No phased prod cutover needed.
- Coordinate loosely with the in-flight next-intl phases (string extraction / translation) only to avoid editing the same route files at the same time — not a hard dependency.
- Complements the already-shipped data-layer caching (`durationSeconds` / `childDubLanguages` / 1 h cache) — that handled the DB cost; this handles the render cost.

## Cross-references

- Supersedes-in-part: [2026-05-28-001-feat-i18n-migration-next-intl-plan.md](2026-05-28-001-feat-i18n-migration-next-intl-plan.md) (decisions #1, #4, #5; Alternative D).
- URL inventory + migration test matrix: [docs/research/jesusfilm-watch-url-patterns.md](../research/jesusfilm-watch-url-patterns.md) §5.
- Watch URL `.html` restructure: [2026-05-27-002-feat-watch-url-html-shape-i18n-restructure-plan.md](2026-05-27-002-feat-watch-url-html-shape-i18n-restructure-plan.md).
- Key code: `apps/web/src/app/layout.tsx`, `apps/web/src/proxy.ts`, `apps/web/src/lib/routes.ts` (`parseWatchPath`), `apps/web/src/lib/url-shape.ts`, `apps/web/src/lib/url-canonicalize.ts`, `apps/web/watch-base-path.mjs`.
