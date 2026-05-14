# packages/graphql — Typed GraphQL Client (Strapi)

## Purpose

This package provides a gql.tada typed GraphQL factory bound to Strapi's schema (`apps/cms/schema.graphql`). It is consumed by `apps/mobile` and `apps/tv` for all GraphQL operations against the Strapi CMS.

`apps/web` now reads from admin via the separate `@forge/admin-graphql` package; this package stays in place until mobile and TV migrate too, at which point it gets deleted alongside `apps/cms`.

## Stack

- gql.tada for type-safe GraphQL operations
- TypeScript strict mode
- Codegen from Strapi's committed SDL artifact

## Surface

```ts
import { graphql, readFragment } from "@forge/graphql"
import type { FragmentOf, ResultOf, VariablesOf } from "@forge/graphql"

const Q = graphql(`
  query {
    experiences {
      id
      title
    }
  }
`)
```

That's the whole API: one factory, three type utilities, one `readFragment` helper.

## Generation flow

```
apps/cms/schema.graphql → packages/graphql/src/graphql-env.d.ts
```

Strapi's GraphQL plugin auto-emits `apps/cms/schema.graphql` during Strapi runs; commit it alongside content-type changes. Run `pnpm --filter @forge/graphql generate` (which calls `gql-tada generate output`) to regenerate `graphql-env.d.ts`. Commit the regenerated file — it's part of the contract.

## Conventions

- Operations are defined in consuming apps (e.g., `apps/mobile/src/...`, `apps/tv/src/...`) using the `graphql()` factory exported here.
- Run codegen after every Strapi schema change.
- Commit generated type files — they are part of the contract.

## Common pitfalls

- Forgetting to run codegen after a schema change breaks types silently (builds pass, runtime fails).
- Strapi's GraphQL plugin has its own filtering/sorting syntax — don't assume Relay-style pagination.
- Fragment colocation: keep fragments close to the queries that use them in the consuming app, not in a separate folder here.
