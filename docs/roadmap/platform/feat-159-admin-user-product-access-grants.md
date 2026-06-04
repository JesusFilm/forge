---
id: "feat-159"
title: "Admin user product access grants"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-06-04"
duration: 1
depends_on:
  - "feat-125"
blocks: []
tags:
  - "platform"
  - "admin"
  - "auth"
  - "manager"
  - "access-control"
---

## Problem

Operators can approve Admin roles from `/dashboard/users`, but Manager access is
now controlled by an explicit Admin-owned `ManagerMembership`. Without a UI,
operators have to run a production script to grant Manager access, and the
Users page does not show which products a user can open.

## Entry Points - Read These First

1. `apps/admin/src/app/dashboard/users/page.tsx` - Users screen and server
   actions.
2. `apps/admin/src/app/dashboard/ops-data.ts` - Users page data loader.
3. `apps/admin/prisma/schema.prisma` - `ManagerMembership` and future product
   grant model reference.
4. `apps/admin/src/app/api/manager/session/route.ts` - production Manager
   access validation path.

## What To Build

1. Add product-access controls to the Users page.
2. Show Manager access state for each listed user.
3. Allow Admin operators to grant and revoke Manager operator access.
4. Keep the UI shape ready for additional products without inventing new
   database models before those products have grant tables.

## Constraints

- Do not make Admin roles imply Manager access.
- Do not create access grants for products that do not yet have a persisted
  authorization model.
- Do not expose this control to non-Admin dashboard users.
- Keep the change local to the Admin Users page and existing
  `ManagerMembership` model.

## Verification

- `pnpm --filter @forge/admin test -- src/app/dashboard/dashboard-ui.test.tsx`
- `pnpm --filter @forge/admin typecheck`
- `pnpm --filter @forge/admin lint`
- `git diff --check`
