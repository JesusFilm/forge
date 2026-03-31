---
id: "feat-005"
title: "GraphQL Contract Stewardship"
owner: "tataihono"
priority: "P0"
status: "not-started"
start_date: "2026-04-01"
duration: 56
depends_on: []
blocks: []
tags:
  - "graphql"
  - "infrastructure"
---

## Entry Points — Read These First

1. `packages/graphql/package.json` — find the codegen script
2. `apps/cms/schema.graphql` — the source schema
3. `apps/web/src/lib/content.ts` — consumer operations
4. `apps/mobile/src/` — grep for `graphql(` to find mobile operations

## Grep These

- `graphql(` in `apps/web/` and `apps/mobile/` — all typed operations
- `codegen` in `packages/graphql/package.json` — the command
- `introspection|schema.*url` in `packages/graphql/` — where codegen reads the schema from

## What To Do

- Review every PR that changes `apps/cms/src/api/*/content-types/` or `apps/cms/schema.graphql`
- After any CMS content type change, verify codegen runs:
  ```bash
  cd packages/graphql && pnpm codegen
  ```
- Check that new operations in `apps/web/src/lib/content.ts` compile with `pnpm tsc --noEmit` in `apps/web/`
- Watch for: breaking changes to existing queries, missing fragment updates, N+1 population issues

## Verification

- `cd packages/graphql && pnpm codegen` → succeeds after every CMS schema change
- `cd apps/web && pnpm tsc --noEmit` → no type errors
- No runtime GraphQL errors in web or mobile after schema changes
