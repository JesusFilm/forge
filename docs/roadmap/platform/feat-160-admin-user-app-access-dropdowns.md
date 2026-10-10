---
id: "feat-160"
title: "Admin user app access dropdowns"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-06-05"
duration: 1
depends_on:
  - "feat-159"
blocks:
  - "feat-179"
tags:
  - "platform"
  - "admin"
  - "auth"
  - "access-control"
---

## Problem

The Admin Users table now exposes Manager access, but the Product Access column
still behaves like a one-off Manager control. Operators need to see the intended
per-Auth-app access-control shape directly in the table, with each first-party
app represented by its own dropdown role selector.

This follow-up is intentionally UI-only for products without a persisted grant
model. Manager keeps the existing backed access behavior; Admin and Mastra
Studio are visible as disabled controls until their authorization models exist.

## Entry Points - Read These First

1. `apps/admin/src/app/dashboard/users/page.tsx` - Users screen, Product Access
   column, and server actions.
2. `apps/admin/src/app/dashboard/ops-data.ts` - Users page data loader and row
   access model.
3. `apps/admin/src/app/dashboard/dashboard-ui.test.tsx` - server-rendered Users
   page coverage.
4. `apps/auth/src/domain/apps.ts` - first-party Auth app catalog reference.

## What To Build

1. Render one access-control dropdown per first-party Auth app in each Users
   table row.
2. Keep Manager backed by the existing grant/revoke server actions and
   `ManagerMembership`.
3. Show Admin and Mastra Studio as disabled/mock controls so operators can see
   the intended control shape without implying a saved grant.
4. Preserve existing Admin role approval behavior and Manager access semantics.

## Constraints

- Do not create a generic app-grant database model in this slice.
- Do not wire persisted Admin or Mastra Studio grants in this slice.
- Do not change OAuth client registration, scopes, or login behavior.
- Keep the change local to the Admin Users table and row data contract.

## Verification

- `pnpm --filter @forge/admin test -- src/app/dashboard/dashboard-ui.test.tsx`
- `pnpm --filter @forge/admin typecheck`
- `pnpm --filter @forge/admin lint`
- `git diff --check`
