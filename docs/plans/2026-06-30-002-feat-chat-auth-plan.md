---
title: "Chat App Authentication - Plan"
type: feat
date: 2026-06-30
topic: chat-auth
artifact_contract: ce-unified-plan/v1
artifact_readiness: requirements-only
product_contract_source: ce-brainstorm
execution: code
---

# Chat App Authentication - Plan

## Goal Capsule

- **Objective:** Let end users of `apps/chat` sign in and sign out, by wiring in the existing `apps/auth` (Better Auth OIDC) provider. Authentication only — establish _who_ the user is, gate nothing.
- **Product authority:** jian wei (feat-207).
- **Open blockers:** A chat OAuth client must be registered in `apps/auth` (client id/secret + env vars) **and requested with the `openid` scope** before this can run in any environment. There is no separate "issue an id_token" configuration step: `apps/auth`'s oauth-provider issues an `id_token` automatically whenever `openid` is among the granted scopes (`isIdToken = scopes.includes("openid")` in `@better-auth/oauth-provider`). R9 establishes sessions only from the id_token, so client registration plus the `openid` scope is the hard prerequisite. This lands outside the chat codebase.

---

## Product Contract

### Summary

Add optional sign-in / sign-out to `apps/chat`, reusing admin's redirect-based OAuth client pattern against `apps/auth`. Chat stays fully usable anonymously; signing in establishes the user's identity and offers sign-out, with nothing blocked, gated, or role-checked.

### Problem Frame

`apps/chat` has no concept of a user today — conversations are client-only and every visitor is anonymous. As the chat surface moves toward features that need to know who someone is (history, preferences, per-user behavior down the line), the foundational gap is identity: there is no way to sign in. `apps/auth` already issues identities for the org and `apps/admin` already consumes it, so the missing piece is the integration into chat, not a new auth system.

### Key Decisions

- **Optional sign-in, not a login wall.** Anonymous use stays first-class; the seeker route and the chat UI remain reachable without a session. Sign-in is offered, never required.
- **Cookie-only session, no database.** Chat must display the signed-in user's identity (R4) but has no database to load it from, so the session is the user's verified identity claims — subject, name, email, picture — read from the ID token at callback and held in a signed, app-local cookie. Chat writes no user record. This matches chat's existing no-persistence boundary and keeps the work to authentication only.
- **Reuse admin's redirect OAuth flow shape; treat its code as a reference, not a template.** Two distinct things are being decided here. (1) **Flow topology — mirror it.** Chat follows the same authorization-code + PKCE redirect → callback → signed session-cookie _shape_ `apps/admin` uses, run against the same `apps/auth` provider it's already proven against in production. Do not invent a new topology. (2) **Implementation mechanism — hand-adapt admin's routes with `jose`, not an OIDC client library** (see Outstanding Questions for the rationale and rejected alternative). What is _not_ shared regardless of mechanism: chat omits admin's authorization layer entirely (Prisma user lookup, roles, permission checks) — chat needs identity, not authorization; and the session-cookie _payload_ deliberately differs — admin stores `{id, role, scopes}` and displays no identity, whereas chat stores the identity claims because it must display them (R4) and has no database to hold them. R9 also diverges from admin's verifier on purpose (dropping the `idToken ?? accessToken` fallback, which is safe in admin only because it additionally gates on the `admin:access` scope) — see that requirement.
- **Sign-in is foundational, with no functional payoff in v1.** A signed-in user gains only the display of their own identity; every downstream feature that needs identity (history, preferences) is deferred. This is an accepted bootstrap — the work exists to establish identity, not to reward it yet.
- **Sign-in / sign-out controls live in the sidebar.** The existing left rail is the home for the signed-out "Sign in" affordance and the signed-in identity + sign-out control.
- **Defer a shared auth-client package.** No shared package exists today; chat adapts the pattern within its own codebase for now — hand-rolled with `jose` directly (see the mechanism decision above and in Outstanding Questions) — rather than extracting a shared package prematurely. Extraction is revisited only if a second consumer appears.

### Actors

- A1. End user — a visitor to the chat app, anonymous by default, who may choose to sign in.
- A2. Chat app — initiates the redirect, handles the callback, holds the local session.
- A3. `apps/auth` — the OIDC provider that authenticates the user and issues identity tokens.

