# Apps Agent Guide

Scope: `apps/*` only.

## Alignment

`CLAUDE.md` files are the detailed policy. Keep this file aligned with:

- root `CLAUDE.md`
- `apps/web/CLAUDE.md`
- `apps/mobile/CLAUDE.md`
- `apps/cms/CLAUDE.md`

## Rules

- Use `packages/graphql` for GraphQL operations (do not inline per app).
- Keep app boundaries strict; no cross-imports between app contexts.
- Treat CMS GraphQL as upstream contract; downstream apps adapt to it.
- Keep publish controls human-only in CMS workflows.

## App ownership

- `apps/web`: web rendering and cache invalidation hooks.
- `apps/cms`: schema/workflow and editorial lifecycle.
- `apps/mobile`: mobile app rendering and device-specific UX.
