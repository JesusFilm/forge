---
title: "feat: Admin user app access dropdowns"
type: feat
status: completed
date: 2026-06-05
origin: docs/roadmap/platform/feat-160-admin-user-app-access-dropdowns.md
---

# feat: Admin user app access dropdowns

## Summary

Reshape the Admin Users table Product Access column into one dropdown role
selector per first-party Auth app. Manager remains the only backed product
grant in this slice; Admin and Mastra Studio render as disabled controls that
make the future access-control model visible without pretending persistence
exists.

---

## Problem Frame

The first Manager access slice made `/dashboard/users` operational for
granting and revoking Manager membership, but the UI still reads as a
Manager-specific patch. Operators now need to see the intended per-app access
model on the same table while the backend remains intentionally limited to
existing persisted grants.

---

## Requirements

- R1. Each Users table row renders separate Product Access controls for Admin,
  Manager, and Mastra Studio.
- R2. Each Product Access control uses a dropdown role-selection shape rather
  than a standalone status pill plus separate grant button.
- R3. Manager remains backed by existing persisted access behavior: enabled
  Manager access maps to the existing active Manager membership, and disabling
  Manager access revokes that membership.
- R4. Admin and Mastra Studio controls render disabled/mock-only until a backed
  authorization model exists for those apps.
- R5. Existing Admin role approval controls and row status behavior remain
  unchanged.
- R6. The UI clearly distinguishes disabled/mock product controls from backed,
  actionable controls.

---

## Scope Boundaries

- Do not add a generic app-grant table or service.
- Do not add persisted Admin or Mastra Studio product grants.
- Do not change OAuth client registration, scopes, consent, session validation,
  or login behavior.
- Do not redesign the entire Users page beyond the Product Access column.

### Deferred to Follow-Up Work

- Generic persisted first-party app grants: separate product/data-model slice.
- Product-specific Mastra Studio access enforcement: separate authorization
  model and gateway validation slice.

---

## Context & Research

### Relevant Code and Patterns

- `apps/admin/src/app/dashboard/users/page.tsx` already renders the Users table
  and uses server actions plus `revalidatePath("/dashboard/users")` for role
  and Manager access changes.
- `apps/admin/src/app/dashboard/ops-data.ts` shapes `UsersData.rows` and now
  treats Product Access as a required row contract.
- `apps/admin/src/services/user-access.service.ts` owns the Manager access
  grant/revoke behavior and should remain the write boundary.
- `apps/auth/src/domain/apps.ts` defines the first-party Auth apps: Admin,
  Manager, and Mastra Studio.
- `apps/admin/src/app/dashboard/dashboard-ui.test.tsx` covers server-rendered
  Users page HTML and is the right first test for the visible table contract.

### Institutional Learnings

- Admin Users access-control writes should keep using the service boundary that
  rechecks current permissions before mutating persisted Manager access.
- Optional product access data should degrade gracefully instead of making the
  Users table disappear when an optional grant surface is missing.

### External References

- Not used. Local patterns are direct and sufficient for this UI-only follow-up.

---

## Key Technical Decisions

- Keep Manager as the only actionable product grant: this preserves the
  existing persisted authorization boundary and avoids inventing storage for
  unsupported products.
- Model Product Access rows as app controls, not generic status badges: this
  matches the requested table shape and keeps future products visually
  discoverable.
- Use disabled dropdowns for unsupported apps: operators can see the intended
  role-control surface without being able to submit changes that would not be
  saved.

---

## Open Questions

### Resolved During Planning

- Should this slice add a generic app-grant backend? No. The user selected the
  UI-only mock path for apps without persisted grants.

### Deferred to Implementation

- Exact dropdown styling: use existing Admin table, form, and status styles;
  adjust only as needed for legibility and responsive fit.

---

## Implementation Units

### U1. Product Access Row Contract

**Goal:** Expand the Users row Product Access model from a Manager-only item
into app-specific controls for Admin, Manager, and Mastra Studio.

**Requirements:** R1, R3, R4, R6

**Dependencies:** None

**Files:**

- Modify: `apps/admin/src/app/dashboard/ops-data.ts`
- Test: `apps/admin/src/app/dashboard/dashboard-ui.test.tsx`

**Approach:**

- Extend the Product Access row shape so each item can describe app key, label,
  current role/status, selectable role options, disabled/mock state, and whether
  the control is backed by a write action.
- Keep Manager active/inactive state derived from `managerMembership` exactly as
  it is today.
- Add Admin and Mastra Studio row items with disabled/mock role-selection state
  and no backing action.

**Patterns to follow:**

- Existing `productAccess` array shape in `apps/admin/src/app/dashboard/ops-data.ts`.
- First-party app labels from `apps/auth/src/domain/apps.ts`.

