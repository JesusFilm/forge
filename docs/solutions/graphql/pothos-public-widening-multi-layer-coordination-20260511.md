---
title: Pothos PUBLIC widening with field-level strip and centralized regression
date: "2026-05-11"
category: graphql
module: apps/admin
problem_type: architecture_pattern
component: authentication
severity: high
applies_when:
  - "Widening a previously-gated Pothos resolver to PUBLIC anonymous access"
  - "Anonymous responses must come back via `data` only, with no entries in `response.errors[]`"
  - "A subset of fields on a now-public type must remain editor/admin-only"
  - "Service-layer methods feeding the resolver still need `hasPermission` for non-GraphQL callers (e.g., Core sync)"
  - "CI cannot see the change — `admin-schema-drift` strips `@authScopes` from the committed SDL"
tags:
  - pothos
  - graphql
  - auth-scopes
  - public-widening
  - unauthorized-resolver
  - consumer-migration
  - regression-test
  - admin
---

# Pothos PUBLIC widening with field-level strip and centralized regression

## Context

Admin's GraphQL surface (`apps/admin/`) is migrating from "logged-in-only on every read" to a hybrid where consumer-facing queries (`videos`, `experienceBySlug`, `watchSetting`, reference data) are PUBLIC anonymous while editorial/internal fields (`isHomepage`, `createdAt`, `updatedAt`, `isTemplate`, `ownerId`) must be stripped from anonymous responses. PR #921 (`feat/admin-public-widening-unit-2`) shipped the first batch and surfaced three forces that collide every time:

1. **Auth lives in three layers.** Pothos resolver `authScopes`, service-layer `hasPermission` defense-in-depth, and the central matrix at `apps/admin/src/auth/permissions.ts`. Flipping the wrong layer silently widens non-GraphQL consumers (Core sync, internal service-to-service calls) that share the same permission key.

2. **Pothos scope-auth's default `unauthorizedResolver` throws.** Confirmed in `@pothos/plugin-scope-auth@4.1.6` at `resolve-helper.js:5-7,81-87`. On a non-nullable field, the thrown error nulls the parent object per GraphQL spec — catastrophic. On a nullable field, it still surfaces in `response.errors[]`, contaminating PR #915's U5 parity comparator that inspects both `data` and `errors[]`.

3. **SDL-drift CI is structurally blind to `authScopes`.** `apps/admin/src/scripts/print-schema.ts` strips Pothos `@authScopes` directives from the committed SDL pre-commit (see [`dual-client-gql-tada-multi-schema-codegen-pattern-20260507.md`](../architecture-patterns/dual-client-gql-tada-multi-schema-codegen-pattern-20260507.md) §4 — the AST stripping is what makes the dual-client codegen work). A future contributor narrowing `experienceBySlug` back to `loggedIn: true` produces zero SDL diff and `admin-schema-drift` doesn't catch it.

Hidden prereq surfaced during U2 planning (session history): reference data resolvers `languages`/`countries`/`keywords` looked PUBLIC at the matrix layer (`read:reference: "PUBLIC"`) but were still `loggedIn: true` at the resolver layer. The anonymous homepage language picker would have failed silently without widening these in the same PR.

## Guidance

### 1. Pick one of three widening modes — explicitly

When flipping a gated resolver to PUBLIC, choose deliberately and document the mode in a resolver-block comment so the next reader knows which gate is load-bearing.

- **Mode A — Flip the matrix entry** (e.g., `read:videos: "VIEWER"` → `"PUBLIC"`). Widens every consumer of the key including non-GraphQL paths. Use only when you've audited all call sites.
- **Mode B — Flip the resolver's `authScopes` to `{ public: true }` AND drop the service-layer guard.** The resolver becomes the single auth contract. U2 took this path for `video.service.ts` `list`/`getById`/`getBySlug`.
- **Mode C — Add a `getByCoreId`-style escape hatch.** Keep the matrix tight for one method while widening the others. U2 kept the guard on `getByCoreId` because it's Core-sync internal, not GraphQL-exposed.

### 2. Pair `authScopes` with `unauthorizedResolver: () => null` for field-level strips

Anonymous callers get a clean `null` with zero entries in `response.errors[]`; EDITOR/ADMIN callers get the real value. The nullability flip is the second half — Pothos requires the field type to permit `null` before the resolver can return it.

