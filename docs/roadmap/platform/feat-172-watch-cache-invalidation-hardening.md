---
id: "feat-172"
title: "Watch cache invalidation hardening"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-06-10"
duration: 2
depends_on:
  - "feat-149"
  - "feat-163"
blocks: []
tags:
  - "platform"
  - "web"
  - "admin"
  - "watch-page"
  - "revalidation"
  - "performance"
---

## Problem

Watch pages are route-level ISR, but the revalidation endpoint only clears
rendered route paths. The page resolvers also use `unstable_cache` without
tags, so a regenerated route can still read stale Data Cache entries. Core sync
also refreshes the watch route manifest without emitting a broad video-data
invalidation for visible video/dub/subtitle/image changes.

## Entry Points - Read These First

1. `docs/plans/2026-06-10-001-fix-watch-cache-invalidation-plan.md` - full
   implementation plan and rollout policy.
2. `apps/web/src/app/api/revalidate/route.ts` - token-gated receiver that maps
   semantic Admin webhooks to Next cache invalidation calls.
3. `apps/web/src/app/api/revalidate/route.test.ts` - route-handler contract
   tests for paths, auth, malformed payloads, and manifest cache clearing.
4. `apps/web/src/lib/content.ts` - watch resolver `unstable_cache` wrappers.
5. `apps/web/src/lib/watch-home.ts` - cached watch home model.
6. `apps/web/src/lib/watch-route-manifest.ts` - process-local manifest cache and
   clearing helper.
7. `apps/admin/src/services/revalidate-webhook.ts` - best-effort Admin-to-web
   webhook client.
8. `apps/admin/src/services/watch-route-manifest-refresh.service.ts` - Core
   sync manifest refresh and webhook emission.

## Grep These

- `revalidatePath`
- `revalidateTag`
- `unstable_cache`
- `watch-route-manifest`
- `emitRevalidateWebhook`
- `ROUTE_RELEVANT_CORE_SYNC_PHASES`
- `fetchResolvedWatchVideo`
- `fetchVideoChildDubLanguages`

## What To Build

1. Add a web-owned watch cache tag helper with coarse tags for home, settings,
   experience, video, series, child-dub languages, and the route manifest.
2. Add matching `tags` arrays to every watch `unstable_cache` wrapper.
3. Extend `/api/revalidate` to call `revalidateTag(tag, { expire: 0 })` while
   preserving the existing public/internal/legacy `revalidatePath` matrix.
4. Support broad `video` invalidation payloads with no slug so Core sync can
   refresh rendered watch video data even without per-slug change summaries.
5. Distinguish route-manifest-relevant Core sync phases from watch-render-
   relevant phases and emit broad video invalidation for render-relevant phases.
6. Keep route-level watch `revalidate` at 60 seconds in the correctness slice;
   after production webhook/topology proof, raise it to 3600 seconds in the
   follow-up.
7. Update web/admin docs with the cache contract and remaining multi-instance
   cache-topology limitation.

## Constraints

- Do not change the public `/watch` URL shape.
- Do not remove existing `revalidatePath` coverage.
- Do not introduce scoped data tags unless matching scoped cache declarations
  exist.
- Do not raise resolver/data-cache TTLs in this ticket.
- Do not block Admin publish or Core sync jobs on web revalidation success.
- Do not add Cloudflare HTML caching rules or a custom shared Next cache
  handler in this ticket.

## Verification

- `pnpm --filter @forge/web test -- src/app/api/revalidate/route.test.ts`
- `pnpm --filter @forge/web test -- src/lib/watch-cache-tags.test.ts`
- `pnpm --filter @forge/admin test -- src/services/watch-route-manifest-refresh.service.test.ts`
- `pnpm --filter @forge/admin test -- src/services/revalidate-webhook.test.ts`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/admin typecheck`
- Preview smoke: request a watch video twice, trigger authorized revalidation,
  and confirm the next request no longer serves stale resolver data.
