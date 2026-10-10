---
title: "Jesus Film Auth Platform"
type: feat
status: active
date: 2026-05-11
origin: docs/brainstorms/2026-05-11-jesus-film-auth-platform-requirements.md
---

# Jesus Film Auth Platform

## Summary

Extract Auth from `apps/admin` into a standalone Jesus Film Auth application and
migrate admin to consume it as an OAuth/OIDC relying client. The new Auth
service owns identity, global membership, first-party app registrations,
environment-specific redirect URLs, app-level grants/scopes, browser login,
user-delegated access tokens, client-credentials service tokens, Firebase lazy
migration, audit, and revocation. The app lives at `apps/auth` and deploys to
Railway as its own service.

The important boundary change is deliberate: **admin must stop relying on
shared `.jesusfilm.org` cookies.** Auth keeps Auth-domain sessions. Admin
redirects through Auth, receives an OAuth/OIDC-style callback, verifies or
exchanges it, then creates its own admin-local session and continues enforcing
admin-local permissions and ABAC.

## Problem Frame

`auth.jesusfilm.org` currently lives inside `apps/admin`. Better Auth config,
Firebase fallback, route handlers, user/session/account tables, CORS/trusted
origins, and admin role data are coupled to the admin app boundary. That
coupling produced a fragile SSO story: admin was intended to share cookies with
the auth host, but the desired product shape is a real Auth authority with apps
registered as clients.

This plan turns Auth into a first-party platform surface while keeping the first
implementation focused: build the standalone Auth app and migrate admin as the
first consumer. Partner/external app support is modeled, but a public developer
portal is deferred.

## Requirements Trace

From `docs/brainstorms/2026-05-11-jesus-film-auth-platform-requirements.md`:

- R1-R5. Extract Auth from admin and migrate admin before declaring complete.
- R5a, R6-R9. Auth owns global membership and app-level grants/scopes; apps own
  domain authorization.
- R10-R13. Auth owns app registry and environment-specific redirects.
- R14-R19. Auth issues browser sessions and scoped API tokens, distinguishing
  user-delegated and service/app tokens.
- R20-R23. Product model supports future partner/external app ownership without
  open self-service registration in v1.
- R24-R27a. Auth exposes operational/audit/revocation surfaces and deploys as a
  separate Railway service.
- R28-R34. Admin becomes an OAuth/OIDC-style client, not a shared-cookie
  consumer.

## Scope Boundaries

- In scope: new `apps/auth`, Auth DB/schema, Better Auth OAuth Provider setup,
  app registry, environment records, scopes/grants, audit/revocation, Firebase
  lazy migration, admin OAuth consumer migration, admin-local sessions.
- In scope: first-party app registrations for `admin` local/staging/production.
  Additional first-party app records can be seeded, but only admin is migrated.
- Out of scope: public partner developer portal.
- Out of scope: migrating manager/web/mobile to Auth as relying clients.
- Out of scope: making Auth own admin's detailed permissions or ABAC.
- Out of scope: decommissioning admin's old auth tables in the same PR that
  introduces the new flow. That cleanup happens after verified migration.

## Context And Research

### Current Repo State

- `apps/admin/src/auth/config.ts` creates the Better Auth instance with Prisma
  adapter, social providers, Okta plugin, and session cookie settings.
- `apps/admin/src/app/api/auth/[...all]/route.ts` wraps Better Auth's route and
  adds Firebase email/password fallback, CORS, rate limiting, audit logging, and
  internal-only signup semantics.
- `apps/admin/src/auth/session.ts` resolves a Better Auth cookie to an admin
  `Principal` by reading the admin `User` row.
- `apps/admin/src/graphql/context.ts` builds GraphQL context from the admin
  session path first, then falls back to `WORKFLOW_TRIGGER` bearer auth.
- `apps/admin/src/auth/permissions.ts` uses `PermissionKey` + role tiers for
  coarse GraphQL gates, then services enforce ABAC.
- `apps/admin/prisma/schema.prisma` stores Better Auth `User`, `Session`,
  `Account`, and `Verification` tables in the admin database alongside admin
  domain data.
- `apps/admin/src/auth/origins.ts` and `apps/admin/src/proxy.ts` currently
  shape `auth.jesusfilm.org` and `admin.jesusfilm.org` behavior in one app.

### Existing Learnings To Preserve

