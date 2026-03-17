# Packages Agent Guide

Scope: `packages/*`.

## Alignment

`CLAUDE.md` is canonical detail. Keep this file aligned with:

- root `CLAUDE.md`
- `packages/graphql/CLAUDE.md`

## Rules

- Contracts change first, generated client updates second.
- No handwritten edits inside generated client outputs.
- `packages/graphql` is shared by both `apps/web` and `apps/mobile`; treat changes as cross-app impact.
