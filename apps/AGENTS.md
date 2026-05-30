# Apps Agent Guide

Scope: `apps/*` only.

## Alignment

`CLAUDE.md` files are the detailed policy. Keep this file aligned with:

- root `CLAUDE.md`
- `apps/web/CLAUDE.md`
- `apps/admin/CLAUDE.md`
- `apps/mobile/CLAUDE.md`
- `apps/manager/CLAUDE.md`
- `apps/agentic/CLAUDE.md`
- `apps/tv/CLAUDE.md`

## Rules

- Use `packages/admin-graphql` for consumer GraphQL operations. Never inline GraphQL operations.
- Keep app boundaries strict; no cross-imports between app contexts.
- Treat admin's `apps/admin/schema.graphql` as the upstream GraphQL contract. Downstream apps adapt to it.
- Keep publish controls human-only in admin workflows.
- Treat Agentic as a first-class runtime app boundary. Manager is the first
  consumer, but future apps must consume Agentic agents/workflows through
  documented API contracts or a planned shared contract package, not by
  importing `apps/agentic` internals.

## App ownership

- `apps/web`: web rendering and cache invalidation hooks.
- `apps/admin`: admin GraphQL surface (Pothos + Prisma), editorial lifecycle, emits ISR revalidate webhooks to web.
- `apps/manager`: internal operator UI, agent automation ownership, dry-run
  reports, and Manager-owned side-effect approvals.
- `apps/mobile`: mobile app rendering and device-specific UX.
- `apps/roadmap`: roadmap viewer and planning surface.
- `apps/tv`: TV app surface.
- `apps/agentic`: shared Mastra runtime, Mastra Studio, agent/workflow
  registration, runtime sessions, and service contracts for consumer apps.
