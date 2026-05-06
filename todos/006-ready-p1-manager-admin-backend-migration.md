---
status: ready
priority: p1
issue_id: "006"
tags: [manager, admin, cms, migration, auth, graphql]
dependencies: []
---

# Manager Admin Backend Migration

## Problem Statement

`apps/manager` still depends on Strapi for production auth, read models,
coverage snapshots, job state, and some enrichment writeback paths. Strapi is
being retired and `apps/admin` is the new backend platform, but Admin does not
yet expose every Manager-shaped contract needed for a safe cutover.

## Findings

- The implementation plan is
  `docs/plans/2026-05-06-001-feat-manager-admin-backend-migration-plan.md`.
- The roadmap ticket is
  `docs/roadmap/platform/feat-120-manager-admin-backend-migration.md`.
- Manager's existing migration seam is `apps/manager/src/cms/gateway.ts`, but
  live mode still delegates to Strapi-shaped auth and data calls.
- Admin has real Yoga/Pothos/Prisma/Better Auth foundations and existing
  Manager-to-Admin embed trigger proxies, but is not yet a drop-in Manager
  backend.
- Red/Green TDD is required. Add failing characterization/contract tests before
  moving each backend seam.
- User-like browser smoke is required before PR handoff.

## Proposed Solutions

1. **Contract-first migration through Admin GraphQL**
   - Pros: aligns with Admin's platform direction; keeps Manager routes stable;
     avoids cross-app DB imports.
   - Cons: requires adding several Admin contracts before Manager can cut over.

2. **Direct Admin database access from Manager**
   - Pros: faster initial implementation.
   - Cons: violates Admin architecture and cross-app boundaries; rejected.

3. **Keep Strapi fallback indefinitely**
   - Pros: lower short-term cutover risk.
   - Cons: fails the retirement goal and hides production dependency; rejected
     except as a temporary migration comparison mode.

## Recommended Action

Execute the plan with Red/Green TDD:

1. Characterize Manager's existing browser-facing backend contracts.
2. Add Admin Manager session/read/job contracts.
3. Add a Manager Admin backend adapter and switch Manager routes.
4. Move writeback paths off CMS.
5. Validate with tests plus user-like browser smoke.
6. If validation exposes follow-up issues that cannot be completed in this
   pass, document them as new todos and relaunch `workflows-work` for the
   surfaced todo.

## Acceptance Criteria

- [ ] Manager production/admin mode boots without `STRAPI_*` env vars.
- [ ] Manager login/session validation uses Admin-owned auth contracts.
- [ ] `/api/videos`, `/api/languages`, `/api/coverage-snapshots`, and job
      routes preserve Manager-visible response contracts.
- [ ] Admin owns Manager read/job contracts through services + GraphQL.
- [ ] Manager writeback paths no longer call Strapi/CMS in admin mode.
- [ ] Manager mock mode remains available and honest.
- [ ] Relevant Admin and Manager tests pass.
- [ ] User-like browser smoke proves login/dashboard/coverage/jobs with Admin
      backend mode.
- [ ] PR description includes Post-Deploy Monitoring & Validation.

## Work Log

### 2026-05-06 - Work Started

**By:** Codex

**Actions:**
- Created branch `feat/120-manager-admin-backend-migration`.
- Created execution todo from the approved plan and roadmap ticket.

**Learnings:**
- The worktree already contained the active plan/roadmap docs, so this branch
  continues from that state rather than creating a second worktree.
