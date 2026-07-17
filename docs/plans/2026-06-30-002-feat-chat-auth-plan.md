---
title: "Chat App Authentication - Plan"
type: feat
date: 2026-06-30
topic: chat-auth
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-brainstorm
execution: code
enriched: 2026-07-01
---

> **Amendment (2026-07-13, feat-240 rewording):** the revocation precondition
> recorded below ("the first feature to trust the authenticated subject for
> durable or authorization decisions must introduce revocation FIRST", under
> Dependencies / Assumptions) and the related accepted-risk framing are
> superseded. feat-240 was reworded to a web-pattern force-login marker
> (sign-out forces a real login page on the next sign-in; no end-session
> call, no refresh-token lease), and revocation is not a precondition for
> feat-241 and is not planned — accepted for an 8h cookie whose only power is
> reading the holder's own conversation history; revisit if the session gets
> longer or the cookie starts gating more than that. The everyone-at-once
> incident lever is rotating `CHAT_SESSION_SECRET` (already noted below as
> invalidating all sessions). Decision record:
> `docs/roadmap/ai-chat/feat-240-chat-sign-out-force-login.md`. The original
> text below is unmodified.

> **Product Contract preservation:** Product Contract unchanged. `ce-plan`
> enriched this file in place (2026-07-01) with the Planning Contract, High-Level
> Technical Design, Implementation Units (U1–U8), Verification Contract, and
> Definition of Done below. The Goal Capsule, Product Contract, requirements
> (R1–R12), flows (F1–F2), and acceptance examples (AE1–AE4) above are carried
> forward verbatim.

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
  - **Covered by:** R1, R4, R5, R8, R9, R10, R11

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

---

## Planning Contract

### Research Consolidation

Confirmed against the worktree at `feat/chat-auth-impl` (cut from `origin/main`):

- **Admin's OAuth client is the reference to adapt, and it is small.** The whole
  flow is five files: `apps/admin/src/auth/oauth-state.ts` (PKCE + `state`
  generation via `node:crypto`), `apps/admin/src/auth/oauth-client.ts`
  (`buildAdminAuthorizeUrl` / `exchangeAdminAuthorizationCode` /
  `verifyAdminIdToken`), `apps/admin/src/auth/auth-session.ts` (signed-cookie
  create/read via `jose` `SignJWT`/`jwtVerify` + cookie-option helpers),
  `apps/admin/src/app/api/auth/login/route.ts`, and
  `.../callback/route.ts`. Chat mirrors the _shape_ of all five, drops the
  Prisma `resolveAdminUser` + role/`admin:access` gating, and changes the
  session-cookie payload from `{id, role, scopes}` to the identity claims.
- **`verifyAdminIdToken` has exactly the two holes R9 forbids.**
  `apps/admin/src/auth/oauth-client.ts:126` does `const token = idToken ??
accessToken` and `apps/admin/src/auth/oauth-client.ts:128` calls `jwtVerify`
  with `{ issuer, audience }` and **no** `algorithms`. Chat must drop the
  fallback (verify the id_token only; absent id_token → no session) and add a
  JWKS-derived `algorithms` allowlist.
- **`apps/auth` signs with EdDSA today, via the bare `jwt()` plugin.**
  `apps/auth/src/auth/config.ts:122` is `jwt()` with no `keyPairConfig`, so
  `alg` resolves to the `"EdDSA"` default. Registered scopes
  (`clientRegistrationDefaultScopes`, line 150) are `["openid", "profile:read",
"email:read"]` — the `:read` keys chat must request. `customIdTokenClaims`
  (line 165) emits `name` (from `user.name`), `picture` (from `user.image ??
undefined`, so absent for avatar-less users), `email`, and
  `https://jesusfilm.org/claims/membership_status` into the id_token
  independent of the profile/email scopes.
- **JWKS + authorize + token endpoints resolve against the issuer origin.**
  Admin builds them with `new URL("/api/auth/oauth2/authorize", issuerUrl)` etc.
  With `AUTH_ISSUER_URL=https://auth.jesusfilm.org/api/auth`, the absolute paths
  resolve to `.../api/auth/oauth2/{authorize,token}` and `.../api/auth/jwks`.
- **`jose` is not yet a chat dependency.** `apps/chat/package.json` has no
  `jose`; admin pins `^6.1.3`. U1 adds it at the same version.
- **Chat's `env.ts` pattern is settled and must be matched.**
  `apps/chat/src/config/env.ts` uses `emptyToUndefined` (Railway/Doppler inject
  `""` for unset), a single `envSchema.parse({...})`, and all-`.optional()`
  fields; boots clean with nothing set. New auth vars slot into the same schema.
- **Chat has no session secret today.** Contrast admin's mandatory
  `ADMIN_SESSION_SECRET` (`auth-session.ts:142`). The new cookie-signing secret
  is `.optional()` at schema level but cookie create/verify **fails closed** to
  anonymous when it is absent or a placeholder (Dependency note; R11).
- **The sidebar is a clean composition seam.** `sidebar.tsx` (`'use client'`)
  lays out `SidebarHeader` / `NewConversationButton` / `ConversationList`. A new
  presentational account row (signed-out "Sign in" / signed-in identity +
  "Sign out") slots at the rail's foot. Identity is read server-side and passed
  down from `page.tsx` → `AppShell` → `Sidebar`, mirroring the existing
  `seekerEnabled` prop threading (`page.tsx` is already `force-dynamic`).
- **Institutional learnings that bind this work** (root `CLAUDE.md`): opt-in
  scaffolding env vars must be `.optional()` (the required-env-var-broke-Railway
  learning); Railway logsV2 silences JSON-stringified stdout in Next.js runtime
  route handlers — use `[label] event=name key=value` plain-string logs;
  outbound timeout must be shorter than the caller's budget (the callback's
  token-exchange + JWKS fetch); Tier-2 `/ce-code-review` is mandatory before
  push for auth surfaces.

