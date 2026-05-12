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

## Prevention

When adding a first-party app to Jesus Film SSO, register it as an OAuth client
with explicit redirect URIs and scopes. Do not widen Auth cookie domains to make
SSO "work"; that recreates the same coupling the Auth extraction is removing.

## Related

- `apps/auth/src/auth/config.ts`
- `apps/auth/src/scripts/seed-first-party-apps.ts`
- `apps/admin/src/auth/oauth-client.ts`
- `apps/admin/src/auth/auth-session.ts`
- `apps/admin/src/auth/session.ts`
- `apps/auth/src/auth/operator.ts`
- `apps/auth/src/app/login/login-page-client.tsx`
- `.dockerignore`
