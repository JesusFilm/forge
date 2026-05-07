# packages/graphql — Typed GraphQL Client

## Purpose

This package provides gql.tada typed GraphQL operations for two GraphQL schemas:

- **Strapi** (`apps/cms`) — the existing CMS, source of truth for all consumer apps today
- **admin** (`apps/admin`) — the strategic replacement; consumer apps migrate to it route-by-route

It is the single source of truth for typed GraphQL interactions in `apps/web`, `apps/mobile`, and `apps/tv`. The dual-client lives only during the consumer migration window — once all consumer routes have moved off Strapi and Strapi is decommissioned, this package collapses back to single-target admin.

## Stack

- gql.tada for type-safe GraphQL operations
- TypeScript strict mode
- Multi-schema codegen from committed SDL artifacts (no live introspection — admin disables it in production via `@envelop/disable-introspection`)

## Dual-client conventions

Two factories side-by-side, each bound to its own schema's introspection:

```ts
import { graphql, adminGraphql } from "@forge/graphql"

// Strapi-bound — accepts queries against Strapi's schema only
const FROM_STRAPI = graphql(`
  query {
    experiences {
      id
      title
    }
  }
`)

// admin-bound — accepts queries against admin's schema only
const FROM_ADMIN = adminGraphql(`query { experienceBySlug(...) { ... } }`)
```

Type utilities are namespaced to make mixing visually obvious:

| Strapi side             | admin side                                       |
| ----------------------- | ------------------------------------------------ |
| `ResultOf<typeof Q>`    | `AdminResultOf<typeof Q>`                        |
| `FragmentOf<typeof F>`  | `AdminFragmentOf<typeof F>`                      |
| `VariablesOf<typeof Q>` | `AdminVariablesOf<typeof Q>`                     |
| `readFragment(F, data)` | `readFragment(F, data)` (shared; works for both) |

Type isolation is enforced at compile time — `src/__tests__/dual-client.types.ts` carries `@ts-expect-error` directives that prove the cross-schema assignment is rejected. This is the AE1 enforcement mechanism documented in `docs/plans/2026-05-05-001-feat-dual-client-codegen-unit-3-plan.md` (U5).

### Which factory to use

- **New queries against admin** → `adminGraphql`
- **Existing Strapi callsites** → `graphql` (no change; they migrate route-by-route under brief Unit 5)
- **Both in the same file** is fine — that's how migrated and unmigrated routes coexist during the transition

### Auth posture (acknowledged gap)

The factories produce typed GraphQL document objects, not HTTP requests. Actual transport auth is enforced in consumer-app Apollo clients (`apps/web`, `apps/mobile`, `apps/tv` each configure their own).

`adminGraphql` queries are intended to be issued **anonymously** (no `Authorization` header) by default. Admin's PUBLIC tier currently exposes:

- `experienceBySlug` (`apps/admin/src/graphql/types/experience.ts:149`)
- `searchExperiences`
- `hybridSearch`
- `sceneRecommendations`

Anything else is gated by admin's scope-auth plugin and will fail at runtime if queried anonymously. Brief Unit 2 widens additional resolvers (`videoBySlug`, `video(id)`, `videos`, `watchSetting`) as consumer routes need them.

**Compile-time gap:** until consumer-app Apollo clients are wired to admin's endpoint (brief Unit 5), nothing prevents a contributor from authoring a non-PUBLIC admin query at this layer. Convention + PR review are the only defenses. `as any` casts between Strapi and admin types defeat the AE1 type-isolation guarantee on purpose; reviewers should reject on sight.

## Generation flow

```
apps/cms/schema.graphql      → packages/graphql/src/graphql-env.d.ts        (Strapi)
apps/admin/schema.graphql    → packages/graphql/src/admin-graphql-env.d.ts  (admin)
```

The two `.d.ts` files are committed alongside the `.graphql` artifacts. Run `pnpm --filter @forge/graphql generate` (which calls `gql-tada generate output`) to regenerate both.

### Strapi side

`apps/cms/schema.graphql` is auto-emitted by Strapi's GraphQL plugin during Strapi runs. Commit changes alongside content-type changes.

### Admin side

`apps/admin/schema.graphql` is emitted by `pnpm --filter @forge/admin schema:print`, which runs `printSchema(lexicographicSortSchema(builder.toSchema()))` against admin's Pothos schema. Pothos plugin directives (e.g., `@authScopes`) are stripped post-print so gql.tada's parser can consume the SDL.

CI enforces drift via the `admin-schema-drift` job in `.github/workflows/ci.yml` — gated on `@forge/admin` affected via Turbo, mirrors the existing `graphql-generate` job pattern.

### Turbo wiring

Root `turbo.json` declares both SDL files as `inputs` to the `generate` task; the `.d.ts` files as `outputs`. No `dependsOn` edge from `generate` → `schema:print` (matches the existing Strapi pattern, where the schema author runs the producer task manually and CI catches drift).

## Conventions

- Operations are defined in apps (e.g., `apps/web/src/lib/content.ts`, `apps/manager/src/app/dashboard/`) using the appropriate factory from this package.
- Run codegen after every schema change — Strapi-side OR admin-side.
- Commit generated type files — they are part of the contract.

## Common Pitfalls

- Forgetting to run codegen after a schema change breaks types silently (builds pass, runtime fails). CI's `admin-schema-drift` job catches the admin-side case.
- Strapi's GraphQL plugin has its own filtering/sorting syntax — don't assume Relay-style pagination.
- Admin's schema uses Pothos conventions (no `documentId`, no `localizations` collection — locale data is per-row). The two schemas have meaningfully different shapes; do NOT assume Strapi field names exist on admin types.
- Fragment colocation: keep fragments close to the queries that use them, not in a separate folder.
- `as any` casts between Strapi and admin types defeat the AE1 type-isolation guarantee. Reviewers should reject on sight; an ESLint rule against this specific shape is a follow-up.
- The dual-client is temporary. When Strapi is decommissioned, `adminGraphql` becomes `graphql` and the Strapi factory + its types + `graphql-env.d.ts` are deleted in one PR.

## Sources

- Origin brief: [docs/brainstorms/2026-05-05-consumer-migration-implementer-brief-requirements.md](../../docs/brainstorms/2026-05-05-consumer-migration-implementer-brief-requirements.md)
- Implementation plan (this PR): [docs/plans/2026-05-05-001-feat-dual-client-codegen-unit-3-plan.md](../../docs/plans/2026-05-05-001-feat-dual-client-codegen-unit-3-plan.md)
