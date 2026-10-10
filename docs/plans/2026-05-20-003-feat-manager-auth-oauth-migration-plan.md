---
title: "feat: Migrate Manager auth to Jesus Film Auth"
type: feat
status: active
date: 2026-05-20
origin: docs/roadmap/platform/feat-125-manager-auth-oauth-admin-backend-migration.md
---

# feat: Migrate Manager auth to Jesus Film Auth

## Summary

Resolve PR #895 by rebasing its Admin-backed Manager backend work onto current `main`, where `apps/auth` owns human identity and `apps/admin` is already an OAuth relying client. Manager should become its own first-party Auth OAuth client, while preserving the proven authorization boundary from PR #919: explicit `ManagerMembership` / `ManagerRole.OPERATOR`, no Strapi panel auth, and no implicit access from Admin editorial roles.

---

## Problem Frame

PR #895 added broad Admin-backed Manager backend contracts, but its interactive auth assumptions are now stale: current `main` moved Admin human login to the standalone Auth app and removed Admin's embedded Better Auth config. Resolving the conflicts by keeping #895's old `auth.api` imports would break Admin and reintroduce the wrong auth boundary. Manager needs to authenticate through `auth.jesusfilm.org` / `apps/auth`, then use Admin-owned Manager membership to decide panel access.

---

## Requirements

- R1. Manager human login uses the standalone Jesus Film Auth authority (`apps/auth`, deployed as `auth.jesusfilm.org`) via OAuth authorization-code + PKCE, not Strapi and not Admin-hosted Better Auth.
- R2. Manager is registered as its own first-party OAuth client with Manager redirect/logout origins and a Manager access scope.
- R3. Manager keeps a Manager-local `manager-session` cookie after callback; it must not trust Auth-domain cookies, Admin cookies, or legacy `strapi-jwt` cookies for panel access.
- R4. Manager users are Auth/Admin-known users, but Manager access requires active Admin-side `ManagerMembership` with v1 `ManagerRole.OPERATOR`.
- R5. Admin editorial roles `VIEWER`, `EDITOR`, and `ADMIN` do not imply Manager panel access unless the same user has active Manager membership.
- R6. `WORKFLOW_TRIGGER` and service bearer identities cannot create Manager panel sessions and cannot satisfy human `access:manager`; service access uses explicit backend contract permissions.
- R7. PR #895's Admin-backed Manager read/job contracts are preserved where valid, but any stale Admin Better Auth session/login code is replaced with current Auth/OAuth-compatible code.
- R8. Conflict resolution keeps current `main` schema assertions for `videosByCoreIds`, `WatchSetting`, and `triggerExperienceEmbeddingBackfill`; retired `triggerExperienceContentDump` remains absent.
- R9. Auth-sensitive changes are test-first where practical and require a user-facing smoke proof before merge.
- R10. Admin-backed Manager mode is not enabled for production/stage traffic until coverage snapshots have a live writer/backfill or an explicit legacy fallback for absent Admin rows.
- R11. Manager job-state cutover must choose and document backfill, dual-read, dual-write, or accepted fresh-start semantics before Admin job tables become authoritative.

---

## Scope Boundaries

- In scope: Auth app Manager client/scopes, Manager OAuth routes/session guard, Admin Manager membership/permission model, PR #895 backend contract reconciliation, generated Admin GraphQL artifacts, docs, and targeted tests.
- In scope: a tested Admin script or equivalent operational path to grant `ManagerRole.OPERATOR` to an existing Auth/Admin user by email.
- Out of scope: a Manager role-management UI.
- Out of scope: granular Manager roles beyond `OPERATOR`.
- Out of scope: full Strapi data retirement beyond the Manager panel auth path and #895's backend contract migration.
- Out of scope: making Manager share Admin's browser session cookie.
- Out of scope: enabling empty Admin coverage/job tables as authoritative production Manager data.

### Deferred to Follow-Up Work

- Add an Admin UI for viewing, granting, and revoking Manager memberships.
- Define future Manager roles such as `CONTRIBUTOR` and `VIEWER`.
- Remove temporary backend compatibility paths after stage/prod prove Admin-backed Manager auth and data access.
- Remove Admin backend rollout guardrails after coverage snapshots have a durable writer/backfill path and job cutover rollback is no longer needed.

