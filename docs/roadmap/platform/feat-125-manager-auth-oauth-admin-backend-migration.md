---
id: "feat-125"
title: "Manager Auth OAuth and Admin Backend Migration"
owner: "vlad"
priority: "P0"
status: "in-progress"
start_date: "2026-05-20"
duration: 5
depends_on:
  - "feat-121"
blocks: []
tags:
  - "manager"
  - "auth"
  - "oauth"
  - "admin"
  - "migration"
---

## Problem

Manager needs to move from Strapi-backed human panel auth to the standalone
Jesus Film Auth authority while preserving the still-valid Admin-backed Manager
read/job contracts from PR #895. The old Manager Admin backend roadmap origin
no longer exists, and platform `feat-120` is already a different SDL/runtime
follow-up.

This ticket is the authoritative roadmap origin for
`docs/plans/2026-05-20-003-feat-manager-auth-oauth-migration-plan.md`.

## Scope

1. Register Manager as its own first-party Auth OAuth client with Manager
   callback/logout origins and a Manager access scope.
2. Replace Manager credential/Strapi panel login with Auth authorization-code
   - PKCE and a Manager-local session cookie.
3. Add Admin-owned `ManagerMembership` / `ManagerRole.OPERATOR` authorization
   and keep Admin editorial roles from implying Manager access.
4. Preserve Admin-backed Manager read/job GraphQL contracts where PR #895 is
   still valid, while removing stale Admin-hosted Better Auth assumptions.
5. Reconcile generated Admin GraphQL artifacts and Manager Admin-backend
   adapter contracts in the same implementation slice.

## Rollout Guards

Admin-backed Manager mode must not become authoritative just because empty
Admin tables exist.

1. Do not enable `MANAGER_BACKEND_MODE=admin` for production/stage Manager
   traffic until coverage snapshots have one of these explicit data-readiness
   paths:
   - a live Admin writer that continuously writes the authoritative coverage
     snapshot rows Manager needs,
   - a verified backfill from the current Strapi/CMS source of truth into the
     Admin coverage snapshot tables, or
   - an explicit fallback that reads the legacy source when Admin coverage rows
     are absent, with logs/metrics showing fallback use during rollout.
2. Job-state cutover must declare and test one of these semantics before Admin
   job tables are treated as authoritative:
   - backfill existing in-flight and recent legacy Manager jobs into Admin,
   - dual-write new jobs to legacy and Admin stores until rollback is no longer
     needed,
   - dual-read Admin first and legacy second during the canary, or
   - an accepted fresh-start cutover. Fresh-start is only valid if the PR and
     rollout notes state that old legacy jobs disappear from the Admin-backed
     view, rollback returns to the legacy view, and operators understand that
     in-flight Admin-only jobs may be lost or need manual reconciliation.
3. Rollout must be flag-gated per environment. Keep the legacy backend path
   available until the operator OAuth smoke and data-readiness checks pass.
4. Rollback must clear or ignore any Admin-only partial job state that would
   confuse operators after returning Manager to the legacy backend path.

## Required Validation Before Completion

- Targeted Auth tests for Manager client/scope seeding.
- Targeted Admin tests for Manager membership permissions and Manager GraphQL
  schema/read/job contracts.
- Targeted Manager tests for OAuth login/callback/logout, local session guards,
  legacy `strapi-jwt` denial, Admin backend adapter behavior, and fallback or
  cutover semantics chosen above.
- User-facing OAuth smoke proof in local production mode, stage, or preview:
  an active `OPERATOR` reaches Manager dashboard, a registered non-member is
  denied, and legacy `strapi-jwt` alone is denied.
- Data-readiness smoke proof for coverage snapshots and job cutover semantics
  before enabling Admin-backed Manager mode outside a local/dev canary.

## References

- `docs/plans/2026-05-20-003-feat-manager-auth-oauth-migration-plan.md`
- `docs/plans/2026-05-11-001-jesus-film-auth-platform-plan.md`
- `docs/roadmap/platform/feat-121-jesus-film-auth-platform.md`
- PR #895: Manager Admin backend migration
- PR #919: Manager membership authorization
