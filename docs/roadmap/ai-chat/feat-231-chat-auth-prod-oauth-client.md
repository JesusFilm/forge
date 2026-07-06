---
id: "feat-231"
title: "Register chat deployed-environment OAuth clients (prod chat auth enablement)"
owner: "jian wei"
priority: "P2"
status: "complete"
start_date: "2026-07-20"
duration: 1
depends_on:
  - "feat-229"
blocks:
  - "feat-235"
tags:
  - "infrastructure"
  - "web"
---

## Resolution

**Shipped:** 2026-07-06 via [PR #1465](https://github.com/JesusFilm/forge/pull/1465) (`feat(auth): register jfp_chat_production OAuth client (feat-231)`).

**What landed.** Deviation from the brief's two-step plan: the owner accepted chat's
Railway-generated domain (`forgechat-production-a4f5.up.railway.app`) as the settled
production hostname pre-DNS and approved its public exposure, so the PR went straight
to `jfp_chat_production` (`kind: "production"`) — no preview client was ever
registered. Identity-only scopes, public PKCE, autoApprove, exact-match redirect
`https://forgechat-production-a4f5.up.railway.app/api/auth/callback`. Two
review-hardening tests rode along: a global clientId-uniqueness assertion across all
first-party seeds (upsert-by-clientId means a copy-paste collision would pass count
and shape tests) and a negative test pinning `jfp_chat_production` out of the dynamic
Railway-wildcard redirect path. Registration receipt confirmed on the post-merge auth
deploy — `Seeded 5 first-party apps, 18 environments, 22 OAuth clients, and 10
scopes.` — then chat's Railway env vars were set (`AUTH_CHAT_CLIENT_ID=jfp_chat_production`,
no client secret), and the owner verified end-to-end in-browser on 2026-07-06:
sign-in round trip, sign-out to anonymous, and the `?signin=failed` path.

**Residual risk / follow-ups.** The seed row and the Railway domain live and die
together: if the domain churns or `jesusfilm.org` DNS fronting lands, update/remove
the seed entry BEFORE releasing the old domain — a released subdomain under a
still-seeded redirect is a silent token-harvesting window on a consent-skipping
client (bounded by identity-only scopes). `SEEKER_CHAT_ENABLED` stays off on the
deployed instance until the inbound rate-cap work lands (the domain is now public in
this repo, so URL obscurity is gone).

## Problem

feat-229 registers only the local client (`jfp_chat_local`), so chat auth
(feat-207) can be exercised on a developer machine but nowhere deployed.
Nothing else tracks deployed-environment enablement: chat has no
`jesusfilm.org` hostname yet (Railway-generated domain, no Cloudflare
fronting — `apps/chat/CLAUDE.md` → Deployment), and `apps/auth` requires
exact-match redirect URIs per environment, so the production client could not
be registered blind. This ticket owns the deployed client(s) so production
enablement doesn't go untracked after feat-229 completes.

Key mechanic inherited from feat-229 (see its Problem #2): the first-party
seed runs on **every auth deploy**, so **merging a seed change = registered on
the next auth deploy**. The auth deploy-log `Seeded ...` counts line is the
receipt.

## Entry Points — Read These First

1. `apps/auth/src/domain/apps.ts` — `CHAT_APP_SEED` (added by feat-229); add
   environments to its `environments` array. Prior art for a Railway-domain
   environment: `MASTRA_STUDIO_APP_SEED`'s `preview` env uses the raw
   `forgemastra-gateway.up.railway.app` domain.
2. `apps/auth/src/scripts/seed-first-party-apps.test.ts` — counts + shape
   assertions to update (also the chat-shape test in
   `apps/auth/src/domain/apps.test.ts`, which pins `environments` to
   `["local"]` and must be extended).
3. `apps/chat/CLAUDE.md` → Deployment — chat's current Railway domain status
   and DNS plans.
4. `docs/roadmap/ai-chat/feat-229-chat-auth-register-oauth-client.md` — the
   local-client pattern and verification flow this extends.

## Grep These

- `CHAT_APP_SEED` / `jfp_chat_local` in `apps/auth/` — the seed to extend.
- `chatAuthConfigured` in `apps/chat/src/config/env.ts` — the env gate the
  Railway variables must satisfy.
- `forgemastra-gateway` in `apps/auth/src/domain/apps.ts` — the Railway-domain
  preview-environment prior art.

## What To Build

1. **Recommended pre-DNS first step:** add a `preview` environment to
   `CHAT_APP_SEED` using chat's current Railway-generated domain
   (`clientId: "jfp_chat_preview"`, redirect
   `https://<chat-railway-domain>/api/auth/callback`, matching
   `allowedOrigins` / `postLogoutRedirectUris`, same `CHAT_DEFAULT_SCOPES`).
   This unlocks deployed end-to-end verification before the DNS cutover.
   Caveat: Railway-generated domains can churn on service re-provisioning; if
   it does, update the seed and merge (it re-seeds automatically on deploy).
2. Once chat's prod hostname is settled: add the `production` environment
   (`clientId: "jfp_chat_production"`, redirect
   `https://<chat-prod-host>/api/auth/callback`, matching origins). Identity-only
   scopes — no new scopes.
3. Update the seed test counts (+ the `apps.test.ts` chat-shape assertions).
4. Merge → confirm the auth deploy-log `Seeded ...` counts bumped (one more
   environment and OAuth client per added env; apps count unchanged at 5).
5. **Only after the deploy-log receipt**, set chat's Railway env vars:
   `AUTH_ISSUER_URL`, `AUTH_CHAT_CLIENT_ID=jfp_chat_<env>`,
   `CHAT_BASE_URL=<exact origin>`, a real ≥32-char `CHAT_SESSION_SECRET` —
   and **no `AUTH_CHAT_CLIENT_SECRET`** (public PKCE client).
   Receiver-registers-first: if `chatAuthConfigured()` flips true before the
   client exists, every sign-in dead-ends at the provider with no chat-side
   signal.

## Constraints

- Identity-only scopes — no `*:access`, no `membership:read` (feat-207 R7).
- Redirect URIs are exact-match per environment; the redirect is always
  `<CHAT_BASE_URL>/api/auth/callback` (chat's `getChatOAuthRedirectUri()`).
- Do NOT set chat's deployed auth env vars before the deploy-log receipt
  (receiver-registers-first).
- No `apps/chat` code changes belong here.

## Verification

- Auth deploy log shows the bumped `Seeded ...` counts after merge.
- On the deployed chat instance: click Sign in → authenticate with your own
  account → land back signed in; sign-out returns to anonymous; a cancelled
  sign-in shows the `?signin=failed` R12 notice.
- `pnpm --filter @forge/auth test` + `pnpm --filter @forge/auth typecheck`
  green.
