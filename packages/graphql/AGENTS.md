# Client Agent Guide

Scope: `packages/graphql`.

## Alignment

`packages/graphql/CLAUDE.md` is canonical detail for this package.

## Rules

- Generation must be deterministic.
- Do not hand-edit `src/graphql-env.d.ts`.
- Regenerate when Strapi's schema changes: `pnpm turbo run generate --filter=@forge/graphql` (runs `gql-tada generate output`; emits `graphql-env.d.ts`).
- Keep shared queries/mutations/fragments in the consuming apps (`apps/mobile`, `apps/tv`), not in this package — this package only ships the factory + types.
- Organize operations by domain in the consumers and export typed results from there.

## Single factory (Strapi)

This package exports one typed factory bound to Strapi's schema:

| Factory     | Schema                             | Type utilities                          |
| ----------- | ---------------------------------- | --------------------------------------- |
| `graphql()` | Strapi (`apps/cms/schema.graphql`) | `ResultOf`, `FragmentOf`, `VariablesOf` |

```ts
import { graphql, type ResultOf } from "@forge/graphql"

const Q = graphql(`query { ... }`)
type Data = ResultOf<typeof Q>
```

Admin-side typed GraphQL lives in the separate `@forge/admin-graphql` package and is consumed by `apps/web`. Mobile and TV will migrate to admin in their own brainstorms; until then, this package stays in place.

## Auth posture

The factory produces typed GraphQL document objects, not HTTP requests. Transport auth is configured in each consumer app's Apollo client.

## Generation flow

```
apps/cms/schema.graphql → src/graphql-env.d.ts
```

When Strapi's schema changes:

- Strapi's GraphQL plugin auto-emits `apps/cms/schema.graphql` on Strapi runs. Commit it.
- Run `pnpm --filter @forge/graphql generate`. Commit the regenerated `graphql-env.d.ts`.
