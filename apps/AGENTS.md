# Apps Agent Guide

Scope: `apps/*` only.

## Alignment

`CLAUDE.md` files are the detailed policy. Keep this file aligned with:

- root `CLAUDE.md`
- `apps/web/CLAUDE.md`
- `apps/admin/CLAUDE.md`
- `apps/mobile/CLAUDE.md`
- `apps/tv/CLAUDE.md`
- `apps/rag/AGENTS.md`

## Rules

- Use `packages/admin-graphql` for consumer GraphQL operations. Never inline GraphQL operations.
- Keep app boundaries strict; no cross-imports between app contexts.
- Treat admin's `apps/admin/schema.graphql` as the upstream GraphQL contract. Downstream apps adapt to it.
- Keep publish controls human-only in admin workflows.

## App ownership

- `apps/web`: web rendering, ISR cache invalidation, reads from admin.
- `apps/admin`: admin GraphQL surface (Pothos + Prisma), editorial lifecycle, emits ISR revalidate webhooks to web.
- `apps/mobile`: mobile app rendering and device-specific UX.
- `apps/tv`: TV app rendering and TV-specific UX.
- `apps/rag`: bounded RAG acquisition, indexing, retrieval, serving, and adapters; separate from every other app context.
