---
title: "Pothos t.relation on abac-gated types must include a query callback that re-applies ABAC filtering"
category: graphql
date: 2026-04-14
tags:
  - graphql
  - pothos
  - auth
  - abac
  - admin
problem_type: security_issue
component: apps/admin/src/graphql/types/experience.ts
---

## Problem

The Experience Pothos type used a bare `t.relation("locales")` to expose
nested ExperienceLocale rows. The root query resolver correctly delegated
to a service that applied ABAC filtering (VIEWER/PUBLIC see only PUBLISHED
locales), but the relation bypass meant a query like:

```graphql
{
  experience(id: "x") {
    locales {
      slug
      status
      blocks
    }
  }
}
```

would return ALL locales — including DRAFTs — to any principal who could
load the parent Experience, because `t.relation` resolves directly through
the Prisma plugin's `...query` passthrough without any auth check.

## Root cause

The Pothos Prisma plugin's `t.relation` is a convenience for eager-loading
relations. It does not consult scope-auth or service-layer ABAC. The
classification test (`classification.test.ts`) caught that `public-shape`
types must not relate to `abac-gated` types, but it did not catch the
inverse: an `abac-gated` parent type relating to its own `abac-gated`
children without a filter.

The architectural rule in CLAUDE.md ("relations targeting abac-gated types
route through service-layer resolvers") was documented but not enforced
for same-type hierarchies.

## Solution

Add a `query` callback to the relation that applies role-based filtering:

```ts
locales: t.relation("locales", {
  query: (_args, ctx) =>
    ctx.user?.role === "ADMIN" || ctx.user?.role === "EDITOR"
      ? {}
      : { where: { status: "PUBLISHED" } },
}),
```

The Pothos Prisma plugin merges the `query` callback's return value into
the Prisma include clause, so the WHERE filter is applied at the SQL level.

## Prevention

When adding `t.relation` on any abac-gated type:

1. Check whether the target type has visibility rules (publish state,
   ownership, archive state).
2. If yes, add a `query` callback that applies the same ABAC WHERE that
   the root query's service method uses.
3. If the filtering logic is complex, delegate to a service method instead
   of inlining the query callback.

The classification test enforces the cross-classification rule (public →
abac-gated is blocked), but same-classification relations need manual
review until a test walks all `t.relation` calls on abac-gated types and
asserts they carry a `query` callback.

## Related

- `apps/admin/src/graphql/types/experience.ts` — the fixed relation
- `apps/admin/src/graphql/classification.test.ts` — cross-classification
  enforcement (does not catch same-type relation bypass)
- `apps/admin/CLAUDE.md` — Permission system section
