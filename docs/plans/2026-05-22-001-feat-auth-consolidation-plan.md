---
title: "feat: Consolidate Auth surfaces across apps"
type: feat
status: active
date: 2026-05-22
origin: docs/roadmap/platform/feat-132-auth-consolidation-across-apps.md
---

# feat: Consolidate Auth surfaces across apps

## Summary

Move the repo from "Auth platform exists" to "auth surfaces are intentionally
owned." Admin and Manager should keep the human OAuth pattern, Strapi should not
be modernized into an Auth relying client, and service credentials should be
inventoried before any conversion. The first conversion slice is deliberately
narrow: Manager's service call to Admin's Manager session validation contract.

## Problem Frame

`apps/auth` is now the standalone identity and app-grant authority. `apps/admin`
and `apps/manager` are the human-app relying clients. The remaining risk is a
mixed auth map: local sessions, Strapi-era cookies, internal env bearers,
rate-limit-only consumer bearers, Manager backend bearers, and future Auth
service tokens all coexist.

This plan consolidates that map without pulling Strapi deeper into the system.
`apps/cms` stays on its current Strapi auth until the separate Strapi sunset
track removes the dependency.

## Requirements Traceability

- Human OAuth app login: R1-R5 from `docs/brainstorms/2026-05-22-auth-consolidation-requirements.md`
- Auth scopes vs app-local authorization: R6-R10
- Service credential inventory and conversion posture: R11-R14a
- Strapi auth non-goal: R15-R18
- Operational visibility and secret hygiene: R19-R21

## Context And Patterns

- `apps/auth/src/domain/apps.ts` already seeds Admin and Manager as first-party
  OAuth clients.
- `apps/auth/src/domain/scopes.ts` currently includes human app scopes such as
  `admin:access` and `manager:access`, plus `tokens:manage`.
- `apps/auth/src/services/token-policy.service.ts` already models
  `client_credentials`, audience, environment, expiry, and granted scopes.
- `apps/admin/src/graphql/context.ts` currently resolves request identity in a
  chain: session -> workflow bearer -> manager bearer -> consumer bearer ->
  public.
- `apps/admin/src/auth/manager-bearer.ts` validates `MANAGER_ADMIN_API_KEY`.
- `apps/manager/src/lib/admin-manager-session.ts` sends
  `ADMIN_MANAGER_API_KEY` to Admin's `/api/manager/session`.
- `docs/solutions/architecture-patterns/db-backed-vs-env-csv-credential-storage-20260518.md`
  says internal env-CSV bearers can remain when the caller set is bounded and
  the threat model does not require per-key metadata or sub-second revocation.
- `docs/solutions/architecture-patterns/bearer-as-passport-multi-csv-composition-20260518.md`
  says known-caller bearers can be composed only when the gate is a passport,
  not a capability.

External research is not needed for this plan. The repo has recent, specific
Auth/OAuth, bearer, token-policy, and deployment-ordering patterns to follow.

## Key Decisions

- **Start with inventory:** Without a complete auth surface map, a blanket
  migration risks deleting useful internal bearers or missing Strapi-dependent
  artifacts.
- **Convert one service surface first:** Manager -> Admin session validation is
  narrow, human-adjacent, and already has a single receiver endpoint. It is a
  good proof of Auth-issued service credentials without touching every internal
  workflow key.
- **Dual-accept during rollout:** Admin should accept both the existing
  Manager bearer and the new Auth-issued credential until staged smoke passes.
- **Do not touch Strapi auth:** Strapi auth disappears through Strapi sunset,
  not by teaching Strapi the new Auth model.

## Implementation Units

### U1. Auth Surface Inventory

**Goal:** Create the repo-wide inventory required before any broad auth
consolidation.

**Requirements:** R11, R13, R15-R18, R19

**Files:**

