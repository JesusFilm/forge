---
id: "feat-098"
title: "Admin CMS Expansion Loop"
owner: "vlad"
priority: "P0"
status: "in-progress"
start_date: "2026-04-14"
duration: 14
depends_on:
  - "feat-097"
blocks: []
tags:
  - "platform"
  - "admin"
  - "cms"
  - "graphql"
  - "operations"
---

## Problem

The admin app is now in an operational v1 state, but it is still early-stage as
the long-term Strapi replacement. The next branch needs a compound expansion
loop that explores where the CMS should grow next, closes the highest-value
functional gaps, and turns ad hoc findings into durable roadmap and solution
artifacts.

## Entry Points — Read These First

1. `apps/admin/AGENTS.md`
2. `apps/admin/CLAUDE.md`
3. `apps/admin/docs/v1-operational-surfaces.md`
4. `docs/roadmap/platform/feat-086-admin-app-graphql-postgres-foundation.md`
5. `docs/roadmap/platform/feat-091-admin-dashboard-ui.md`
6. `docs/roadmap/platform/feat-092-admin-experience-embedding-workflow.md`
7. `docs/roadmap/platform/feat-093-admin-app-sync-hardening-and-rate-limit.md`
8. `docs/roadmap/platform/feat-097-admin-v1-pr-hardening.md`
9. `docs/plans/2026-04-14-003-admin-cms-expansion-loop-plan.md`

## Grep These

- `TODO|todo|test.todo|placeholder|coming soon` in `apps/admin/src`
- `createServices|ExperienceService|VideoService` in `apps/admin/src`
- `builder.queryFields|builder.mutationFields` in `apps/admin/src/graphql`
- `requireSession|hasPermission|canEdit` in `apps/admin/src`
- `content_revision|sync_state|sync_locks|experience_locale|video_locale` in `apps/admin/prisma/schema.prisma`

## What To Build

1. Run a compound loop over the admin app: review the current surface, identify
   the highest-value missing CMS capabilities, implement bounded improvements,
   and record the learnings.
2. Prioritize work that makes the admin app feel more like a real CMS and less
   like an operational shell:
   - richer editorial CRUD flows
   - revision history visibility
   - sync/workflow observability
   - safer operator actions
   - search and embedding ergonomics
3. Create follow-up roadmap tickets whenever the branch discovers work that is
   too large or too separate to absorb cleanly.
4. Add or update `docs/solutions/` entries when the branch lands a reusable
   pattern worth carrying forward.

## Constraints

- Keep the branch scoped to `apps/admin` plus the docs that support that work.
- Do not regress the v1 validation baseline.
- Preserve the existing architectural boundary: UI -> GraphQL/services -> Prisma.
- Any new CMS capability should be documented as either operational in-branch
  or explicitly deferred into a follow-up roadmap ticket.

## Verification

- `pnpm --filter @forge/admin typecheck`
- `pnpm --filter @forge/admin test`
- `pnpm --filter @forge/admin lint`
- `pnpm --filter @forge/admin build`
- New follow-up work identified during the loop is represented in roadmap files.
