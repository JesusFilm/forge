---
id: "feat-158"
title: "Manager login error sign-out recovery"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-06-04"
duration: 1
depends_on: []
blocks: []
tags:
  - "manager"
  - "auth"
  - "oauth"
  - "ux"
---

## Problem

When a user reaches the Manager login error page with `error=forbidden` or
another OAuth callback failure, the page explains that Manager access is
unavailable but does not give the user a way to clear the current session and
choose another Auth account.

## Entry Points - Read These First

1. `apps/manager/src/app/login/page.tsx` - login and access-error page
   composition.
2. `apps/manager/src/app/api/auth/logout/route.ts` - local Manager session and
   OAuth cookie clearing.
3. `apps/manager/src/lib/oauth-client.ts` - configured public Manager origin
   used for OAuth redirects.
4. `apps/manager/src/app/globals.css` - existing login button and auth shell
   styling.

## Grep These

- `formatLoginError` in `apps/manager/src/app/login/page.tsx`
- `login-button` in `apps/manager/src/app/globals.css`
- `prompt=login` in `apps/manager/src/app/api/auth`
- `managerBaseUrl` in `apps/manager/src/lib/oauth-client.ts`

## What To Build

1. Add a visible sign-out affordance on login error states that points to the
   Manager logout endpoint.
2. Ensure GET logout clears Manager/Auth cookies and redirects back through the
   configured public Manager origin with `prompt=login`.
3. Keep the existing login shell and error copy intact.
4. Cover both the rendered error-page affordance and the logout redirect/cookie
   behavior with focused tests.

## Constraints

- Do not change which accounts are approved for Manager access.
- Do not weaken Manager membership enforcement.
- Do not build logout redirects from the incoming request host in production;
  Railway can surface internal hosts such as `0.0.0.0:8080`.
- Do not add new environment variables.

## Verification

- `pnpm --filter @forge/manager test -- src/app/login/page.test.ts src/app/api/auth/logout/route.test.ts`
- `pnpm --filter @forge/manager typecheck`
- `pnpm --filter @forge/manager lint`
- `git diff --check`
- Local smoke: `GET /login?error=forbidden` renders "Sign out and try another
  account" with `href="/api/auth/logout"`.
- Local smoke: `GET /api/auth/logout` clears Manager/Auth cookies and redirects
  to `/api/auth/login?prompt=login` on the configured Manager origin.

## Follow-up: Auth prompt consumption

Manager's sign-out recovery intentionally adds `prompt=login` to the first
OAuth authorize hop so Auth does not silently reuse the currently forbidden
account. After the user completes an interactive Auth sign-in, Auth must treat
that prompt as consumed before resuming the relying-client OAuth authorize URL.
Otherwise Better Auth sees `prompt=login` again on
`/api/auth/oauth2/authorize` and sends the user back to `/login` immediately
after a successful Google callback.

Auth owns this continuation behavior in
`apps/auth/src/app/api/auth/[...all]/route.ts`; keep the prompt on the login
retry URL, but strip interactive prompt values from the post-sign-in
continuation URL.
