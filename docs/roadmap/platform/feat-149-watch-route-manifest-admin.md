---
id: "feat-149"
title: "Admin Watch Route Manifest"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-05-29"
duration: 2
depends_on:
  - "feat-148"
blocks:
  - "feat-172"
  - "feat-314"
tags:
  - "platform"
  - "admin"
  - "web"
  - "watch-page"
  - "routing"
  - "performance"
---

## Problem

The static `/watch` route rewrite bounds internal locale params, but arbitrary
watch content segments can still reach App Router rendering and admin lookups
before returning 404. Once ISR is active, random route spray can create
unnecessary render work and cache entries unless web can cheaply reject paths
that cannot exist.

## Entry Points - Read These First

1. `docs/plans/2026-05-29-002-feat-watch-route-manifest-admin-plan.md` - implementation plan and route-admission contract.
2. `apps/admin/prisma/schema.prisma` - source tables and snapshot model.
3. `apps/admin/src/services/revalidate-webhook.ts` - existing best-effort admin-to-web notification pattern.
4. `apps/admin/src/services/experience.service.ts` - Experience publish/update/archive hooks.
5. `apps/admin/src/services/core-sync/orchestrator.ts` - route-relevant Core sync phase orchestration.
6. `apps/admin/src/auth/consumer-bearer.ts` - service-to-service bearer validation for web callers.
7. `apps/web/src/proxy.ts` - future consumer location for route-admission checks.

## Grep These

- `watch-route-manifest`
- `WatchRouteManifest`
- `emitRevalidateWebhook`
- `isValidConsumerBearer`
- `childDubLanguages`
- `VideoRelation`
- `video-dubs`

## What To Build

1. Add an admin service that computes compact watch route-admission sets:
   `contentSlugs`, `oneSegmentSlugs`, `episodePairsByParent`, and
   `audioLanguageSlugs`.
2. Persist the latest deterministic, versioned manifest snapshot in Postgres.
3. Refresh the manifest after route-relevant Experience and Core sync changes
   without blocking publish or sync jobs.
4. Expose the latest manifest through an authenticated admin API route for
   `apps/web`.
5. Extend the existing web revalidation webhook with a manifest-refresh model.
6. Add a safe operator script and docs for local refresh/inspection.

## Constraints

- Do not implement the `apps/web` route-admission consumer in this ticket.
- Do not change public `/watch` URL shape.
- Do not enumerate `content x language` or `parentChild x language` route
  permutations.
- Do not expose drafts, archived content, internal IDs, localized content,
  media URLs, subtitles, search data, or rendering payloads through the
  manifest.
- Do not make admin publish/update/archive UX depend on web availability.
- Do not hand-edit generated Prisma client or GraphQL environment outputs.

## Verification

- `pnpm --filter @forge/admin test -- watch-route-manifest`
- `pnpm --filter @forge/admin test -- revalidate-webhook experience.service core-sync`
- `pnpm --filter @forge/admin typecheck`
- `pnpm --filter @forge/admin lint`
- Verify the Prisma migration applies on a fresh local admin database.
- Run the manifest generation script against local/restored admin data and
  record slug counts, pair count, payload size, and generation duration.