- `docs/solutions/auth/better-auth-secret-must-not-fallback-to-hardcoded-value.md`
  — cryptographic secrets stay optional at build time but fail closed at runtime
  in production.
- `docs/solutions/auth/better-auth-firebase-migration-must-block-public-signup.md`
  — Firebase lazy migration can use internal signup, but public signup must stay
  blocked.
- `docs/solutions/auth/spike-auth-header-must-be-env-gated.md` — dev auth
  shortcuts must be env-gated and never enabled implicitly in production.
- `docs/solutions/platform/adding-new-apps.md` and
  `docs/solutions/platform/new-app-ci-and-deployment-patterns.md` — new apps
  need validated env, local dev scripts, Railway/Doppler posture, CI checks, and
  lazy external SDK initialization.
- `docs/solutions/deployment/nextjs-pnpm-monorepo-railway-standalone.md` —
  standalone output and Railway start command caveats apply to `apps/auth`.
- `docs/solutions/platform/railway-mcp-staged-config-never-commits-20260420.md`
  — Railway dashboard/service updates must be accepted; staged config alone is
  not authoritative.

### External References

- Better Auth OAuth Provider plugin: `https://better-auth.com/docs/plugins/oauth-provider`
  supports OAuth 2.1/OIDC provider behavior, client registration, consent/grant
  APIs, client-secret rotation, authorization-code flow, token verification
  helpers, discovery metadata, and client credentials.
- Better Auth API Key plugin: `https://canary.better-auth.com/docs/plugins/api-key`
  supports API key creation/verification, expiry, metadata, rate limiting, and
  sessions from API keys. Treat as an option for internal API keys, not the
  default replacement for OAuth access tokens.
- Better Auth SSO plugin: `https://better-auth.com/docs/plugins/sso` supports
  integrating upstream OIDC/OAuth/SAML identity providers; useful for future
  enterprise/partner SSO, not the core provider spine.
- OAuth 2.0 RFC 6749: `https://www.rfc-editor.org/rfc/rfc6749` distinguishes
  authorization-code and client-credentials grants.
- OpenID Connect Core: `https://openid.net/specs/openid-connect-core-1_0-18.html`
  defines identity-layer expectations on top of OAuth 2.0.

## Key Technical Decisions

- **Use Better Auth OAuth Provider as the protocol spine.** Do not build OAuth
  endpoints from scratch. The plugin already covers the high-risk protocol
  surface; Forge code should focus on Jesus Film product policy.
- **Admin uses authorization-code style login.** Admin redirects to Auth,
  validates `state`, exchanges the code, verifies the ID/access token, checks
  the app grant/scopes, and creates an admin-local session.
- **No shared-cookie SSO for admin.** `AUTH_COOKIE_DOMAIN=.jesusfilm.org` is
  retired as the admin/Auth integration mechanism. Auth cookies are scoped to
  Auth; admin cookies are scoped to admin.
- **Auth owns membership and app grants; apps own domain authorization.** Auth
  answers "is this person globally approved and allowed into admin with these
  scopes?" Admin answers "what can this principal do inside admin?"
- **Keep admin `Principal` shape initially, extend later only if needed.** Admin
  can map Auth scopes/grants into existing `ADMIN`/`EDITOR`/`VIEWER` tiers for
  the first migration, then add richer scope-aware checks where it matters.
- **Do not migrate admin user data.** Start `apps/auth` with its own DB/schema,
  bootstrap Auth-owned identities and app grants, and keep
  `ADMIN_AUTH_MODE=embedded` only as a runtime rollback while Auth is proven.
  Do not leave Auth and admin permanently sharing one DB.
- **Carry Firebase lazy migration into Auth.** The fallback currently in admin's
  route moves to Auth and keeps public signup blocked. Admin should never call
  Firebase directly after migration.
- **Token families are explicit.** User-delegated access tokens and
  client-credentials service tokens have distinct audit fields, lifetimes,
  allowed scopes, and revocation paths.
- **First-party auto-approval is policy, not absence of grants.** Admin may be
  auto-approved, but Auth still persists an app grant/scope record and audit
  event.
- **Partner/external ownership is modeled but inactive.** The schema/product
  model includes owner/trust/approval posture, but no open self-service external
  portal ships in this plan.
- **Railway is the deployment target.** `apps/auth` gets its own Railway
  service, database, env matrix, healthcheck, migrations, and custom-domain
  binding for `auth.jesusfilm.org`. Admin no longer hosts the Auth production
  domain after cutover.

