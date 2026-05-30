---
id: "feat-148"
title: "Restore Watch Static Rendering with Internal Locale Rewrites"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-05-29"
duration: 3
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "routing"
  - "i18n"
  - "performance"
---

## Problem

The previous `apps/web/src/app/layout.tsx` read `headers()` so the root layout
could derive `<html lang>` from the public watch URL. That dynamic API opted
every descendant route out of the Full Route Cache, so `/watch` pages kept
re-rendering even though the page routes were otherwise ISR-friendly.

## Entry Points — Read These First

1. `docs/plans/2026-05-29-001-perf-restore-watch-static-render-locale-rewrite-plan.md` - implementation plan and reviewed edge cases.
2. `apps/web/src/app/[locale]/[htmlLang]/layout.tsx` - static locale root layout.
3. `apps/web/src/proxy.ts` - canonicalization, security headers, and locale rewrite entry point.
4. `apps/web/src/app/[locale]/[htmlLang]/[...rest]/page.tsx` - one/two/three segment watch dispatch behavior.
5. `apps/web/src/app/api/revalidate/route.ts` - webhook path invalidation that must follow the new internal route tree.
6. `apps/web/src/lib/routes.ts` - public URL builders and route classification.
7. `apps/web/src/lib/locale.ts` - UI catalog family and raw audio slug mapping.

## Grep These

- `headers()`
- `resolveWatchLocaleIdentity`
- `setRequestLocale`
- `parseWatchPath`
- `revalidatePath`
- `getWatchLocaleSegmentIndex`
- `Accept-Language`

## What To Build

1. Move cacheable public watch surfaces under internal locale params:
   - message catalog key in `[locale]`
   - static HTML language tag in `[htmlLang]`
   - raw audio slug preserved in `rest` for dub selection.
2. Preserve the public URL contract through proxy rewrites, not redirects.
3. Preserve one-segment collection behavior such as `/easter.html` by keeping
   the current `isLocale(slug) ? localized-home : resolveWatchPage(slug)`
   disambiguation.
4. Prevent visible internal locale-prefixed routes from becoming duplicate 200s.
5. Replace visible Accept-Language redirects for locale-less watch surfaces with
   default-family internal rewrites.
6. Update `/api/revalidate` invalidation targets for the internal route tree.
7. Add tests for proxy rewrites, direct-prefix policy, one-segment collection
   routing, query preservation, hostile paths, and revalidation.

## Constraints

- Do not change the user-visible `/watch` URL contract.
- Do not use `headers()`, `cookies()`, `draftMode()`, `unstable_noStore`, or
  request-time dynamic APIs in cacheable watch render trees.
- Do not hand-edit generated GraphQL outputs.
- Keep admin GraphQL access server-only.
- Keep public asset, framework, API, and demo routes outside the locale rewrite.

## Verification

- `pnpm --filter @forge/web test -- src/proxy.test.ts src/lib/routes.test.ts src/lib/url-canonicalize.test.ts src/app/[locale]/[htmlLang]/[...rest]/__tests__/page-routing.test.tsx src/app/api/revalidate/route.test.ts`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web build`
- Confirm `next build` output does not mark representative watch routes as dynamic.
- Confirm repeat requests to representative watch URLs return cache HIT / ISR-equivalent headers and no admin GraphQL round-trip.
- Confirm public watch URLs rewrite to internal `/[locale]/[htmlLang]` targets without a second-pass redirect loop, while visible direct internal-prefix requests still redirect or 404.
- Confirm the URL probe treats modal search and reserved asset/API passthrough as intentional cutover contracts; triage any remaining hard failures as route bugs versus data/admin snapshot mismatches.