External research: **not run.** The mechanism (hand-adapt admin's `jose`-based
routes) is decided in the Product Contract, the reference implementation is
in-repo and production-proven against `apps/auth`, and R8–R11 carry the safety
net. No external option set is open. (This matches the "skip when a strong local
pattern exists" rule; no explicit external-research request was made.)

### Key Technical Decisions

- **KTD1 — Namespace chat's auth code under `apps/chat/src/auth/` and its routes
  under `apps/chat/src/app/api/auth/{login,callback,logout}/route.ts`.** Mirrors
  admin's layout exactly so the adaptation is a structural port. No shared
  package (Product Contract defers extraction).
- **KTD2 — Session-cookie payload is the verified identity claims, not a
  principal.** `{ sub, name?, email?, picture? }` signed with `HS256` via `jose`
  `SignJWT` (same primitive as admin), `setExpirationTime` = the chosen TTL. On
  read, `jwtVerify` with `{ algorithms: ["HS256"] }`; any failure → `null` →
  anonymous. This is the entire session — no DB, matching admin's cookie
  mechanism but not its payload.
- **KTD3 — id_token verification pins a JWKS-derived algorithm allowlist and
  never falls back to the access token.** `verifyChatIdToken` verifies the
  `id_token` only (absent → throw → anonymous). It resolves the `algorithms`
  allowlist from the issuer's published JWKS and calls `jwtVerify(idToken, jwks,
{ issuer, audience: clientId, algorithms })`.
  - **What the allowlist actually guarantees (reviewer-corrected).** Key
    resolution uses `jose` `createRemoteJWKSet`, which resolves only _asymmetric_
    JWKS keys — so a symmetric (`HS*`) token is already rejected at key
    resolution regardless of the `algorithms` value. The allowlist's real jobs
    are therefore (a) rejecting `alg: none` and (b) **tracking a key rotation to
    a different asymmetric `alg`** so a hardcoded `["EdDSA"]` pin can't silently
    reject every id_token. Do not describe the allowlist as the symmetric-
    confusion barrier — `createRemoteJWKSet` is that barrier; the allowlist is
    the none-rejection + rotation-tracking barrier.
  - **Endpoint URLs use the `new URL(absolutePath, issuerUrl)` form, NOT string
    concatenation.** Build the JWKS, authorize, and token URLs exactly as admin
    does — `new URL("/api/auth/jwks", issuerUrl)`, `new URL("/api/auth/oauth2/
token", issuerUrl)`, `new URL("/api/auth/oauth2/authorize", issuerUrl)`
    (`apps/admin/src/auth/oauth-client.ts:96,127`). The absolute path resolves
    against the issuer _origin_ and is correct for any `AUTH_ISSUER_URL` shape;
    `${issuer}/jwks` concatenation silently breaks (404 → silent-anonymous) when
    the issuer string carries a trailing slash or omits `/api/auth`.
  - **`alg` derivation is a total `kty`+`crv` function that fails closed
    loudly.** Prefer each JWK's explicit `alg` when present. For a key that omits
    `alg`, derive from `kty`+`crv`: `OKP`+`Ed25519`→`EdDSA`, `OKP`+`Ed448`→
    `EdDSA`, `EC`+`P-256`→`ES256`, `EC`+`P-384`→`ES384`, `EC`+`P-521`→`ES512`,
    `RSA`→`RS256`. An unrecognized `kty`/`crv` pair with no explicit `alg` must
    **fail closed loudly** — contribute nothing to the allowlist AND log a
    distinct non-PII config-error code — never silently drop, since an empty
    allowlist reproduces the exact "all sign-ins go anonymous, no alarm" mode R9
    exists to prevent.
  - **The allowlist cache is invalidated, not pinned for process lifetime.** A
    naive "memoize at first use forever" defeats the rotation-tracking goal: a
    long-lived process that computed its allowlist before an `apps/auth` key
    rotation keeps rejecting every post-rotation id_token until redeploy — the
    same silent-anonymous failure, just deferred to rotation time. Bind the
    allowlist to the same JWKS material `createRemoteJWKSet` uses, OR give it a
    bounded TTL, OR re-derive once on an algorithm-mismatch verify failure before
    giving up. `createRemoteJWKSet` self-heals on unknown-`kid`; the allowlist
    cache must not lag it.
  - If the JWKS fetch fails, verification fails closed (no session, logged
    non-PII code) rather than proceeding without a pin.
- **KTD4 — Cookie hardening: `HttpOnly`, `Secure` in production, `SameSite=Lax`,
  host-only (no `Domain`), `Path=/`, short TTL.** `SameSite=Lax` (not `Strict`)
  because the cookie is set on the top-level cross-site GET return to
  `/api/auth/callback` — `Strict` would withhold it there and the freshly
  signed-in user would appear anonymous (R11). Host-only per `apps/auth`'s
  no-shared-parent-cookie rule. The transient `state` / `code_verifier` /
  `return_to` cookies get the same baseline hardening plus a ~10-minute TTL and
  are deleted on callback (matching admin's `login`/`callback`).
- **KTD5 — Session TTL is a named constant, chosen short for shared-device
  exposure — recommend 8 hours.** Explicitly not admin's 7 days (staff tool).
  The cookie's own lifetime is authoritative; the id*token's `exp` (≈1h from
  `apps/auth`) is verified once at callback and not carried onto the session
  (R11 — chat gates nothing, so token freshness buys nothing; the claims are a
  display-only snapshot). 8h keeps a workday session useful while bounding
  shared-browser lingering; the exact number is an Open Question the
  implementer may set — it is a one-constant change. **Forward flag:** this TTL
  is the \_sole* mitigation for both shared-device lingering and no-revocation,
  acceptable only while the session is display-only. **Make the display-only
  invariant structurally visible, not just documented:** the session payload
  stays display-fields-only (already the case), and `getChatIdentity()` carries a
  code-level comment that its output must never gate authorization — so the first
  future PR tempted to read the cookie's `sub` for a gated decision (where the 8h
  staleness and no-revocation would suddenly matter) meets the constraint at the
  call site, not only in this plan.
- **KTD6 — Config gate `chatAuthConfigured()` degrades the whole feature to
  anonymous-only when the auth env is absent.** The prerequisite (an
  `apps/auth`-registered chat OAuth client with an exact-match redirect URI per
  environment) lands out-of-codebase and before enablement. When the required
  auth vars (issuer, client id, base URL, signing secret) are unset or the
  signing secret is a placeholder, `chatAuthConfigured()` is `false`: the
  sidebar hides the "Sign in" affordance and the login route refuses to start a
  flow, so chat never exposes a sign-in that dead-ends in a `redirect_uri`
  mismatch. Read server-side and passed down like `seekerEnabled`.
- **KTD7 — No-PII logging discipline.** The callback logs only non-PII outcome
  codes in the `[chat-auth] event=<name> reason=<code>` plain-string format
  (Railway logsV2 silences JSON stdout). It never logs the verified claims
  (`sub`/`name`/`email`/`picture`) or the caught verification error (which can
  embed token/claim fragments). The R12 failure notice carries no claim values
  and no raw error detail (R11/R12).
- **KTD8 — Return-target validation against chat's own origin.** A
  `resolveChatReturnToURL(returnTo, fallback)` helper (ported from admin's
  `origins.ts`) validates any post-login target against chat's configured base
  origin and falls back to chat's home on untrusted/unparseable input — on both
  success and failure paths (R10). Chat's base origin comes from a new
  `CHAT_BASE_URL` env var.

---

## High-Level Technical Design

Sign-in flow (F1), showing where each requirement binds. The callback is the
security-critical step; everything before the signed session-cookie is set is
verification.

```mermaid
sequenceDiagram
    autonumber
    participant U as User (browser)
    participant C as apps/chat (routes + server)
    participant A as apps/auth (OIDC)

    Note over C: chatAuthConfigured() must be true (KTD6) — else no affordance
    U->>C: GET /api/auth/login
    C->>C: create state + PKCE (S256); set state/verifier/return_to cookies (HttpOnly, Lax, host-only, ~10m TTL) — R8
    C-->>U: 302 → apps/auth authorize (scope: openid profile:read email:read; NEVER admin:access)
    U->>A: authenticate
    A-->>U: 302 → /api/auth/callback?code&state
    U->>C: GET /api/auth/callback?code&state (cookie sent — Lax allows top-level GET, KTD4)
    C->>C: reject if state ≠ state-cookie OR verifier missing — R8
    C->>A: POST token (code + code_verifier + client creds)
    A-->>C: { id_token, access_token, scope }
    C->>A: fetch JWKS (memoized) → derive alg allowlist — KTD3/R9
    C->>C: verify id_token: JWKS sig + iss + aud(clientId) + exp + alg allowlist; NO access-token fallback — R9
    C->>C: sign session cookie { sub, name?, email?, picture? } (HS256, short TTL); clear transient cookies — R11/KTD2/KTD5
    C-->>U: 302 → validated return_to (else chat home) — R10
    Note over C: any failure → log non-PII code, 302 home, R12 notice, anonymous — R12/KTD7
```

Session read (every request / F2 sign-out): `getChatIdentity()` reads the
session cookie, `jwtVerify`s it (HS256), returns `{ sub, name?, email?, picture?
} | null`. Never redirects (anonymous is valid — R3). Sign-out
(`/api/auth/logout`) clears the cookie and 302s home (R6); `apps/auth`'s own SSO
session is untouched (Dependency note).

---

## Output Structure

New files (chat only; no other app or package changes except the `jose` dep):

```
apps/chat/src/
  auth/
    oauth-state.ts            state + PKCE (S256) via node:crypto  [U2]
    oauth-state.test.ts                                            [U2]
    oauth-client.ts           authorize URL + token exchange + verifyChatIdToken (alg allowlist, no fallback)  [U3]
    oauth-client.test.ts                                           [U3]
    session-cookie.ts         signed identity cookie: create/read + options; fail-closed on missing secret  [U4]
    session-cookie.test.ts                                         [U4]
    origins.ts                resolveChatReturnToURL + base-origin  [U5]
    origins.test.ts                                                [U5]
    identity.ts               getChatIdentity() server-side reader  [U6]
    identity.test.ts                                               [U6]
  app/api/auth/
    login/route.ts            redirect → apps/auth; set transient cookies  [U6]
    login/route.test.ts                                            [U6]
    callback/route.ts         verify + set session; fail → notice  [U6]
    callback/route.test.ts                                         [U6]
    logout/route.ts           clear session → home              [U6]
    logout/route.test.ts                                           [U6]
  components/shell/
    sidebar-account.tsx       signed-out "Sign in" / signed-in identity + "Sign out"  [U7]
    sidebar-account.test.tsx                                       [U7]
    sidebar.tsx               mount the account row                [U7]  (modified)
    sidebar-collapsed-styles.ts  + account/accountLabel/signOut slots  [U7]  (modified)
    app-shell.tsx             thread identity/authConfigured/signInError  [U7]  (modified)
  app/page.tsx                read getChatIdentity() + chatAuthConfigured()  [U7]  (modified)
  config/env.ts               + auth vars + chatAuthConfigured()   [U1]  (modified)
apps/chat/.env.example        + auth var block                     [U1]  (modified)
apps/chat/package.json        + jose ^6.1.3                        [U1]  (modified)
apps/chat/CLAUDE.md           + Authentication section             [U8]  (modified)
apps/chat/README.md           + auth env/feature note (if applicable)  [U8]  (modified)
```

---

## Implementation Units

Dependency order: U1 → U2/U3/U4/U5 (parallelizable primitives) → U6 (routes +
reader, depends on U2–U5) → U7 (sidebar, depends on U6) → U8 (docs). Each unit is
one atomic commit.

### U1. Auth env vars, `jose` dependency, and the config gate

- **Goal:** Add the `.optional()` auth env vars, the `jose` dependency, and the
  `chatAuthConfigured()` gate so the feature can be wired but the default-off
  deploy still boots clean.
- **Requirements:** R11 (signing secret), KTD6, Dependency notes (prerequisite,
  cookie-signing secret).
- **Dependencies:** none.
- **Files:** `apps/chat/src/config/env.ts` (modify), `apps/chat/.env.example`
  (modify), `apps/chat/package.json` (modify — add `"jose": "^6.1.3"`),
  `apps/chat/src/config/env.test.ts` (modify).
- **Approach:** Extend `envSchema` with all-`.optional()` string fields, threaded
  through the same `emptyToUndefined` wrapper: `AUTH_ISSUER_URL`,
  `AUTH_CHAT_CLIENT_ID`, `AUTH_CHAT_CLIENT_SECRET`, `CHAT_BASE_URL`,
  `CHAT_SESSION_SECRET`, `AUTH_COOKIE_PREFIX` (optional; default `forge_chat`).
  Model the names on admin's (`AUTH_ISSUER_URL`/`AUTH_ADMIN_CLIENT_ID`/
  `AUTH_COOKIE_PREFIX`). Add `chatAuthConfigured(): boolean` — true only when
  issuer, client id, base URL, and a real signing secret are all present. The
  signing-secret check is **concrete, not just "present"** (the whole fail-closed
  guarantee rides on it): reject the empty string, reject the exact placeholder
  value shipped in `.env.example`, and require a minimum length (≥32 chars) —
  otherwise a copy-paste deploy that leaves the documented placeholder in place
  signs real sessions with a guessable secret, silently defeating R11's
  signature-verified-on-read. Keep the `.env.example` placeholder and the
  rejected sentinel single-sourced so they can't drift. Add `.env.example` entries with the
  same commented, self-documenting style as the Seeker block, noting the
  out-of-codebase client-registration prerequisite and that the secret is
  required only on the auth path.
