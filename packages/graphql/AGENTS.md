# Client Agent Guide

Scope: `packages/graphql`.

## Alignment

`packages/graphql/CLAUDE.md` is canonical detail for this package.

## Rules

- Generation must be deterministic.
- Do not hand-edit `src/graphql-env.d.ts` or `src/admin-graphql-env.d.ts`.
- Regenerate when EITHER schema changes: `pnpm turbo run generate --filter=@forge/graphql` (runs `gql-tada generate output`; emits both env files).
- Keep all shared queries/mutations/fragments in this package for `apps/web`, `apps/mobile`, and `apps/tv`.
- Organize operations by domain and export typed results for consumers.

## Dual-client (Strapi + admin)

This package exports two typed factories side-by-side during the Strapi → admin consumer migration:

| Factory          | Schema                              | Use for                                            | Type utilities                                         |
| ---------------- | ----------------------------------- | -------------------------------------------------- | ------------------------------------------------------ |
| `graphql()`      | Strapi (`apps/cms/schema.graphql`)  | All existing consumer callsites until they migrate | `ResultOf`, `FragmentOf`, `VariablesOf`                |
| `adminGraphql()` | Admin (`apps/admin/schema.graphql`) | New admin-targeted queries; routes being migrated  | `AdminResultOf`, `AdminFragmentOf`, `AdminVariablesOf` |

```ts
import {
  graphql,
  adminGraphql,
  type ResultOf,
  type AdminResultOf,
} from "@forge/graphql"

// Strapi-typed query
const STRAPI_Q = graphql(`query { ... }`)
type StrapiData = ResultOf<typeof STRAPI_Q>

// Admin-typed query — distinct type, NOT assignable to StrapiData
const ADMIN_Q = adminGraphql(`query { ... }`)
type AdminData = AdminResultOf<typeof ADMIN_Q>
```

Mixing — assigning a `ResultOf<...>` value to an `AdminResultOf<...>` variable, or passing an admin document to code that expects a Strapi document — is a TypeScript error at compile time. Verified by `src/__tests__/dual-client.types.ts` (the AE1 enforcement mechanism).

Dual-client is **temporary scaffolding**. When all consumer apps are reading from admin and Strapi is decommissioned, this package collapses back to single-target admin (the `adminGraphql` → `graphql` rename + Strapi factory deletion happens in that same change).

## Auth posture

The factories are documentation-and-convention only — they produce typed GraphQL document objects, not HTTP requests. Auth posture for the actual HTTP transport is enforced in consumer-app Apollo clients (web/mobile/tv each configure their own).

`adminGraphql` queries are intended to be issued via clients configured for **anonymous HTTPS** (no `Authorization` header) by default. Admin's PUBLIC tier currently exposes `experienceBySlug`, `searchExperiences`, `hybridSearch`, and `sceneRecommendations`; non-PUBLIC admin queries are out of scope until admin's `read:videos`-gated resolvers are widened (tracked under brief Unit 2).

**Acknowledged gap:** between the dual-client landing and the consumer-side Apollo wiring (brief Unit 5), no compile-time guard prevents a contributor from writing a non-PUBLIC admin query — the only protection is convention plus PR review. As-casting between Strapi and admin types via `as any` defeats the AE1 type-isolation guarantee by design; reviewers should reject on sight.

## Generation flow

Two SDL artifacts feed two introspection .d.ts files:

```
apps/cms/schema.graphql          → src/graphql-env.d.ts        (Strapi)
apps/admin/schema.graphql        → src/admin-graphql-env.d.ts  (admin)
```

When you change Strapi:

- Strapi's GraphQL plugin auto-emits `apps/cms/schema.graphql` on Strapi runs. Commit it.
- Run `pnpm --filter @forge/graphql generate`. Commit the regenerated `graphql-env.d.ts`.

When you change admin's Pothos schema:

- Run `pnpm --filter @forge/admin schema:print`. Commit the regenerated `apps/admin/schema.graphql`.
- Run `pnpm --filter @forge/graphql generate`. Commit the regenerated `admin-graphql-env.d.ts`.
- CI's `admin-schema-drift` job catches you if you forget step 1.

Admin disables introspection in production (`@envelop/disable-introspection`), so SDL must come from a build-time emit, not live introspection. The committed SDL is the contract handoff between admin (producer) and this package (consumer).