## High-Level Design

```mermaid
sequenceDiagram
    participant Browser
    participant Admin as apps/admin
    participant Auth as apps/auth
    participant AuthDB as Auth DB
    participant AdminDB as Admin DB

    Browser->>Admin: GET /dashboard
    Admin-->>Browser: redirect /login
    Browser->>Admin: GET /login
    Admin-->>Browser: redirect Auth /oauth2/authorize
    Browser->>Auth: login + authorize admin scopes
    Auth->>AuthDB: validate membership + app grant
    Auth-->>Browser: redirect Admin callback with code + state
    Browser->>Admin: GET /api/auth/callback?code&state
    Admin->>Auth: exchange code / verify tokens
    Auth-->>Admin: identity + scopes
    Admin->>AdminDB: upsert local auth session / user mirror
    Admin-->>Browser: Set-Cookie admin session; redirect /dashboard
```

```mermaid
flowchart LR
    Auth["apps/auth"] --> Membership["Global membership"]
    Auth --> Registry["Apps + environments"]
    Auth --> Grants["App grants + scopes"]
    Auth --> OAuth["OAuth/OIDC provider"]
    Auth --> Tokens["User + service tokens"]
    Auth --> Audit["Audit + revocation"]
    Admin["apps/admin"] --> OAuth
    Admin --> LocalSession["Admin-local session"]
    Admin --> LocalPolicy["Admin permissions + ABAC"]
```

## Implementation Units

### Unit 1 — Scaffold `apps/auth`

**Goal:** Create a standalone Next.js app that can run locally, validate env, and
host health/auth routes without touching admin behavior.

**Files:**

- Create: `apps/auth/package.json`
- Create: `apps/auth/next.config.ts`
- Create: `apps/auth/tsconfig.json`
- Create: `apps/auth/eslint.config.mjs` or align with root ESLint pattern
- Create: `apps/auth/src/config/env.ts`
- Create: `apps/auth/src/app/api/health/route.ts`
- Create: `apps/auth/AGENTS.md`
- Create: `apps/auth/CLAUDE.md`
- Create: `apps/auth/.env.example`
- Modify: `pnpm-lock.yaml`
- Modify: `turbo.json` if required for new app scripts

**Tests:**

- Create: `apps/auth/src/config/env.test.ts`
- Create: `apps/auth/src/app/api/health/route.test.ts`

**Notes:**

- Mirror admin's Next.js/Prisma/Better Auth stack where practical, but give Auth
  its own package name, port, env prefix posture, and deployment identity.
- Env secrets follow the Better Auth production runtime guard pattern.
- Do not import from `apps/admin`; app boundaries stay strict.

**Verification:**

- `pnpm --filter @forge/auth test`
- `pnpm --filter @forge/auth typecheck`
- `pnpm --filter @forge/auth lint`

**Status:** Completed 2026-05-11. Also verified
`pnpm --filter @forge/auth build` for the new standalone Next.js app.

### Unit 2 — Auth Data Model And Migration Groundwork

**Goal:** Add Auth-owned persistence for Better Auth tables, app registry,
environments, scopes, grants, global membership, token metadata, and audit
events.

**Files:**

- Create: `apps/auth/prisma/schema.prisma`
- Create: `apps/auth/prisma/migrations/*/migration.sql`
- Create: `apps/auth/src/db/client.ts`
- Create: `apps/auth/src/domain/scopes.ts`
- Create: `apps/auth/src/domain/apps.ts`
- Create: `apps/auth/src/services/audit.service.ts`
- Create: `apps/auth/src/services/app-registry.service.ts`
- Create: `apps/auth/src/services/membership.service.ts`
- Create: `apps/auth/src/services/token-policy.service.ts`
- Create: `apps/auth/src/scripts/seed-first-party-apps.ts`

**Tests:**

- Create: `apps/auth/src/domain/scopes.test.ts`
- Create: `apps/auth/src/services/app-registry.service.test.ts`
- Create: `apps/auth/src/services/membership.service.test.ts`
- Create: `apps/auth/src/services/token-policy.service.test.ts`

**Modeling decisions for planning-time scope:**

- Auth `User` has global membership status (`active`, `invited`, `suspended`,
  `disabled` or equivalent).
- Registered app has key, display name, trust tier, owner type, active/suspended
  state.