---

## Context & Research

### Relevant Code and Patterns

- `apps/auth/src/domain/apps.ts`, `apps/auth/src/domain/scopes.ts`, and `apps/auth/src/scripts/seed-first-party-apps.ts` seed the existing Admin OAuth client and should be extended for Manager.
- `apps/admin/src/auth/oauth-client.ts`, `apps/admin/src/app/api/auth/login/route.ts`, and `apps/admin/src/app/api/auth/callback/route.ts` show the current Auth relying-client pattern to mirror in Manager.
- `apps/admin/src/auth/auth-session.ts` signs admin-local sessions; Manager needs an analogous Manager-local session artifact rather than reusing Admin's cookie.
- `apps/admin/src/auth/permissions.ts` and `apps/admin/src/auth/principal.ts` own coarse permission behavior. PR #919 proved the safer shape: optional `managerRole` on the principal and `access:manager` gated by active membership.
- `apps/admin/src/graphql/types/managerSession.ts`, `apps/admin/src/graphql/types/managerReadModels.ts`, and `apps/admin/src/graphql/types/managerJob.ts` from PR #895/#919 are the Manager backend contract surfaces to preserve and adapt.
- `apps/manager/src/lib/auth.ts`, `apps/manager/src/lib/require-auth.ts`, `apps/manager/src/middleware.ts`, and `apps/manager/src/app/api/auth/*` are the current Strapi-backed panel auth path to replace.
- `apps/manager/src/backend/admin-client.ts`, `apps/manager/src/cms/gateway.ts`, and `apps/manager/src/lib/state.ts` are the Admin backend adapter seams from PR #895.

### Institutional Learnings

- `docs/solutions/auth/admin-sso-uses-oauth-local-session-not-shared-cookies.md`: first-party apps should use OAuth with app-local sessions, not shared cross-domain cookies.
- `docs/solutions/developer-experience/local-admin-dev-auth-flow-impractical-20260514.md`: local OAuth browser smoke can be awkward; production-style or deployed smoke is more reliable for Auth/Admin flows.
- Prior PR #919 established that Manager authorization must be separate from Admin editorial roles, with `ManagerMembership` / `ManagerRole.OPERATOR`, header-forwarded validation, `managerLogout`, and `strapi-jwt` only as a rollback hazard.
- `docs/solutions/platform/admin-manager-enrichment-trigger-endpoint-20260506.md`: cross-app service calls should use narrow bearer permissions, not human panel permissions.

### External References

- Better Auth OAuth Provider docs: `https://better-auth.com/docs/plugins/oauth-provider`.
- Better Auth Next.js integration docs: `https://better-auth.com/docs/integrations/next`.
- OAuth browser-based apps guidance: `https://oauth.net/2/browser-based-apps/`.

---

## Key Technical Decisions

- Manager becomes a first-party Auth OAuth client, parallel to Admin. It does not proxy credentials through Admin GraphQL.
- Manager access uses a dedicated Auth scope such as `manager:access` and an Admin-side active `ManagerMembership` check; both must pass for panel access.
- Manager keeps its own signed `manager-session` cookie. Middleware can check presence for UX redirects only; server components and API routes must validate the session and current membership.
- `ManagerMembership` lives in Admin for this migration because #895 makes Admin the Manager backend authority and because Manager-specific app authorization must be visible/manageable from Admin.
- Human `access:manager` is never granted to `WORKFLOW_TRIGGER`; backend service contracts get explicit permission keys such as `read:manager-read-models` and `write:manager-jobs`.
- Current `main` wins over PR #895 wherever Admin Auth/OAuth moved the source of truth; PR #895 wins where it contributes still-valid Manager read/job data contracts.
- `MANAGER_BACKEND_MODE=admin` is a rollout gate, not a proof of data readiness. Coverage snapshots need a continuous Admin writer, a verified backfill, or a legacy fallback before production/stage Manager traffic can use Admin as authoritative.
- Manager job tables need explicit migration semantics before cutover: backfill current jobs, dual-write during canary, dual-read legacy fallback, or accept a fresh-start view with documented rollback/operator consequences.

---

## Open Questions

### Resolved During Planning

