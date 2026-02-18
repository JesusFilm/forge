# Client Agent Guide

Scope: `packages/graphql`.

## Rules

- Generation must be deterministic.
- Do not hand-edit `src/generated/*`.
- Regenerate when schema changes: `pnpm run codegen` (runs `gql-tada generate output`).