- App environment has environment key, redirect URLs, allowed origins,
  production/non-production classification, approval state.
- Scope catalog is centralized and versioned by string key.
- App grant links user/service/app/environment/scopes and approval state.
- Token metadata stores token family, audience, environment, expiry,
  revocation, and audit pointer. Raw bearer tokens are never logged.

**Verification:**

- Migration applies on empty local Auth DB.
- Seed script creates admin local/staging/production app registrations with
  expected scopes.
- No admin user data migration script is present or required.

**Status:** Completed 2026-05-11. The initial Auth schema now includes Better
Auth protocol tables, Auth product tables, the generated SQL migration,
isolated Prisma client generation, first-party admin seeds, pure policy
services, and explicit no-admin-user-migration posture. Verified with `pnpm --filter
@forge/auth test`, `typecheck`, `lint`, and `build`. Empty-DB migration apply
still needs to be run against a real local/postgres service when credentials are
available.

### Unit 3 — Better Auth Provider In Auth

**Goal:** Move Better Auth identity behavior into `apps/auth` and configure the
OAuth Provider plugin as the client-facing protocol surface.

**Files:**

- Create: `apps/auth/src/auth/config.ts`
- Create: `apps/auth/src/auth/origins.ts`
- Create: `apps/auth/src/auth/firebase-rest.ts`
- Create: `apps/auth/src/auth/firebase-admin.ts`
- Create: `apps/auth/src/auth/rate-limit.ts`
- Create: `apps/auth/src/app/api/auth/[...all]/route.ts`
- Create: `apps/auth/src/app/oauth/authorize/page.tsx` if Better Auth requires
  a custom consent/continue page for first-party disclosure
- Create: `apps/auth/src/app/login/page.tsx`
- Create: `apps/auth/src/app/login/login-page-client.tsx`

**Tests:**

- Create: `apps/auth/src/auth/config.test.ts`
- Create: `apps/auth/src/auth/origins.test.ts`
- Create: `apps/auth/src/app/api/auth/[...all]/route.test.ts`
- Create: `apps/auth/src/auth/firebase-rest.test.ts`
- Create: `apps/auth/src/auth/rate-limit.test.ts`

**Approach:**

- Configure existing upstream social providers in Auth, not admin.
- Add Better Auth OAuth Provider plugin for downstream clients like admin.
- Use first-party auto-approval by policy: skip repeated user consent for
  trusted first-party apps, but persist grants and expose requested scopes.
- Preserve Firebase fallback: Better Auth sign-in first, Firebase email/password
  fallback second, internal signup only, no public signup endpoint.
- Keep anti-enumeration error behavior and rate limiting around the whole email
  sign-in flow.

**Verification:**

- Email/password sign-in succeeds through Auth.
- Firebase fallback migrates a test user and links the Firebase account.
- Public signup route remains blocked.
- OAuth provider metadata/discovery endpoint is available.
- Auth can issue an authorization code for the seeded admin client.

**Status:** Completed 2026-05-11 for the first usable Auth slice. `apps/auth`
now has Better Auth, the OAuth Provider plugin, JWT support, Auth route
handlers, a real login UI, first-party trusted-origin callback validation,
public signup blocking, Firebase lazy migration, Firebase admin token
verification, Redis/local rate limiting, CORS for trusted first-party origins,
and well-known OAuth/OIDC metadata routes. On 2026-05-12, available upstream
SSO provider variables were copied from admin to Auth for Facebook, Google, and
Okta; Apple was not configured on admin. Verified with `pnpm --filter
@forge/auth test`, `typecheck`, `lint`, and `build`.

### Unit 4 — OAuth Token Policy, Introspection, And Revocation

**Goal:** Make token issuance policy explicit for user-delegated and
client-credentials flows.

**Files:**

- Create: `apps/auth/src/services/oauth-policy.service.ts`
- Create: `apps/auth/src/services/revocation.service.ts`
- Create: `apps/auth/src/app/api/oauth/introspect/route.ts` if Better Auth does
  not provide the exact resource-server contract needed
- Create: `apps/auth/src/app/api/oauth/revoke/route.ts` wrapper if product
  policy needs audit/reason metadata around provider revocation
- Create: `apps/auth/src/app/dashboard/tokens/page.tsx` or defer UI to Unit 7
  if service-level tests cover the first slice

**Tests:**

