---
id: "feat-318"
title: "Make language-less Watch URLs canonical for English"
owner: "codex"
priority: "P1"
status: "complete"
start_date: "2026-07-25"
duration: 1
depends_on:
  - "feat-315"
  - "feat-316"
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "routing"
  - "seo"
---

## Problem

`feat-315` and `feat-316` restored English rendering at durable
language-less Watch URLs such as `/watch/jesus.html`, but Forge link builders,
metadata, structured data, sharing, and sitemap output still advertise
`/watch/jesus.html/english.html` as the primary identity.

## Entry Points — Read These First

1. `docs/plans/2026-07-25-001-fix-watch-language-less-english-canonical-plan.md`
   - reviewed implementation and validation plan.
2. `packages/watch-url-policy/src/routes.ts` - shared public Watch route and canonical URL policy.
3. `apps/web/src/lib/routes.ts` - typed Web route builders.
4. `apps/web/src/proxy.ts` - manifest admission and internal rewrites.
5. `apps/web/src/lib/watch-home-route-admission.ts` - deployment-overlap
   fallback for localized-home admission.
6. `apps/admin/src/services/watch-route-manifest.service.ts` - route and
   published-homepage admission corpus.
7. `apps/web/src/lib/watch-sitemap.ts` - canonical and hreflang projection.

## Grep These

- `buildCanonicalWatchVideoPath`
- `buildExplicitWatchVideoPath`
- `watchVideoPath`
- `WATCH_INTERNAL_REWRITE_HEADER`
- `expectedCanonicalPath`
- `WatchChromeShell`
- `homepageLocales`

## What To Build

1. Emit `/watch/{content}.html` as the canonical public form for eligible
   English content while preserving explicit non-English paths.
2. Keep `/watch/{content}.html/english.html` as a direct 200 compatibility URL
   whose metadata points to the language-less English canonical.
3. Keep explicit English canonical for a content slug that conflicts with a
   public language-home identity.
4. Align Web navigation, metadata, structured data, sharing, sitemap,
   revalidation, and every Forge-owned Watch link producer.
5. Preserve manifest admission, contextual episode navigation, query strings,
   international URLs, and fixed-404 behavior.
6. Decide missing localized-home redirects in proxy admission so a cold static
   page never emits duplicate `Location` headers.

## Constraints

- Keep eligible language-less English and explicit-English compatibility URLs
  as direct `200` responses; do not redirect either form.
- Keep non-English and contextual episode browser paths language-explicit.
- Keep explicit English canonical for content slugs that collide with public
  language-home slugs.
- Revalidate any caller-supplied internal rewrite claim before it can bypass
  public route-manifest admission.
- Preserve `dynamic = "force-static"` and ISR for static Watch content routes.
- Keep callback and download consumers on corpus-free package subpaths.

## Verification

- Shared and Web route-builder conformance tests.
- Focused proxy, metadata, structured-data, share, sitemap, revalidation, and
  client route-surface suites.
- Full touched-package test/typecheck/lint/build validation.
- HTTP and browser route matrix covering language-less English,
  explicit-English compatibility, Romanian, Spanish, Russian, contextual, and
  failure routes.
- Pull request checks green and mergeable; do not merge in this work item.

Exact focused commands:

- `pnpm --filter @forge/watch-url-policy test`
- `pnpm --filter @forge/web exec vitest run src/proxy.test.ts src/lib/watch-url-probe.test.ts src/components/__tests__/FloatingSearchProvider.test.tsx`
- `pnpm --filter @forge/admin exec vitest run src/scripts/generate-persona-variants.test.ts`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- `pnpm --filter @forge/web probe:watch-urls --production https://www.jesusfilm.org --preview http://127.0.0.1:3001`

## Completion

- All touched-package tests, typechecks, lints, and builds passed.
- Browser and JavaScript-disabled smoke tests passed for English compatibility,
  international variants, Experience chrome, and client navigation.
- Final 122-URL gate: 112 exact, 10 reviewed compatibility differences,
  0 soft regressions, 0 hard regressions, 0 errors.
- Same-environment five-sample median TTFB remained inside the 20% budget and
  static ISR behavior was unchanged.
