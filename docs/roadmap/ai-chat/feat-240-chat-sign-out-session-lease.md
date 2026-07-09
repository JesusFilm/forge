---
id: "feat-240"
title: "Chat real sign-out + session lease (revocation)"
owner: "jian wei"
priority: "P2"
status: "not-started"
start_date: "2026-07-15"
duration: 3
depends_on:
  - "feat-207"
blocks:
  - "feat-241"
tags:
  - "web"
  - "infrastructure"
---

## Problem

Chat's session is a self-contained signed cookie (feat-207): once issued it is
valid until its 8h expiry with no server-side check, so it cannot be ended
early from anywhere — and sign-out only clears chat's local cookie while
`apps/auth`'s own SSO session persists, so clicking "Sign in" immediately
after sign-out silently re-authenticates without showing the sign-in page
(recorded as an accepted risk in the feat-207 plan, line 139/142). Both gaps
were acceptable while the cookie gated nothing. feat-241 turns this cookie
into a credential that reads a user's full conversation history, and the
feat-207 code comment in `apps/chat/src/auth/identity.ts` requires
revocation/re-verification before any feature trusts the subject that far.

This ticket makes sign-out real and the session revocable, **with all code
changes scoped to `apps/chat`** — `apps/auth` is consumed exactly as already
deployed:

1. **Real sign-out.** Sign-out ends chat's session AND the `apps/auth` SSO
   session via the OIDC RP-initiated logout endpoint (already mounted at
   `/api/auth/oauth2/end-session` by the `@better-auth/oauth-provider` plugin;
   chat's client registration already has `enableEndSession: true` and
   `postLogoutRedirectUris` seeded). Signing in afterwards shows the actual
   sign-in page. This deliberately diverges from admin's suite-SSO convention
   (admin has no signed-out state; chat is anonymous-first with sensitive
   content) — flag the divergence to the team before merge.
2. **Session lease.** Chat retains the OAuth refresh token from the callback
   exchange and periodically re-validates by performing a refresh against
   `apps/auth`'s token endpoint — a failed refresh means the session was
   revoked, and chat treats the user as signed out. Because revocation happens
   server-side in `apps/auth`'s database, every copy of the session dies
   within one lease interval, which is what feat-241's precondition needs.

## Entry Points — Read These First

1. `apps/chat/src/auth/identity.ts` — the display-only carve-out comment that
   requires revocation before history features trust the subject; this ticket
   retires that precondition.
2. `apps/chat/src/auth/oauth-client.ts` — the token exchange. The id_token is
   verified then discarded, and the refresh token is never read; both must now
   be retained (id_token for `id_token_hint` at end-session, refresh token as
   the lease).
3. `apps/chat/src/auth/session-cookie.ts` — the signed session cookie the
   retained credentials extend. Watch the ~4KB cookie budget.
4. `apps/chat/src/app/api/auth/logout/route.ts` — current local-only sign-out;
   its comment records the "matching admin" decision this ticket reverses.
5. `apps/auth/src/domain/apps.ts` — chat's client registration (read-only
   reference: `enableEndSession`, `postLogoutRedirectUris`, `refresh_token`
   grant are already seeded — verify, don't change).
6. `docs/plans/2026-06-30-002-feat-chat-auth-plan.md` — R6 and the accepted
   sign-out risk this ticket retires.

## Grep These

- `CHAT_SESSION_COOKIE` in `apps/chat/` — every reader of the session shape.
- `verifyChatIdToken` — where the id_token is currently dropped after
  verification.
- `enableEndSession` and `postLogoutRedirectUris` in `apps/auth/src/domain/` —
  confirm the seeded registration (do not modify).
- `oauth2/end-session` and `rpInitiatedLogoutEndpoint` in
  `node_modules/@better-auth/oauth-provider/dist/` — the endpoint contract
  (GET, `id_token_hint` required; deletes the session row; does NOT revoke
  tokens).

## What To Build

1. **Retain credentials at callback**: store the id_token and refresh token in
   the signed session cookie (or a sibling hardened cookie if the 4KB budget
   forces a split). Same hardening as the existing cookie (HttpOnly, Secure in
   production, SameSite=Lax, host-only).
2. **The lease**: a server-side check that performs the `refresh_token` grant
   against `apps/auth`'s token endpoint when the last successful refresh is
   older than the lease interval (~1h). Refresh failure with a definitive
   rejection → treat as signed out (clear session). Transient network errors
   must NOT sign the user out (fail toward the last known state within the 8h
   TTL, which remains the outer bound). Expose the "lease is fresh" predicate
   so feat-241 can require it before any history read.
3. **Sign-out sequence** (replaces the current cookie-delete-only route):
   revoke the refresh token via `apps/auth`'s `/api/oauth/revoke` → clear
   chat's session cookie(s) → 303 the browser through
   `/api/auth/oauth2/end-session` with `id_token_hint` and chat's registered
   `post_logout_redirect_uri` → user lands back on chat as anonymous. The
   revoke step is mandatory: end-session deletes only the SSO session row and
   does not revoke tokens, so skipping it would leave the lease alive.
4. **Verification spikes against a LOCAL `apps/auth`** (no deployed changes):
   (a) chat's public client (PKCE, no secret) can perform the refresh grant
   and revoke its own tokens; (b) end-session accepts an id_token_hint whose
   `exp` has passed (the id_token lives 1h; the session 8h — the handler
   verifies signature/issuer/audience and did not appear to check `exp`;
   prove it with a test, don't assume).
5. Update `apps/chat/CLAUDE.md` (Authentication section) — the sign-out
   semantics, the lease, and the retirement of the feat-207 accepted risk.

## Constraints

- **Zero `apps/auth` changes.** No code, no seed, no env. If spike (4a) proves
  the public client cannot refresh/revoke, STOP and surface the finding — the
  fallback (credentialing chat's client in the seed) needs explicit approval
  first; do not implement it inside this ticket.
- **Never log token material** — not the refresh token, not the id_token, not
  derived hashes. Plain-string logs with fixed non-PII reason codes only
  (existing `[chat-auth] event=... reason=<code>` convention).
- **Keep the 8h cookie TTL.** The lease shortens revocation latency; it is not
  a license to extend the session lifetime.
- **Per-device semantics.** Sign-out ends this browser's chat session and the
  SSO session it rode in on. Other devices' sessions expire via their own
  lease/TTL. "Sign out everywhere" is out of scope.
- **Anonymous-first is untouched.** The lease gates nothing in this ticket
  (feat-241 consumes it); anonymous chat keeps working with no new
  prerequisites, and all new env needs (if any) must be `.optional()` so the
  default-off deploy still boots with none set.
- No new required env vars, no rate-limiting work (tracked separately as the
  pre-audience-widening prerequisite), no operator CLI (incident lever is
  documented as manual row deletion in `apps/auth`'s database).

## Verification

- `pnpm --filter @forge/chat test && pnpm --filter @forge/chat lint && pnpm --filter @forge/chat typecheck`
- Manual against local `apps/auth`: sign in → sign out → click "Sign in" →
  the `apps/auth` login page renders (no silent re-authentication).
- Revocation test (jsdom or integration): with two copies of the same session
  cookie, sign out from one; the other's next lease check treats it as
  signed out.
- Sign-out on an already-anonymous session stays idempotent (existing R6
  behavior).
- Grep the diff for token material in any log statement — none.
