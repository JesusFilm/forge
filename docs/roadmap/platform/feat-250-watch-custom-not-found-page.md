---
id: "feat-250"
title: "Watch custom not-found page"
owner: "unassigned"
priority: "P1"
status: "complete"
start_date: "2026-07-13"
duration: 1
depends_on: []
blocks:
  - "feat-251"
tags:
  - "web"
  - "infrastructure"
---

## Problem

Watch page misses do not have a useful user experience. Proxy-classified and
route-manifest-rejected URLs return an empty 404 body, while resolver-level
misses fall back to Next.js's default page because the locale route has no
`not-found.tsx`. Viewers get no branded explanation or path back to working
content.

The current proxy admission guard is intentional: unknown routes must not reach
Admin page resolvers or create unbounded force-static ISR miss keys. The custom
page must preserve that boundary and the final HTTP 404 status.

## Entry Points — Read These First

1. `apps/web/src/proxy.ts` — `buildNotFound()` currently terminates page misses
   with an empty response; `rewriteToInternal()` owns the marked locale rewrite.
2. `apps/web/src/app/[locale]/[htmlLang]/[...rest]/page.tsx` — existing
   resolver and shape misses call `notFound()` inside the force-static tree.
3. `apps/web/src/app/[locale]/[htmlLang]/layout.tsx` — supplies Montserrat,
   dark Watch styling, and the floating logo/search/account provider.
4. `apps/web/src/components/FloatingSearchProvider.tsx` — established fixed
   header behavior and safe-area-aware spacing that the page must coexist with.
5. `docs/solutions/performance-issues/watch-static-locale-rewrite-route-manifest-admission-20260529.md`
   — explains the cache-spray and Admin-work boundary that must remain intact.

## Grep These

- `buildNotFound` — every proxy-owned negative branch.
- `notFound()` — every app-level miss that should share the custom page.
- `WATCH_INTERNAL_REWRITE_HEADER` — recursion guard and internal rewrite marker.
- `isRewriteAdmittedByManifest` — compact admission check that must not weaken.
- `WATCH_PAGE_CONTENT_CLASSES` — shared responsive Watch rail sizing.

## What To Build

1. Add a locale-scoped `not-found.tsx` backed by a reusable, server-rendered
   Watch component. Use the existing Montserrat/black/stone/brand-red visual
   system, one lightweight local poster, a semantic not-found heading, and
   working links to the Watch home and video inventory.
2. Add one fixed internal 404 sentinel route that calls `notFound()` before
   streaming. Rewrite page-level proxy rejections to that sentinel while
   preserving the browser URL, internal marker, CSP, and referrer policy.
3. Keep the current route-manifest lookup and admission behavior. Sentinel
   rendering must not call page resolvers, Admin GraphQL, CMS, or remote media.
4. Cover component semantics and proxy behavior. Production-mode proof must
   show the custom body, status 404, `noindex`, and unchanged valid routes.
5. Capture desktop, 390x667 portrait, and 844x390 landscape proof with keyboard
   focus, reduced-motion, home/browse navigation, and header search checks.

## Constraints

- Do not admit arbitrary invalid paths to the force-static catch-all.
- Do not change canonical URL normalization, redirect status, sitemap behavior,
  API error bodies, or reserved static-asset handling.
- Do not add a dependency, CMS fetch, remote image, or new client controller.
- Do not add not-found copy keys across all message catalogs in this change.
- Keep the original invalid public URL visible in the browser.

## Verification

- `pnpm --filter @forge/web test -- src/proxy.test.ts src/components/WatchNotFound.test.tsx`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- `pnpm --filter @forge/web build`
- Run the production server and assert both a proxy-rejected URL and an
  app-level miss return the custom HTML with HTTP 404 and `noindex`.
- Confirm a representative valid Watch route remains 200 with no new
  critical-path request or document-timing regression.
- Browser-smoke desktop, portrait mobile, and landscape mobile layouts; tab to
  both actions, emulate reduced motion, navigate both links, and open search.

## Completion Notes

- Added a locale-scoped cinematic not-found page and fixed internal sentinel so
  proxy and resolver misses converge on the same server-rendered response.
- Production proof confirms HTTP 404, automatic `noindex`, original URL
  retention, same-origin-only error-page requests, and working recovery actions.
- Focused tests (62), typecheck, lint, formatting, and production build pass.
- Responsive and interaction proof covers 1440x900, 390x667, and 844x390,
  keyboard focus, reduced motion, navigation, and global search.
- The valid `/watch` shell remains 200 with no new critical-path resource or
  warmed document-timing regression against base revision `8496d905`.
- Route-scoping inherited remote-media hints is follow-up `feat-251`.