### Key Flows

- F1. Sign in
  - **Trigger:** A1 activates the sign-in control while signed out.
  - **Steps:** Chat (A2) redirects the browser to `apps/auth` (A3); the user authenticates with a configured provider; A3 redirects back to chat; chat verifies the identity and establishes a local session.
  - **Outcome:** The user lands back in chat, signed in, with their identity displayed.
  - **Covered by:** R1, R4, R5, R8, R9, R10

- F2. Sign out
  - **Trigger:** A1 activates the sign-out control while signed in.
  - **Steps:** Chat clears its local session.
  - **Outcome:** The user is returned to chat as anonymous; chat remains fully usable.
  - **Covered by:** R2, R6

### Requirements

**Authentication**

- R1. A signed-out user can sign in through `apps/auth` and return to chat authenticated.
- R2. A signed-in user can sign out.
- R3. Chat is fully usable without signing in — no surface is gated on auth state, including the seeker route.

**Identity and session**

- R4. When signed in, chat displays the user's identity: the provider's name when present, else the email, else a generic label; and the avatar when the provider supplies one, else initials or a generic icon. Neither name nor avatar is guaranteed by the identity scopes, so both fallbacks are required.
- R5. A signed-in session is established from verified identity claims and persists across navigation and page refresh until it expires or the user signs out.
- R6. Signing out ends chat's local session and returns the user to chat as anonymous.

**Boundary**

- R7. Auth state changes identity only — it never changes what a user is allowed to do; chat performs no role or permission checks.

**Auth flow security**