- Create: `apps/auth/src/services/oauth-policy.service.test.ts`
- Create: `apps/auth/src/services/revocation.service.test.ts`
- Create: `apps/auth/src/app/api/oauth/introspect/route.test.ts`
- Create: `apps/auth/src/app/api/oauth/revoke/route.test.ts`

**Scenarios:**

- User-delegated token includes user id, client id, environment, audience, and
  approved scopes only.
- Client-credentials token includes service/app principal and no human user id.
- Local/staging token is rejected for production audience.
- Revoked token fails introspection/verification.
- Suspended app or disabled membership prevents token issuance.

**Status:** Completed 2026-05-11 for the first policy slice. Auth now has
product-level token issue checks (`oauth-policy.service.ts`), revocation policy
and redacted audit event shaping (`revocation.service.ts`), and `/api/oauth`
introspection/revocation wrappers that delegate protocol behavior to Better
Auth's OAuth Provider. Verified with `pnpm --filter @forge/auth test`,
`typecheck`, `lint`, and `build`.

### Unit 5 — Admin OAuth Consumer Foundation

**Goal:** Add admin-side OAuth client support while preserving current auth as a
temporary fallback behind a feature flag.

**Files:**

- Modify: `apps/admin/src/config/env.ts`
- Create: `apps/admin/src/auth/oauth-client.ts`
- Create: `apps/admin/src/auth/oauth-state.ts`
- Create: `apps/admin/src/auth/auth-session.ts`
- Create: `apps/admin/src/app/api/auth/callback/route.ts`
- Modify: `apps/admin/src/app/login/page.tsx`
- Modify: `apps/admin/src/app/login/login-page-client.tsx`
- Modify: `apps/admin/src/auth/session.ts`

**Tests:**

- Create: `apps/admin/src/auth/oauth-client.test.ts`
- Create: `apps/admin/src/auth/oauth-state.test.ts`
- Create: `apps/admin/src/auth/auth-session.test.ts`
- Create: `apps/admin/src/app/api/auth/callback/route.test.ts`
- Modify: `apps/admin/src/app/login/page.ui.test.tsx`

**Approach:**

- Add env such as `AUTH_ISSUER_URL`, `AUTH_ADMIN_CLIENT_ID`,
  `AUTH_ADMIN_CLIENT_SECRET`, and `ADMIN_AUTH_MODE=embedded|oauth`.
- Use `ADMIN_AUTH_MODE=embedded` as default until Auth is deployed.
- Store OAuth `state`/PKCE verifier in a short-lived, admin-host cookie.
- Exchange code server-side, verify issuer/audience/expiry/state, and create an
  admin-local session.
- Do not read Auth-domain cookies in admin.

**Verification:**

- Missing/invalid state rejects callback.
- Wrong issuer/audience rejects token.
- Under-scoped admin token rejects login with generic forbidden UX.
- Successful callback creates admin-local session and redirects to dashboard.

**Status:** Foundation completed 2026-05-11. Admin now has
`ADMIN_AUTH_MODE=embedded|oauth`, OAuth authorize URL creation, PKCE/state
cookies, server-side code exchange, JWKS token verification, admin-local
session cookies, and session resolution without reading Auth-domain cookies.
Embedded auth remains the default. Added focused tests for OAuth URL creation,
token exchange, JWKS verification, invalid callback state, successful callback
session creation, logout cookie clearing, PKCE state generation, and local
session signing. Verified with `pnpm --filter @forge/admin test`, `typecheck`,
`lint`, and `build`.

### Unit 6 — Admin Permission Mapping And GraphQL Context Migration

**Goal:** Map Auth membership/scopes into admin's existing principal model and
prove protected admin behavior survives the migration.

**Files:**

- Modify: `apps/admin/src/auth/principal.ts`
- Modify: `apps/admin/src/auth/permissions.ts`
- Modify: `apps/admin/src/auth/session.ts`
- Modify: `apps/admin/src/graphql/context.ts`
- Modify: admin protected route call sites only if `requireSession` contract
  changes

**Tests:**

- Modify: `apps/admin/src/auth/permissions.test.ts`
- Modify: `apps/admin/src/graphql/context.test.ts`
- Add focused tests beside changed protected route or API handlers as needed.

**Approach:**

- Keep the current `Principal` shape if possible: map Auth grants/scopes to
  `ADMIN`/`EDITOR`/`VIEWER` for existing permission gates.
