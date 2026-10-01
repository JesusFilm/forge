---
id: "feat-542"
title: "Burn the force-login marker on callback success, not on the login redirect"
owner: "vlad"
priority: "P2"
status: "not-started"
start_date: "2026-10-06"
duration: 2
depends_on:
  - "feat-536"
blocks: []
tags:
  - "web"
  - "auth"
---

## Problem

`docs/solutions/architecture-patterns/post-sign-out-force-login-marker-oidc-relying-apps.md`
records this exact gap and says to **apply it when the surface is next touched**.
feat-536 touched that line (converting the clear from `cookies.delete()` to the
dual-path `clearWebAuthCookie`) but changed only _how_ the marker is cleared, not
_when_ — so the trigger fired and the gap survives.

`apps/web/src/app/api/auth/login/route.ts` clears `WEB_AUTH_FORCE_LOGIN_COOKIE` on
the **login redirect**, before any OAuth outcome exists. If the user abandons the
provider's login page or the callback fails, the marker is already burned. On a
shared or kiosk browser the next sign-in then silently skips the forced
re-authentication that a previous sign-out asked for.

The 10-minute cookie TTL masks how often this is reachable; it does not fix it.

## Entry Points — Read These First

1. `docs/solutions/architecture-patterns/post-sign-out-force-login-marker-oidc-relying-apps.md`
   — the consumption-point analysis. Read before changing anything.
2. `apps/web/src/app/api/auth/login/route.ts` — the marker is read to pick
   `prompt`, then cleared in the same response.
3. `apps/web/src/app/api/auth/callback/route.ts` — the success path, where the
   marker should be consumed, and `redirectToAuthError`, where it must survive.
4. `apps/web/src/app/api/auth/logout/route.ts` — where the marker is armed.

## Grep These

- `WEB_AUTH_FORCE_LOGIN_COOKIE`
- `parsePrompt`
- `clearWebAuthCookie`
- `clearLegacyWebAuthCookie`

## What To Build

- Keep reading the marker in `login/route.ts` to choose `prompt=login`, but stop
  clearing it there.
- Clear it in `callback/route.ts` only on the success path, after the session
  cookie is established — the point at which the forced re-authentication has
  actually happened.
- Leave it intact on `redirectToAuthError` and on an abandoned attempt, so the next
  attempt is still forced.
- Keep the dual-path clear feat-536 introduced: the marker still has a legacy
  `Path=/` copy in browsers. Clear it after every `response.cookies.*` call on that
  response, per `docs/solutions/auth/narrowing-a-cookie-path-lets-the-legacy-copy-win-the-read.md`.

## Constraints

- Do NOT extend the marker's 10-minute TTL as a substitute for moving the
  consumption point.
- Do NOT treat the marker as authorization; it is a UX affordance.
- Preserve the existing `prompt` precedence: an explicit `?prompt=` query value
  still wins over the marker.

## Verification

- `pnpm --filter @forge/web test src/app/api/auth` — add cases: an abandoned login
  (no callback) leaves the marker set; a failed callback leaves it set; a
  successful callback clears it at both paths.
- Falsify each once: reverting the consumption point must turn the abandoned-login
  case red.
- `next build` + `next start`: sign out, start a login, abandon it, start again,
  and confirm the provider is still asked to re-prompt.