- Should Manager use `auth.jesusfilm.org`? Yes. Manager should authenticate through `apps/auth` / `auth.jesusfilm.org`.
- Should Manager users appear/manage inside Admin? Yes. Users are Auth/Admin-known identities with Admin-side Manager membership for Manager access.
- Should Manager share Admin's local session cookie? No. Manager should be a separate relying client with a Manager-local session.
- Should Admin `ADMIN` imply Manager access? No. It must require Manager membership.

### Deferred to Implementation

- Exact migration sequence number for `ManagerMembership` depends on the active branch after PR #895 is rebased.
- Exact smoke target can be local production-mode, stage, or PR preview depending on available env; the smoke must prove an operator can access Manager and a non-member cannot.
- Exact Manager data rollout mode must be chosen during implementation: coverage snapshots require writer/backfill/fallback, and job state requires backfill/dual-read/dual-write or explicitly accepted fresh-start behavior.

---

## Implementation Units

### U1. Register Manager In Auth

**Goal:** Add Manager as a first-party OAuth relying client in `apps/auth`.

**Requirements:** R1, R2

**Dependencies:** None

**Files:**

- Modify: `apps/auth/src/domain/scopes.ts`
- Modify: `apps/auth/src/domain/apps.ts`
- Modify: `apps/auth/src/scripts/seed-first-party-apps.ts`
- Test: existing Auth domain/script tests or new focused tests beside the touched files

**Approach:**

- Add a Manager access scope (`manager:access`) to the known Auth scope list.
- Add a Manager app seed with local, preview/staging, and production callback/logout/origin settings.
- Ensure seed code handles both Admin and Manager app registrations without duplicating scope seeding.

**Execution note:** Write tests first for Manager scope/client seed shape before changing the seed implementation.

**Patterns to follow:**

- Existing Admin seed in `apps/auth/src/domain/apps.ts`.
- Existing `seed:first-party-apps` behavior in `apps/auth/src/scripts/seed-first-party-apps.ts`.

**Test scenarios:**

- Happy path: seeding includes Manager app, environments, OAuth clients, and `manager:access`.
- Edge case: unknown scopes still fail validation.
- Integration: seed routine remains idempotent for both Admin and Manager records.

**Verification:**

- Auth tests prove Manager client registration without breaking Admin registration.

### U2. Add Manager OAuth Login, Callback, And Local Session

**Goal:** Replace Manager's password/Strapi login flow with Auth OAuth login and a Manager-local session.

**Requirements:** R1, R2, R3, R9

**Dependencies:** U1

**Files:**

- Modify: `apps/manager/src/app/api/auth/login/route.ts`
- Create/Modify: `apps/manager/src/app/api/auth/callback/route.ts`
- Modify: `apps/manager/src/app/api/auth/logout/route.ts`
- Modify/Create: `apps/manager/src/lib/session-cookie.ts`
- Modify: `apps/manager/src/app/login/page.tsx`
- Modify: `apps/manager/src/app/login/login-form.tsx`
- Modify: `apps/manager/src/config/env.ts`
- Test: `apps/manager/src/app/api/auth/login/route.test.ts`
- Test: `apps/manager/src/app/api/auth/logout/route.test.ts`
- Test: new callback/session-cookie tests

**Approach:**

- Mirror Admin's OAuth state/PKCE/callback pattern, but use Manager env names and Manager callback URL.
- Change the login UI to initiate redirect-based sign-in rather than collecting a password for `/api/auth/login`.
- Store a signed Manager-local session containing the verified Auth subject/email and enough metadata to re-check membership, but do not trust stale embedded membership claims.
- Logout clears Manager session and, where practical, redirects/signs out through Auth's end-session behavior.

**Execution note:** Add failing tests for redirect URL/state cookies and invalid callback state before implementation.

**Patterns to follow:**

- `apps/admin/src/app/api/auth/login/route.ts`.
- `apps/admin/src/app/api/auth/callback/route.ts`.
- `apps/admin/src/auth/oauth-client.ts`.
- `apps/admin/src/auth/auth-session.ts`.

**Test scenarios:**

- Happy path: login route redirects to Auth authorize URL with Manager client id, redirect URI, `manager:access`, state, and PKCE.
- Error path: callback with missing code/state/verifier does not set `manager-session`.
- Error path: token exchange or token verification failure redirects/denies without setting session.
- Happy path: valid callback sets `manager-session` and redirects to Manager dashboard.
- Integration: login page points to redirect flow, not a credential POST.

