---
title: Pothos `objectRef`-based fields default to NULLABLE; `prismaObject` fields infer from the schema — `nullable: false` is load-bearing on objectRef
date: 2026-05-18
last_updated: 2026-05-18
category: graphql
module: apps/admin
problem_type: integration_issue
component: documentation
root_cause: inadequate_documentation
resolution_type: documentation_update
severity: medium
applies_when:
  - Defining a new GraphQL output type via `builder.objectRef<T>("Name")` + `.implement({ fields })`.
  - Reviewing a `t.exposeID(...)` / `t.exposeString(...)` field on an objectRef-backed type.
  - Acting on a code-review finding that claims `nullable: false` is "redundant" because the underlying TS shape is non-null.
tags:
  - pothos
  - graphql
  - objectRef
  - prismaObject
  - nullability
  - sdl
  - schema-drift
  - reviewer-verification
related:
  - docs/solutions/graphql/pothos-public-widening-multi-layer-coordination-20260511.md
  - docs/solutions/graphql/pothos-prisma-shared-enum-module.md
  - docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md
---

# Pothos `objectRef`-based fields default to NULLABLE in SDL

## Problem

`builder.prismaObject(...)` infers field nullability from the Prisma schema —
`t.exposeID("id")` on a `prismaObject` whose underlying column is `String @id`
emits `id: ID!` in the SDL. `builder.objectRef<T>("Name")` does NOT infer
anything from the TS shape — `t.exposeID("id")` on an objectRef-backed type
emits `id: ID` (nullable) regardless of whether `T["id"]: string` is non-null
at the type level.

To get a non-null field on an objectRef, you must explicitly pass
`{ nullable: false }`. Dropping the option flips the SDL from `ID!` to `ID`.

This is silently asymmetric — it bites when you (or a reviewer) trust a
prismaObject precedent and propagate the "redundant nullable: false" suggestion
across the codebase.

## Symptoms

- `schema:print` regenerated artifact silently changes a field from
  `id: ID!` to `id: ID` (and `coreId: String!` to `coreId: String`) after
  what looked like a no-op cleanup commit.
- gql.tada introspection regen produces no errors; consumer code that
  relied on the non-null guarantee starts type-checking against
  `string | null | undefined`.
- No test failure: `schema.test.ts` may not assert per-field nullability
  on the new objectRef-based type unless explicitly added.

## What didn't work

- **Trusting the reviewer's "redundant" claim.** ce:review (kt-007) confidently
  flagged `nullable: false` as redundant by pointing at sibling
  `prismaObject` precedents in the same file (e.g.,
  `VideoOrigin.id: t.exposeID("id")` without the option). The reviewer was
  right about prismaObject — and wrong about objectRef. Confidence was 0.6;
  applying without verification flipped the SDL.
- **Reading the diff visually.** The TS change reads as a clean simplification
  (`t.exposeID("id", { nullable: false })` → `t.exposeID("id")`). The SDL
  effect is invisible from the source diff alone.

## Solution

Always pass `nullable: false` explicitly on objectRef-based `t.exposeID` /
`t.exposeString` / `t.exposeInt` / `t.exposeBoolean` fields where the SDL
shape must be non-null. Verify by regenerating SDL after any "cleanup" change
that touches an objectRef field.

```ts
// apps/admin/src/graphql/types/video.ts — VideoForEnrichment (objectRef)
const VideoForEnrichmentRef =
  builder.objectRef<VideoForEnrichment>("VideoForEnrichment")

VideoForEnrichmentRef.implement({
  fields: (t) => ({
    // `nullable: false` is required on objectRef-based types —
    // Pothos cannot infer non-nullability from the TS shape the
    // way prismaObject can from the Prisma schema. Dropping these
    // would silently flip the SDL to `String` / `ID` (nullable).
    id: t.exposeID("id", { nullable: false }),
    coreId: t.exposeString("coreId", { nullable: false }),
    // Genuinely nullable fields — explicit for both forms.
    label: t.exposeString("label", { nullable: true }),
    // …
  }),
})
```

Contrast with `prismaObject` (no `nullable: false` needed for fields backed
by non-null columns):

```ts
// apps/admin/src/graphql/types/video.ts — VideoOrigin (prismaObject)
builder.prismaObject("VideoOrigin", {
  fields: (t) => ({
    id: t.exposeID("id"), // → ID! (inferred)
    coreId: t.exposeString("coreId"), // → String! (inferred)
    description: t.exposeString("description", { nullable: true }), // → String
  }),
})
```

## Why this works

Pothos's `prismaObject` ties field-level nullability to the Prisma DMMF's
column metadata at builder-time. The `expose*` helpers introspect the DMMF
to determine the SDL output type. For `objectRef<T>`, no DMMF exists —
Pothos has only the TS type `T`, which it cannot reflect on at runtime
(type erasure). Its default is to treat every field as nullable unless the
caller asserts otherwise via `nullable: false`.

This is a deliberate framework choice for ergonomics on non-Prisma types
(where the TS shape may be optional in practice, or the field may need to
opt into null for service-mediated reads), but it surprises anyone migrating
patterns across the two kinds of object types in the same file.

## Prevention

1. **Treat `nullable: false` as load-bearing on every objectRef-based
   `expose*` field that should appear non-null in SDL.** Do NOT drop it as
   "redundant" — there is no SDL-level redundancy for objectRef types.

2. **Add a schema-surface assertion for new objectRef types in
   `schema.test.ts`.** Iterate fields and assert nullability via either
   `String(field.type).endsWith("!")` or graphql-js's `isNonNullType`.
   `apps/admin/src/graphql/schema.test.ts`'s `VideoForEnrichment` block is the
   canonical example.

3. **Regenerate SDL + commit the diff in the same change** as any
   objectRef field touch. CI's `admin-schema-drift` will catch a missed
   regen; a local `pnpm --filter @forge/admin schema:print` + `git diff
apps/admin/schema.graphql` between change candidates surfaces the
   nullability flip visually before commit.

4. **When a reviewer claims a `nullable: false` is redundant, verify
   against the SDL artifact, not against sibling source code.** The
   prismaObject vs objectRef seam is invisible at the source-diff level;
   only the regenerated SDL exposes the asymmetry. ce:review confidence
   is sub-threshold for auto-apply when the framework default differs
   from the reviewer's mental model.

5. **Document the seam at the schema-test site, not just the resolver
   site.** The schema-test assertion is what protects the next contributor
   from re-applying the "drop the redundant option" suggestion.

## Cross-references

- `apps/admin/src/graphql/types/video.ts` (`VideoForEnrichmentRef`) — the
  objectRef where the nullability seam was discovered.
- `apps/admin/src/graphql/types/watch-setting.ts` (`WatchSettingRef`) — the
  same convention applied earlier; uses `nullable: true` explicitly on
  every field but never asserts the contract via schema-test.
- `apps/admin/src/graphql/schema.test.ts` — `VideoForEnrichment` nullability
  block (added as part of ce:review Round 1 on PR #974).
- `docs/solutions/graphql/pothos-public-widening-multi-layer-coordination-20260511.md`
  — describes how authScopes drop out of the printed SDL; same general
  class of "Pothos directive metadata is invisible to schema-drift CI"
  trap, different seam.
