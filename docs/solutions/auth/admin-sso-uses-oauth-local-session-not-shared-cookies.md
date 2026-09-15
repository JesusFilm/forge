---
title: "Admin SSO should use OAuth with an admin-local session, not shared Auth cookies"
category: auth
date: 2026-05-11
tags:
  - auth
  - oauth
  - sso
  - admin
  - better-auth
problem_type: architecture
component: apps/admin/src/auth/session.ts
last_updated: 2026-05-12
---

## Problem

`auth.jesusfilm.org` and `admin.jesusfilm.org` should not depend on a shared
`.jesusfilm.org` session cookie. That coupling makes Auth hard to extract,
breaks across domain/deployment boundaries, and prevents admin from behaving
like a normal OAuth relying application.

## Solution

Keep Auth cookies scoped to `apps/auth`. Admin starts an OAuth authorization
code + PKCE flow, verifies the returned token server-side, then creates its own
admin-host session cookie.

In this shape:

- Auth owns identity, global membership, app registrations, grants, and scopes.
- Admin owns its local session, role mapping, GraphQL permission checks, and
  domain ABAC.
- The `ADMIN_AUTH_MODE=embedded|oauth` toggle was a migration-era bridge and
  is now REMOVED (2026-09-07 refresh: zero hits in `apps/admin/src`) — admin
  is unconditionally OAuth-only.
- Auth operator surfaces must have their own explicit access policy. Active
  membership alone is too broad. The shipped gate is `canAccessAuthOperator`
  (`apps/auth/src/auth/operator.ts`): a blanket non-production disable until
  operator-specific grants are modeled. (An earlier `AUTH_OPERATOR_EMAILS`
  allowlist idea never shipped.)
- Upstream SSO provider credentials belong on the Auth service once Auth owns
  login. Copy existing admin provider envs to Auth and verify provider buttons
  from the live login page without printing client secrets.
- Railway deploy context should ignore local Next build output (`**/.next`) so
  local verification artifacts are not copied into the deployment image.
- In Next.js App Router, start the Admin OAuth flow from a Route Handler, not
  directly inside the `/login` page render. OAuth initiation must set
  short-lived PKCE/state/callback cookies before redirecting to Auth; Next.js
  16 only allows those cookie mutations in a Server Action or Route Handler.
  Keep `/login` responsible for resolving the callback URL, then redirect to an
  admin-local route such as `/api/auth/login` to set cookies and build the Auth
  authorize URL.
- Better Auth's JWT plugin requires a persisted `jwks` model when Auth is an
  OAuth provider. The Prisma model must expose `prisma.jwks` and include
  `publicKey`, `privateKey`, `createdAt`, optional `expiresAt`, plus nullable
  `alg` and `crv` because generated keys include those values. Missing this
  model causes Admin callback failures during token exchange even after the user
  successfully signs in.

## Prevention

When adding a first-party app to Jesus Film SSO, register it as an OAuth client
with explicit redirect URIs and scopes. Do not widen Auth cookie domains to make
SSO "work"; that recreates the same coupling the Auth extraction is removing.

When smoke-testing the deployed OAuth path, verify the whole unauthenticated
redirect chain:

1. `https://admin.jesusfilm.org/dashboard` redirects unauthenticated
   requests straight to `/api/auth/login?returnTo=/dashboard`
   (`apps/admin/src/auth/session.ts` — the interim `/login` page was later
   removed; there is no admin login page).
2. `/api/auth/login` sets the host-only OAuth cookies (prefix from
   `AUTH_COOKIE_PREFIX`, default `forge_admin`: `_oauth_state`,
   `_oauth_verifier`, `_oauth_return_to`, `_oauth_access_request` — see
   `apps/admin/src/auth/auth-session.ts`) and redirects to Auth's OAuth
   authorize endpoint.
3. Auth's authorize endpoint redirects unauthenticated users to the Auth login
   page while preserving the OAuth request parameters.

This catches the production failure mode where local tests passed but the
deployed `/login` page returned:

```text
Cookies can only be modified in a Server Action or Route Handler.
```

Also verify `https://auth.jesusfilm.org/api/auth/jwks` returns a key set after
deploying Auth as an OAuth provider. A production callback failure with:

```text
Auth code exchange failed.
```

can be caused by the token endpoint failing to sign OAuth tokens because the
Better Auth JWKS model is absent from the generated Prisma client or database.

## Related

- `apps/auth/prisma/schema.prisma`
- `apps/auth/src/auth/config.ts`
- `apps/auth/src/scripts/seed-first-party-apps.ts`
- `apps/admin/src/auth/oauth-client.ts`
- `apps/admin/src/auth/auth-session.ts`
- `apps/admin/src/auth/session.ts`
- `apps/admin/src/app/api/auth/login/route.ts`
- `apps/auth/src/auth/operator.ts`
- `apps/auth/src/app/login/login-page-client.tsx`
- `.dockerignore`