- Add scope metadata to the session only if needed for workflow/media/user-admin
  distinctions not expressible through current tiers.
- Preserve `WORKFLOW_TRIGGER` bearer behavior until service-token migration is
  complete; do not widen its permission allowlist during this unit.

**Verification:**

- Public requests remain PUBLIC.
- OAuth-authenticated admin gets expected principal.
- User missing admin grant is denied.
- Existing workflow bearer tests continue to pass.
- Admin-only settings route still requires admin authority.

**Status:** Foundation completed 2026-05-11. OAuth-authenticated users are
mapped into the existing admin `Principal` tiers during callback: `admin:access`
creates a `VIEWER` session and `admin:content:write` creates an `EDITOR`
session. `resolvePrincipalFromRequest` reads the admin-local OAuth session in
OAuth mode and leaves workflow bearer behavior untouched. Verified through the
full admin test suite and build; deeper admin-scope-to-ADMIN mapping remains a
cutover policy decision.

### Unit 7 — Auth Operator UI

**Goal:** Give operators enough UI to manage first-party apps, environment
registrations, grants/scopes, membership, tokens, audit, and revocation.

**Files:**

- Create: `apps/auth/src/app/dashboard/page.tsx`
- Create: `apps/auth/src/app/dashboard/apps/page.tsx`
- Create: `apps/auth/src/app/dashboard/apps/[id]/page.tsx`
- Create: `apps/auth/src/app/dashboard/users/page.tsx`
- Create: `apps/auth/src/app/dashboard/audit/page.tsx`
- Create: `apps/auth/src/app/dashboard/tokens/page.tsx`
- Create: `apps/auth/src/components/*` as needed

**Tests:**

- Create colocated `*.test.tsx` files for dashboard summaries and critical
  revocation actions.

**Scope control:**

- This is an internal operator UI, not an external developer portal.
- Manual operator-created partner/external app records are allowed if useful for
  validating the model.
- No public self-service registration.

**Verification:**

- Operator can inspect admin app registrations/scopes.
- Operator can suspend an app/environment/user grant and see Auth deny issuance.
- Audit list does not expose raw secrets/tokens.

**Status:** Completed 2026-05-11 for the internal read/revoke operator slice.
`apps/auth/src/app/dashboard/*` now provides protected operator pages for
overview metrics, app/environment inspection, user grant inspection, audit
review, issued token records, and operator token revocation. Production access
requires active membership plus `AUTH_OPERATOR_EMAILS`. Mutating
app/environment/user suspension remains the next hardening step before broad
operator rollout.

### Unit 8 — Deployment, Environment, And Cutover

**Goal:** Deploy Auth, configure admin as the first client, and cut admin over
from embedded mode to OAuth mode with a rollback path.

**Files:**

- Create: `apps/auth/railway.toml` if config-as-code is wired, otherwise
  document dashboard config in `apps/auth/CLAUDE.md`
- Create: `apps/auth/docs/railway-deployment.md`
- Modify: `apps/admin/.env.example`
- Modify: `apps/admin/CLAUDE.md`
- Modify: `apps/admin/AGENTS.md`
- Modify: root `CLAUDE.md` known patterns if auth posture changes repo-wide
- Create: `docs/solutions/auth/jesus-film-auth-oauth-consumer-migration.md`
  after successful cutover

**Verification:**

- `apps/auth` deployed with healthcheck passing.
- Railway `apps/auth` service has its own Postgres database, runtime env vars,
  migration command, start command, and healthcheck path.
- `auth.jesusfilm.org` points to Auth service, not admin.
- `admin.jesusfilm.org/login` redirects to Auth and returns with admin-local
  session.
- `AUTH_COOKIE_DOMAIN` no longer required for admin/Auth integration.
- Rollback is documented: set `ADMIN_AUTH_MODE=embedded` while old admin auth
  remains present.
- After observation window, create follow-up to remove embedded admin Better
  Auth route/tables/fallback.

**Status:** Completed 2026-05-11 for repository-side deployment readiness.
`apps/auth/railway.toml`, `apps/auth/docs/railway-deployment.md`,
`apps/auth/.env.example`, `apps/admin/.env.example`, `apps/admin/CLAUDE.md`,
and `apps/admin/AGENTS.md` now document the Railway service shape, Auth env
matrix, admin OAuth relying-client mode, and embedded rollback flag. Real
Railway provisioning, DNS binding, staging smoke, and production cutover remain
operational rollout steps outside this local code change.

