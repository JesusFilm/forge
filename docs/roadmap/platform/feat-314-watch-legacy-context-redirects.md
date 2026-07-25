---
id: "feat-314"
title: "Watch legacy contextual route redirects"
owner: "codex"
priority: "P1"
status: "complete"
start_date: "2026-07-24"
duration: 1
depends_on:
  - "feat-149"
  - "feat-179"
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "routing"
  - "seo"
---

## Problem

Legacy indexed Watch URLs can retain a collection parent after the current
Admin relationship has been removed or changed. The route manifest rejects
that contextual parent/child pair and Web sends the request to the shared 404,
even when the child Video and requested Dub still have a valid canonical
standalone URL.

## Entry Points — Read These First

1. `docs/plans/2026-07-24-003-fix-watch-legacy-context-redirects-plan.md` -
   implementation plan and redirect decision matrix.
2. `apps/web/src/proxy.ts` - public Watch canonicalization, manifest admission,
   internal rewrites, redirects, and fixed 404 routing.
3. `apps/web/src/proxy.test.ts` - proxy request/response contract coverage.
4. `apps/web/src/lib/watch-route-manifest.ts` - exact contextual and standalone
   route admission from the Admin-owned manifest.
5. `apps/web/src/lib/routes.ts` - canonical Watch URL builders.

## Grep These

- `isRewriteAdmittedByManifest`
- `isWatchRouteAdmittedByManifest`
- `watchVideoPath`
- `manifestRoute`
- `buildNotFound`

## What To Build

1. Preserve every exact manifest-admitted contextual
   `/{parent}.html/{child}/{language}.html` route.
2. When a safe contextual route is rejected, evaluate the same
   child/language as a standalone Video route against the already fetched
   manifest.
3. Return HTTP 301 to `/{child}.html/{language}.html` only when that standalone
   route is admitted.
4. Preserve query parameters and the existing redirect cache-control header.
5. Keep the fixed 404 when both contextual and standalone candidates are
   rejected.
6. Preserve the current multi-segment fail-open behavior when the manifest is
   unavailable.

## Constraints

- Do not change valid parent/child navigation or contextual metadata.
- Do not add a historic-parent allowlist or change the Admin manifest contract.
- Do not fetch the manifest more than once per request.
- Do not redirect malformed routes, unsupported public language slugs, or
  rejected standalone targets.
- Do not change one-segment, standalone Video, or internal-prefix behavior.

## Verification

- `pnpm --filter @forge/web exec vitest run src/proxy.test.ts src/lib/watch-route-manifest.test.ts`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- `pnpm --filter @forge/web test`
- Direct HTTP proof covers the 301 `Location`, query preservation, valid
  contextual rewrite, and fixed 404 fallback.
- Browser smoke follows the legacy redirect without a loop and confirms valid
  contextual navigation remains contextual.
- Page-loading verification confirms the proxy-only change adds no client
  request, script, or rendered resource.
