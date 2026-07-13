---
id: "feat-249"
title: "Web force-login marker: consume on callback success, not login redirect"
owner: "unassigned"
priority: "P2"
status: "not-started"
start_date: "2026-07-20"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "infrastructure"
---

## Problem

`apps/web`'s post-sign-out force-login marker is burned at the wrong moment.
Logout sets `WEB_AUTH_FORCE_LOGIN_COOKIE` so the next sign-in sends
`prompt=login` and renders a real login page instead of silently re-authing
via `apps/auth`'s live rolling SSO session. But the login route deletes the
marker on the authorize redirect itself — before any OAuth outcome exists
(`apps/web/src/app/api/auth/login/route.ts:65`). If the user abandons the
provider's login page or the callback fails, the marker is already gone and
the NEXT "Sign in" click silently re-auths into the previous user's account —
the exact shared-device hazard the marker exists to prevent.

Chat's feat-240 implementation fixed this shape: login only READS the marker;
the callback's success path consumes it; every failure path leaves it armed.
Web should match. Full pattern rationale (including why the marker's TTL
should be sized to the rolling SSO window once consumption is
success-gated) lives in
`docs/solutions/architecture-patterns/post-sign-out-force-login-marker-oidc-relying-apps.md`,
which names web's copy as the known instance of this gap.

## Entry Points — Read These First

1. `docs/solutions/architecture-patterns/post-sign-out-force-login-marker-oidc-relying-apps.md`
   — the pattern doc; "Insight 2" is this ticket, "Insight 1" is the TTL
   follow-through.
2. `apps/web/src/app/api/auth/login/route.ts` — reads the marker into
   `prompt` (line 41), then wrongly deletes it on the redirect (line 65).
   Note the `?prompt=` query passthrough (account-switch UX) is query-param
   driven and does not touch the marker cookie — leave it alone.
3. `apps/web/src/app/api/auth/callback/route.ts` — success path deletes the
   transient state/verifier/return_to cookies (lines 82–84); the failure
   catch (line 87) deletes the same three (lines 102–104). The marker delete
   belongs on the success path ONLY.
4. `apps/web/src/app/api/auth/logout/route.ts` — sets the marker with
   `maxAge: 60 * 10` (lines 39–45).
5. `apps/chat/src/app/api/auth/login/route.ts`,
   `apps/chat/src/app/api/auth/callback/route.ts`,
   `apps/chat/src/auth/session-cookie.ts` — the corrected shape to mirror,
   with colocated `*.test.ts` suites covering all five marker behaviors.

## Grep These

- `WEB_AUTH_FORCE_LOGIN_COOKIE` — every touch point of the marker in web
- `FORCE_LOGIN` in `apps/chat/src` — the reference implementation + tests
- `prompt=login` / `parsePrompt` — web's account-switch passthrough to keep

## What To Build

1. Remove `response.cookies.delete(WEB_AUTH_FORCE_LOGIN_COOKIE)` from the
   login route's redirect response.
2. Add the same delete to the callback's SUCCESS path only (alongside the
   existing transient-cookie deletes after the session cookie is set). The
   failure catch must NOT touch the marker.
3. Extend the marker's `maxAge` at logout from `60 * 10` to
   `60 * 60 * 24 * 30`, matching chat's `FORCE_LOGIN_TTL_SECONDS` and the
   pattern doc's lifetime reasoning (consume-on-success makes the long TTL
   cost-free; the 10-minute value silently expires the protection). Keep the
   existing hardening attributes unchanged.
4. Add colocated route tests (none exist for web's auth routes today),
   mirroring chat's suites: logout sets the marker with exact hardening +
   30-day TTL; login with the marker builds `prompt=login` and leaves the
   marker untouched; login without the marker emits no `prompt` param;
   callback deletes the marker on success; callback keeps it armed on
   failure.

## Constraints

- Do NOT touch web's `?prompt=` query passthrough or `parsePrompt` — the
  account-switch UX is a separate feature and is not marker-driven.
- No `apps/auth` changes; the provider is consumed exactly as deployed.
- No changes to the transient state/verifier/return_to cookie handling.
- Scope is `apps/web` only. Chat's implementation is the reference, not a
  shared-package extraction target — keep the two apps' auth routes
  independent (per-app cookie state precedent).

## Verification

- `pnpm --filter @forge/web test -- src/app/api/auth` — all five marker
  behaviors covered and green.
- Manual smoke against local or preview: sign in, sign out, click "Sign in",
  close the provider's login page, click "Sign in" again → a real login page
  must render (pre-fix: silent re-auth straight into the previous session).
- Update the "known instance" note in
  `docs/solutions/architecture-patterns/post-sign-out-force-login-marker-oidc-relying-apps.md`
  (When to Apply, last bullet) to record that web now matches chat's shape.