- Create: `docs/auth-consolidation/surface-inventory.md`
- Read: `apps/auth/src/domain/scopes.ts`
- Read: `apps/auth/src/domain/apps.ts`
- Read: `apps/admin/src/config/env.ts`
- Read: `apps/admin/src/graphql/context.ts`
- Read: `apps/manager/src/config/env.ts`
- Read: `apps/manager/src/lib/auth.ts`
- Read: `apps/web/CLAUDE.md`
- Read: `apps/mobile/CLAUDE.md`
- Read: `apps/tv/CLAUDE.md`
- Read: `apps/cms/CLAUDE.md`

**Approach:**

- Inventory human session cookies, OAuth state cookies, legacy cookies,
  bearer env vars, public/mobile Strapi tokens, Auth scopes, and service-token
  policy surfaces.
- For each surface, record owner app, caller, receiver, credential kind,
  principal minted, permissions granted, environment scope, logs/audit posture,
  and disposition.
- Dispositions: keep as-is, convert to Auth-issued service credential, replace
  with another app contract, or delete during Strapi sunset.
- Explicitly label all `apps/cms` auth surfaces as out of Auth-consolidation
  scope unless another app stops depending on them.

**Test scenarios:**

- Documentation check: every grep pattern in the roadmap ticket has at least
  one row in the inventory or an explicit "no live surface found" note.
- Security check: no raw secret values are included in the document.
- Scope check: no row proposes changing Strapi/CMS authentication.

**Verification:**

- Inventory covers Admin, Manager, Web, Mobile, TV, CMS, scripts, and CI.
- Inventory includes a first-slice conversion recommendation.

### U2. Human Auth Boundary Verification

**Goal:** Prove Admin and Manager human access follow Auth OAuth with app-local
sessions and no Strapi-cookie fallback.

**Requirements:** R1-R10

**Dependencies:** U1 and completion of the relevant pieces of
`docs/plans/2026-05-20-003-feat-manager-auth-oauth-migration-plan.md`.

**Files:**

- Read/Modify as needed: `apps/admin/src/app/api/auth/login/route.ts`
- Read/Modify as needed: `apps/admin/src/app/api/auth/callback/route.ts`
- Read/Modify as needed: `apps/admin/src/auth/session.ts`
- Read/Modify as needed: `apps/manager/src/app/api/auth/login/route.ts`
- Read/Modify as needed: `apps/manager/src/app/api/auth/callback/route.ts`
- Read/Modify as needed: `apps/manager/src/app/api/auth/logout/route.ts`
- Read/Modify as needed: `apps/manager/src/lib/auth.ts`
- Read/Modify as needed: `apps/manager/src/middleware.ts`
- Test: `apps/admin/src/app/api/auth/login/route.test.ts`
- Test: `apps/admin/src/app/api/auth/callback/route.test.ts`
- Test: `apps/manager/src/app/api/auth/login/route.test.ts`
- Test: `apps/manager/src/app/api/auth/callback/route.test.ts`
- Test: `apps/manager/src/lib/auth.test.ts`

**Approach:**

- Treat this as a verification and hardening unit, not a second Manager OAuth
  migration plan.
- Confirm Admin uses Auth OAuth and Admin-local session state.
- Confirm Manager uses Auth OAuth and Manager-local session state.
- Ensure `strapi-jwt` alone cannot authenticate Manager dashboard or Manager
  API routes that require human operator access.
- Keep `MANAGER_DATA_MODE=mock` behavior test-only/demo-only and ensure it does
  not weaken production auth.

**Test scenarios:**

- Admin login redirects to Auth and sets only Admin-local OAuth state.
- Admin callback with valid Auth token creates an Admin-local session.
- Manager login redirects to Auth and requests Manager scope.
- Manager callback with valid Auth token plus active Manager membership creates
  a Manager-local session.
- Manager request with only `strapi-jwt` is rejected.
- Admin `ADMIN` role without Manager membership cannot satisfy Manager access.

**Verification:**

- `pnpm --filter @forge/admin test -- auth`
- `pnpm --filter @forge/manager test -- auth`

### U3. Auth-Issued Credential For Manager Session Validation

**Goal:** Add a dual-accept path where Admin's Manager session validation
endpoint can accept an Auth-issued service credential from Manager.

**Requirements:** R11-R14a, R20-R21

