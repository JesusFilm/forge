---
title: "feat: Admin user product access grants"
type: feat
status: completed
date: 2026-06-04
origin: docs/roadmap/platform/feat-159-admin-user-product-access-grants.md
---

# feat: Admin user product access grants

## Problem Frame

`/dashboard/users` can approve Admin roles, but Manager access is now a
separate Admin-owned grant (`ManagerMembership`). Operators need to see and
toggle product access from the same user-management surface instead of running
`apps/admin/src/scripts/grant-manager-operator.ts` manually.

## Scope

- In scope: add Manager product access status and grant/revoke actions to the
  Admin Users page.
- In scope: shape the page data as product grants so future products can join
  the same UI pattern.
- Out of scope: adding new product grant database models for products other
  than Manager.
- Out of scope: a full role-management product matrix or audit trail.

## Requirements

1. Users page rows show whether a user has active Manager access.
2. Admin operators can grant Manager operator access from the row.
3. Admin operators can revoke Manager operator access from the row.
4. Existing Admin role approval behavior remains unchanged.
5. The data/UI names product access generically enough to extend later, while
   only Manager is actionable in this slice.

## Existing Patterns

- `apps/admin/src/app/dashboard/users/page.tsx` already uses server actions
  and `revalidatePath("/dashboard/users")` for role approvals.
- `apps/admin/src/app/dashboard/ops-data.ts` returns `UsersData.rows` consumed
  by the Users table.
- `apps/admin/src/scripts/grant-manager-operator.ts` grants by upserting
  `managerMembership` with `role: "OPERATOR"` and `revokedAt: null`.
- `apps/admin/src/app/api/manager/session/route.ts` treats access as active
  when `managerMembership` exists and `revokedAt` is null.

## Implementation Units

### Unit 1 - Users Data Shape

Files:

- `apps/admin/src/app/dashboard/ops-data.ts`

Plan:

- Extend the private `TableRow` shape with an optional `productAccess` array.
- Select `managerMembership.role` and `managerMembership.revokedAt` in
  `loadUsersData()`.
- Map each row to a Manager product access item with active/inactive status,
  role label, and tone.

Tests:

- Existing Users page render coverage in
  `apps/admin/src/app/dashboard/dashboard-ui.test.tsx` should keep compiling
  against the updated row shape.

### Unit 2 - Users Page Product Actions

Files:

- `apps/admin/src/app/dashboard/users/page.tsx`

Plan:

- Add `grantManagerAccess` and `revokeManagerAccess` server actions.
- Require `requireAdminSession()` and return early unless the operator role is
  `ADMIN`.
- Grant via `prisma.managerMembership.upsert()`.
- Revoke by setting `revokedAt` to the current time when a row exists.
- Add a "Product Access" table column that renders product grant pills and
  action buttons.

Tests:

- Add or update Users page render assertions in
  `apps/admin/src/app/dashboard/dashboard-ui.test.tsx` to verify the Manager
  product access column and grant/revoke labels render.

### Unit 3 - Roadmap Traceability

Files:

- `docs/roadmap/platform/feat-159-admin-user-product-access-grants.md`

Plan:

- Mark the ticket complete once implementation and validation pass.

## Risk Notes

- Revocation should not delete historical membership rows; `revokedAt` keeps
  the existing validation behavior and allows re-grant via upsert.
- The first slice should not pretend other products are grantable until their
  authorization models exist.