**Verification:**

- Manager no longer sets `strapi-jwt` during login and has a tested Manager-local session path.

### U3. Add Admin Manager Membership Authorization

**Goal:** Add Admin-side Manager membership and make `access:manager` membership-backed.

**Requirements:** R4, R5, R6, R9

**Dependencies:** None

**Files:**

- Modify: `apps/admin/prisma/schema.prisma`
- Create: `apps/admin/prisma/migrations/<next>_manager_membership/migration.sql`
- Modify: `apps/admin/src/auth/principal.ts`
- Modify: `apps/admin/src/auth/permissions.ts`
- Modify: `apps/admin/src/auth/permissions.test.ts`
- Modify/Create: `apps/admin/src/scripts/grant-manager-operator.ts`
- Modify: `apps/admin/package.json`

**Approach:**

- Port PR #919's `ManagerMembership`, `ManagerRole.OPERATOR`, optional `managerRole` principal shape, and grant script onto current `main`.
- Remove human `access:manager` from the editorial tier ladder and remove it from `WORKFLOW_TRIGGER`.
- Add explicit backend service permission keys for Manager read/job contracts if #895 still needs service bearer access.

**Execution note:** Red/Green TDD is required. First capture that `VIEWER`, `EDITOR`, `ADMIN`, and `WORKFLOW_TRIGGER` do not satisfy human Manager access without membership.

**Patterns to follow:**

- PR #919 implementation on `origin/feat/manager-admin-auth-membership`.
- Existing permission matrix tests in `apps/admin/src/auth/permissions.test.ts`.

**Test scenarios:**

- Happy path: active `OPERATOR` membership satisfies `access:manager`.
- Error path: no membership denies `VIEWER`, `EDITOR`, and `ADMIN`.
- Error path: revoked membership denies access.
- Error path: `WORKFLOW_TRIGGER` does not satisfy `access:manager`.
- Happy path: service keys still satisfy only explicit backend contract permissions.

**Verification:**

- Admin permission tests prove Manager access is membership-backed and service identities are separated.

### U4. Reconcile Admin Manager GraphQL Contracts

**Goal:** Preserve PR #895's Manager backend GraphQL/read/job contracts while replacing stale Admin Better Auth assumptions.

**Requirements:** R4, R6, R7, R8

**Dependencies:** U3

**Files:**

- Modify: `apps/admin/src/graphql/schema.ts`
- Modify: `apps/admin/src/graphql/schema.test.ts`
- Modify: `apps/admin/src/graphql/types/managerSession.ts`
- Modify: `apps/admin/src/graphql/types/managerReadModels.ts`
- Modify: `apps/admin/src/graphql/types/managerJob.ts`
- Modify: `apps/admin/src/services/manager-read-model.service.ts`
- Modify: `apps/admin/src/services/manager-job.service.ts`
- Test: related `manager*.test.ts` files

**Approach:**

- Import and expose Manager read/job/session GraphQL modules from #895.
- Replace `auth.api.getSession` / `signInEmail` assumptions with current OAuth session and membership validation. If Manager authenticates directly with Auth, Admin's Manager session GraphQL should validate Manager membership for a subject/session rather than act as password login.
- Keep current `main` schema tests for `videosByCoreIds`, `WatchSetting`, and `triggerExperienceEmbeddingBackfill`; keep `triggerExperienceContentDump` absent.
- Add explicit tests or implementation notes for empty Admin read-model tables. Coverage snapshot queries must either return a deliberate fallback to the legacy source or stay behind the backend-mode gate until writer/backfill readiness is proven.

**Patterns to follow:**

- Current `apps/admin/src/auth/session.ts`.
- PR #919 `managerSession` header-forwarding and `managerLogout` where still useful.
- Current `apps/admin/src/graphql/schema.ts` side-effect import pattern.

**Test scenarios:**

- Happy path: Manager read model/job fields are present.
- Happy path: Manager membership-backed viewer/session shape includes `managerRole`.
- Error path: user without membership gets null/forbidden.
- Regression: current `main` schema assertions continue to pass.

**Verification:**

- Admin schema and Manager GraphQL tests pass with no imports from removed `apps/admin/src/auth/config.ts`.

### U5. Adapt Manager Backend/Auth Guards

