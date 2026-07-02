---
id: "feat-207"
title: "Chat app authentication"
owner: "jian wei"
priority: "P1"
status: "in-progress"
start_date: "2026-07-07"
duration: 5
depends_on:
  - "feat-205"
blocks:
  - "feat-209"
  - "feat-229"
tags:
  - "web"
  - "infrastructure"
---

## Resolution

**Status:** Code complete and reviewed; raised as [PR #1438](https://github.com/JesusFilm/forge/pull/1438) (`feat(chat): add optional apps/auth OIDC sign-in (feat-207)`), ready to merge. **This ticket stays `in-progress`, not `complete`** — the code work is resolved but end-to-end sign-in is not yet verified (see Residual below). The two are deliberately kept separate: the Resolution is written now because the code is done; the status waits on verification.

**What landed.** The implementation is complete, reviewed, and **ships default-off** — `chatAuthConfigured()` returns false unless the issuer, chat client id, base URL, and a real signing secret are all set, so an unconfigured deploy hides the "Sign in" affordance, the login route no-ops to home before any outbound call, and the session cookie fails closed to anonymous. Delivered as plan units U1–U8: `jose`-based hand-adapted OAuth client (authorization-code + PKCE + `state`), an id-token-only verifier with a JWKS-derived algorithm allowlist that deliberately diverges from admin's (no access-token fallback; `alg` pin admin omits), an HS256 signed identity cookie (HttpOnly / Secure-in-prod / `SameSite=Lax` / host-only / short TTL), `return_to` origin-equality validation, login/callback/logout routes + a non-redirecting `getChatIdentity()`, and the sidebar account control across the expanded / collapsed / mobile presentations. Authentication only — `/api/seeker` and every other surface behave identically signed-in and signed-out. `typecheck` / `lint` / `test` (234) / `build` all green.

**Compound docs.** [`docs/solutions/architecture-patterns/hardened-oidc-id-token-verify-jose-jwks-20260702.md`](../../solutions/architecture-patterns/hardened-oidc-id-token-verify-jose-jwks-20260702.md) — the reusable pattern (id-token-only verify, JWKS-derived alg allowlist, fail-closed config gate, cookie decode + jose/jsdom gotchas).

**Residual risk / follow-ups.**

- **Full end-to-end sign-in verification is deferred** to [feat-229](feat-229-chat-auth-register-oauth-client.md), the follow-up enablement ticket that registers chat's OAuth client (`jfp_chat_local`, redirect `http://localhost:3200/api/auth/callback` for local; the exact-match redirect URI per environment) in `apps/auth` — a **production auth-DB operator action** (`pnpm --filter @forge/auth seed:first-party-apps`, no deploy hook runs it), out of this codebase. feat-207 is merged (#1438) but **not yet end-to-end verified**, which is why the status stays `in-progress` rather than `complete`.
- The world-reachable `/api/auth/*` (and the existing `/api/seeker`) routes ship **un-rate-limited** in v1 (accepted risk; a per-IP cap is a prerequisite before the audience widens).

**Unblocked.** `feat-209` (`depends_on: feat-207`) is not unblocked yet — it clears only when this ticket flips to `complete` (after the enablement ticket lands and a real sign-in is verified).

## Problem

`apps/chat` has no concept of a user — every visitor is anonymous and conversations are client-only. Integrate the existing `apps/auth` (Better Auth OIDC) provider into the chat app so end users can sign in and sign out. This is **authentication only**: establish _who_ the user is. It does not add authorization, roles, permissions, or gating of any surface (including the `/api/seeker` route).

Full requirements + scope in `docs/plans/2026-06-30-002-feat-chat-auth-plan.md`.

## Entry Points — Read These First

1. `apps/admin/src/app/api/auth/login/route.ts` — the redirect-to-authorize entry of admin's OAuth flow (authorization-code + PKCE). The pattern chat adapts.
2. `apps/admin/src/app/api/auth/callback/route.ts` — code exchange + ID-token verification + session-cookie creation. Chat mirrors the shape, **minus** the Prisma user lookup / role resolution.
3. `apps/admin/src/auth/oauth-client.ts` — `buildAuthorizeUrl` / `exchangeAuthorizationCode` / `verifyIdToken` logic to adapt for chat. **Caution when adapting `verifyIdToken`:** admin's version verifies `idToken ?? accessToken` — do NOT copy that fallback. It is safe in admin only because admin _additionally_ gates on the `admin:access` scope; chat has no such gate, so accepting the opaque access token as identity would be a real hole (R9 forbids it). **Second caution:** admin's `jwtVerify` call passes no `algorithms` allowlist — chat must add one (R9), but **derive it from the issuer's published JWKS `alg` at startup rather than hardcoding a value.** `apps/auth` signs with `EdDSA` today (better-auth's bare `jwt()` default, no `keyPairConfig` override in `apps/auth/src/auth/config.ts`), but better-auth resolves `alg = key.alg ?? keyPairConfig?.alg ?? "EdDSA"`, so a future key rotation carrying an explicit non-EdDSA `alg` would make a hardcoded `['EdDSA']` pin reject every real id_token — surfacing only as silent all-anonymous, since chat gates nothing. A JWKS-derived allowlist stays correct across rotation (and an assumed RSA/EC default is wrong today). See R9.
4. `apps/admin/src/auth/auth-session.ts` + `session.ts` — signed-cookie create/read + `requireSession()`. Chat needs the create/read; it does **not** need a redirecting `requireSession()` (chat is anonymous-OK).
5. `apps/admin/src/auth/permissions.ts` — admin's role/permission layer. **Reference only — chat does NOT replicate this.**
6. `apps/auth/src/auth/config.ts` — provider config, advertised scopes, ID-token claims (`name`, `email`, `picture`). Source of the identity chat displays.
7. `apps/chat/src/config/env.ts` — zod env validation, all `.optional()`; where chat's new auth env vars get added (keep them optional so the app still boots unconfigured).
8. `apps/chat/src/components/shell/sidebar.tsx` (+ `sidebar-header.tsx`, the `sidebar-*` sub-components) — the left rail that hosts the signed-out "Sign in" affordance and the signed-in identity + sign-out control.

