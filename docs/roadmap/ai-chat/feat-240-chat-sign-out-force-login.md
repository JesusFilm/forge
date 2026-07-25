---
id: "feat-240"
title: "Chat sign-out force-login marker (no silent re-auth)"
owner: "jian wei"
priority: "P2"
status: "complete"
start_date: "2026-07-15"
duration: 1
depends_on:
  - "feat-207"
blocks:
  - "feat-241"
tags:
  - "web"
  - "infrastructure"
---

## Resolution

**Shipped:** 2026-07-13 via [PR #1539](https://github.com/JesusFilm/forge/pull/1539) (`feat(chat): force a real login page on the sign-in after sign-out (feat-240)`).

**What landed.** Web's force-login marker pattern with two deliberate divergences. The planned one: a 30-day marker `maxAge` (web: 10 minutes), sized to apps/auth's rolling SSO session. The review-driven one: this ticket originally prescribed web's delete-on-the-login-redirect consumption, but three independent reviewers (security + adversarial personas + a cross-model pass) converged on the same line — burning the marker on the redirect lets an abandoned or failed OAuth attempt disarm it, so the retry silently re-auths. The shipped shape consumes the marker on the callback's success path only and keeps it armed on every failure; this ticket's What To Build was reworded mid-implementation to match. Zero apps/auth changes; the dropped lease/revocation design stayed dropped per the Decision Record.

**Compound docs.** [Force-login marker pattern](../../solutions/architecture-patterns/post-sign-out-force-login-marker-oidc-relying-apps.md) (five-persona doc-review applied: per-app scope honesty, provider-transfer qualifier, upstream-IdP one-click caveat, provider-bump re-verification tripwire). Also rode the PR: [the dev-server pipe gotcha](../../solutions/developer-experience/background-dev-server-piped-through-head-wedges.md) and CONCEPTS.md's "User sign-in" cluster.

**Residual risk / follow-ups.** apps/web's original copy keeps the delete-on-redirect gap and 10-minute TTL — tracked as [feat-249](../platform/feat-249-web-force-login-marker-consume-on-success.md). Chat's logout remains CSRF-unchecked (bounded, accepted nuisance: a cross-site POST can only force extra login prompts, never bypass the marker). The provider-side `prompt=login` dependency carries a documented re-verification tripwire for `@better-auth/oauth-provider` bumps.

**Unblocked.** [feat-241](feat-241-chat-server-history-sidebar.md) (`depends_on: feat-240`).

## Problem

Chat's sign-out only clears the local session cookie; `apps/auth`'s SSO
session (rolling — `expiresIn` 7d + `updateAge` 1d) persists, so clicking
"Sign in" right after signing out silently re-authenticates without ever
showing a sign-in page (feat-207's recorded accepted risk). Once feat-241
exposes conversation history, that gap gets teeth on a shared browser: log
out, the next person clicks "Sign in", and they land inside the previous
user's full history.

Fix the sign-out UX with the force-login marker pattern `apps/web` already
runs in production against the same `apps/auth`. All code changes scoped to
`apps/chat`; `apps/auth` is consumed exactly as deployed.

**This ticket replaces its earlier revision** ("real sign-out + session
lease"), which called `apps/auth`'s end-session endpoint and retained a
refresh-token lease for revocation. That design is dropped — see the
Decision Record below, which is itself part of this ticket's deliverable
(the decision is recorded across the docs, not just implied by code).

## Decision Record — session revocation dropped (2026-07-13)

**What changed.** The end-session sign-out and the refresh-token session
lease are replaced by a browser-local force-login marker. Revocation is not
a precondition for feat-241 and is not planned. Accepted for the session's
current shape — an 8h cookie whose only power is reading the holder's own
conversation history. Revisit if the session gets longer or the cookie
starts gating more than that.

**Why, strongest argument first:**

1. **The lease was itself a risk.** The dropped design stored the OAuth
   refresh token inside the browser cookie, upgrading a stolen 8h identity
   snapshot into a credential that can mint fresh tokens from `apps/auth` —
   plus public-client refresh sharp edges (the old ticket's own spike
   carried a STOP condition), refresh-rotation races between two copies of
   the cookie (spurious sign-outs), and the ~4KB cookie budget. Dropping it
   removes attack surface along with work.
2. **Repo consistency.** admin and web run 7-day signed/encrypted cookies
   with no revocation; manager is the lone per-read-validation outlier.
   Chat's 8h TTL is already the most conservative session in the repo.
3. **The honest mitigations for the history capability** are the 8h TTL,
   server-side self-scoped reads (a session reads only its holder's own
   threads), and chat's plain-text message rendering (React-escaped text —
   no HTML/markdown). `HttpOnly` is deliberately NOT cited as a mitigation
   here: it prevents cookie exfiltration, not session riding — an injected
   script never needs to read the cookie to call same-origin routes, and
   revocation would not stop that either.

   > **Superseded 2026-07-20 (feat-268):** the third mitigation's wording
   > changed — assistant turns now render hardened markdown
   > (`apps/chat/src/components/chat/assistant-markdown.tsx`: element
   > allowlist, raw HTML inert-texted, https-only links; no
   > `dangerouslySetInnerHTML`, no `rehype-raw`). The invariant this
   > mitigation rests on is now "no raw HTML ever reaches the DOM", per
   > the reworded discipline in `apps/chat/CLAUDE.md`. User turns remain
   > React-escaped plain text; the mitigation itself still holds.

**Incident lever.** Rotating `CHAT_SESSION_SECRET` instantly invalidates
every chat session — everyone-at-once, zero-code (the feat-207 plan already
records rotation as invalidating all sessions and calls it acceptable).
This replaces the earlier revision's "manual row deletion in `apps/auth`'s
database" note, which — with no lease re-checking `apps/auth` — would not
affect chat's self-contained cookie at all.

**Accepted trade-off, stated plainly.** A live session runs its full 8
hours and cannot be ended early per-user, from anywhere — including for
feat-241's future conversation-history reads. This also means features like
"sign out everywhere" or forced logout on account compromise are not
possible without building revocation; the everyone-at-once kill switch is
rotating `CHAT_SESSION_SECRET`. The marker prevents accidental silent
re-auth on a shared browser, not a deliberate next user who clears chat's
cookies — the same trade web made.

## Entry Points — Read These First

1. `apps/web/src/app/api/auth/logout/route.ts` — the pattern source: sets
   the HttpOnly `*_force_login = "1"` marker alongside cookie deletion.
2. `apps/web/src/app/api/auth/login/route.ts` — reads the marker →
   `prompt=login` on the authorize URL → deletes the marker on the redirect
   response. (Chat deliberately diverges on the deletion point — see What To
   Build 2.)
3. `apps/chat/src/app/api/auth/logout/route.ts` — chat's POST logout
   (cookie-delete-only today) that gains the marker set.
4. `apps/chat/src/app/api/auth/login/route.ts` — chat's login entry that
   gains the marker check + `prompt` forwarding.
5. `apps/chat/src/auth/oauth-client.ts` — the authorize-URL builder that
   gains an optional `prompt` parameter.
6. `apps/chat/src/auth/session-cookie.ts` — cookie option helpers +
   `chatAuthCookiePrefix()`; the marker follows the same naming
   (`forge_chat_force_login`) and hardening.

## Grep These

- `WEB_AUTH_FORCE_LOGIN_COOKIE` in `apps/web/src/` — the complete pattern
  to copy (constant + both routes).
- `promptSet?.has("login")` in the installed `@better-auth/oauth-provider`
  dist — provider-side handling, confirmed present in 1.6.2 (forces the
  login page even with a live SSO session).
- `chatAuthCookiePrefix` in `apps/chat/` — the naming convention the marker
  follows.
- `buildAuthorizeUrl` (or its chat equivalent) in
  `apps/chat/src/auth/oauth-client.ts` — where `prompt` threads in.

## What To Build

1. **Marker on logout**: in chat's logout route, alongside deleting the
   session cookie, set `forge_chat_force_login = "1"` — HttpOnly, Secure in
   production, SameSite=Lax, host-only, `Path=/`, **`maxAge` 30 days** (the
   one deliberate divergence from web's 10 minutes; see 3).
2. **`prompt=login` on login**: when the marker is present, add
   `prompt=login` to the authorize URL. The marker is consumed by the
   **callback's success path only** — a failed or abandoned attempt keeps it
   armed, so the retry still forces a login page. This is a second deliberate
   divergence from web (which deletes on the login redirect): review found
   delete-on-redirect lets an abandoned/failed attempt burn the marker and
   silently re-auth the next sign-in — the exact gap this ticket exists to
   close. Web's copy has the same gap, masked by its 10-minute marker.
3. **The 30-day lifetime, and how to word the guarantee**: `apps/auth`'s
   SSO session is ROLLING (`expiresIn` 7d + `updateAge` 1d in
   `apps/auth/src/auth/config.ts`) — any SSO use extends it, so no finite
   marker can claim to cover the entire silent-re-auth window. Lifetime is
   cost-free (the marker is consumed by the first COMPLETED sign-in), and 30
   days is far beyond realistic re-visit gaps. Word the guarantee with its
   bound — "after sign-out, every sign-in on this browser within 30 days
   shows a real login page until one completes" — never an unqualified
   "always".
4. **Docs**: update `apps/chat/CLAUDE.md`'s Authentication section
   (sign-out semantics + a pointer to this Decision Record) in the
   implementation PR.

## Constraints

- **Zero `apps/auth` changes.** No code, no seed, no env. `prompt=login` is
  already handled by the deployed provider.
- **Do not resurrect the lease.** No tokens retained at callback, no
  end-session call, no refresh grant, no revoke call — the Decision Record
  above is binding.
- **Keep the 8h session TTL**; keep sign-out a POST; anonymous-first is
  untouched (sign-out on an anonymous session stays idempotent — setting
  the marker is harmless there, it only ever forces a login page).
- **Never log token material**; existing plain-string
  `[chat-auth] event=... reason=<code>` convention.
- **Per-device semantics.** Sign-out affects this browser's next sign-in
  only; "sign out everywhere" stays impossible without revocation (see the
  trade-off statement).

## Verification

- Manual against a local `apps/auth`: sign in → sign out → click "Sign in"
  → the `apps/auth` login page renders (no silent re-auth); complete that
  login → the marker is gone → sign out and sign in again to prove the
  cycle repeats.
- Route tests: logout sets the marker with the exact hardening + 30d
  `maxAge`; login with the marker present builds an authorize URL
  containing `prompt=login` and leaves the marker untouched; the callback
  deletes the marker on success and keeps it armed on failure; login
  without the marker adds no `prompt` param.
- Sign-out on an already-anonymous session stays idempotent (existing R6
  behavior).
- `pnpm --filter @forge/chat test && pnpm --filter @forge/chat lint && pnpm --filter @forge/chat typecheck`