```ts
// apps/admin/src/graphql/types/experience.ts
const STRIPPED_FOR_PUBLIC = {
  nullable: true as const,
  authScopes: { hasPermission: "read:experiences" as const },
  unauthorizedResolver: () => null,
}

builder.prismaObject("ExperienceLocale", {
  fields: (t) => ({
    id: t.exposeID("id"),
    slug: t.exposeString("slug"),
    title: t.exposeString("title"),

    // Stripped — anonymous see null with no error entry
    isHomepage: t.exposeBoolean("isHomepage", { ...STRIPPED_FOR_PUBLIC }),
    createdAt: t.string({
      ...STRIPPED_FOR_PUBLIC,
      resolve: (row) => row.createdAt.toISOString(),
    }),
    updatedAt: t.string({
      ...STRIPPED_FOR_PUBLIC,
      resolve: (row) => row.updatedAt.toISOString(),
    }),
  }),
})
```

### 3. Bridge public-shape → abac-gated via service-mediated `t.prismaField` on `objectRef`

When a public-shape root type (e.g., `WatchSetting`) needs to expose a field whose target is abac-gated (e.g., `ExperienceLocale`), do NOT use `t.relation`. The classification walker would flag the bridge AND `t.relation` defers auth to the related type's resolver, which would 401 anonymous callers. Use `t.prismaField` on a `builder.objectRef` and put the gate in the service's Prisma `WHERE`:

```ts
// apps/admin/src/graphql/types/watch-setting.ts
const WatchSettingRef = builder
  .objectRef<WatchSettingShape>("WatchSetting")
  .implement({
    fields: (t) => ({
      homepageExperience: t.prismaField({
        type: "ExperienceLocale",
        nullable: true,
        resolve: (_query, parent) => parent.homepageExperience, // service supplies the row
      }),
    }),
  })

// apps/admin/src/services/watch-setting.service.ts
await prisma.experienceLocale.findFirst({
  where: {
    locale,
    isHomepage: true,
    status: "PUBLISHED", // gate
    experience: { archivedAt: null }, // gate
  },
})
```

The service is the gate. The classification walker (which only inspects `prismaObject` + `t.relation`) is invisible to this bridge by construction. See sibling pattern: [`pothos-relation-abac-filter-required-for-nested-types.md`](pothos-relation-abac-filter-required-for-nested-types.md) for the `t.relation` query-callback gating it complements.

### 4. Substitute SDL-drift CI with a centralized source-walking regression test

Add `apps/admin/src/graphql/public-resolvers.regression.test.ts`. It walks source files under `src/graphql/{types,queries,mutations}/`, parses each Pothos resolver block via balanced-brace tracking, and asserts:

- Every name in `INTENDED_PUBLIC_RESOLVERS` carries `authScopes: { public: true }` (catches accidental narrowing)
- No PUBLIC resolver exists outside the manifest (catches accidental widening)

Pair with a reciprocal `existsSync` assertion in `classification.test.ts` so deleting either test fails the other (meta-defense against silent removal).

```ts
const INTENDED_PUBLIC_RESOLVERS = [
  "experienceBySlug",
  "searchExperiences",
  "search",
  "sceneRecommendations",
  "video",
  "videoBySlug",
  "videos",
  "languages",
  "countries",
  "keywords",
  "watchSetting",
] as const
```

### 5. Verify end-to-end with a smoke script, not vitest

Vitest's transitive `graphql` double-instance issue (documented in `apps/admin/src/graphql/queries/scene-recommendations.test.ts`) blocks full-pipeline `execute()` calls in test mode — `instanceof` checks against `GraphQLObjectType` fail because there are two copies of the module loaded. Workaround: a temporary `apps/admin/.tmp/smoke-public-resolvers.ts` script that imports the schema directly and runs `graphql({ schema, source, contextValue })` against real Postgres. `.tmp/` is gitignored, so the script stays out of commits and can be re-run any time.

## Why This Matters

**If you flip only `authScopes` and leave `service.hasPermission` intact:** the inner guard wins. The resolver compiles, ships, and 401s anonymous callers because the service-layer check fires after scope-auth passes. This is the silent-hole failure mode — tests at the resolver pass (resolver allows anonymous) AND tests at the service pass (service rejects anonymous) but the seam between them is broken. The flipped service-test assertions in `video.service.test.ts` are permanent regression guards; any future contributor re-adding the `hasPermission` check breaks them.

**If you flip only the matrix entry:** every consumer of the key widens, including Core sync's `getByCoreId` and any other service-to-service path. The blast radius is invisible from the resolver file you're editing.

**If you skip `unauthorizedResolver: () => null`:** PR #915's U5 parity comparator inspects `response.errors[]`. Pothos's default throws on unauthorized field access; on nullable fields this still adds an `errors[]` entry, which the comparator counts as a divergence between admin and Strapi responses. Every anonymous request fails parity, the canary flips red, the migration stalls. On non-nullable fields it's worse — the parent object goes null per the GraphQL spec, breaking the entire response. _(plan-research history: the initial U2 plan draft incorrectly described Pothos as "returns null on auth failure" — a doc reviewer caught it before any code was written.)_

