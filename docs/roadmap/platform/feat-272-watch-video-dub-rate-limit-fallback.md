---
id: "feat-272"
title: "Prevent Watch RSC videoDub rate-limit 500s"
owner: "unassigned"
priority: "P1"
status: "complete"
start_date: "2026-07-20"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "admin"
  - "watch-page"
  - "reliability"
---

## Problem

Production Watch requests can 500 when Web RSC traffic is rate-limited by
Admin's generic `Query.videoDub` field limiter. Web RSC is trusted
server-to-server traffic and should not accumulate into the same field-limit
bucket across page renders. On 2026-07-20, Railway production logs showed eight
500s for:

`/watch/life-of-jesus-gospel-of-john.html/english.html`

The matching app logs reported:

`CombinedGraphQLErrors: You are trying to access 'videoDub' too often`

Admin should prevent Web RSC from sharing a production field-limit bucket; Web
should also degrade selected-dub detail hydration as a defensive fallback because
the route snapshot already carries the playable `hls` URL.

## Entry Points

1. `apps/web/src/lib/content.ts` - `hydrateSelectedVariant` and Watch route
   resolution.
2. `apps/web/src/app/[locale]/[htmlLang]/[...rest]/page.tsx` - two-segment
   Watch page body rendering.
3. `apps/admin/src/graphql/plugins/rate-limit.ts` - Admin GraphQL field
   limiter identity formation.
4. `apps/admin/src/graphql/plugins/rate-limit.test.ts` - rate-limit bucket
   coverage.
5. `apps/web/src/lib/content.test.ts` - resolver fallback coverage.
6. `apps/web/src/app/[locale]/[htmlLang]/[...rest]/__tests__/page-routing.test.tsx`
   - page-level route failure coverage.

## Completion Notes

- Confirmed the production incident in Railway logs for `@forge/web`
  production: eight HTTP 500s between `2026-07-20T04:32:07Z` and
  `2026-07-20T04:32:36Z`.
- Confirmed matching app errors and metadata fallbacks for
  `slug=life-of-jesus-gospel-of-john rawLocale=english` with detail
  `You_are_trying_to_access__videoDub__too_often`.
- Updated Admin rate-limit identity formation so non-fleet
  `WEB_ADMIN_API_KEYS` traffic gets a request-scoped internal identity instead
  of accumulating across all Web RSC renders in a flat `consumer:<key>` bucket.
- Updated selected-dub hydration to log and continue with the existing route
  snapshot variant when the detail query fails.
- Kept an outer page-render guard for non-detail route resolver failures.
- Added regression coverage for the exact degradation path.

## Verification

- `pnpm --filter @forge/admin test -- src/graphql/plugins/rate-limit.test.ts`
- `pnpm --filter @forge/web test -- src/lib/content.test.ts 'src/app/[locale]/[htmlLang]/[...rest]/__tests__/page-routing.test.tsx'`
- `pnpm --filter @forge/web test -- src/lib/url-canonicalize.test.ts src/proxy.test.ts src/lib/routes.test.ts`
- `pnpm --filter @forge/web typecheck`
