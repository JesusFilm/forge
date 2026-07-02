---
id: "feat-229"
title: "Register chat OAuth client in apps/auth (chat auth enablement)"
owner: "jian wei"
priority: "P1"
status: "not-started"
start_date: "2026-07-09"
duration: 2
depends_on:
  - "feat-207"
blocks:
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
`apps/auth/src/domain/apps.ts` seeds only `admin`, `manager`, and
`mastra-studio`.

This ticket owns that out-of-codebase enablement. It **does not block feat-207's
merge** — feat-207 merges independently and stays inert while unconfigured. It
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
2. **Seeding is a manual, production-DB operator action.** OAuth clients are
   written by `pnpm --filter @forge/auth seed:first-party-apps`
   (`apps/auth/src/scripts/seed-first-party-apps.ts`, a `prisma.oauthClient.upsert`
   loop). **Nothing runs it on deploy** — `apps/auth/railway.toml` has no
   pre/post-deploy hook. So "merge the seed PR" ≠ "client registered"; a human
   with prod `forge-auth` DB access must run the seed. The running auth server
   reads clients from the DB at request time, so no auth redeploy is needed once
   seeded — the seed write is the go-live.

## Entry Points — Read These First

1. `apps/auth/src/domain/apps.ts` — the `FIRST_PARTY_APP_SEEDS` array (line ~230)
   and the `RegisteredAppSeed` / `AppEnvironmentSeed` types (line ~13). Model a
   new `CHAT_APP_SEED` on `ADMIN_APP_SEED` (line ~59). The array is what the seed
   iterates.
2. `apps/auth/src/scripts/seed-first-party-apps.ts` — the manual seed command.
   It upserts scopes, then every app + environment + `oauthClient` row. **It
   rewrites the whole array on each run (idempotent upserts of admin/manager/
   mastra too), not a chat-only insert** — expect a prod seed run to touch every
   client row.
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
6. `apps/auth/CLAUDE.md` → "Agent login handles" — `AGENT_LOGIN_MINTING_KEY` +
   `pnpm --filter @forge/auth mint:agent-handle` is the sanctioned dev
   login-without-real-credentials path for verification.
7. `docs/plans/2026-06-30-002-feat-chat-auth-plan.md` — feat-207's plan; the
   "Prerequisite (out-of-codebase)" and receiver-registers-first sequencing.

## Grep These

- `FIRST_PARTY_APP_SEEDS` / `ADMIN_APP_SEED` / `AppEnvironmentSeed` in
  `apps/auth/src/domain/apps.ts` — the seed structures to extend.
- `jfp_admin_local` / `jfp_admin_production` in `apps/auth/` — the client-id
  naming to mirror (`jfp_chat_local` / `jfp_chat_production`).
- `chatAuthConfigured` / `AUTH_CHAT_CLIENT_ID` / `CHAT_BASE_URL` in `apps/chat/`
  — the env the client registration must match.
- `seed:first-party-apps` / `mint:agent-handle` in `apps/auth/package.json`.
- Receiver-registers-first: `docs/solutions/platform/admin-manager-enrichment-trigger-endpoint-20260506.md`.

## What To Build

