---
title: Pothos + Prisma Shared Enum Module Pattern
category: graphql
date: 2026-04-13
tags:
  [
    pothos,
    prisma,
    graphql-schema,
    admin-app,
    enum-deduplication,
    best-practices,
    schema-design,
  ]
---

# Pothos + Prisma Shared Enum Module Pattern

## Problem

When multiple Pothos type modules independently register the same Prisma
enum under different GraphQL names (e.g., `ExperienceLocaleStatus` in
`experience.ts` and `LocaleStatus` in `video.ts`), the schema ends up
with two distinct GraphQL enum types that map to the same underlying
values (DRAFT/PUBLISHED/ARCHIVED). Clients cannot write a single filter
input that works across both `ExperienceLocale.status` and
`VideoLocale.status` because GraphQL treats the two enums as
incompatible types. This forces duplicate filter logic on the client and
breaks any "give me all draft locales" query that would naturally span
entity types.

The same trap applies to shared scalars (`JSON`, `DateTime`) — each
`builder.addScalarType` call creates a distinct GraphQL scalar identity
keyed on the name string.

## Root Cause

Pothos does not automatically deduplicate enum or scalar registrations.
Each call to `builder.enumType("X", ...)` creates a new GraphQL enum
type keyed by the string name passed. When type definitions are
organized into per-feature modules (one file per domain entity),
developers naturally register the enums they need locally, unaware that
another module already registered the same underlying Prisma enum under
a different name. Pothos has no built-in mechanism to detect or merge
these duplicates — the framework treats enum identity as the GraphQL
type name string, so `ExperienceLocaleStatus !== LocaleStatus` even
when both enumerate `{DRAFT, PUBLISHED, ARCHIVED}`.

The trap was caught during a multi-agent code review of PR #748 on the
`apps/admin/` admin app (Strapi replacement) where two Pothos type
modules had independently registered the Prisma `LocaleStatus` enum
under different GraphQL names.

## Solution

Centralize all shared enums and scalars in a single reference module
that is imported before any consumer module. Consumer modules import
the exported references rather than calling `builder.enumType` or
`builder.addScalarType` themselves.

### 1. Register shared enums once in `reference.ts`

```ts
// src/graphql/types/reference.ts
import { builder } from "@/graphql/builder"

/**
 * Shared enums — registered once, imported everywhere.
 * Add any Prisma enum used by more than one type module here.
 */

export const LocaleStatusEnum = builder.enumType("LocaleStatus", {
  values: {
    DRAFT: { value: "DRAFT" },
    PUBLISHED: { value: "PUBLISHED" },
    ARCHIVED: { value: "ARCHIVED" },
  } as const,
})
```

### 2. Register shared scalars in the same module

```ts
// src/graphql/types/reference.ts (continued)
import { GraphQLScalarType } from "graphql"

const JSONScalarGraphQL = new GraphQLScalarType({
  name: "JSON",
  description: "Arbitrary JSON value.",
  parseValue: (v) => v,
  serialize: (v) => v,
  // parseLiteral implementation omitted for brevity
})

builder.addScalarType("JSON", JSONScalarGraphQL, {})
```

For modules that don't import a named export but still rely on the
scalar registration side effect (e.g., a type that references
`type: "JSON"`), keep a side-effect import:

```ts
// some-other-type.ts
import "@/graphql/types/reference" // side-effect: registers JSON scalar
```

### 3. Consumer modules import and use the exported references

```ts
// src/graphql/types/experience.ts
import { builder } from "@/graphql/builder"
import { LocaleStatusEnum } from "@/graphql/types/reference"

builder.prismaObject("ExperienceLocale", {
  fields: (t) => ({
    id: t.exposeID("id"),
    locale: t.exposeString("locale"),
    title: t.exposeString("title", { nullable: true }),
    // Use the shared enum — not a new builder.enumType() call
    status: t.expose("status", { type: LocaleStatusEnum }),
  }),
})
```

```ts
// src/graphql/types/video.ts
import { builder } from "@/graphql/builder"
import { LocaleStatusEnum } from "@/graphql/types/reference"

builder.prismaObject("VideoLocale", {
  fields: (t) => ({
    id: t.exposeID("id"),
    locale: t.exposeString("locale"),
    label: t.exposeString("label", { nullable: true }),
    // Same shared enum — one GraphQL type in the schema
    status: t.expose("status", { type: LocaleStatusEnum }),
  }),
})
```

