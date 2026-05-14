# Packages Agent Guide

Scope: `packages/*`.

## Alignment

`CLAUDE.md` is canonical detail. Keep this file aligned with:

- root `CLAUDE.md`
- `packages/admin-graphql/CLAUDE.md`
- `packages/graphql/CLAUDE.md`

## Rules

- Contracts change first, generated client updates second.
- No handwritten edits inside generated client outputs.
- `packages/admin-graphql` is consumed by `apps/web`; changes are a cross-app impact for web.
- `packages/graphql` is consumed by `apps/mobile` + `apps/tv`; changes are a cross-app impact for both.
- The two typed clients are isolated: admin types never assignable to Strapi types and vice versa (enforced at compile time by `packages/admin-graphql/src/__tests__/type-isolation.types.ts`).