- R8. Sign-in uses authorization-code + PKCE plus a per-request `state` value bound to a short-lived cookie; chat rejects any callback whose returned `state` does not match. The transient cookie(s) carrying `state` and the PKCE `code_verifier` carry the same baseline hardening as the session cookie (R11): HttpOnly, Secure in production, host-only (no `Domain`), `SameSite=Lax` (see R11 — the callback is a top-level cross-site GET return), a short TTL, and cleared on callback. The PKCE `code_verifier` in particular must never be readable by client JS.
- R9. A session is established only from a present ID token whose signature verifies against the issuer's JWKS and whose issuer, audience (chat's client id), and expiry all check out; an absent, unverifiable, or expired ID token establishes no session. Verification must pin the issuer's expected asymmetric signing algorithm and reject `alg:none` and symmetric-algorithm confusion — signature verification against the JWKS is not complete without an algorithm allowlist. `apps/auth` signs id_tokens with **`EdDSA`** today (better-auth's `jwt()` default; no `keyPairConfig` override in `apps/auth/src/auth/config.ts`), but the allowlist **must be derived from the issuer's published JWKS `alg` at startup**, not hardcoded to `['EdDSA']`. The default only holds while the JWKS key omits an explicit `alg`: better-auth resolves `alg = key.alg ?? keyPairConfig?.alg ?? "EdDSA"`, so a future key rotation or `keyPairConfig` change on `apps/auth`'s side that carries a non-EdDSA `alg` would make a literal `['EdDSA']` pin reject **every** id_token — and because chat gates nothing, that failure surfaces only as "every sign-in silently becomes anonymous," with no error and no cross-repo alarm. Resolving the allowlist from JWKS at startup (restricted to the `alg` values actually present) keeps the pin correct across rotation; if a literal pin is ever kept for simplicity, it must carry an explicit cross-repo coupling note plus a smoke test that fetches JWKS and asserts the expected `alg`. Chat never falls back to the opaque access token for identity — this deliberately diverges from admin's `verifyAdminIdToken`, which verifies `idToken ?? accessToken` and, notably, calls `jwtVerify` with **no** `algorithms` pin; that fallback must be dropped when adapting admin's client, and the algorithm allowlist must be added — admin is safe without either only because it additionally gates on the `admin:access` scope, which chat does not, so R9's signature check is chat's sole barrier. Note: because these two changes (id-token-only, no access-token fallback; algorithm allowlist) are exactly what R9 diverges from admin on, they are **net-new relative to admin's production-proven verifier** — the reused PKCE/state/JWKS-fetch plumbing is proven, but this verifier logic is not, so it must carry its own tests: reject an access token presented as identity, reject `alg:none`, and reject a token signed with a non-allowlisted algorithm.
- R10. The post-sign-in redirect target is validated against chat's own origin; any untrusted or unparseable target falls back to chat's home, on both the success and failure paths.
- R11. The session cookie is HttpOnly, Secure in production, **`SameSite=Lax`** (not `Strict`: the cookie is set at the `/callback` route, which is reached via a top-level cross-site redirect back from `apps/auth`, and `SameSite=Strict` would withhold the cookie on exactly that navigation — leaving a freshly signed-in user appearing anonymous; `Lax` sends the cookie on the top-level cross-site GET return while still blocking cross-site subrequests, matching `apps/auth`'s own `sameSite: "lax"`), and host-only — no `Domain` attribute, scoped to chat's own host and never the parent `.jesusfilm.org` domain (per `apps/auth`'s no-shared-parent-cookie rule), `Path=/` — with a bounded lifetime chosen for chat's shared-device exposure (explicitly not inheriting admin's 7-day staff-tool value); its payload is signature-verified on read, and a cookie that fails verification or is past its embedded expiry yields the anonymous state. The cookie's own bounded lifetime is authoritative: the ID token's `exp` is verified once at callback (proving the claims were fresh at sign-in), after which the app-local cookie lifetime governs — chat does not bound the session to the ID token's `exp` (which `apps/auth` sets to 1 hour). Rationale: chat performs no authorization (R7), so ongoing token freshness buys nothing; the claims are a display-only snapshot and the only exposure of a stale snapshot is a briefly out-of-date name/avatar, not any capability. This is the same lifetime knob as the shared-device mitigation below — one short value serves both. Only the concrete number is open (see Outstanding Questions). The verified identity claims (subject, name, email, picture) are protected at rest as well as in transit: they, and any caught ID-token-verification error (which can embed token or claim fragments), must never be written to logs, error responses, or the R12 notice — the callback logs only non-PII outcome codes (matching admin's callback discipline and `apps/auth`'s "no unnecessary PII in stdout logs" posture).
- R12. When a sign-in attempt returns control to chat without a verified session — cancelled, failed, or refused by the provider — chat shows the user as anonymous with a brief notice, and the sign-in affordance stays available to retry. The notice carries no identity-claim values and no raw verification-error detail (per R11's no-PII-in-logs-or-surfaces posture); it conveys only that sign-in did not complete. A fully abandoned redirect that never returns to chat is out of chat's reach; the affordance simply reappears on the user's next visit.

### Acceptance Examples

- AE1. Anonymous use
  - **Given** a visitor who is not signed in,
  - **When** they open chat and send messages,
  - **Then** chat works exactly as today and a sign-in affordance is visible. **Covers R3.**

- AE2. Sign-in mid-conversation (accepted loss)
  - **Given** a signed-out user with an in-progress conversation,
  - **When** they start a sign-in attempt,
  - **Then** the outbound full-page redirect discards the in-progress conversation immediately, regardless of outcome; if control later returns to chat they are signed in on success or anonymous otherwise, and if they abandon the attempt (close the tab, browser Back) they do not return at all — in every case with no conversation restored. **Covers R1, R5.**

- AE3. Session expiry
  - **Given** a signed-in user whose session has expired,
  - **When** they continue using chat,
  - **Then** chat treats them as anonymous and remains fully usable. **Covers R5, R3, R11.**

- AE4. Sign-in fails, is cancelled, or is refused
  - **Given** a visitor who attempts to sign in but obtains no verified session (cancelled or an error),
  - **When** control returns to chat,
  - **Then** chat shows them as anonymous with a brief notice and keeps the sign-in affordance available to retry. **Covers R10, R12.**

### Scope Boundaries

**Deferred for later**

- A chat-side datastore. This is a deliberate v1 cut with a bounded reversal cost: the deferred features below (history, preferences) will each need a datastore keyed by the authenticated subject, but adding one later reuses the sign-in / OAuth work unchanged — only the datastore is net-new (a server-side, revocable session is additional, and only if revocation is wanted). So identity is a reusable foundation; the no-storage decision is the part later work reverses.
- Conversation persistence, user-facing history, and cross-device continuity.
- Per-user preferences or settings.
- Preserving an in-progress conversation across any sign-in redirect — completed, failed, or cancelled (accepted as lost in v1 — see AE2, AE4).
- Extracting a shared auth-client package for admin and chat.
- Inbound auth / rate-limiting on the seeker proxy (tracked separately as its own hardening).

**Outside this work's identity**

- Authorization of any kind — roles, permissions, or gating any surface (including the seeker route) on who the user is. This is authentication only.

### Dependencies / Assumptions

- This feature is feat-207; it depends on feat-205, assumed complete.
- **Chat authenticates whoever `apps/auth` authenticates — no org-only guarantee.** Chat gates nothing (R7), so who may sign in is `apps/auth`'s policy, not a chat requirement; a signed-in user gains only identity display and could already use chat anonymously. Chat imposes no membership check and treats every authenticated user as first-class. (`apps/auth`'s social / Okta providers set `disableSignUp: true` while its email/password path is open, so the population that can sign in is whatever `apps/auth` currently allows — chat neither depends on nor constrains it. That open email/password path is documented by `apps/auth` as a temporary migration artifact — its CLAUDE.md / AGENTS.md state "No public signup while migration fallback exists" — so the sign-in population is expected to narrow when the Firebase migration fallback is removed.) The "Sign in" affordance is shown to everyone. **Forward flag:** this is safe in v1 because chat persists no per-user state (cookie-only, no datastore), so no self-provisioned account can hold durable data. Any future feature that keys durable per-user state on the authenticated subject (the deferred history / preferences) must first decide whether a membership gate is required before trusting the subject as a stable principal — the id_token already carries a `https://jesusfilm.org/claims/membership_status` claim for exactly that purpose, so the gate is a claim check, not new infrastructure.
- **Prerequisite (out-of-codebase):** a chat OAuth client registered in `apps/auth` — client id/secret plus the issuer and chat-base-URL env values chat will read. **Sequencing:** because `apps/auth` requires redirect URLs to be exact-match per environment (see its CLAUDE.md security posture), the client registration (with the exact redirect URI for that environment) must land and be verified **before** chat's auth path is enabled there — mirroring the repo's documented receiver-registers-first cross-app discipline. Chat's env is entirely `.optional()`, so when the auth env vars are absent chat must degrade to anonymous-only (hide the sign-in affordance) rather than expose a sign-in that dead-ends in a `redirect_uri` mismatch at the provider with no chat-side signal.
- **Cookie-signing secret.** R11's "signature-verified on read" guarantee requires a signing secret that chat does not have today — `apps/chat/src/config/env.ts` is entirely `.optional()` so a default-off deploy boots clean, and there is no session secret (contrast admin's mandatory `ADMIN_SESSION_SECRET` in `apps/admin/src/auth/auth-session.ts`). The secret is a per-environment value that is **required on the auth path only** (the default-off anonymous deploy stays zero-prerequisite), and cookie verification MUST fail closed — yield the anonymous state, never sign or accept with a missing/placeholder secret. Rotating the secret invalidates all outstanding sessions (acceptable given the short R11 lifetime). Concrete env-var name and wiring are for planning.
- Assumes `apps/auth` is reachable from chat's deployment and from local dev (admin uses production auth for local dev; chat is expected to do the same).
- Assumes sign-out clears chat's local session only; the provider's own SSO session is untouched (matching admin), so a subsequent sign-in may not re-prompt at the provider.
- **OIDC `nonce` is intentionally omitted.** The ID token is retrieved over the back channel under authorization-code + PKCE with audience binding (R9), so front-channel ID-token replay is out of the threat model; admin's reference uses no nonce either. Nonce stays available as hardening if the flow ever moves to a front channel.
- **No server-side session / revocation — considered and rejected for v1.** apps/auth itself runs a revocable Better Auth session, but chat cannot share it cross-origin (admin's no-shared-cookie rule), so a revocable session would require chat's own session store (the deferred datastore) or per-request introspection against apps/auth — both are the complexity this MVP defers. Cookie validity governs session lifetime; the short R11 lifetime is the accepted mitigation. **Precondition on that acceptance:** the single R11 lifetime knob is the _sole_ mitigation for both shared-device lingering and the absence of revocation, and it is acceptable **only while the session is display-only** (R7 — no authorization, no durable per-user state). The first feature to trust the authenticated subject for durable or authorization decisions (the deferred history / preferences) must introduce revocation — a server-side session store or per-request introspection — **before** relying on the subject; this safety gate must not be left implicit in the deferred-datastore note.
- **Accepted risk:** with no revocation and an HttpOnly cookie, a session left signed-in on a shared device cannot be ended early from anywhere — a short R11 lifetime is the only mitigation, and until it expires the next user of that browser may be treated as the previous one (the provider's SSO session also persists, so a re-sign-in may not re-prompt).

### Outstanding Questions

**Deferred to planning**

- The exact session-cookie lifetime value and cookie naming. R11 resolves the expiry-authority question (the app-local cookie lifetime governs, not the ID token's 1-hour `exp`), so only the concrete number is open: short and audience-appropriate for shared-device exposure (not admin's 7 days), and — since it doubles as the shared-device mitigation — short enough to bound how long a session lingers on a shared browser while long enough to stay useful.
- The R12 sign-in-failure notice: its wording and placement, whether an org-less / unprovisioned-account refusal gets a distinct, actionable message (request access / contact admin) rather than a generic one, and whether a silent session expiry (AE3) surfaces a notice or downgrades quietly.
- Which OAuth scopes chat requests (identity-only: `openid` / `profile:read` / `email:read`; no `admin:access`). Note: `apps/auth`'s registered scope keys are `profile:read` / `email:read` (see `apps/auth/src/auth/config.ts` `clientRegistrationDefaultScopes`, and admin's proven authorize request in `apps/admin/src/auth/oauth-client.ts`), so request the registered `:read` keys rather than the bare OIDC `profile` / `email` names. This is consent/scope hygiene, **not** an R4-display dependency: the identity claim values reach the id*token via `apps/auth`'s `customIdTokenClaims: ({ user }) => firstPartyUserClaims(user)` (`apps/auth/src/auth/config.ts`), which emits them independent of the requested `profile:read` / `email:read` scopes and whose values override the scope-gated defaults — so R4's display is populated as long as `openid` is granted, regardless of the profile/email scope. The per-claim presence differs by column, though: `name` is DB-guaranteed (the `user.name` column is `NOT NULL` in `apps/auth/prisma/schema.prisma`) so it is effectively always present, while `picture` derives from the nullable `user.image` (`picture: user.image ?? undefined`, which drops from the token when null) and is therefore absent for users without an avatar — a normal case R4's `avatar → initials → icon` fallback already covers. **Forward flag:** the claim \_mechanism* breaks (and R4 loses its data source) only if that `customIdTokenClaims` callback is ever removed or stops emitting these fields; a per-user absent avatar is expected and handled by R4's fallback chain, not a break.

**Resolved during review**

- **Client mechanism: hand-adapt admin's routes (`jose`-based JWKS + id_token verify, per-request state / PKCE), not an OIDC client library.** Rationale: chat needs a single id_token verification at callback (no refresh / renewal / userinfo), the ~150-line surface is `jose`-backed and already proven against `apps/auth` in production, and R9's no-fallback rule is a targeted adaptation rather than a reason to abstract behind a library. The library route was considered and rejected — revisit only if a shared auth-client package (deferred above) is extracted. This mechanism choice is a planning direction, not a requirement: the binding safety net stays in R8 (state / PKCE), R9 (id_token signature + iss / aud / expiry, no access-token fallback), R10 (return-target validation), and R11 (cookie hardening), so any conforming implementation is correct regardless of mechanism.

### Sources / Research

- `apps/admin` OAuth client pattern (the reference to adapt): `apps/admin/src/app/api/auth/login/route.ts`, `apps/admin/src/app/api/auth/callback/route.ts`, `apps/admin/src/auth/oauth-client.ts`, `apps/admin/src/auth/auth-session.ts`, `apps/admin/src/auth/session.ts`. Chat omits the authorization layer in `apps/admin/src/auth/permissions.ts`.
- `apps/auth` provider config (providers, scopes, token claims): `apps/auth/src/auth/config.ts`; routes under `apps/auth/src/app/api/auth/[...all]/route.ts`.
- `apps/chat` current state: `apps/chat/src/config/env.ts` (zod, all `.optional()`); no middleware, no auth wiring, no database today.