Split into **two PRs** — not "local DB vs prod DB" (there is one prod auth DB),
but "register the localhost redirect now to unblock local verification, and
defer the real prod redirect until chat's prod hostname is settled." `apps/chat`
is still on a Railway-generated domain with no `jesusfilm.org` DNS
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
     description: "Conversational AI chat surface (jesusfilm.ai).",
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
3. **Operator step (production auth DB):** a person with prod `forge-auth` DB
   access runs `pnpm --filter @forge/auth seed:first-party-apps` against the prod
   `DATABASE_URL`. This creates the `jfp_chat_local` client row. **Call out the
   operator/owner explicitly** — the PR author cannot self-serve this without prod
   auth DB credentials (Doppler project `forge-auth`).
   - **Seed from a checkout current for ALL apps — ideally `main` after this PR
     merges, not the feature branch in isolation.** The seed re-upserts every
     client row (admin/manager/mastra-studio included, per Entry Point #2), so
     seeding from a stale or ahead-of-`main` branch would silently regress those
     sibling clients' prod config (redirect URIs, scopes) to whatever that
     checkout's `apps.ts` holds. Merge first, then seed from `main`.
4. **Verify feat-207 end-to-end locally** (see Verification). Once green, feat-207
   can merge (if it hasn't already) and this PR merges.

### PR2 — production client (deferred until chat's prod hostname is settled)

1. Add a `production` (and any `preview`/`staging`) environment to `CHAT_APP_SEED`
   with the real chat prod origin once known:
   `clientId: "jfp_chat_production"`, `redirectUris:
["https://<chat-prod-host>/api/auth/callback"]`, matching `allowedOrigins` /
   `postLogoutRedirectUris`.
2. Update the seed test counts.
3. **Seed the prod client FIRST**, then set chat's prod env vars
   (`AUTH_ISSUER_URL`, `AUTH_CHAT_CLIENT_ID=jfp_chat_production`,
   `CHAT_BASE_URL`, `CHAT_SESSION_SECRET`) in the chat Railway service — again
   **no `AUTH_CHAT_CLIENT_SECRET`** (public PKCE client, as in PR1). This is the
   **receiver-registers-first** discipline: if chat's prod `chatAuthConfigured()`
   flips true before the client exists in the DB, every sign-in dead-ends in a
   `redirect_uri`/unknown-client error with no chat-side signal.
4. Verify sign-in in production.

## Constraints

- **Do NOT gate feat-207's merge on this ticket.** feat-207 is default-off and
  inert while unconfigured; it merges independently and stays `in-progress` until
  this ticket verifies it.
- **Do NOT set chat's prod auth env vars before the prod client is seeded**
  (PR2). Receiver-registers-first; reverse order produces a dead window of failing
  sign-ins.
- **Do NOT touch chat code** — no `apps/chat` changes belong here. If verification
  surfaces a chat-side bug, that is a separate `fix(chat-auth):` PR against
  feat-207's surface.
- **Do NOT add `*:access` or `membership:read` to chat's scopes** — chat performs
  no authorization (feat-207 R7). Identity-only: `openid profile:read email:read`.
- **Do NOT invent the prod redirect URI** in PR1. The prod host isn't settled;
  guessing an exact-match URI now would register a wrong client.
- Client-id naming mirrors admin/manager: `jfp_chat_<env>`. Redirect URI is
  always `<CHAT_BASE_URL>/api/auth/callback` (chat's `getChatOAuthRedirectUri()`).

## Verification

Local end-to-end (PR1), after the operator seeds `jfp_chat_local`:

1. In `apps/chat`, set `.env.local`: `AUTH_ISSUER_URL=https://auth.jesusfilm.org/api/auth`,
   `AUTH_CHAT_CLIENT_ID=jfp_chat_local`, `CHAT_BASE_URL=http://localhost:3200`,
   and a real ≥32-char `CHAT_SESSION_SECRET` (not the `.env.example`
   placeholder). **Leave `AUTH_CHAT_CLIENT_SECRET` unset** — the seed registers
   every first-party client as a public PKCE client (`public: true`,
   `tokenEndpointAuthMethod: "none"`), so no client secret is issued (mirrors
   admin, whose `.env.example` leaves `AUTH_ADMIN_CLIENT_SECRET` commented out).
2. Confirm `chatAuthConfigured()` is now true: the sidebar shows "Sign in".
3. Ensure `AGENT_LOGIN_MINTING_KEY` is set on auth; mint a login handle:
   `pnpm --filter @forge/auth mint:agent-handle`. (Handle is a bearer credential —
   don't paste it into PRs/logs.)
4. `pnpm --filter @forge/chat dev` → http://localhost:3200 → click Sign in →
   authenticate with the minted handle → confirm you land back signed in, the
   sidebar shows the identity (name→email→label, avatar→initials→icon), sign-out
   clears the session and returns to anonymous, and the failure path (`?signin=failed`)
   shows the R12 notice on a cancelled/failed attempt.
5. Confirm the seeded client alone enabled this: with the same env but the client
   NOT seeded, sign-in dead-ends at the provider (`redirect_uri`/unknown-client).

Seed-shape checks (both PRs):

- `pnpm --filter @forge/auth test` green (updated `seed-first-party-apps.test.ts`).
- `pnpm --filter @forge/auth typecheck` clean.

Completion: when the local round trip passes and `jfp_chat_local` is seeded in
prod auth, flip **feat-207** to `complete` (with its Resolution section) — that
is the signal this ticket unblocks. **feat-229 itself flips to `complete` at
PR1** (local client seeded + verified); PR2 (prod client) is tracked as a
trailing follow-up gated on chat's DNS cutover, not a condition of this ticket's
completion — so feat-229 doesn't stay open indefinitely waiting on production
hostname decisions.