**Dependencies:** U1

**Files:**

- Modify: `apps/auth/src/domain/scopes.ts`
- Modify: `apps/auth/src/services/token-policy.service.ts`
- Modify: `apps/auth/src/scripts/seed-first-party-apps.ts`
- Modify/Create: `apps/auth/src/services/token-policy.service.test.ts`
- Modify/Create: `apps/auth/src/scripts/seed-first-party-apps.test.ts`
- Modify/Create: `apps/admin/src/auth/auth-service-token.ts`
- Modify: `apps/admin/src/app/api/manager/session/route.ts`
- Modify/Create: `apps/admin/src/app/api/manager/session/route.test.ts`
- Modify: `apps/manager/src/lib/admin-manager-session.ts`
- Modify/Create: `apps/manager/src/lib/admin-manager-session.test.ts`
- Modify: `apps/admin/src/config/env.ts`
- Modify: `apps/manager/src/config/env.ts`
- Modify: `apps/admin/.env.example`
- Modify: `apps/manager/.env.example`

**Approach:**

- Add a Manager -> Admin service scope such as
  `admin:manager-session:validate`.
- Seed the Manager first-party app/environment with the approved
  client-credentials scope for Admin as audience.
- Add an Admin receiver validator that accepts Auth-issued credentials only
  when issuer, audience, environment, scope, expiry, and revocation posture are
  valid.
- Keep the existing `MANAGER_ADMIN_API_KEY` receiver path as a dual-accept
  fallback during rollout.
- Update Manager's caller helper to prefer the Auth-issued credential when
  configured, falling back to `ADMIN_MANAGER_API_KEY` until cutover.
- Do not let this service credential mint human sessions or satisfy
  `access:manager`.

**Test scenarios:**

- Auth policy accepts Manager client credentials for Admin audience with the
  approved service scope.
- Auth policy rejects production audience from non-production environment.
- Admin `/api/manager/session` accepts the Auth-issued credential.
- Admin rejects wrong issuer, wrong audience, wrong environment, missing
  scope, expired token, and revoked token.
- Admin still accepts `MANAGER_ADMIN_API_KEY` during dual-accept mode.
- Manager caller prefers Auth-issued credential when configured.
- Manager caller falls back to the existing bearer when Auth credential config
  is missing.

**Verification:**

- `pnpm --filter @forge/auth test`
- `pnpm --filter @forge/admin test -- manager/session`
- `pnpm --filter @forge/manager test -- admin-manager-session`

### U4. Rollout, Cutover, And Bearer Disposition

**Goal:** Move the first service credential conversion through receiver-first
rollout and decide which remaining internal bearers stay local.

**Requirements:** R11-R14a, R19-R21

**Dependencies:** U3

**Files:**

- Modify: `docs/auth-consolidation/surface-inventory.md`
- Modify: `apps/admin/CLAUDE.md`
- Modify: `apps/manager/CLAUDE.md`
- Modify: `apps/auth/CLAUDE.md`
- Modify as needed after smoke: `apps/admin/src/auth/manager-bearer.ts`
- Modify as needed after smoke: `apps/admin/src/config/env.ts`
- Modify as needed after smoke: `apps/admin/.env.example`
- Modify as needed after smoke: `apps/manager/src/config/env.ts`
- Modify as needed after smoke: `apps/manager/.env.example`

**Approach:**

- Document receiver-first ordering: deploy Admin accepting the Auth-issued
  credential before Manager sends it.
- Run local/stage/preview smoke for Manager dashboard access and Admin Manager
  session validation.
- After smoke, either remove the legacy Manager/Admin bearer or record why it
  remains.
- Classify remaining internal bearers using the existing decision matrix:
  `WORKFLOW_API_KEYS`, `WEB_ADMIN_API_KEYS`, `BACKUP_DOWNLOAD_API_KEYS`,
  `ADMIN_TRIGGER_API_KEYS`, `MANAGER_TRIGGER_API_KEY`,
  `ADMIN_EMBED_TRIGGER_API_KEY`, `MANAGER_API_KEY`, and Strapi/mobile tokens.
