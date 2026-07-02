---
id: "feat-229"
title: "Register chat OAuth client in apps/auth (chat auth enablement)"
owner: "jian wei"
priority: "P1"
status: "in-progress"
start_date: "2026-07-09"
duration: 2
depends_on:
  - "feat-207"
blocks:
  - "feat-231"
tags:
  - "infrastructure"
  - "web"
---

## Problem

feat-207 wires optional OAuth sign-in into `apps/chat`, but the code ships
**default-off**: `chatAuthConfigured()` returns `false` until the auth env vars
are set, so the sidebar hides "Sign in" and `/api/auth/login` no-ops to home.
The feature cannot be exercised — locally or in production — until a **chat
OAuth client is registered in `apps/auth`**. There is no such client today:
`apps/auth/src/domain/apps.ts` seeds only `admin`, `manager`, `web`, and
`mastra-studio`.

This ticket owns that enablement. It did not block feat-207's merge (feat-207
merged 2026-07-02 via [#1438](https://github.com/JesusFilm/forge/pull/1438) and
stays inert while unconfigured). It
blocks feat-207's **end-to-end verification and per-environment enablement**:
feat-207 stays `in-progress` until this ticket lands a client and a real sign-in
round trip has been verified.

Two facts drive the shape of this work (both verified against the code):

1. **Local dev points at PRODUCTION auth.** `apps/chat` mirrors `apps/admin`,
   whose `.env.example` sets `AUTH_ISSUER_URL=https://auth.jesusfilm.org/api/auth`
   and `AUTH_ADMIN_CLIENT_ID=jfp_admin_local` (see `apps/admin/CLAUDE.md` →
   "Jesus Film Auth client mode"). There is no local auth instance in the loop.
   So the `jfp_chat_local` client (redirect `http://localhost:3200/...`) lives in
   the **same production auth DB** as any future `jfp_chat_production` client.
2. **Seeding runs automatically on every auth deploy**, so merging a seed
   change registers the client on the next auth deploy — no manual seed run.
   (The Railway dashboard start command is canonical and chains migrations +
   `seed-first-party-apps.ts`; `railway.toml`'s startCommand does NOT run the
   seed, so don't infer "manual" from that file. Verified in the production
   deploy logs, 2026-07-02.)

## Entry Points — Read These First

1. `apps/auth/src/domain/apps.ts` — the `FIRST_PARTY_APP_SEEDS` array (line ~230)
   and the `RegisteredAppSeed` / `AppEnvironmentSeed` types (line ~13). Model a
   new `CHAT_APP_SEED` on `ADMIN_APP_SEED` (line ~59). The array is what the seed
   iterates.
