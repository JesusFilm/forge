---
id: "feat-097"
title: "Admin App V1 PR Hardening and Operational Surfaces"
owner: "tataihono"
priority: "P0"
status: "complete"
start_date: "2026-04-14"
duration: 1
depends_on:
  - "feat-086"
  - "feat-091"
  - "feat-092"
  - "feat-093"
blocks: []
tags:
  - "platform"
  - "admin"
  - "ui"
  - "docs"
  - "operations"
---

## Problem

The admin branch was close to a final PR, but it still had release blockers and
operator-visible placeholders: typed-route failures in the dashboard nav,
duplicate roadmap IDs, and multiple admin routes rendered through shared stub
surfaces instead of live operational views.

## Entry Points — Read These First

1. `apps/admin/src/components/admin-nav.ts`
2. `apps/admin/src/components/admin-shell.tsx`
3. `apps/admin/src/app/dashboard/ops-data.ts`
4. `apps/admin/src/app/dashboard/`
5. `apps/admin/CLAUDE.md`
6. `apps/admin/docs/v1-operational-surfaces.md`
7. `docs/roadmap/platform/feat-091-admin-dashboard-ui.md`
8. `docs/roadmap/platform/feat-093-admin-app-sync-hardening-and-rate-limit.md`

## Grep These

- `AdminStubPage|PremiumStubPage|premiumStubLabel` in `apps/admin/src/`
- `typedRoutes|href: Route|href: string` in `apps/admin/src/components/`
- `load.*Data|runSemanticSearch` in `apps/admin/src/app/dashboard/`
- `feat-091|feat-093|feat-097` in `docs/roadmap/platform/`

## What To Build

1. Remove the remaining stub-route behavior from the admin dashboard and replace
   it with operational read or action surfaces backed by current schema and env.
2. Fix typed-route compilation without weakening the dashboard shell behavior.
3. Update docs so the branch clearly states what is live in v1, what is read
   only, and how operators validate the system.
4. Re-run the admin validation suite (`typecheck`, `test`, `lint`, `build`)
   before treating the branch as the final PR candidate.

## Constraints

- Keep scope inside `apps/admin` and admin-specific docs for this PR-hardening pass.
- Do not revert unrelated repo changes outside the admin scope.
- Do not add new runtime dependencies for the hardening pass.

## Verification

- `pnpm --filter @forge/admin typecheck`
- `pnpm --filter @forge/admin test`
- `pnpm --filter @forge/admin lint`
- `pnpm --filter @forge/admin build`
- `/dashboard/*` renders without stub framing and shows real operational data or
  deliberate empty states.