## Grep These

- `oauth` / `OAuth` / `pkce` / `codeVerifier` / `codeChallenge` in `apps/admin/src/auth/` — the flow primitives to port.
- `requireSession` / `Principal` in `apps/admin/src/auth/` — session-reading shape (chat keeps reading, drops the role/redirect parts).
- `AUTH_ISSUER_URL` / `AUTH_ADMIN_CLIENT_ID` / `AUTH_COOKIE_PREFIX` in `apps/admin` — the env var names to model chat's after (`AUTH_CHAT_CLIENT_ID`, `CHAT_BASE_URL`, etc.).
- `SignJWT` / cookie name constants in `apps/admin/src/auth/auth-session.ts` — signed app-local session cookie creation.
- `'use client'` in `apps/chat/src/components/shell/` — which sidebar components can hold the sign-in/out control vs stay presentational.

## What To Build

A redirect-based OAuth client in `apps/chat` that authenticates against `apps/auth` and holds the result in a signed, app-local session cookie — **no database**. **Mechanism is decided, not open:** hand-adapt admin's routes using `jose` directly (JWKS + id*token verify, per-request state / PKCE) — do \_not* pull in an OIDC client library. Chat needs only a single id_token verification at callback (no refresh / renewal / userinfo), the surface is small and already proven against `apps/auth` in prod, and the safety net lives in the R8–R11 requirements regardless of mechanism. See the plan's "Resolved during review" note for the rejected-library rationale. Concretely:

