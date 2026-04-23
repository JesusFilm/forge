---
id: "feat-104"
title: "Admin Core Consumer Migration Plan"
owner: "tataihono"
priority: "P0"
status: "in-progress"
start_date: "2026-04-22"
duration: 2
depends_on:
  - "feat-098"
blocks: []
tags:
  - "platform"
  - "admin"
  - "cms"
  - "graphql"
  - "migration"
---

## Problem

The admin app has reached a useful CMS foundation, but public consumers still
read Strapi through `packages/graphql`. Before moving `apps/web`, `apps/mobile`,
or `apps/tv` to the admin GraphQL API, the team needs a concrete migration plan
that defines the contract strategy, parity checks, rollout flags, and rollback
path.

## Entry Points — Read These First

1. `docs/plans/2026-04-22-001-feat-admin-core-consumer-migration-plan.md` — canonical plan for this planning slice.
2. `docs/brainstorms/2026-04-13-admin-app-graphql-postgres-requirements.md` — origin requirements for admin as Strapi replacement.
3. `docs/plans/2026-04-13-002-feat-admin-app-graphql-postgres-plan.md` — completed admin foundation plan.
4. `apps/admin/AGENTS.md` and `apps/admin/CLAUDE.md` — current admin architecture and constraints.
5. `packages/graphql/AGENTS.md` and `packages/graphql/CLAUDE.md` — typed client contract rules.
6. `apps/web/AGENTS.md` and `apps/web/CLAUDE.md` — web consumer rules.
7. `apps/mobile/CLAUDE.md` and `apps/tv/CLAUDE.md` — native/TV consumer rules.

## Grep These

- `graphql(` in `apps/web/src apps/mobile/src apps/tv/src`
- `FORGE_CONTENT_API|CONTENT_API|STRAPI|NEXT_PUBLIC_CMS` in `apps/web apps/mobile apps/tv packages/graphql`
- `builder.queryFields|authScopes|PUBLIC|read:experiences|read:videos` in `apps/admin/src/graphql`
- `ExperienceService|VideoService|source='core'|source: "core"` in `apps/admin/src/services`
- `packages/graphql/src/graphql-env.d.ts|gql.tada|schema.graphql`

## What To Build

1. Produce a plan for migrating public content reads from Strapi to the admin
   GraphQL API without breaking current web, mobile, or TV releases.
2. Decide whether the migration should use a dual-client typed GraphQL package,
   a compatibility schema layer on the admin API, or a direct regeneration of
   `packages/graphql` from the admin schema.
3. Define the first vertical-slice cutover, parity harness, feature flags, cache
   behavior, and rollback path.
4. Split implementation follow-ups into roadmap tickets if the plan reveals
   multiple PR-sized phases.

## Constraints

- Planning only: do not change runtime behavior in this ticket.
- Do not decommission Strapi or move `apps/manager` in this scope.
- Do not hand-edit generated GraphQL outputs.
- Keep admin API security default-deny; PUBLIC fields must stay explicit.
- Keep consumer apps able to fall back to Strapi during rollout.

## Verification

- Plan references concrete repo-relative files for every proposed unit.
- Plan includes explicit tests for `apps/admin`, `packages/graphql`, `apps/web`,
  `apps/mobile`, and `apps/tv` migration surfaces.
- Plan defines an observable rollback path before any implementation begins.
