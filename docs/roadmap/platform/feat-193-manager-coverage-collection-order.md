---
id: "feat-193"
title: "Manager coverage collection order"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-06-16"
duration: 1
depends_on:
  - "feat-190"
blocks: []
tags:
  - "platform"
  - "admin"
  - "manager"
  - "coverage"
  - "data-contract"
---

## Problem

The Manager coverage dashboard groups videos under collection and series rows,
but the child items do not follow the Core/Admin `VideoRelation.order` value.
The existing Manager coverage payload only exposes `parentDocumentIds`, which
is enough to group videos but not enough to sort a child differently per parent.

## Entry Points -- Read These First

1. `apps/admin/src/services/manager-read-model.service.ts` -- Admin Manager
   coverage read model and relation projection.
2. `apps/admin/src/graphql/types/managerReadModels.ts` -- Manager coverage
   GraphQL contract exposed to Manager.
3. `apps/manager/src/backend/admin-client.ts` -- Manager's Admin GraphQL
   selection for coverage rows.
4. `apps/manager/src/app/api/videos/route.ts` -- Manager coverage grouping
   route that builds dashboard collections.
5. `apps/manager/src/features/coverage/coverage-report-client.tsx` --
   coverage dashboard collection tile rendering.

## What To Build

1. Keep `parentDocumentIds` for compatibility.
2. Add relation-specific parent order metadata to the Manager coverage payload.
3. Sort each Manager collection's child videos by that relation order, with
   null orders after ordered children and a deterministic fallback.
4. Preserve the sorted collection order in the coverage tile UI.
5. Regenerate Admin SDL and `packages/admin-graphql` artifacts after the
   GraphQL contract change.

## Constraints

- Do not change Core sync or add a new database column.
- Do not hardcode collection-specific slugs or titles.
- Do not hand-edit generated GraphQL artifacts.

## Verification

- `pnpm --filter @forge/admin test -- --run src/services/manager-read-model.service.test.ts src/graphql/types/managerReadModels.test.ts src/graphql/schema.test.ts`
- `pnpm --filter @forge/admin schema:print`
- `pnpm --filter @forge/admin-graphql generate`
- `pnpm --filter @forge/manager test -- --run src/app/api/videos/route.mock.test.ts src/backend/admin-client.test.ts`
- Targeted type checks for Admin and Manager if the test/codegen pass exposes
  contract drift.

## Completion Notes

- Admin Manager coverage now exposes `parentRelations { parentDocumentId order }`
  alongside the legacy `parentDocumentIds` membership array.
- Manager sorts each collection's child rows by that relation-specific order
  with null orders last and a deterministic title/input fallback.
- The coverage tile UI preserves the API-provided item order instead of
  re-sorting by coverage status.
