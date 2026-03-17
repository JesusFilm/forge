# Client Agent Guide

Scope: `packages/graphql`.

## Alignment

`packages/graphql/CLAUDE.md` is canonical detail for this package.

## Rules

- Generation must be deterministic.
- Do not hand-edit `src/graphql-env.d.ts`.
- Regenerate when schema changes: `pnpm turbo run generate --filter=@forge/graphql` (runs `gql-tada generate output`).
- Keep all shared queries/mutations/fragments in this package for `apps/web` and `apps/mobile`.
- Organize operations by domain and export typed results for consumers.