**Test scenarios:**

- Happy path: a row with active Manager membership maps to an enabled Manager
  control with the Operator role selected.
- Edge case: a row without active Manager membership maps to a Manager control
  representing no access.
- Happy path: Admin and Mastra Studio controls are present for every row and
  marked disabled/mock-only.

**Verification:**

- Users page render fixtures compile against the expanded row contract.

### U2. Dropdown Product Access UI

**Goal:** Replace Manager-specific Product Access pills/buttons with compact
per-app dropdown role controls in the Users table.

**Requirements:** R1, R2, R3, R4, R5, R6

**Dependencies:** U1

**Files:**

- Modify: `apps/admin/src/app/dashboard/users/page.tsx`
- Test: `apps/admin/src/app/dashboard/dashboard-ui.test.tsx`

**Approach:**

- Render each product access item as a labeled dropdown control inside the
  Product Access cell.
- For Manager, submit dropdown changes through the existing grant/revoke server
  actions when the selected role changes between no access and Operator.
- For Admin and Mastra Studio, render disabled dropdowns with helper state that
  makes the lack of persistence explicit.
- Preserve the existing Principal, Status, and Updated cells and the existing
  Admin role approval forms.

**Patterns to follow:**

- Existing server actions in `apps/admin/src/app/dashboard/users/page.tsx`.
- Existing status/form styling from the Users page and Admin global styles.

**Test scenarios:**

- Happy path: rendered Users page contains Admin, Manager, and Mastra Studio
  product controls.
- Happy path: active Manager row renders the Manager dropdown with Operator
  selected and a backed form target.
- Edge case: inactive Manager row renders the Manager dropdown with No Access
  selected and a backed form target.
- Error path: unsupported product controls are disabled and do not render write
  targets.
- Regression: existing Approve Editor/Admin role actions still render for
  Viewer rows.

**Verification:**

- Server-rendered Users page HTML proves the per-app dropdown contract and
  existing role-approval controls remain present.

### U3. Validation and Ticket Closure

**Goal:** Prove the UI-only slice is coherent, typed, lint-clean, and tracked.

**Requirements:** R1, R2, R3, R4, R5, R6

**Dependencies:** U1, U2

**Files:**

- Modify: `docs/roadmap/platform/feat-160-admin-user-app-access-dropdowns.md`
- Test: `apps/admin/src/app/dashboard/dashboard-ui.test.tsx`

**Approach:**

- Run targeted dashboard render coverage first, then typecheck, lint, and diff
  hygiene.
- Mark the roadmap ticket complete only after validation passes.

**Patterns to follow:**

- Verification command set from the existing Admin Users access-control ticket.

**Test scenarios:**

- Test expectation: none beyond U1/U2 feature coverage; this unit is tracking
  and validation.

**Verification:**

- Targeted render test, typecheck, lint, and diff whitespace checks pass.
- Roadmap ticket status is complete.

---

## System-Wide Impact

- **Interaction graph:** Users page server actions continue to be the only
  write path from the table; Manager writes stay behind `user-access.service`.
- **Error propagation:** Existing Manager grant/revoke error behavior remains
  unchanged.
- **State lifecycle risks:** Unsupported product dropdowns must not create
  partially saved UI state.
- **API surface parity:** No GraphQL, Auth, OAuth, or session API surface is
  changed in this slice.
- **Integration coverage:** Server-rendered Users page coverage should prove
  the visible row contract; browser proof should verify layout fit.
- **Unchanged invariants:** Admin roles do not imply Manager access, and
  Manager access still depends on explicit active Manager membership.

---

## Risks & Dependencies

| Risk                                                                 | Mitigation                                                                    |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Operators think disabled product controls are saved grants           | Render unsupported controls disabled with explicit mock/unavailable state.    |
| Manager dropdown accidentally bypasses the hardened service boundary | Reuse existing server actions and service calls for Manager access writes.    |
| Product Access column becomes cramped                                | Use compact stacked controls and browser-proof the table at the target route. |

---

## Documentation / Operational Notes

- No operator runbook change is needed for this UI-only slice.
- Follow-up backend grant work should create a new roadmap ticket rather than
  expanding this PR.

---

## Sources & References

- Origin ticket: `docs/roadmap/platform/feat-160-admin-user-app-access-dropdowns.md`
- Prior ticket: `docs/roadmap/platform/feat-159-admin-user-product-access-grants.md`
- Prior plan: `docs/plans/2026-06-04-003-feat-admin-user-product-access-grants-plan.md`
- Related code: `apps/admin/src/app/dashboard/users/page.tsx`
- Related code: `apps/admin/src/app/dashboard/ops-data.ts`
- Related code: `apps/admin/src/services/user-access.service.ts`
- Related code: `apps/auth/src/domain/apps.ts`
