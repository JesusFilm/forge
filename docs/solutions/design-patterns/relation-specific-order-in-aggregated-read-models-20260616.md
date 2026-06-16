---
module: admin, manager
problem_type: design_pattern
severity: medium
date: 2026-06-16
---

# Relation-specific order in aggregated read models

## Problem

Manager coverage grouped videos into collections using only
`parentDocumentIds`. That membership array is enough to answer "which parents
contain this child" but cannot answer "what order does this child have inside
this specific parent", especially when the same video belongs to more than one
collection.

## Pattern

When a read model groups children under parents and the join table owns
metadata such as order, expose a relation-shaped projection in addition to any
legacy membership array:

```ts
parentRelations: Array<{
  parentDocumentId: string
  order: number | null
}>
```

Consumers should sort each parent group using the relation entry that matches
that parent, not the global child list order. Keep null orders last and use a
stable fallback for deterministic rendering.

## Applied Instance

- Admin service: `apps/admin/src/services/manager-read-model.service.ts`
- Admin GraphQL contract: `apps/admin/src/graphql/types/managerReadModels.ts`
- Manager grouping route: `apps/manager/src/app/api/videos/route.ts`
- Manager UI preservation: `apps/manager/src/features/coverage/coverage-report-client.tsx`

The compatibility `parentDocumentIds` field remains available for older
callers, but new ordering-sensitive consumers should use `parentRelations`.
