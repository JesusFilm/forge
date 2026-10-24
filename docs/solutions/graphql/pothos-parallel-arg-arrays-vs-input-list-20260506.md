---
title: Pothos mutations — parallel arg arrays vs an inline input-object list
date: 2026-05-06
category: graphql
problem_type: best_practice
component: pothos-graphql-schema
root_cause: positional-pairing-scales-poorly-past-2-axes
resolution_type: documentation_update
severity: low
tags:
  - pothos
  - graphql
  - api-contract
  - schema-design
related:
  - docs/solutions/platform/admin-manager-enrichment-trigger-endpoint-20260506.md
---

# Pothos mutations — parallel arg arrays vs an inline input-object list

## Problem

A Pothos mutation needs to accept a list of "paired things" (e.g.
`{ assetId, coreId }` per item, possibly with future per-item
fields). Two reasonable shapes exist; the project doesn't have a
default and the trade-off keeps coming up:

```graphql
# Shape A — parallel arg arrays paired by index:
mutation {
  triggerManagerEnrichment(
    assetIds: [Int!]!
    coreIds: [String!]!
    kind: String!
  )
}

# Shape B — inline input-object list:
mutation {
  triggerManagerEnrichment(
    items: [TriggerItemInput!]!
    kind: String!
  )
}
```

Shape A is cheaper to define (no `builder.inputType(...)` boilerplate)
and reads naturally when the caller already has parallel arrays from
some upstream projection. Shape B is structurally correct (clients
can't desynchronize the arrays) and additive-friendly (a third
per-item field is a one-line schema change vs a third parallel
array + a new length-equality validation branch).

## Symptoms of picking wrong

Picked A when B was right:

- A third per-item field becomes a breaking arg-list change OR a
  third parallel array with N×M length-equality validation cases.
- Clients that have a record-shaped input have to "unzip" before
  calling the mutation — every caller writes
  `assetIds: items.map(i => i.assetId), coreIds: items.map(i => i.coreId)`.
- /ce:review's api-contract reviewer flags this as a forward-compat
  trap (feat-119 PR2 conf 0.82).

Picked B when A was right:

- Adds a top-level `TriggerItemInput` type to the schema (a public
  GraphQL surface) for what is purely an internal pairing of
  `(assetId, coreId)`.
- Requires a Pothos `builder.inputType(...)` definition + side-effect
  import discipline.
- Slightly more verbose at the call site — clients that naturally
  have parallel arrays (e.g. piped from a CSV parser) build
  ephemeral objects just to pass them.

## Decision rule

**Use parallel arg arrays (Shape A) ONLY when ALL three are true:**

1. **≤2 fields per item.** A third axis means a third parallel
   array AND a new validation case for length equality with axes
   1+2.
2. **The producer naturally projects them as separate arrays.**
   E.g. PR1's `missingArtifacts: [{ assetId, coreId, kind }]` is
   already record-shaped, so the consumer has to unzip — which
   itself is a smell pointing at Shape B.
3. **The field set is unlikely to grow within the next 6 months.**
   The mutation's domain owner can credibly assert "this is the
   per-item shape, period."

**Switch to `[InputType!]!` (Shape B) as soon as ANY of:**

- A third per-item field is plausible within 6 months
  (priority, language hint, requestedBy, retryFrom marker)
- The per-item shape evolves at a different cadence than the
  mutation envelope (e.g. the mutation contract is stable but
  the per-item schema is in flux)
- The producer already has a record-shaped object (Pothos
  introspection-via-tooling won't reconstruct the original record;
  consumers fight the unzip)
- Length-equality validation is creeping into the resolver
  (it's a smell — input objects make it unrepresentable)

## Worked instance — feat-119 PR2 chose Shape A, deliberately

```ts
// apps/admin/src/graphql/mutations/manager-enrichment.ts
builder.mutationFields((t) => ({
  triggerManagerEnrichment: t.field({
    type: "JSON",
    authScopes: { hasPermission: "write:manager-enrichment-trigger" },
    args: {
      assetIds: t.arg.intList({ required: true, ... }),
      coreIds: t.arg.stringList({ required: true, ... }),
      kind: t.arg.string({ required: true, ... }),
    },
    resolve: async (_root, args) => {
      // Length-equality enforced in validateAndPairItems
      return dispatchManagerEnrichment(args)
    },
  }),
}))
```

Why Shape A passed muster:

- Two fields (`assetId`, `coreId`).
- The producer (PR1's CLI) populates them by mapping
  `missingArtifacts.map(i => i.assetId)` + `.map(i => i.coreId)`
  — two-line projection, no real ergonomic cost.
- The kind taxonomy is constrained by manager's URL paths
  (`/api/admin-trigger/{scene-analysis,transcript}`); a third
  per-item field would be a significant scope change.
- Plan D9 explicitly asked for consistency with sibling trigger
  mutations (`triggerSceneEmbeddingBackfill` etc.) which use
  similar parallel-list shapes.

The api-contract reviewer flagged this at conf 0.82 as a
forward-compat trap. Decision was **accept the trap** — but the
mutation's JSDoc documents the trade-off explicitly so a future
maintainer adding a 3rd field knows to migrate to `[InputType!]!`
rather than adding a third parallel array.

## Migration path (if Shape A becomes wrong)

Adding a per-item field after Shape A is in production is a
**breaking change to the GraphQL schema**. Mitigation:

1. Add a NEW mutation `triggerManagerEnrichmentV2(items:
[TriggerItemInput!]!, kind: String!)` alongside the old one.
2. Mark the old mutation `@deprecated(reason: "Use
triggerManagerEnrichmentV2 — supports per-item fields beyond
   assetId/coreId")`.
3. Migrate callers (CLI, programmatic) over time.
4. Remove the old mutation in a coordinated cleanup PR.

This is more friction than starting with Shape B. The decision
cost of guessing wrong is one V2 cycle; that's cheap when the V1
shape is genuinely the simplest correct one, but it compounds if
multiple mutations across the schema need V2 cycles for the same
reason.

## Prevention

- Default to **Shape B** (input-object list) for any mutation that
  takes "list of paired things". The cost is small (one
  `builder.inputType` declaration); the future-flexibility payoff
  is large.
- Use Shape A only when you can defend ALL three conditions above
  in the mutation's PR description.
- Document the choice in a JSDoc comment on the mutation. Future
  maintainers reading "why parallel arrays" should find the
  rationale at the call site, not in PR archaeology.
- /ce:review's api-contract reviewer should flag any new Shape A
  mutation that doesn't document its rationale.