**Goal:** Make Manager trust Auth/OAuth identity plus Admin membership, and keep #895 Admin-backed data/job behavior.

**Requirements:** R3, R4, R7, R9

**Dependencies:** U2, U4

**Files:**

- Modify: `apps/manager/src/lib/auth.ts`
- Modify: `apps/manager/src/lib/require-auth.ts`
- Modify: `apps/manager/src/middleware.ts`
- Modify: `apps/manager/src/backend/admin-client.ts`
- Modify: `apps/manager/src/cms/gateway.ts`
- Modify: `apps/manager/src/lib/state.ts`
- Test: `apps/manager/src/lib/auth.test.ts`
- Test: `apps/manager/src/lib/require-auth.test.ts`
- Test: `apps/manager/src/backend/admin-client.test.ts`
- Test: `apps/manager/src/cms/gateway.test.ts`
- Test: `apps/manager/src/lib/state-create.test.ts`

**Approach:**

- Make `hasManagerAccess` require verified Manager membership/role, not Strapi or Admin editorial role names.
- Ensure protected routes validate `manager-session` server-side and redirect/401 on invalid, expired, revoked, or non-member sessions.
- Preserve `MANAGER_API_KEY` bearer behavior for external/service API callers where already intended.
- Preserve Admin backend mode for read/job state while separating backend data auth from human panel login.
- Treat Admin backend mode as disabled outside local/dev canary unless coverage snapshot data readiness is satisfied by writer/backfill/fallback.
- Implement or document the selected job cutover behavior before switching Manager job state to Admin: backfill, dual-read, dual-write, or accepted fresh-start with rollback consequences.

**Execution note:** Add failing tests for legacy `strapi-jwt` denial and non-member denial before implementation.

**Patterns to follow:**

- PR #919 Manager changes on `origin/feat/manager-admin-auth-membership`.
- Current Manager API auth tests and gateway tests.

**Test scenarios:**

- Happy path: `OPERATOR` session accesses dashboard/API guard.
- Error path: `strapi-jwt` alone redirects to login or returns 401.
- Error path: valid Auth identity without Manager membership is denied.
- Happy path: Admin backend job state operations still use Admin GraphQL in admin mode.
- Rollout guard: Admin backend mode with empty coverage snapshot rows does not silently present empty authoritative coverage; it must fail closed, use a proven writer/backfill, or deliberately fall back to the legacy source.
- Rollout guard: job list/detail behavior proves the selected backfill/dual-read/dual-write/fresh-start semantics.
- Integration: logout clears local session and does not leave middleware accepting stale cookies.

**Verification:**

- Manager auth/gateway/backend tests prove Auth-backed human sessions and Admin-backed data mode work together.
- Rollout validation names the coverage snapshot data-readiness path and job-state cutover semantics used for the environment being enabled.

### U6. Resolve PR #895 Conflicts And Generated Artifacts

**Goal:** Finish the merge/rebase conflict resolution and refresh generated/doc artifacts.

**Requirements:** R7, R8, R9

**Dependencies:** U1-U5

**Files:**

- Modify: `apps/admin/src/auth/permissions.test.ts`
- Modify: `apps/admin/src/auth/session.ts`
- Modify: `apps/admin/src/graphql/schema.test.ts`
- Modify: `apps/manager/CLAUDE.md`
- Modify: `apps/manager/AGENTS.md`
- Modify: `apps/manager/src/lib/state.ts`
- Modify: `docs/roadmap/README.md`
- Modify: `docs/roadmap/platform/feat-086-admin-app-graphql-postgres-foundation.md`
- Modify: `apps/admin/schema.graphql`
- Modify: any generated gql.tada artifacts required by current repo conventions

**Approach:**

- Preserve both sides of additive conflicts in permission tests and docs.
- Keep current `main` `apps/admin/src/auth/session.ts` OAuth-session behavior; do not restore Admin embedded Better Auth.
- Keep roadmap references pointed at the real platform ticket for this migration and do not reuse the unrelated platform `feat-120`.
- Regenerate Admin schema artifacts after Pothos changes.

**Patterns to follow:**

- `apps/admin/AGENTS.md` SDL/codegen instructions.
- Prior conflict review for PR #895.

**Test scenarios:**