### 4. Import order in `schema.ts`

The reference module **must** be imported first so its scalars and
enums are registered on the builder before any field references them:

```ts
// src/graphql/schema.ts
import { builder } from "@/graphql/builder"

// 1. Shared enums + scalars — MUST come first
import "@/graphql/types/reference"

// 2. Feature type modules (order among these doesn't matter)
import "@/graphql/types/experience"
import "@/graphql/types/video"

// 3. Build the schema after all types are registered
export const schema = builder.toSchema()
```

### Rule of thumb

If an enum or scalar appears in more than one type module, it lives in
`reference.ts` and is exported. Feature modules should never call
`builder.enumType()` or `builder.addScalarType()` for types that are or
could become shared. Single-use enums scoped to one entity can stay in
that entity's type file, but promote them to `reference.ts` the moment
a second consumer appears.

## Prevention

1. **Single-owner module**: All shared GraphQL enums and scalars live
   in `src/graphql/types/reference.ts`. No other file may call
   `builder.enumType()` for a Prisma enum used by more than one entity.

2. **Naming convention**: The file is always `reference.ts` inside
   `src/graphql/types/`. Entity-specific enums (used by exactly one
   type module) can stay in that entity's file. The moment a second
   module needs the enum, move it to `reference.ts`.

3. **Code-organization rule**: Add to `reference.ts` when the enum
   originates from a Prisma schema enum OR is referenced by two or more
   entity type files. Keep entity-specific enums local only if they
   are truly single-use.

4. **Import ordering in `schema.ts`**: `reference.ts` must be the
   first type import, before any entity modules. Other modules depend
   on its side-effect registrations (scalars, shared enums).

5. **Documentation**: Add the convention to the app's `CLAUDE.md`
   under a "GraphQL Type Registration" or "Conventions" heading so new
   contributors and AI agents discover it before writing type code.

## Detection

1. **Schema test** — assert that no two registered GraphQL enum types
   share identical value sets. If `getEnumValues(typeA)` deep-equals
   `getEnumValues(typeB)`, fail with a message pointing to
   `reference.ts`.

2. **Grep pattern for reviewers**:

   ```bash
   grep -rn "builder.enumType\|builder.addScalarType" src/graphql/types/
   ```

   If any hit is outside `reference.ts` for a Prisma-sourced enum or a
   non-entity-specific scalar, flag it.

3. **Code-review checklist item**: "Any new `builder.enumType` call —
   is this enum used by 2+ entities? If yes, it belongs in
   `reference.ts`."

## Related Documentation

- [`docs/solutions/cms/admin-app-data-model-decisions.md`](../cms/admin-app-data-model-decisions.md)
  — Companion data model doc for the same admin app. Defines the
  Prisma enums (LocaleStatus, RevisionStatus, RevisedByKind, SourceTier,
  VideoLabel, VideoSource) that this pattern centralizes.
- [`docs/solutions/integration-issues/expo-graphql-schema-drift-and-fragment-validation.md`](../integration-issues/expo-graphql-schema-drift-and-fragment-validation.md)
  — Schema drift prevention. Centralizing enum registration is one of
  the controls that keeps the schema stable across consumer apps.
- [`docs/solutions/runtime-errors/pothos-turbopack-hmr-duplicate-typename-crash-20260515.md`](../runtime-errors/pothos-turbopack-hmr-duplicate-typename-crash-20260515.md)
  — Same `ConfigStore` no-deduplication behavior, surfaced via a
  different trigger: Turbopack HMR re-evaluation. Centralizing a type
  in `reference.ts` does NOT prevent the HMR variant — the centralized
  module gets re-evaluated and re-registers. The dev-loop fix is a
  process restart; the long-term fix is a `globalThis` builder
  singleton or a register-once guard.

## Caught By

This trap was surfaced by the `pattern-recognition-specialist` agent
during a multi-agent code review (`/ce:review`) of PR #748 on the
admin app's Phase 2 branch. The agent flagged "Duplicate `LocaleStatus`
enum registered as two GraphQL types" with concrete file:line
citations. Other reviewer agents in the same wave caught related
schema-organization concerns (missing FK constraints, inconsistent
soft-delete columns, JSON scalar `parseLiteral` missing `Kind.ENUM`),
all fixed in the same follow-up commit.