2. `apps/auth/src/scripts/seed-first-party-apps.ts` — the seed (runs on every
   auth deploy; see Problem #2). It upserts scopes, then every app, environment,
   and `oauthClient` row. **It rewrites the whole seed array on each run
   (idempotent upserts of the sibling apps too), not a chat-only insert** —
   every deploy touches every client row.
3. `apps/auth/src/scripts/seed-first-party-apps.test.ts` — asserts seed counts /
   shape. Update it when `CHAT_APP_SEED` is added (a new app + its environments).
4. `apps/auth/src/auth/config.ts` — `clientRegistrationDefaultScopes` (line ~150)
   = `["openid", "profile:read", "email:read"]` (the `:read` keys chat requests);
   `customIdTokenClaims` (line ~165) emits `name`/`email`/`picture` and does NOT
   set `aud`, so the id_token `aud` = the registered `client_id` for the code
   flow (what `verifyChatIdToken` pins). Signs with `EdDSA` today (bare `jwt()`).
5. `apps/chat/src/config/env.ts` — the auth env surface feat-207 added here (its
   `chatAuthConfigured()` gate + the `AUTH_ISSUER_URL` / `AUTH_CHAT_CLIENT_ID` /
   `AUTH_CHAT_CLIENT_SECRET` / `CHAT_BASE_URL` / `CHAT_SESSION_SECRET` vars, plus
   an optional `AUTH_COOKIE_PREFIX`). **Landed on `main` in [PR #1438](https://github.com/JesusFilm/forge/pull/1438)** —
   this is the env the client registration must line up with.
6. `docs/plans/2026-06-30-002-feat-chat-auth-plan.md` — feat-207's plan; the
   "Prerequisite (out-of-codebase)" and receiver-registers-first sequencing.

## Grep These

- `FIRST_PARTY_APP_SEEDS` / `ADMIN_APP_SEED` / `AppEnvironmentSeed` in
  `apps/auth/src/domain/apps.ts` — the seed structures to extend.
- `jfp_admin_local` / `jfp_admin_production` in `apps/auth/` — the client-id
  naming to mirror (`jfp_chat_local` / `jfp_chat_production`).
- `chatAuthConfigured` / `AUTH_CHAT_CLIENT_ID` / `CHAT_BASE_URL` in `apps/chat/`
  — the env the client registration must match.
- `seed:first-party-apps` in `apps/auth/package.json`.
- Receiver-registers-first: `docs/solutions/platform/admin-manager-enrichment-trigger-endpoint-20260506.md`.

## What To Build

**This ticket ships PR1 only** — register the localhost redirect now to unblock
local verification. The deployed-environment client (production, plus a
recommended pre-DNS `preview` on chat's Railway domain) is tracked as
**[feat-231](feat-231-chat-auth-prod-oauth-client.md)**: `apps/chat` is still on
a Railway-generated domain with no `jesusfilm.org` DNS
(`apps/chat/CLAUDE.md` → Deployment), so the exact-match prod redirect URI is not
yet knowable — and `apps/auth` requires redirect URIs to be exact per
environment (`apps/auth/CLAUDE.md` → Security posture).

### PR1 — local client + local verification

1. In `apps/auth/src/domain/apps.ts`, add a `CHAT_APP_KEY = "chat"`, a
   `CHAT_DEFAULT_SCOPES = ["openid", "profile:read", "email:read"]` (no
   `*:access`, no `membership:read` — chat gates nothing), and a `CHAT_APP_SEED`
   with a single `local` environment, then append it to `FIRST_PARTY_APP_SEEDS`:

   ```ts
   export const CHAT_APP_KEY = "chat"
   export const CHAT_DEFAULT_SCOPES = [
     "openid",
     "profile:read",
     "email:read",
   ] satisfies AuthScopeKey[]

   export const CHAT_APP_SEED: RegisteredAppSeed = {
     key: CHAT_APP_KEY,
     displayName: "Jesus Film Chat",
     description: "Conversational AI chat surface.",
     ...FIRST_PARTY_OWNER,
     environments: [
       {
         key: "local",
         kind: "local",
         clientId: "jfp_chat_local",
         redirectUris: ["http://localhost:3200/api/auth/callback"],
         postLogoutRedirectUris: ["http://localhost:3200"],
         allowedOrigins: ["http://localhost:3200"],
         defaultScopes: CHAT_DEFAULT_SCOPES,
         autoApprove: true,
       },
     ],
   }
   ```

   Then add `CHAT_APP_SEED` to the `FIRST_PARTY_APP_SEEDS` array.

2. Update `apps/auth/src/scripts/seed-first-party-apps.test.ts` for the new app +
   environment counts.
3. **Merge this PR — merging is the registration go-live.** Auth redeploys on
   every `main` merge, and the startup seed runs with `CHAT_APP_SEED` included
   (Problem #2). Confirm the receipt in the auth service's deploy logs: the
   seed line changes from
   `Seeded 4 first-party apps, 16 environments, 20 OAuth clients, and 10 scopes.`
   to `Seeded 5 first-party apps, 17 environments, 21 OAuth clients, and 10 scopes.`
   No manual seed run, no DB access, no other operator action.
4. **Verify feat-207 end-to-end locally** (see Verification), then flip
   statuses per Completion.

### Deployed-environment client — moved to feat-231

The production (and pre-DNS `preview`) client registration is tracked as
[feat-231](feat-231-chat-auth-prod-oauth-client.md), gated on chat's prod
hostname. Kept out of this ticket so feat-229 completes at PR1 instead of
staying open indefinitely on DNS decisions.

## Constraints

- **Do NOT set chat's deployed auth env vars before the deployed client exists**
  ([feat-231](feat-231-chat-auth-prod-oauth-client.md)). Receiver-registers-first;
  reverse order produces a dead window of failing sign-ins.
- **Do NOT touch chat code** — no `apps/chat` changes belong here. If verification
  surfaces a chat-side bug, that is a separate `fix(chat-auth):` PR against
  feat-207's surface.
- **Do NOT add `*:access` or `membership:read` to chat's scopes** — chat performs
  no authorization (feat-207 R7). Identity-only: `openid profile:read email:read`.
- **Do NOT invent the prod redirect URI** here. The prod host isn't settled;
  guessing an exact-match URI now would register a wrong client (that's
  feat-231's scope, once the host is known).
- Client-id naming mirrors admin/manager: `jfp_chat_<env>`. Redirect URI is
  always `<CHAT_BASE_URL>/api/auth/callback` (chat's `getChatOAuthRedirectUri()`).

## Verification

Local end-to-end, after the post-merge auth deploy has seeded `jfp_chat_local`
(deploy-log receipt in PR1 step 3):

1. In `apps/chat`, set `.env.local`: `AUTH_ISSUER_URL=https://auth.jesusfilm.org/api/auth`,
   `AUTH_CHAT_CLIENT_ID=jfp_chat_local`, `CHAT_BASE_URL=http://localhost:3200`,
   and a real ≥32-char `CHAT_SESSION_SECRET` (not the `.env.example`
   placeholder). **Leave `AUTH_CHAT_CLIENT_SECRET` unset** — the seed registers
   every first-party client as a public PKCE client (`public: true`,
   `tokenEndpointAuthMethod: "none"`), so no client secret is issued (mirrors
   admin, whose `.env.example` leaves `AUTH_ADMIN_CLIENT_SECRET` commented out).
2. Confirm `chatAuthConfigured()` is now true: the sidebar shows "Sign in".
3. `pnpm --filter @forge/chat dev` → http://localhost:3200 → click Sign in →
   authenticate with **your own account** (the client is seeded `skipConsent`).
   Use a private window to see the fresh-login screen (an existing auth SSO
   session redirects straight back). Confirm you land back signed in, the
   sidebar shows the identity (name→email→label, avatar→initials→icon), and
   sign-out clears the session and returns to anonymous.
4. Failure path: start a sign-in and cancel at the provider — confirm the R12
   notice renders via `?signin=failed`.

(An optional negative control — the same env before the client is seeded
dead-ends at the provider with a `redirect_uri`/unknown-client error — only
exists BEFORE this PR merges; there is no unseeded window after.)

Seed-shape checks:

- `pnpm --filter @forge/auth test` green (updated `seed-first-party-apps.test.ts`).
- `pnpm --filter @forge/auth typecheck` clean.

Completion: when the deploy-log receipt is confirmed and the local round trip
passes, flip **feat-207** to `complete` (with its Resolution section) — that is
the signal this ticket unblocks. **feat-229 itself flips to `complete` at PR1**
(client seeded by the post-merge deploy + verified). The deployed-environment
client is tracked as [feat-231](feat-231-chat-auth-prod-oauth-client.md), not a
condition of this ticket's completion — so feat-229 doesn't stay open
indefinitely waiting on production hostname decisions.
