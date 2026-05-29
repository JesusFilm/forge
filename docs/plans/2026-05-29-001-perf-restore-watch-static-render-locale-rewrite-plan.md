---
title: Restore static rendering for /watch routes via internal locale rewrites
type: perf
status: planned
date: 2026-05-29
---

# Restore static rendering for /watch routes via internal locale rewrites

## Overview

The watch and collection pages currently render **dynamically on every request**. Not because the pages need to — they're deliberately clean — but because the root layout reads a request header (`headers()`) to learn the locale for `<html lang>`. Per Next.js semantics, any `headers()` call in the root layout flips the entire app to dynamic rendering, disabling the Full Route Cache.

This plan restores **static rendering + ISR** (prerender once, cache, serve from cache for follow-up visitors) by moving locale identity into the route tree as **internal-only** segments via a middleware rewrite. The **public `.html` URL contract is byte-identical** — users, links, and search engines keep seeing `/watch/jesus.html/spanish-latin-american.html`; only Next's internal router sees `/{message-locale}/{html-lang}/{original-path}`.

It reverses one decision from the next-intl plan ([2026-05-28-001](2026-05-28-001-feat-i18n-migration-next-intl-plan.md), decision #5 "`<html lang>` becomes dynamic") and relaxes another for the **internal tree only** (decision #1 "no `[locale]` segment" — the _public_ guarantee is preserved). Both were deliberate, one-day-old decisions by the plan owner (Vlad), who **owns this plan and has approved the direction** (public URL preserved; relax the file-tree rule for the internal segment).

**Deployment context — low pre-cutover traffic risk, material launch risk.** `apps/web` is currently a _hidden staging_ environment; live `/watch` traffic still serves from the legacy prod. Traffic is steered at the **DNS level**, so rollback is "point DNS back at legacy", but DNS rollback does not undo crawler churn, cached bad canonical tags, or direct staging URLs. We can land the change on staging, validate with the probe harness and go/no-go gate, and only repoint DNS once satisfied.

## Problem Statement

### Current state

- `apps/web/src/app/layout.tsx` calls `await headers()` (`deriveLocaleFromUrl`, reading the proxy-set `WATCH_PATHNAME_HEADER`) to set `<html lang>` + `setRequestLocale`. Added 2026-05-28 in #1053 (next-intl wiring).
- Per Next.js: `headers()` in the root layout makes **every** descendant route dynamic. The app's own CLAUDE.md confirms "the watch routes were already dynamic."
- The **known page routes are clean** — `app/[slug]/page.tsx` and `app/[slug]/[...rest]/page.tsx` use no `headers()`/`cookies()` (there's an explicit `// keeping cookies() out of this page` comment), and both declare `export const revalidate = 60`. The root layout is the known blocker; Phase 3 still must prove no other dynamic bailout exists in metadata, server components, data helpers, feature-flag calls, or route config.

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

Middleware derives locale identity from the URL and **prepends** it as internal route segments. The root layout then receives params for the message catalog and static `<html lang>` with no request-time API → static rendering + ISR return. Public URL unchanged (rewrite, not redirect).

### Locale identity invariant

Keep these identities separate:

1. **Raw audio slug** — the public audio-language slug, e.g. `spanish-latin-american`; it stays in `params.rest` and drives dub selection, resolver fallback, language picker state, and per-dub metadata.
2. **Message-catalog key** — the bounded UI catalog key, e.g. `es`; this is the `[locale]` segment, feeds `setRequestLocale(params.locale)` / `getRequestConfig`, and must always be one of `messages/*.json`.
3. **HTML language tag** — the static `<html lang>` value, e.g. `es-419` when the raw audio slug carries a finer regional BCP-47 tag that still maps to an available message catalog family. If the raw audio slug does not map to an available UI catalog family, this falls back with the message catalog key (typically `en`). Because the root layout cannot statically read child catch-all params, this value is carried as a second internal `[htmlLang]` segment; do not derive it from `headers()`.

### Route tree (target)

```
app/[locale]/[htmlLang]/layout.tsx            ← locale-aware root layout
                                                 renders <html lang={params.htmlLang}>,
                                                 calls setRequestLocale(params.locale),
                                                 NextIntlClientProvider, fonts;
                                                 generateStaticParams = [] or small hot-set;
                                                 export const dynamicParams = true
app/[locale]/[htmlLang]/page.tsx              ← watch home
app/[locale]/[htmlLang]/videos/page.tsx       ← videos index
no app search page                             ← proxy redirects deprecated /search into root modal
app/[locale]/[htmlLang]/[...rest]/page.tsx    ← watch dispatcher for localized-home,
                                                 one-segment collection, video, episode,
                                                 unknown
app/(demo)/layout.tsx                         ← demo-only root layout, default chrome;
                                                 bypassed by locale rewrite
app/(demo)/demo-search/**                     ← preserves public /demo-search URLs
app/(demo)/demo-recommendations/**            ← preserves public /demo-recommendations URLs
app/api/**                                    ← unaffected (API routes need no root layout)
```

### The rewrite — framing decision (important)

`[locale]` carries the **message-catalog key** (`resolveUiLocale(...)` → bounded by `messages/*.json`), **not** the raw audio-language slug and not necessarily the final `<html lang>`. `[htmlLang]` carries the static HTML language tag. `params.rest` keeps the **entire original path** (audio slug included). Rationale: the trailing audio-language slug does double duty — it's both the chrome-locale source _and_ the audio-dub selector. Stripping it would lose dub precision; **prepend the message key + html tag, preserve the full path**.

| Public URL (under `/watch` basePath)                                                | Internal rewrite target                                                                       | `params.locale` | `params.htmlLang` | `params.rest`                          |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | --------------- | ----------------- | -------------------------------------- |
| `/jesus.html/spanish.html`                                                          | `/es/es/jesus.html/spanish.html`                                                              | `es`            | `es`              | `["jesus.html","spanish.html"]`        |
| `/book-of-acts.html/the-holy-spirit-comes-at-pentecost/spanish-latin-american.html` | `/es/es-419/book-of-acts.html/the-holy-spirit-comes-at-pentecost/spanish-latin-american.html` | `es`            | `es-419`          | 3 segs preserved (bare episode intact) |
| `/conversation-starters.html/spanish-latin-american.html` (no-trailer collection)   | `/es/es-419/conversation-starters.html/spanish-latin-american.html`                           | `es`            | `es-419`          | 2 segs                                 |
| `/spanish.html` (localized-home)                                                    | `/es/es/spanish.html`                                                                         | `es`            | `es`              | `["spanish.html"]`                     |
| `/` (home)                                                                          | `/en/en`                                                                                      | `en`            | `en`              | `[]`                                   |
| `/videos`                                                                           | `/en/en/videos`                                                                               | `en`            | `en`              | `["videos"]`                           |
| `/search`                                                                           | redirect to `/` / `/?q=...` before internal rewrite                                           | n/a             | n/a               | search lives in the global modal       |

### `generateStaticParams` / ISR guidance

The UI-locale set is **all catalogs on the translation platform** (5 today, potentially hundreds). This affects **only** the build-time prebuild list:

- **Never enumerate the full catalog** in `generateStaticParams`. Return `[]` (cold-first-then-cached) or a small curated hot-set (e.g. `en/es/fr/pt`) to pre-warm top-traffic locales.
- `dynamicParams = true` + `revalidate` → **on-demand ISR** for every `(locale, path)` not prebuilt. First visitor renders + caches; followers are served the cached copy until revalidate lapses. Build time stays bounded regardless of catalog count.
- The middleware normalizes unknown/garbage locale slugs to the default **before** the rewrite, so the `[locale]` segment that reaches Next is always a real catalog (or default) — bounded by `messages/*.json`, never arbitrary user input. This bounds the message-locale cache dimension; it does **not** by itself bound `params.rest`, so Phase 5 must add path-spray checks.

### Relationship to the next-intl plan (what this supersedes)

- **Decision #5 ("`<html lang>` becomes dynamic")** — **reversed.** It becomes static, derived from `params.htmlLang`.
- **Decision #1 ("no `[locale]` segment / URL contract UNCHANGED")** — **public guarantee preserved**, file-tree rule relaxed for the _internal_ tree only. The user-facing URL is byte-identical; the `[locale]` / `[htmlLang]` segments are invisible (rewrite, not redirect). This is materially different from the visible `/es/...` subpath that decision #1 and Alternative D rejected.
- **Decision #4 ("no middleware")** — **amended.** A rewrite step is added to the existing `proxy.ts` (which already does canonicalize + header injection). Net change is one terminal rewrite hop.
- The `WATCH_PATHNAME_HEADER` + `deriveLocaleFromUrl` plumbing in `layout.tsx` is **removed** — the layout reads `params.locale` / `params.htmlLang` instead.

## Technical Approach

### Architecture decisions

1. **`[locale]` = message-catalog key, `[htmlLang]` = static HTML language tag, both internal only.** Public `.html` URL untouched; raw audio slug remains in `rest`.
2. **One required catch-all only for watch content shapes.** Do not blindly delegate 1-segment URLs to `parseWatchPath`; the current `app/[slug]/page.tsx` behavior is `isLocale(slug) ? localized-home : resolveWatchPage(slug)`, and live best-effort one-segment collection URLs such as `/easter.html` must keep resolving as collection slugs. Home and `/videos` stay as sibling pages under `app/[locale]/[htmlLang]/`; `/search` is only a proxy-level deprecated redirect into the global modal.
3. **Explicit root-layout map.** Delete `app/layout.tsx`. Locale-aware public watch surfaces move under `app/[locale]/[htmlLang]/**`; demo-only surfaces move under `app/(demo)/**` with their own default-chrome root layout and are bypassed by the locale rewrite. API routes are unaffected (no root layout needed).
4. **Middleware order: direct internal-prefix policy → canonicalize → locale rewrite.** Public requests that visibly start with internal locale segments (e.g. `/en`, `/en/en/videos`, `/es/es-419/jesus.html/spanish-latin-american.html`) are duplicates and must 308 to the de-prefixed canonical public URL or 404; choose 308 unless a path cannot be safely de-prefixed. Canonicalize (legacy → `.html`, may 307/308) then runs before the terminal internal rewrite.
5. **`generateStaticParams` bounded; `dynamicParams = true`.** Never enumerate the catalog.
6. **Locale-less shapes get the default family** (home/videos) so they fit under `[locale]`; `/search` redirects before it enters the internal locale tree.
7. **Preserve the full original path in `rest`** so the audio-dub slug survives. Query strings are passed separately via `searchParams` and must be preserved by cloning `request.nextUrl` for rewrites.

### Implementation phases

#### Phase 0 — Framework spike (de-risk)

Validate on a throwaway branch, before touching real routes:

- `app/[locale]/[htmlLang]/layout.tsx` as the locale-aware root (no `app/layout.tsx`) renders `<html lang>` from `params.htmlLang`, calls `setRequestLocale(params.locale)`, and prerenders statically.
- The locale-aware root handles the zero-segment home route, and the required catch-all `[...rest]` matches one-or-more-segment watch content cases.
- A middleware **rewrite** (not redirect) under `basePath: /watch` reaches the rewritten path, and `nextUrl.pathname` semantics vs basePath are confirmed.
- ISR: `dynamicParams: true` + `revalidate` serves a cached copy on the second request (verify a cache HIT / no upstream call).

**Done criteria:** a minimal route demonstrates static prerender of `<html lang>` from a middleware-injected segment, public URL unchanged, second request cache-served.

> **Atomicity:** Phases 1-3 are one implementation unit / one PR. Phase 1 by itself deletes the old public routes before Phase 2's rewrite makes public URLs reach the new internal tree, so it is not a shippable intermediate state even on hidden staging.

#### Phase 1 — Introduce the `[locale]` root + catch-all page

- Add `app/[locale]/[htmlLang]/layout.tsx` (port `<html>`, `NextIntlClientProvider`, fonts from current `layout.tsx`); read `params.locale` and `params.htmlLang`.
- Move the route files explicitly:
  - `app/page.tsx` → `app/[locale]/[htmlLang]/page.tsx`.
  - `app/videos/page.tsx` + loading/error/tests → `app/[locale]/[htmlLang]/videos/page.tsx`.
  - Delete the old `app/search/**` page surface; proxy-level `/search` redirects to the root modal URL instead.
  - `app/[slug]/page.tsx` + `app/[slug]/[...rest]/page.tsx` → `app/[locale]/[htmlLang]/[...rest]/page.tsx`.
  - `app/demo-search/**` → `app/(demo)/demo-search/**`.
  - `app/demo-recommendations/**` → `app/(demo)/demo-recommendations/**`.
- Add `app/[locale]/[htmlLang]/[...rest]/page.tsx`; port the shape dispatch from `app/[slug]/page.tsx` + `app/[slug]/[...rest]/page.tsx`. The 1-seg branch must keep today's disambiguation: strip `.html`, then `isLocale(slug) ? localized home : resolveWatchPage(locale, slug)` so best-effort collection URLs like `/easter.html` do not become localized-home/default-home pages.
- Require `setRequestLocale(validUiLocale)` in the locale-aware layout, the catch-all page, moved pages, and their `generateMetadata` functions before any `useTranslations`, `getTranslations`, or metadata translation call.
- Port the route-segment UX boundaries: create/port `app/[locale]/[htmlLang]/loading.tsx`, `app/[locale]/[htmlLang]/error.tsx`, and any catch-all-specific boundaries from the current watch routes; add smoke/tests for skeleton and retry behavior.
- This is a **direct route-tree swap** within the atomic unit. Safe to do bluntly on staging only because DNS is the rollback (see Deployment context). Delete the old `app/layout.tsx` + `app/[slug]/**` page routes in the same change.

**Done criteria:** every shape renders under the new tree in dev with a hard-coded/default locale; old route files deleted.

#### Phase 2 — Middleware rewrite

- Before canonicalization, handle visible internal-prefix requests (`/{locale}`, `/{locale}/{htmlLang}`, or `/{locale}/{htmlLang}/...`) with the chosen direct-prefix policy so they cannot become duplicate public URLs.
- Replace the current visible Accept-Language append for locale-less shapes with the default-family internal rewrite. `/` and `/videos` keep their public URLs even with `accept-language: es`; `/search` must redirect to the root modal URL and must never canonicalize to `/search.html/search.html`.
- After the existing `canonicalizeWatchPath` pass, derive the message catalog key via `resolveUiLocale` (reuse, do not reimplement), derive `htmlLang` from the raw audio slug's BCP-47 when it maps to the same available catalog family, and **prepend** both; keep the full path as the remainder. Default both params for locale-less shapes.
- Reuse `parseWatchPath` / `getWatchLocaleSegmentIndex` to find the locale segment per shape.

**Done criteria:** `proxy.test.ts` extended — every canonical shape rewrites to the correct `/{locale}/{htmlLang}/{path}`; legacy shapes still 307/308 first; direct visible internal-prefix URLs are 308/404; reserved/asset/demo subtrees untouched; output paths pass `isUnsafeRedirectPath` guards; hostile rewrite fixtures cover encoded slash/backslash, dot segments, empty/control segments, CRLF, protocol-relative paths, and non-canonical encodings.

#### Phase 3 — Remove the `headers()` plumbing

- Delete `deriveLocaleFromUrl` + `WATCH_PATHNAME_HEADER` consumption from the layout (and the producer in `proxy.ts` if now unused elsewhere). Layout uses `params.locale`, `params.htmlLang`, and `setRequestLocale(params.locale)`.
- Run a static-bailout audit over the layout, pages, metadata functions, server components, data helpers, route config, and feature-flag calls. Check for `headers()`, `cookies()`, `unstable_noStore` / `noStore`, `dynamic = "force-dynamic"`, uncached `fetch` / `cache: "no-store"`, request-dependent metadata, or any dynamic API that would still opt the tree out of the Full Route Cache.

**Done criteria:** no dynamic bailout remains anywhere in the render tree; `next build` lists representative watch routes as static/ISR, **not** ƒ (Dynamic); runtime curl proof shows the second request returns a cache HIT / ISR-equivalent header and no admin GraphQL round-trip.

#### Phase 4 — Metadata reconstruction

- `generateMetadata` rebuilds the **public** canonical/OG/hreflang URLs from `(params.locale, params.htmlLang, params.rest, searchParams)` via the existing `routes.ts` builders. Public shapes unchanged; hreflang per-dub emission (i18n Phase 6) preserved.
- Browser-visible links, redirects, RSC/prefetch URLs, `usePathname`-dependent behavior, and hydration must not leak `/{locale}/{htmlLang}/` internal paths.

**Done criteria:** canonical/OG/hreflang tags byte-identical to pre-change for the §5 URL matrix.

#### Phase 5 — Prebuild tuning + ISR

- `generateStaticParams` returns `[]` or a curated hot-set; set `dynamicParams = true` + `revalidate`.
- Add path-spray mitigation. Reject malformed/non-canonical paths before cached rendering; ensure invalid paths return `notFound()` before expensive admin lookups; explicitly decide whether valid-looking 404s are `no-store`, short-lived, or tag-invalidated. Add hostile-path tests for random 1-, 2-, and 3-segment slugs and verify they do not create unbounded ISR storage or admin work beyond the intended resolver miss.
- Update `apps/web/src/app/api/revalidate/route.ts` and tests. After the basePath/rewrite spike, document whether `revalidatePath` must target public paths, internal paths, route patterns, or switch to tags, then update the emitted path set accordingly.

**Done criteria:** build output + size bounded irrespective of catalog count; second request to a cold `(locale, slug)` is cache-served.

#### Phase 6 — Verification

- Run the watch-url probe harness (`src/lib/watch-url-probe.ts`) over the research-doc §5 matrix.
- Include query/search contracts in the probe matrix: `?t=`, `?autoplay=1`, `?q=`, `?_lr=1`, and `?utm_*`. The catch-all page receives these through `searchParams`, not `rest`; the middleware rewrite must preserve them by cloning `request.nextUrl`.
- Confirm prerendered HTML carries correct `<html lang>` per locale (curl, no-JS) and representative home, video, episode, collection, videos, and search routes render public links only (no internal locale-prefixed URLs).
- Measure baseline and post-change TTFB / cache HIT on repeat views for the top watch URLs; record the threshold that justifies DNS repointing.

**Done criteria:** probe matrix green; static/ISR confirmed in build manifest; repeat views within the revalidate window served from cache with no admin round-trip.

### Risks & system-wide impact

- **Root layout swap is low pre-cutover traffic risk, not zero launch risk.** `apps/web` is hidden staging and traffic is steered at DNS, so rollback can repoint DNS at legacy, but DNS rollback does not undo crawler churn, cached bad canonical tags, direct staging URLs, or Cloudflare cache state. Before DNS repointing, run a go/no-go checklist covering top URLs, query links, no-JS `<html lang>`, canonical/OG/hreflang parity, Cloudflare purge steps, DNS TTL expectations, and the backout PR path.
- **basePath `/watch` + middleware path semantics.** Confirm `nextUrl.pathname` excludes the basePath and the rewrite target is basePath-relative (Phase 0).
- **Non-watch page surfaces.** Use the Phase 1 file map: home/videos/search under `app/[locale]/[htmlLang]/**`, demo surfaces under `app/(demo)/**`, API routes exempt.
- **Metadata must reconstruct public URLs** from the new params (Phase 4) — easy to regress canonical/OG silently; cover with the §5 assertions.
- **404 contract preserved.** `parseWatchPath` already returns `unknown` for 4+ segments → `notFound()`; the catch-all must keep that.
- **Audio-dub precision preserved** because `rest` carries the original audio slug.
- **One-segment collection contract preserved.** Some one-segment collection slugs such as `/easter.html` 200 today while many others 404; the catch-all must preserve the current best-effort `isLocale ? localized-home : collection` branch.
- **Cache-key abuse only partially prevented** by middleware normalization to a real catalog/default; `rest` remains a separate path dimension and must be bounded/tested in Phase 5.
- **next-intl request-mode timing.** `setRequestLocale` now runs in the layout and page route (has `params`); confirm `getRequestConfig`'s request-scoped store is populated before child message loads.

### Alternatives considered

- **A — Status quo (dynamic render + data cache).** What we have. DB work amortized; render not. Repeat views not free. Rejected as the end state; it's the baseline this improves on.
- **B — Visible `/es/...` subpath.** Rejected by the i18n plan (URL-contract change). This plan's internal rewrite preserves the public URL, so it does not reopen B.
- **C — Default `<html lang>` + client-side correction.** Keeps static but ships wrong `lang` in prerendered HTML to crawlers/no-JS — SEO/a11y regression for a multilingual site. Rejected.
- **D — Partial Prerendering (PPR).** Doesn't fit: a dynamic attribute on `<html>` isn't a Suspense-able hole, and locale-dependent messages pervade the tree, so the dynamic region would be ~everything. Rejected.

## Acceptance criteria

- Watch + collection routes render **static/ISR** (build manifest shows non-dynamic); repeat visits within the revalidate window are served from cache with no admin round-trip, while the first request after expiry may regenerate.
- **Public URLs byte-identical** across every active research-doc §5 shape, including `.html` watch/collection shapes and locale-less `/` and `/videos`; `/search` intentionally diverges from historical production by redirecting into the global modal, and `/search.html/search.html` must 404. Legacy normalization still 307/308; expected 404s stay 404.
- Direct visible internal-locale URLs (`/en`, `/en/en/videos`, `/es/es-419/jesus.html/spanish-latin-american.html`) do not 200 as duplicate content; they 308 to canonical public URLs or 404 by policy.
- `<html lang>` correct per locale in **prerendered** HTML; message catalog key and raw audio slug remain independently testable.
- `generateStaticParams` does not enumerate the full catalog; build time bounded.
- `typecheck` + `lint` + `build` + existing tests green; `proxy.test.ts` / `url-shape.test.ts` / `api/revalidate` tests extended; probe harness passes including query params, one-segment collection, direct-prefix, Accept-Language, hostile-path, and cache HIT cases.

## Ownership & sequencing

- **Direction approved** by the next-intl plan owner (Vlad): reverse decision #5, relax decision #1's file-tree rule for the internal segment (public URL guarantee intact). No further sign-off gate.
- **Low pre-cutover traffic risk, material launch risk** — hidden-staging env + DNS-level traffic steering is the rollback (see Deployment context), but DNS repointing requires the go/no-go gate above.
- Coordinate loosely with the in-flight next-intl phases (string extraction / translation) only to avoid editing the same route files at the same time — not a hard dependency.
- Complements the already-shipped data-layer caching (`durationSeconds` / `childDubLanguages` / 1 h cache) — that handled the DB cost; this handles the render cost.

## Cross-references

- Supersedes-in-part: [2026-05-28-001-feat-i18n-migration-next-intl-plan.md](2026-05-28-001-feat-i18n-migration-next-intl-plan.md) (decisions #1, #4, #5; Alternative D).
- URL inventory + migration test matrix: [docs/research/jesusfilm-watch-url-patterns.md](../research/jesusfilm-watch-url-patterns.md) §5.
- Watch URL `.html` restructure: [2026-05-27-002-feat-watch-url-html-shape-i18n-restructure-plan.md](2026-05-27-002-feat-watch-url-html-shape-i18n-restructure-plan.md).
- Key code: `apps/web/src/app/[locale]/[htmlLang]/layout.tsx`, `apps/web/src/app/[locale]/[htmlLang]/[...rest]/page.tsx`, `apps/web/src/proxy.ts`, `apps/web/src/lib/routes.ts` (`parseWatchPath`), `apps/web/src/lib/url-shape.ts`, `apps/web/src/lib/url-canonicalize.ts`, `apps/web/watch-base-path.mjs`.
