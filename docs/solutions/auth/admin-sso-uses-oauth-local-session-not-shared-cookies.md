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
- `ADMIN_AUTH_MODE=embedded` keeps the old embedded auth path available until
  Auth is deployed and seeded.
- `ADMIN_AUTH_MODE=oauth` switches admin login/session resolution to OAuth
  without reading Auth-domain cookies.
- Auth operator surfaces must have their own explicit access policy. Active
  membership alone is too broad; use `AUTH_OPERATOR_EMAILS` in production until
  operator-specific grants are modeled.
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

## Prevention

When adding a first-party app to Jesus Film SSO, register it as an OAuth client
with explicit redirect URIs and scopes. Do not widen Auth cookie domains to make
SSO "work"; that recreates the same coupling the Auth extraction is removing.

When smoke-testing the deployed OAuth path, verify the whole unauthenticated
redirect chain:

1. `https://admin.jesusfilm.org/dashboard` redirects to `/login`.
2. `https://admin.jesusfilm.org/login` redirects to `/api/auth/login`.
3. `/api/auth/login` sets `forge_admin_oauth_state`,
   `forge_admin_oauth_verifier`, and `forge_admin_oauth_callback` as host-only
   Admin cookies and redirects to Auth's OAuth authorize endpoint.
4. Auth's authorize endpoint redirects unauthenticated users to the Auth login
   page while preserving the OAuth request parameters.

This catches the production failure mode where local tests passed but the
deployed `/login` page returned:

```text
Cookies can only be modified in a Server Action or Route Handler.
```

## Related

- `apps/auth/src/auth/config.ts`
- `apps/auth/src/scripts/seed-first-party-apps.ts`
- `apps/admin/src/auth/oauth-client.ts`
- `apps/admin/src/auth/auth-session.ts`
- `apps/admin/src/auth/session.ts`
- `apps/admin/src/app/api/auth/login/route.ts`
- `apps/admin/src/app/login/page.tsx`
- `apps/auth/src/auth/operator.ts`
- `apps/auth/src/app/login/login-page-client.tsx`
- `.dockerignore`
