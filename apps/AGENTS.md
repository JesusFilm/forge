# Apps Agent Guide

Scope: `apps/*` only.

## Alignment

`CLAUDE.md` files are the detailed policy. Keep this file aligned with:

- root `CLAUDE.md`
- `apps/web/CLAUDE.md`
- `apps/mobile/CLAUDE.md`
- `apps/cms/CLAUDE.md`
- `apps/manager/CLAUDE.md`
- `apps/admin/CLAUDE.md`
- `apps/mastra/CLAUDE.md`

## Rules

- Use `packages/graphql` for GraphQL operations (do not inline per app).
- Keep app boundaries strict; no cross-imports between app contexts.
- Treat CMS GraphQL as upstream contract; downstream apps adapt to it.
- Keep publish controls human-only in CMS workflows.
- Treat Mastra as a first-class runtime app boundary. Manager is the first
  consumer, but future apps must consume Mastra agents/workflows through
  documented API contracts or a planned shared contract package, not by
  importing `apps/mastra` internals.

## App ownership

- `apps/web`: web rendering and cache invalidation hooks.
- `apps/cms`: schema/workflow and editorial lifecycle.
- `apps/manager`: internal operator UI, agent automation ownership, dry-run
  reports, and Manager-owned side-effect approvals.
- `apps/admin`: internal admin data tooling and operational dashboards.
- `apps/mobile`: mobile app rendering and device-specific UX.
- `apps/roadmap`: roadmap viewer and planning surface.
- `apps/tv`: TV app surface.
- `apps/mastra`: shared Mastra runtime, Mastra Studio, agent/workflow
  registration, runtime sessions, and service contracts for consumer apps.