- Login + callback route handlers in chat (adapted from admin) implementing authorization-code + PKCE: redirect to `apps/auth`, verify the returned ID token, set a signed session cookie carrying the verified identity claims (name, email, picture). Request identity-only scopes — `openid`, `profile:read`, `email:read` (these are `apps/auth`'s registered scope keys — request them rather than the unregistered bare OIDC `profile` / `email` names) — never `admin:access`. The identity display does **not** depend on the profile/email scope: `apps/auth`'s `customIdTokenClaims` emits `name` / `email` / `picture` into the id_token independent of scope, so the display is populated as long as `openid` is granted (see the plan's scopes note).
- A logout route handler that clears chat's session cookie and returns the user to chat (anonymous).
- Server-side session reading that exposes the current identity to components **without redirecting** when absent (anonymous is a valid state).
- Sidebar UI: signed-out shows a "Sign in" control; signed-in shows the user's name (and avatar when present) plus a "Sign out" control.
- New `.optional()` auth env vars in `apps/chat/src/config/env.ts` (issuer URL, chat client id/secret, chat base URL, optional cookie prefix, and a **cookie-signing secret** — chat has none today, contrast admin's mandatory `ADMIN_SESSION_SECRET`) + `.env.example` entries. Keep them `.optional()` so the default-off deploy still boots, but cookie verification MUST fail closed to the anonymous state when the signing secret is absent/placeholder — never sign or accept with a missing secret.
- Carry over admin's auth-flow security controls (these are committed requirements, not optional): per-request OAuth `state` (CSRF) alongside PKCE; full ID-token verification (JWKS signature + issuer + audience + expiry) before any session is established, with **no fallback to the opaque access token** for identity; an origin allowlist on the post-login redirect (success and failure paths); and a short-lived (audience-appropriate, not admin's 7 days) HttpOnly + Secure-in-prod + **`SameSite=Lax`** (not `Strict` — the cookie is set on the cross-site `/callback` return and `Strict` would withhold it there) + **host-only** (no `Domain`, never `.jesusfilm.org` — apps/auth's no-shared-parent-cookie rule) session cookie that is signature-verified on read and treated as anonymous when expired/invalid. Apply the same baseline hardening (HttpOnly, Secure-in-prod, host-only, `SameSite=Lax`, short TTL, cleared on callback) to the transient `state` / PKCE `code_verifier` cookie(s).
- Handle the no-session path: when a cancelled, failed, or provider-refused sign-in (including an org-less account) returns control to chat, show the user as anonymous with a brief notice, affordance still available. A fully abandoned redirect that never returns is out of reach — the affordance just reappears on the next visit.

Detailed requirements (R1–R12), flows (F1–F2), and acceptance examples (AE1–AE4) live in `docs/plans/2026-06-30-002-feat-chat-auth-plan.md`. Run `/ce-plan` against that doc to produce the implementation plan.

## Constraints

- **Authentication only.** No roles, no permissions, no gating. Do not gate the `/api/seeker` route or any other surface on auth state.
- **Anonymous stays first-class.** Chat must remain fully usable signed out. Session-reading must not redirect unauthenticated users.
- **No database / no Prisma in chat.** The signed session cookie is the entire session. Do not add a user table or replicate admin's `resolveUser` / `permissions.ts`.
- **New env vars must be `.optional()`** so chat still boots with none set (matches the existing `env.ts` convention; avoids bricking Railway deploys).
- **Accepted limitation:** signing in mid-conversation discards the in-progress (client-only) conversation via the full-page redirect. Do not build conversation-preservation to work around it (out of scope).
- **Prerequisite (out-of-codebase):** a chat OAuth client must be registered in `apps/auth` (client id/secret) and requested with the `openid` scope before this runs in any environment. `apps/auth` issues an `id_token` automatically whenever `openid` is granted (there is no separate "issue id_token" toggle), and R9 establishes sessions only from it. Because `apps/auth` requires exact-match redirect URIs per environment, the registration must land and be verified **before** chat's auth path is enabled there; when the auth env vars are absent chat degrades to anonymous-only (hides the sign-in affordance) rather than exposing a sign-in that dead-ends at a `redirect_uri` mismatch.
- **Chat authenticates whoever `apps/auth` authenticates — no org-only guarantee, no membership check.** Chat gates nothing (auth-only), so who may sign in is `apps/auth`'s policy, not a chat concern; an authenticated outsider gains only identity display and could already use chat anonymously. Treat every authenticated user as first-class. Do not build a signup path or a membership gate. Show the "Sign in" affordance to everyone. (`apps/auth`'s open email/password path is documented there as a temporary migration artifact. Safe for v1 because chat persists no per-user state; **forward flag** for the deferred history/preferences work — keying durable state on the subject must first decide whether a membership gate is needed, and the id_token already carries a `membership_status` claim for exactly that, so it's a claim check not new infra.)
- **No PII in logs or surfaces (R11/R12).** The verified identity claims (subject, name, email, picture) and any caught id_token-verification error (which can embed token/claim fragments) must never be written to logs, error responses, or the R12 failure notice — the callback logs only non-PII outcome codes (matches admin's callback discipline and `apps/auth`'s no-unnecessary-PII-in-stdout posture).
- Identity display (R4) needs fallbacks: name → email → generic label; avatar → initials → generic icon (`picture` derives from the nullable `user.image`, so it's absent for avatar-less users; `name` is DB-guaranteed via a `NOT NULL` column but the fallback still covers empty/edge values). OIDC `nonce` is intentionally omitted (back-channel code+PKCE, audience-bound); a server-side/revocable session is considered-and-rejected for v1 (short cookie lifetime is the mitigation) — but that short-lifetime knob is the sole mitigation for both shared-device lingering and no-revocation, so the first feature to trust the subject for durable/authz decisions must add revocation before relying on it.

## Verification

- `pnpm --filter @forge/chat build` / `lint` / `typecheck` / `test` all pass.
- App still boots with **no** auth env vars set, and chat is fully usable anonymously (send messages, no sign-in required).
- With chat's OAuth client configured: sign-in redirects to `apps/auth`, returns authenticated, and the sidebar shows the user's identity.
- Sign-out clears the session and returns the user to an anonymous, still-usable chat.
- The `/api/seeker` route behaves identically signed-in and signed-out (no gating).
- Colocated tests cover the OAuth callback (token verification + cookie set) and the signed-out/anonymous path.