**If you trust SDL-drift CI:** `admin-schema-drift` compares `apps/admin/schema.graphql`, which `print-schema.ts` produces _after_ stripping `@authScopes`. A contributor flipping `{ public: true }` back to `{ loggedIn: true }` produces zero SDL diff. The centralized regression test compensates by reading source files directly — it's auth-aware where the SDL comparator is auth-blind.

**Option A (single type + field-level strip) vs Option B (separate `PublicExperience` type):** U2 chose Option A explicitly. Option B doubles the type surface, requires SDL parity across two types forever, and forces consumer apps to change query shapes at every schema version. Option A keeps the SDL contract stable and lets scope-auth handle field suppression at runtime. _(session history: this decision was deliberated during the U2 planning phase and documented in the plan's Key Technical Decisions section.)_

## When to Apply

- Widening an existing gated Pothos resolver to PUBLIC anonymous access (root queries, list endpoints, slug lookups).
- Stripping editorial/internal/timestamp fields from anonymous responses on an otherwise-public type.
- Bridging a public-shape root type to an abac-gated related type without exposing the related type's auth surface.
- Any time you need `@pothos/plugin-scope-auth` to silently return `null` instead of throwing into `response.errors[]`.
- Before merging any PR that touches `authScopes` in `apps/admin/src/graphql/` — update `INTENDED_PUBLIC_RESOLVERS` if widening, remove the entry if narrowing.

## Examples

**Service-layer guard removal coordinated with resolver widening:**

```ts
// apps/admin/src/services/video.service.ts
// BEFORE U2:
async list({ user, query }: { user: Principal | null; query: object }) {
  if (!hasPermission(user, "read:videos")) throw new ForbiddenError()
  return prisma.video.findMany({ ...query, where: { deletedAt: null } })
}

// AFTER U2 — resolver is the single auth contract:
async list({ query }: { query: object }) {
  return prisma.video.findMany({ ...query, where: { deletedAt: null } })
}

// getByCoreId KEPT its guard because Core sync calls it directly, bypassing GraphQL:
async getByCoreId({ coreId, user, query }: { ... }) {
  if (!hasPermission(user, "read:videos")) throw new ForbiddenError()
  return prisma.video.findFirst({ ...query, where: { coreId, deletedAt: null } })
}
```

**Smoke script for full-pipeline verification:**

```ts
// apps/admin/.tmp/smoke-public-resolvers.ts (gitignored; re-runnable)
import { graphql } from "graphql"
import { schema } from "@/graphql/schema"
import { createServices } from "@/services"
import { prisma } from "@/db/client"

const ctx = {
  user: null, // PUBLIC
  request: new Request("http://localhost/api/graphql"),
  prisma,
  loaders: createLoaders(prisma),
  services: createServices(prisma),
}

const r = await graphql({
  schema,
  source: `{ experienceBySlug(locale: "en", slug: "home") {
    id slug
    isHomepage createdAt updatedAt
  } }`,
  contextValue: ctx,
})

console.log("errors:", r.errors ?? "[]")
console.log("data:", r.data)
// Expected (PUBLIC): isHomepage/createdAt/updatedAt all null, errors[] empty
```

PR #921 shipped 6/6 green on local Postgres AND against the Railway preview at `https://forgeadmin-forge-pr-921.up.railway.app/api/graphql` on the first deployment. The auth-widening worked as specified on the first live run — no failed approaches during implementation, because all three Pothos behaviors (default-throw, AST directive strip, classification walker scope) were verified during planning before any code shipped. _(session history.)_

## Related

- [`pothos-relation-abac-filter-required-for-nested-types.md`](pothos-relation-abac-filter-required-for-nested-types.md) — sibling pattern: `t.relation` query-callback ABAC filtering for nested children. Complements this doc's resolver-level scope widening + field-level strip.
- [`../architecture-patterns/dual-client-gql-tada-multi-schema-codegen-pattern-20260507.md`](../architecture-patterns/dual-client-gql-tada-multi-schema-codegen-pattern-20260507.md) — causal predecessor. Explains §4 (AST directive stripping) which is _why_ SDL-drift CI is blind to `authScopes` changes, making the centralized regression test necessary.
- Plan: [`docs/plans/2026-05-11-001-feat-consumer-migration-unit-2-admin-public-widening-plan.md`](../../plans/2026-05-11-001-feat-consumer-migration-unit-2-admin-public-widening-plan.md)
- Brief: [`docs/brainstorms/2026-05-05-consumer-migration-implementer-brief-requirements.md`](../../brainstorms/2026-05-05-consumer-migration-implementer-brief-requirements.md)
- Shipping PR: https://github.com/JesusFilm/forge/pull/921
