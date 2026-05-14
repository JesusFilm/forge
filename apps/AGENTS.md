# Apps Agent Guide

Scope: `apps/*` only.

## Alignment

`CLAUDE.md` files are the detailed policy. Keep this file aligned with:

- root `CLAUDE.md`
- `apps/web/CLAUDE.md`
- `apps/admin/CLAUDE.md`
- `apps/mobile/CLAUDE.md`
- `apps/tv/CLAUDE.md`
- `apps/cms/CLAUDE.md`

## Rules

- Use the right typed client per app: `packages/admin-graphql` for `apps/web`, `packages/graphql` for `apps/mobile` + `apps/tv`. Never inline GraphQL operations.
- Keep app boundaries strict; no cross-imports between app contexts.
- Treat upstream GraphQL schemas as contract: admin's `apps/admin/schema.graphql` for web; Strapi's `apps/cms/schema.graphql` for mobile + TV. Downstream apps adapt to them.
- Keep publish controls human-only in admin + CMS workflows.

## App ownership

- `apps/web`: web rendering, ISR cache invalidation, reads from admin.
- `apps/admin`: admin GraphQL surface (Pothos + Prisma), editorial lifecycle, emits ISR revalidate webhooks to web.
- `apps/cms`: Strapi schema / workflow / editorial lifecycle for mobile + TV.
- `apps/mobile`: mobile app rendering and device-specific UX.
- `apps/tv`: TV app rendering and TV-specific UX.