- **Patterns to follow:** `apps/chat/src/config/env.ts` (`emptyToUndefined`, all
  `.optional()`, single `envSchema.parse`); `apps/admin/src/config/env.ts` var
  naming.
- **Test scenarios:**
  - `chatAuthConfigured()` returns `false` when all auth vars are unset (parse
    succeeds, app boots). **Covers AE1** (anonymous-usable with no config).
  - Returns `false` when issuer/client-id/base-URL present but signing secret
    absent.
  - Returns `false` when the secret equals the exact `.env.example` placeholder
    value (assert against the shipped placeholder so the sentinel and the example
    can't drift), when it is empty, and when it is shorter than the 32-char
    minimum.
  - Returns `true` only when issuer, client id, base URL, and a real (≥32-char,
    non-placeholder) signing secret are all set.
  - `envSchema.parse` does not throw with an empty environment (every field
    `.optional()`, `""` coerced to `undefined`).
- **Verification:** `pnpm --filter @forge/chat typecheck` clean; env unit test
  green; app boots with no auth env set.

### U2. OAuth state + PKCE primitive

- **Goal:** Generate a per-request `state` and a PKCE `code_verifier` /
  S256 `code_challenge`.
- **Requirements:** R8.
- **Dependencies:** none (pure; can land alongside U1).
- **Files:** `apps/chat/src/auth/oauth-state.ts`,
  `apps/chat/src/auth/oauth-state.test.ts`.
- **Approach:** Direct port of `apps/admin/src/auth/oauth-state.ts` —
  `createOAuthState()` using `node:crypto` `randomBytes` + `createHash("sha256")`
  - `base64url`. No divergence from admin here.
- **Patterns to follow:** `apps/admin/src/auth/oauth-state.ts` verbatim.
- **Test scenarios:**
  - `code_challenge` equals `base64url(sha256(code_verifier))` (S256 contract).
  - `state` and `code_verifier` are non-empty, URL-safe, and differ across calls
    (randomness — vary by asserting two successive calls are unequal).
- **Verification:** unit test green.

### U3. OAuth client: authorize URL, token exchange, and hardened id_token verify

- **Goal:** Build the authorize URL with identity-only scopes, exchange the code,
  and verify the id_token with a JWKS-derived algorithm allowlist and no
  access-token fallback.
- **Requirements:** R1, R9; KTD3.
- **Dependencies:** U1 (env + `jose`).
- **Files:** `apps/chat/src/auth/oauth-client.ts`,
  `apps/chat/src/auth/oauth-client.test.ts`.
- **Approach:** Adapt `apps/admin/src/auth/oauth-client.ts`. `getChatOAuthConfig()`
  reads chat's env; `getChatOAuthRedirectUri()` = `${CHAT_BASE_URL}/api/auth/callback`.
  `buildChatAuthorizeUrl` requests scope `"openid profile:read email:read"` —
  **never `admin:access`** — with `code_challenge_method=S256`, built via
  `new URL("/api/auth/oauth2/authorize", issuerUrl)`.
  `exchangeChatAuthorizationCode` posts to `new URL("/api/auth/oauth2/token",
issuerUrl)` (**not** `${issuer}/oauth2/token` string concatenation — the
  absolute-path form resolves against the issuer origin and is correct for any
  `AUTH_ISSUER_URL` shape; concatenation 404s on a trailing slash or a bare
  origin — KTD3), Basic auth when a client secret is configured.
  `verifyChatIdToken({ idToken })`:
  - throws when `idToken` is absent (no access-token fallback);
  - resolves the algorithm allowlist via `getChatIdTokenAlgorithms()` — fetch
    `new URL("/api/auth/jwks", issuerUrl)`, prefer each key's explicit `alg`,
    else derive from the full `kty`+`crv` mapping (KTD3), drop `alg: none`, and
    **fail closed loudly** (contribute nothing + log a distinct non-PII code) on
    an unrecognized `kty`/`crv` with no explicit `alg`; fail closed if the fetch
    fails. The allowlist cache is invalidated per KTD3 (bound to the
    `createRemoteJWKSet` material / bounded TTL / re-derive on alg-mismatch), not
    pinned for process lifetime;
  - calls `jwtVerify(idToken, createRemoteJWKSet(new URL("/api/auth/jwks",
issuerUrl)), { issuer, audience: clientId, algorithms })` — `createRemoteJWKSet`
    resolves only asymmetric keys, so it (not the allowlist) is the symmetric-key
    barrier;
  - returns `{ subject, name?, email?, picture? }`, reading `picture` from the
    `picture` claim (string-guarded, else `undefined`).
    Wrap the token-fetch and JWKS-fetch with a timeout shorter than the callback's
    own budget (outbound-timeout learning).
- **Patterns to follow:** `apps/admin/src/auth/oauth-client.ts` for
  structure/`fetch` shape and the `new URL(absolutePath, issuerUrl)` endpoint
  form (lines 96, 127); **diverge deliberately** at `verifyChatIdToken` (drop
  `idToken ?? accessToken`; add `algorithms`).
- **Execution note:** Write the R9 rejection tests first — they encode the
  net-new-vs-admin verifier logic the Product Contract flags as unproven.
- **Test scenarios:**
  - Authorize URL contains `openid profile:read email:read` and **not**
    `admin:access`; has `code_challenge_method=S256`, `state`, `redirect_uri` =
    chat callback.
  - Endpoint URLs resolve correctly for an `AUTH_ISSUER_URL` with a trailing
    slash and for a bare origin (the `new URL` form; guards against the
    concatenation 404 → silent-anonymous mode).
  - `verifyChatIdToken` returns `{ subject, name, email, picture }` for a valid
    id_token signed with the JWKS key (happy path). **Covers F1.**
  - Rejects when only an access token is present / `idToken` undefined (no
    fallback). **Net-new vs admin — must fail if the fallback is reintroduced.**
  - Rejects a token with header `alg: none`.
  - **Allowlist actually gates (not a vacuous test):** drive `verifyChatIdToken`
    so only the `algorithms` pin can cause the rejection — a token whose header
    `alg` is a valid _asymmetric_ alg outside the derived allowlist is rejected
    with the algorithm-mismatch error specifically (not a key-resolution error).
    A plain HS256 token is separately rejected at key resolution by
    `createRemoteJWKSet`; do not rely on the HS256 case to prove the allowlist.
  - Rejects on issuer mismatch and on audience ≠ chat client id.
  - Rejects an expired id_token.
  - `picture` is `undefined` when the claim is absent (avatar-less user).
  - Allowlist derivation over `kty`+`crv`: an EdDSA (OKP/Ed25519) key → `["EdDSA"]`;
    a rotated JWKS carrying a different asymmetric `alg` → the allowlist tracks it
    (not a hardcoded pin); an alg-less key with an unrecognized `kty`/`crv` →
    fail-closed no-session + logged config-error code (the EC/Ed448 derivation
    branch is exercised, not only the EdDSA case).
  - Allowlist cache invalidation: after a simulated in-process rotation to a new
    `alg`, a fresh verify picks up the new allowlist (proves the memo isn't
    pinned for process lifetime).
- **Verification:** unit test green, including the R9 rejection cases, the
  allowlist-gates-specifically case, the kty+crv derivation cases, and the
  cache-invalidation case.

### U4. Signed identity session cookie

- **Goal:** Create and read the signed, app-local session cookie carrying the
  verified identity claims; fail closed to anonymous without a signing secret.
- **Requirements:** R5, R11; KTD2, KTD4, KTD5.
- **Dependencies:** U1.
- **Files:** `apps/chat/src/auth/session-cookie.ts`,
  `apps/chat/src/auth/session-cookie.test.ts`.
- **Approach:** Adapt `apps/admin/src/auth/auth-session.ts`. Cookie-name
  constants prefixed by `AUTH_COOKIE_PREFIX ?? "forge_chat"`:
  `<prefix>_session`, `<prefix>_oauth_state`, `<prefix>_oauth_verifier`,
  `<prefix>_oauth_return_to`. `createChatSessionCookie({ sub, name?, email?,
picture? })` → `jose` `SignJWT` with `HS256` + `setExpirationTime(SESSION_TTL)`
  (KTD5 constant). `readChatSessionCookie(value?)` → `jwtVerify` with
  `{ algorithms: ["HS256"] }`, string-guard each claim, return `{ sub, name?,
email?, picture? } | null` (any throw/invalid → `null`).
  `getSigningKey()` throws / the create+read helpers refuse when the secret is
  missing or a placeholder — read path returns `null` (anonymous), never accepts
  an unsigned cookie. `chatSessionCookieOptions()` = `{ httpOnly: true, sameSite:
"lax", secure: NODE_ENV === "production", path: "/", maxAge: SESSION_TTL_SECONDS }`
  with **no `domain`**. `transientCookieOptions()` mirrors it with a ~10m maxAge.
- **Patterns to follow:** `apps/admin/src/auth/auth-session.ts`
  (`SignJWT`/`jwtVerify`, `verifyPayload` try/catch → null, cookie-option
  helpers). Payload differs (identity claims, not `{id, role, scopes}`); TTL
  differs (KTD5, not 7 days).
- **Test scenarios:**
  - Round-trip: `read(create({sub,name,email,picture}))` yields the same claims.
  - **Covers AE3:** a cookie past its embedded `exp` reads as `null` (anonymous).
  - A cookie signed with a different secret reads as `null` (signature check).
  - A tampered / malformed cookie value reads as `null`.
  - Read with a missing signing secret returns `null` and never accepts the
    value (fail-closed).
  - `create` with a missing/placeholder secret does not emit a usable
    unsigned cookie.
  - Cookie options: `httpOnly` true, `sameSite` `"lax"` (not `"strict"`), no
    `domain`, `path` `/`, `secure` true only in production.
- **Verification:** unit test green; option-shape assertions cover R11.

### U5. Return-target origin validation

- **Goal:** Validate the post-login `return_to` against chat's own origin, with a
  home fallback on untrusted or unparseable input.
- **Requirements:** R10.
- **Dependencies:** U1.
- **Files:** `apps/chat/src/auth/origins.ts`, `apps/chat/src/auth/origins.test.ts`.
- **Approach:** Port the relevant slice of `apps/admin/src/auth/origins.ts`:
  `getChatBaseURL()` (from `CHAT_BASE_URL`, localhost default off-prod),
  `isTrustedReturnToOrigin(origin)` (=== chat base origin),
  `resolveChatReturnToURL(returnTo, fallback = chat home)`. Drop admin's
  multi-host `getLoginDestinationName` map (not needed).
- **Patterns to follow:** `apps/admin/src/auth/origins.ts`
  (`resolveAdminReturnToURL` try/catch → fallback).
- **Test scenarios:**
  - A `return_to` on chat's own origin is returned unchanged.
  - **Covers AE4/R10:** a cross-origin `return_to` falls back to chat home.
  - An unparseable / malformed `return_to` falls back to chat home.
  - Undefined `return_to` returns the fallback.
- **Verification:** unit test green.

### U6. Route handlers (login / callback / logout) + server-side identity reader

- **Goal:** Wire the flow: login redirect, callback verify-and-establish-session,
  logout clear-session, plus the non-redirecting `getChatIdentity()` reader that
  exposes identity to server components.
- **Requirements:** R1, R2, R3, R5, R6, R8, R9, R10, R11, R12; F1, F2; KTD6, KTD7.
- **Dependencies:** U2, U3, U4, U5.
- **Files:** `apps/chat/src/app/api/auth/login/route.ts` (+ `.test.ts`),
  `apps/chat/src/app/api/auth/callback/route.ts` (+ `.test.ts`),
  `apps/chat/src/app/api/auth/logout/route.ts` (+ `.test.ts`),
  `apps/chat/src/auth/identity.ts` (+ `.test.ts`).
- **Approach:** Adapt `apps/admin/src/app/api/auth/{login,callback}/route.ts`.
  - **login:** if `!chatAuthConfigured()` return a redirect to home (no flow);
    else `createOAuthState()`, build authorize URL, set the three transient
    cookies (state/verifier/return_to) with `transientCookieOptions()`, 302 to
    `apps/auth`. Validate any inbound `returnTo` param via
    `resolveChatReturnToURL` before storing it.
  - **callback:** read `code`/`state` + the transient cookies; reject (302 home - R12 marker) when `state` mismatches or the verifier is missing (R8);
    exchange the code; `verifyChatIdToken({ idToken })` (R9 — **no** access-token
    fallback, no user lookup, no role gate); set the signed session cookie
    (R11), clear the transient cookies, 302 to the validated `return_to` (R10).
    On **any** thrown error — including token-exchange failures (non-ok response,
    network error, and the U3 timeout rejection) and verify failures — the single
    callback `try/catch` logs a non-PII `[chat-auth] event=callback_failed
reason=<code>` line (KTD7), 302s home with an R12 failure marker, and stays
    anonymous. The token-exchange and verify failures share this one catch; do
    not add a separate error branch. The R12 marker is a **fixed enum code, never
    free text** (KTD7 — no reflected error), and if the marker mechanism is a
    query param the home render must strip it after first read
    (`history.replaceState` or a clearing redirect) so a refresh/share/bookmark
    doesn't re-show the notice indefinitely (see the resolved Open Question).
  - **logout:** clear the session cookie, 302 home (R6). Idempotent when already
    anonymous. **Logout is a POST** (a `POST` route handler, invoked from the
    sidebar's sign-out form — U7/KTD design), not a GET link, so it isn't
    prefetchable/crawlable.
  - **identity.ts:** `getChatIdentity()` reads the session cookie via
    `next/headers` `cookies()` and `readChatSessionCookie`, returns the claims or
    `null`. **Never redirects** (contrast admin's `requireSession()` — R3).
    Carries a code-level comment that its output is **display-only and must never
    gate authorization** (KTD5 display-only invariant).
  - **Auth-route rate limiting — accepted v1 risk, recorded as a decision.** The
    login/callback routes are world-reachable and drive outbound calls to
    `apps/auth` on each hit; like the sibling `/api/seeker` proxy they ship
    **un-rate-limited in v1**, gated only by the outbound timeout. This is the
    same accepted-risk posture already documented for `/api/seeker` in
    `apps/chat/CLAUDE.md`; a per-IP cap (as admin's auth/search routes use via
    Redis, fired before the outbound call) is a prerequisite before the audience
    widens. Record it in U8's docs update alongside the existing note rather than
    leaving it an implicit oversight.
- **Patterns to follow:** admin's `login`/`callback` route structure and cookie
  set/delete calls; admin's `session.ts` `resolveFromHeaders` for the read shape
  — **but drop `requireSession`'s redirect** (anonymous is valid).
- **Execution note:** Start with a failing callback test asserting the R9 no
  access-token-fallback contract at the route level.
- **Test scenarios:**
  - **login:** with auth unconfigured → 302 home, no `apps/auth` redirect, no
    transient cookies set (KTD6). With auth configured → 302 to `apps/auth`
    authorize URL; state/verifier/return_to cookies set with hardened options.
  - **callback happy path (F1/AE2-success):** valid code + matching state →
    session cookie set with the verified claims; transient cookies cleared; 302
    to validated `return_to`.
  - **callback state mismatch (R8):** returned `state` ≠ cookie → no session,
    302 home, R12 marker.
  - **callback missing verifier (R8):** → no session, 302 home.
  - **callback verify failure (R9/R12):** `verifyChatIdToken` throws (bad token,
    alg:none, access-token-only) → no session, 302 home, R12 marker, **no PII in
    the logged line** (assert the log payload contains no claim values / error
    text). **Covers AE4.**
  - **callback token-exchange failure (R12):** the token exchange throws (non-ok
    response / network error / U3 timeout rejection) → routed through the _same_
    catch → no session, 302 home, R12 marker, no PII logged (proves the exchange
    failure isn't a separate un-caught branch).
  - **callback R12 marker shape:** the marker is a fixed enum code, not free
    text, and (query-param mechanism) is stripped from the URL after first read.
  - **callback cross-origin return_to (R10):** untrusted `return_to` cookie →
    redirect target falls back to chat home.
  - **logout (R6/F2):** POST clears the session cookie; 302 home; idempotent when
    no session.
  - **getChatIdentity (R3/R5):** returns claims for a valid cookie; returns
    `null` (no redirect) when the cookie is absent, expired, or invalid.
- **Verification:** all route + identity tests green; manual: with a configured
  client, `/api/auth/login` round-trips and sets the session; `/api/seeker`
  behaves identically signed-in and signed-out (no gating — R3/R7).

### U7. Sidebar account control (sign-in / identity + sign-out) + failure notice

- **Goal:** Render the signed-out "Sign in" affordance and the signed-in identity
  (name → email → generic label; avatar → initials → icon) with a "Sign out"
  control; show the R12 brief notice when a sign-in attempt returned without a
  session. Hide the affordance entirely when auth is unconfigured.
- **Requirements:** R2, R4, R6, R12; KTD6; F2.
- **Dependencies:** U6.
- **Files:** `apps/chat/src/components/shell/sidebar-account.tsx` (+ `.test.tsx`),
  `apps/chat/src/components/shell/sidebar.tsx` (modify — mount the account row),
  `apps/chat/src/components/shell/sidebar-collapsed-styles.ts` (modify — add
  `account` / `accountLabel` / `signOut` slots),
  `apps/chat/src/components/shell/app-shell.tsx` (modify — thread identity +
  `authConfigured` + `signInError` props),
  `apps/chat/src/app/page.tsx` (modify — read `getChatIdentity()` +
  `chatAuthConfigured()` server-side and pass down).
- **Approach:** `page.tsx` (already `force-dynamic`) reads `getChatIdentity()` and
  `chatAuthConfigured()` and passes `identity` / `authConfigured` /
  `signInError` (from the R12 marker) into `AppShell`, which threads them to
  `Sidebar` → new `SidebarAccount`, mounted at the rail's foot. The control is
  presentational (no hooks; inherits the client context like the other
  `sidebar-*` sub-components):
  - **Control semantics (committed, not "link/button"):** "Sign in" is an
    **anchor** to `/api/auth/login` (a full-page redirect is expected — AE2).
    "Sign out" is a **`<form method="post" action="/api/auth/logout">` with a
    submit button**, not a GET link — a GET-logout link is prefetchable/crawlable
    and has the wrong semantics (matches U6's POST logout route). Both mirror the
    existing sidebar controls' explicit roles.
  - signed in: name (→ email → generic label) + avatar (`next/image` when
    `picture` present, else initials from name/email, else a generic icon) + the
    sign-out form.
  - **Accessible name (R4 a11y, matches the sidebar's existing aria discipline):**
    the avatar's `next/image` `alt` is the resolved display name; the
    initials/generic-icon fallbacks are `aria-hidden` with the name carried by
    adjacent text or an `aria-label`, so a screen reader announces the user (the
    name), never "JD" or nothing, and never double-announces.
  - unconfigured: render nothing (KTD6).
  - **Three-presentation coverage (this is the required state matrix, not
    deferred):**
    - _Expanded rail:_ full identity row + labeled controls; R12 notice renders
      inline above the account row.
    - _Collapsed 68px rail:_ add `collapsedStyles` slots (`account`,
      `accountLabel`, `signOut`) mirroring the `newButton` icon-only pattern —
      signed-in shows an avatar-only centered target (initials/icon fallback);
      signed-out shows a centered icon "Sign in" target with a `title`/tooltip.
      The account row is **persistent when collapsed** (like the new-conversation
      icon button), not hidden like the conversation nav — sign-in/out is a
      primary control. Decide per the collapsed layout whether sign-out is a
      second icon target or reachable only on expand; if only-on-expand, note the
      shared-device tradeoff (R11).
    - _Mobile drawer:_ always shows full content (the rail's `md:`-scoping), so
      the account row inherits the expanded layout.
  - **R12 notice placement across presentations:** the notice renders in the
    expanded rail and mobile drawer inline. The collapsed rail can't hold text —
    fall back to auto-expanding the rail on `signInError`, or an accessible
    icon+tooltip, so the retry cue is **never invisible** where a just-returned
    user lands. Content is the brief, non-PII "Sign-in didn't complete — try
    again"; the affordance stays present.
- **Patterns to follow:** `apps/chat/src/components/shell/sidebar-header.tsx` and
  `sidebar-new-conversation.tsx` (presentational, no `'use client'`, explicit
  `aria-label` / `sr-only` / `aria-hidden` discipline, `title` tooltips on
  collapsed icons); `collapsedStyles` slot-map for rail states; chat's JSDoc +
  3-line-comment conventions; `next/image` (CLAUDE.md: no raw `<img>`, no emoji).
- **Test scenarios (React Testing Library, per chat's test conventions):**
  - Signed out + configured → "Sign in" anchor visible, `href` = `/api/auth/login`.
    **Covers AE1** (affordance visible to anonymous users).
  - Signed in with name + picture → name + avatar rendered; avatar `alt` = the
    display name; sign-out is a `method="post"` form to `/api/auth/logout` (not a
    GET link). **Covers R4, F2.**
  - Signed in, name absent → falls back to email; email absent → generic label.
  - Signed in, `picture` absent → initials shown (not a broken image), initials
    `aria-hidden` with the name as accessible text; name and email both absent →
    generic icon.
  - Collapsed rail: signed-in → avatar-only target rendered (account row not
    hidden); signed-out → icon "Sign in" target with a `title`. Uses the new
    `collapsedStyles` slots.
  - `authConfigured` false → nothing rendered (no "Sign in").
  - `signInError` set → brief notice rendered with no claim values, affordance
    still present; collapsed-rail path surfaces the cue (auto-expand or
    icon+tooltip), not silently dropped. **Covers AE4/R12.**
- **Verification:** component tests green; browser check (chrome-devtools MCP) of
  the signed-out affordance, the signed-in identity row, and the R12 notice in
  the expanded rail, the collapsed 68px rail, and the mobile drawer.

### U8. Documentation

- **Goal:** Record the auth surface in chat's docs so the "Intentionally Absent →
  No auth" note no longer misleads.
- **Requirements:** none (docs).
- **Dependencies:** U7.
- **Files:** `apps/chat/CLAUDE.md` (modify), `apps/chat/README.md` (modify if it
  documents env/features).
- **Approach:** Add an "Authentication (feat-207)" section: the cookie-only,
  no-DB, anonymous-first design; the env vars + the out-of-codebase
  client-registration prerequisite + host-only cookie note; the R9 divergence
  from admin (id-token-only, alg allowlist). Update "Intentionally Absent" and
  "Key Conventions" (new `'use client'` boundary for the account control if any).
  Extend the existing `/api/seeker` accepted-risk note to also cover the
  **login/callback routes shipping un-rate-limited in v1** (world-reachable,
  drive outbound calls to `apps/auth`; per-IP cap is a prerequisite before the
  audience widens) so the posture is a recorded decision, not an oversight.
- **Test scenarios:** Test expectation: none — documentation only.
- **Verification:** docs reflect the shipped surface; `pnpm --filter @forge/chat
lint` clean (markdown-adjacent files unaffected).

---

## Verification Contract

Gates (all must pass before the work is done):

- `pnpm --filter @forge/chat typecheck` — clean.
- `pnpm --filter @forge/chat lint` — clean.
- `pnpm --filter @forge/chat test` — green, including every unit's colocated
  tests; specifically the U3 R9 rejection cases (access-token-as-identity,
  `alg:none`, allowlist-gates-a-non-allowlisted-asymmetric-alg-specifically) plus
  the kty+crv derivation and allowlist-cache-invalidation cases, and the U4
  expiry/invalid-cookie → anonymous cases.
- `pnpm --filter @forge/chat build` — succeeds.
- **Boots unconfigured:** with no auth env vars, the app boots and chat is fully
  usable anonymously (send messages, no sign-in required); the "Sign in"
  affordance is hidden. **(AE1, KTD6.)**
- **Configured round-trip (manual, needs a registered chat OAuth client):**
  `/api/auth/login` → `apps/auth` → callback → sidebar shows identity; refresh
  keeps the session; `/api/auth/logout` returns to anonymous. **(F1, F2, R5, R6.)**
- **No gating:** `/api/seeker` behaves identically signed-in and signed-out.
  **(R3, R7.)**
- **No PII:** grep the callback's logged lines — only `event=`/`reason=` codes,
  no `sub`/`name`/`email`/`picture` values, no raw verification-error text.
  **(R11, R12, KTD7.)**
- **Tier-2 `/ce-code-review`** run before push (auth surface — mandatory per
  root CLAUDE.md).

---

## Definition of Done

- U1–U8 landed; all Verification Contract gates green.
- Anonymous use is unchanged and first-class; no surface is gated on auth (R3,
  R7). `/api/seeker` untouched behaviorally.
- Sign-in (F1) and sign-out (F2) work against a configured `apps/auth` client;
  identity displays with the R4 fallback chain.
- The session cookie is HttpOnly / Secure-in-prod / `SameSite=Lax` / host-only /
  short-TTL, signature-verified on read, anonymous when expired or invalid (R11).
- id_token verification uses the `new URL(absolutePath, issuerUrl)` endpoint
  form, pins a JWKS-derived (kty+crv, cache-invalidated) algorithm allowlist, and
  never falls back to the access token; the R9 rejection + allowlist-gating +
  derivation tests are present and green.
- Callback logs and the R12 notice carry no PII (R11, R12).
- All new auth env vars are `.optional()`; the default-off deploy boots with none
  set; cookie verification fails closed without the signing secret.
- `docs/roadmap/ai-chat/feat-207-chat-auth.md` stays `in-progress` (flipping to
  `complete` is out of scope for this run).

### Open Questions (deferred to implementation)

- **Exact session TTL** (KTD5 recommends 8h) and final cookie name — a
  one-constant change; implementer may tune within the "short, shared-device
  appropriate, not 7 days" envelope.
- **R12 notice mechanism** — the callback marker is a fixed enum code (KTD7) and,
  if implemented as a query param, is stripped from the URL after first read
  (U6). Still open: query param vs transient one-read cookie/flag, exact
  wording/placement, whether a distinct message is shown for a provider-refused
  (org-less) account vs a generic failure, and whether a silent session expiry
  (AE3) surfaces any notice or downgrades quietly.
- **Cross-repo `apps/auth` verification before the configured round-trip** —
  confirm against a live chat client registration / JWKS fetch that: (a) the
  id_token's `aud` equals chat's client id (the R9 audience check assumes admin's
  pattern holds for the chat client — `apps/auth`'s `validAudiences` composition
  is unverified for chat); (b) `apps/auth` returns an `id_token` for chat's
  `openid`-only scope set (`isIdToken = scopes.includes("openid")` — asserted
  from source, not smoke-tested); and (c) whether the published JWKS key carries
  an explicit `alg` today (if it does, the kty+crv derivation branch is
  exercised only by the rotation test, not the live issuer). These are the
  unverified upstream assumptions the whole flow's correctness rides on.

_(Resolved during review: the exact session-cookie-signing placeholder-secret
rejection moved into U1 as a concrete requirement — reject empty, the
`.env.example` placeholder, and sub-32-char values — since the fail-closed
guarantee rides on it; it is no longer an open question.)_
