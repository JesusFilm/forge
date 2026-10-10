# Packages Agent Guide

Scope: `packages/*`.

## Alignment

`CLAUDE.md` is canonical detail. Keep this file aligned with:

- root `CLAUDE.md`
- `packages/admin-graphql/CLAUDE.md`
- `packages/rag-contracts/AGENTS.md`

## Rules

- Contracts change first, generated client updates second.
- No handwritten edits inside generated client outputs.
- `packages/admin-graphql` is consumed by `apps/web`; changes are a cross-app impact for web.
- `packages/admin-graphql` is consumed by web, mobile, and TV; changes are a cross-app impact.
- `packages/rag-contracts` is runtime-neutral and must not import from any application context.
