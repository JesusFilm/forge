# Client Agent Guide

Scope: `packages/graphql`.

## Rules

- Generation must be deterministic.
- Do not hand-edit `src/graphql-env.d.ts`.
- Regenerate when schema changes: `pnpm turbo run generate --filter=@forge/graphql` (runs `gql-tada generate output`).