**Provisioning update 2026-05-12:** Railway production service `@forge/auth`
and dedicated Postgres are provisioned. The service is healthy at
`https://auth.jesusfilm.org`; startup applied migration `0001_init` and seeded
the admin first-party app/OAuth clients. The `auth.jesusfilm.org` custom domain
was moved from `@forge/admin` to `@forge/auth`. Admin production envs now
include `AUTH_ISSUER_URL=https://auth.jesusfilm.org/api/auth`,
`AUTH_ADMIN_CLIENT_ID=jfp_admin_production`, and
`ADMIN_BASE_URL=https://admin.jesusfilm.org`, but `ADMIN_AUTH_MODE=oauth` is
not enabled.

## Security Review Checklist For Implementation

- Authorization code flow uses state and PKCE where supported.
- Client secrets never reach browser code.
- Redirect URLs are exact-match per app environment.
- Access tokens are audience-bound and environment-bound.
- Tokens expire and can be revoked.
- Suspended membership/app/environment/grant prevents new token issuance.
- Audit logs avoid raw credentials, bearer tokens, refresh tokens, and
  unnecessary PII.
- Firebase migration remains anti-enumeration and public signup remains blocked.
- Admin does not trust claims without issuer/audience/expiry/scope validation.
- Partner/external app trust tier cannot auto-approve production scopes.

## Test Plan

- `pnpm --filter @forge/auth test`
- `pnpm --filter @forge/auth typecheck`
- `pnpm --filter @forge/auth lint`
- `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/forge_auth pnpm --filter @forge/auth build`
- `pnpm --filter @forge/admin test`
- `pnpm --filter @forge/admin typecheck`
- `pnpm --filter @forge/admin lint`
- `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/forge_admin pnpm --filter @forge/admin build`
- Manual smoke:
  - local Auth + local Admin OAuth login
  - staging Auth + staging Admin OAuth login
  - production Auth + production Admin OAuth login
  - under-scoped user denied
  - suspended user denied
  - revoked service token denied

## Rollout Plan

1. Ship Auth app scaffold and DB model without changing admin runtime behavior.
2. Create Railway `apps/auth` service and staging environment with Auth
   Postgres, migrations, healthcheck, and seeded admin app registrations.
3. Add admin OAuth mode behind `ADMIN_AUTH_MODE`.
4. Run local and staging smoke with `ADMIN_AUTH_MODE=oauth`.
5. Bootstrap required Auth users/operators and seed app grants through
   Auth-owned flows.
6. Smoke the real `auth.jesusfilm.org` flow and cut production admin to OAuth
   mode during a low-risk window.
7. Observe auth logs, admin errors, and operator login success.
8. Keep embedded fallback for one release window.
9. Remove shared-cookie assumptions and embedded admin auth in a follow-up.

## Open Questions

### Resolved During Planning

- **Should admin share Auth cookies?** No. Admin is an OAuth/OIDC relying
  client with admin-local session state.
- **Should Auth be role-first or scope-first?** Scope-first. Roles/coarse
  standing may exist, but scopes are the cross-app authorization contract.
- **Should first-party apps require consent prompts?** No repeated consent
  prompts in v1; first-party apps are auto-approved by configuration, with
  visible/auditable grants.
- **Should API tokens be v1?** Yes. User-delegated and service tokens are in
  scope.
- **Should Auth own all app permissions?** No. Auth owns membership and app
  grants/scopes; apps own domain authorization.

### Deferred To Implementation

- Exact Better Auth OAuth Provider extension points for auto-approval and
  grant policy enforcement.
- Whether service tokens use OAuth client credentials only or also Better Auth
  API Key plugin for selected internal keys.
- Whether admin-local sessions should be Better Auth-backed, custom signed
  cookies, or DB sessions. The session must be admin-host-only either way.
- Exact invitation/bootstrap flow for first Auth operators after Railway
  provisioning.
- Whether Auth operator UI uses app-local admin sessions or bootstraps through
  the same OAuth provider path.

## Follow-Up Tickets To Create After Planning

- Remove embedded Better Auth route and tables from admin after Auth cutover.
- Migrate manager to Auth as second relying client.
- Add partner/external app registration workflow.
- Evaluate Auth as shared authorization source for service-to-service workflow
  triggers, replacing static `WORKFLOW_API_KEYS`.