- Ensure Strapi-dependent tokens are deferred to Strapi sunset rather than
  converted through this ticket.

**Test scenarios:**

- Receiver accepts both legacy and Auth-issued credentials during dual-accept.
- Caller can switch from legacy bearer to Auth-issued credential without
  downtime.
- Removing the legacy bearer does not break Manager dashboard login or
  membership refresh.
- Wrong-environment service token is rejected in stage/production smoke.

**Verification:**

- Updated inventory has final disposition for each surface.
- Rollout notes include deploy order, rollback, and secret-rotation guidance.
- No `apps/cms` auth files are modified.

### U5. Operator Visibility And Documentation

**Goal:** Make the resulting model understandable for operators and future
agents.

**Requirements:** R19-R21

**Dependencies:** U1-U4

**Files:**

- Modify: `apps/auth/CLAUDE.md`
- Modify: `apps/admin/CLAUDE.md`
- Modify: `apps/manager/CLAUDE.md`
- Modify: `docs/auth-consolidation/surface-inventory.md`
- Modify as needed: `apps/auth/src/app/dashboard/tokens/page.tsx`
- Modify as needed: `apps/auth/src/app/dashboard/apps/page.tsx`
- Test as needed: `apps/auth/src/services/token-policy.service.test.ts`

**Approach:**

- Document how to distinguish Auth-owned app access, app-local permissions,
  internal env bearers, and Strapi sunset dependencies.
- If the existing Auth dashboard already exposes enough information, keep this
  as docs-only.
- If not, add the smallest dashboard affordance that shows whether a token or
  grant is Auth-owned and what audience/environment/scope it targets.
- Do not create a Strapi Auth UI or Strapi OAuth registration.

**Test scenarios:**

- Operator docs explain where to grant Auth app access.
- Operator docs explain where to grant Manager membership.
- Operator docs explain which bearers remain local and why.
- Auth dashboard, if changed, does not display raw secrets or tokens.

**Verification:**

- `pnpm --filter @forge/auth test` if Auth UI/services changed.
- Docs accurately link back to the inventory and roadmap ticket.

## Rollout Strategy

1. Land inventory and docs first.
2. Verify Admin and Manager human OAuth boundaries.
3. Add Admin receiver dual-accept for Auth-issued Manager service credential.
4. Deploy receiver first.
5. Configure Manager caller for Auth-issued service credential.
6. Smoke Manager dashboard and Manager -> Admin validation.
7. Remove or explicitly retain the legacy bearer based on smoke results and
   inventory disposition.

Rollback is straightforward while dual-accept is active: restore Manager to
`ADMIN_MANAGER_API_KEY` and keep Admin's legacy `MANAGER_ADMIN_API_KEY` path.
After removal, rollback requires re-adding the legacy env vars and restoring
the dual-accept code path.

## Risks

| Risk                                                                    | Mitigation                                                                                       |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Service-token conversion widens access compared with the legacy bearer. | Add a dedicated service scope and receiver-side audience/environment/scope checks.               |
| Removing an env bearer before all callers are switched causes outage.   | Receiver-first deploy, dual-accept, then caller switch, then removal.                            |
| Strapi auth changes sneak into the work.                                | Inventory labels `apps/cms` auth as out of scope; verification checks no CMS auth files changed. |
| Auth dashboard work expands into a UI project.                          | Prefer docs-only operator visibility unless a concrete missing field blocks operation.           |

## Validation Commands

- `pnpm --filter @forge/auth test`
- `pnpm --filter @forge/admin test`
- `pnpm --filter @forge/manager test`

## Open Questions

- Resolved 2026-05-22: Manager uses Better Auth's OAuth client-credentials
  token endpoint directly for the first service credential. Admin validates the
  resulting token through Better Auth introspection during dual-accept.
- Should `MANAGER_API_KEY` be split into separate service-only keys before
  Strapi sunset, or is it acceptable to keep until Manager's remaining
  Strapi-backed API routes are retired?
- Does Auth's current operator dashboard already show enough token/audience
  posture for U5, or does it need a small addition?