- Regression: no conflict markers remain.
- Regression: schema tests include both #895 Manager contracts and current `main` consumer/admin fields.
- Documentation: env tables mention Auth/Manager OAuth and Admin backend mode accurately.

**Verification:**

- `git diff --check` reports no conflict markers or whitespace errors.
- Generated artifacts match source changes.

### U7. Validation, Smoke, And Shipping Review

**Goal:** Prove the full auth and conflict-resolution path before commit/PR.

**Requirements:** R9

**Dependencies:** U1-U6

**Files:**

- No primary code files; validation may update docs only if smoke notes are required.

**Approach:**

- Run targeted Auth, Admin, and Manager tests for touched areas.
- Run lint/typecheck/build for touched apps as practical.
- Run a user-facing smoke in local production mode, stage, or preview: an operator reaches Manager dashboard; a registered non-member is denied; legacy `strapi-jwt` is denied.
- Run data-readiness smoke for the selected rollout: coverage snapshots prove writer/backfill/fallback behavior, and job state proves backfill/dual-read/dual-write or the accepted fresh-start contract plus rollback consequences.
- Run code review and address safe findings.

**Test scenarios:**

- Integration: Auth login -> Manager callback -> Manager dashboard succeeds for `OPERATOR`.
- Integration: Auth login -> Manager callback -> Manager dashboard denies non-member.
- Regression: service bearer/API auth remains separate from human panel access.
- Rollout: enabling Admin backend mode cannot turn empty Admin coverage/job tables into silent production truth.

**Verification:**

- Targeted tests and smoke proof are captured in the final summary/PR.

---

## System-Wide Impact

- **Interaction graph:** Browser -> Manager -> Auth OAuth -> Manager local session -> Admin membership/read/job contracts.
- **Error propagation:** Auth/token failures should deny without cookies; membership failures should be generic from the user perspective and detailed only in server logs.
- **State lifecycle risks:** Revoked membership must take effect on next validation; Manager must not trust stale role claims embedded in cookies.
- **API surface parity:** Manager UI routes, API route auth, Admin GraphQL Manager contracts, and service bearers must all preserve distinct auth semantics.
- **Integration coverage:** Unit tests are not enough; smoke must prove the real browser/session route.
- **Rollout data readiness:** Empty Admin coverage tables must fail closed, use a proven writer/backfill, or fall back deliberately; empty Admin job tables must use backfill/dual-read/dual-write or a documented fresh-start cutover before Admin backend mode is enabled outside local/dev canary.
- **Unchanged invariants:** Admin remains an Auth relying client; Auth owns identity; Admin/Manager own app-specific authorization; Strapi panel auth is retired.

---

## Risks & Dependencies

| Risk                                                    | Mitigation                                                                                      |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Accidentally restoring Admin embedded Better Auth       | Search for `@/auth/config` and `auth.api` in `apps/admin`; keep current OAuth session path      |
| Manager non-members gain access through editorial roles | Membership-backed permission tests and Manager guard tests                                      |
| OAuth local smoke is noisy                              | Prefer production-mode local or stage smoke if dev server/proxy loops interfere                 |
| Service bearer permissions widen human access           | Separate `access:manager` from explicit service keys                                            |
| Generated schema drift                                  | Regenerate Admin SDL and any current codegen artifacts after schema changes                     |
| Empty Admin coverage/job tables look like real data     | Gate Admin backend mode on coverage writer/backfill/fallback and explicit job cutover semantics |

---

## Sources & References

- Related PR: `https://github.com/JesusFilm/forge/pull/895`
- Prior auth PR: `https://github.com/JesusFilm/forge/pull/919`
- Existing Auth plan: `docs/plans/2026-05-11-001-jesus-film-auth-platform-plan.md`
- Existing Manager backend plan: `docs/plans/2026-05-06-001-feat-manager-admin-backend-migration-plan.md`
- Admin OAuth pattern: `apps/admin/src/auth/oauth-client.ts`
- Manager auth seams: `apps/manager/src/lib/auth.ts`, `apps/manager/src/cms/gateway.ts`, `apps/manager/src/backend/admin-client.ts`
- Better Auth OAuth Provider: `https://better-auth.com/docs/plugins/oauth-provider`
- OAuth browser-based apps guidance: `https://oauth.net/2/browser-based-apps/`
