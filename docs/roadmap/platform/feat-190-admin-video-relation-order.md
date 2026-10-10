---
id: "feat-190"
title: "Admin Video Relation Order Preservation"
owner: "tataihono"
priority: "P1"
status: "complete"
start_date: "2026-06-14"
duration: 2
depends_on: []
blocks:
  - "feat-192"
tags:
  - platform
  - admin
  - core-sync
  - watch-page
  - data-contract
---

## Problem

Forge Watch pages render video collections from Admin GraphQL, but Admin
currently imports Core parent-child video relations without preserving the
ordered `children` array returned by Core. The `VideoRelation.order` column
exists, yet live JESUS collection rows have `order = null`, so the database's
non-contractual row order leaks through Admin and into Web's sibling carousel.

## Entry Points -- Read These First

1. `docs/plans/2026-06-14-001-fix-watch-video-relation-order-plan.md` --
   implementation plan and verification scope.
2. `apps/admin/AGENTS.md` -- Admin Core sync, GraphQL schema generation, and
   operator-script rules.
3. `apps/admin/src/services/core-sync/phases/sync-videos.ts` -- Core video
   sync relation extraction and bulk insert path.
4. `apps/admin/src/graphql/types/video.ts` -- `Video.parents` and
   `Video.children` relation query callbacks.
5. `apps/web/src/lib/content.ts` -- Watch data normalization that should
   preserve Admin relation order.
6. `docs/roadmap/platform/feat-109-admin-core-sync-entity-coverage.md` --
   historical context for Admin Core sync coverage.

## Grep These

- `pendingRelations|videoRelationRows|video_relation` in
  `apps/admin/src/services/core-sync/phases/sync-videos.ts`
- `videoParentsFilter|videoChildrenFilter|VideoRelation` in
  `apps/admin/src/graphql/types/video.ts`
- `children { order child|parents { order parent` in `apps/web/src/lib`
- `SiblingCarousel` in `apps/web/src/components/watch`

## What To Build

1. Capture each Core child relation's array position during the Admin `videos`
   Core sync phase and write it to `VideoRelation.order`.
2. Preserve skipped unresolved children without renumbering the remaining Core
   positions.
3. Return `Video.parents` and `Video.children` from Admin GraphQL with
   deterministic relation ordering:
   - `order` ascending with nulls last,
   - then `createdAt` ascending,
   - then `id` ascending.
4. Keep Web as a pass-through consumer of Admin relation order. Do not add a
   Watch-specific slug ranking or hardcoded JESUS sequence.
5. Regenerate or verify Admin SDL and `packages/admin-graphql` artifacts after
   the Pothos source change.

## Constraints

- Do not add a new schema column; `VideoRelation.order` already exists.
- Do not hardcode JESUS collection ordering in Web.
- Do not change public Watch URL shapes or routing.
- Do not hand-edit generated GraphQL artifacts.
- Treat production backfill as an operator action after deployment; code should
  make the existing `videos` Core sync phase fill relation order.

## Verification

- `pnpm --filter @forge/admin test -- src/services/core-sync/phases/sync-videos.test.ts src/graphql/types/video.principal-filter.test.ts`
- `pnpm --filter @forge/admin schema:print`
- `pnpm --filter @forge/admin-graphql generate`
- `pnpm --filter @forge/admin typecheck`
- After deployment and backfill, query Admin GraphQL for
  `videoBySlug(slug: "jesus") { children { order child { slug } } }` and
  confirm the first children match Core/www: `the-beginning`,
  `birth-of-jesus`, `childhood-of-jesus`.
