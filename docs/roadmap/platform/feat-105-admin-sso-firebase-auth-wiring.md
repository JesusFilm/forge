---
id: "feat-105"
title: "Wire SSO + Firebase fallback auth on @forge/admin"
owner: "tataihono"
priority: "P0"
status: "not-started"
start_date: "2026-04-21"
duration: 3
depends_on:
  - "feat-104"
blocks: []
tags:
  - "platform"
  - "admin"
  - "auth"
  - "sso"
  - "firebase"
---

## Problem

`@forge/admin` shipped to Railway in feat-104 with SSO and Firebase
email/password fallback deliberately unwired for the R1 smoke deploy.
Better Auth is installed and configured in the codebase, but without
provisioned OAuth apps (Facebook, Google, Apple, Okta) and the Firebase
bridge secrets, no operator can actually log in. This blocks:

- The R1 scene-embedding backfill smoke test
  (`triggerSceneEmbeddingBackfill` requires ADMIN principal).
- All R2+ admin-driven editorial operations.
- The Strapi → admin migration cutover, since editors can't sign in to
  the admin surface to validate parity.

Auth is the gating work between "admin is deployed" and "admin is
usable."

## Entry Points — Read These First

1. `docs/roadmap/platform/feat-104-admin-railway-provisioning.md` — the
   provisioning ticket this follows; contains the env var matrix with
   SSO / Firebase rows marked "skip for R1".
2. `apps/admin/CLAUDE.md` — Unit 5 section documents Better Auth setup,
   adapter config, cross-subdomain cookie rules, and Firebase fallback
   design.
3. `apps/admin/src/auth/` — Better Auth config + Firebase bridge
   implementation (already written; just needs env vars + OAuth app
   credentials).
4. `apps/admin/src/config/env.ts` — env var schema; confirms which
   SSO / Firebase vars are expected.
5. Railway `@forge/admin` service (id
   `bdb15048-1ca9-4217-ae01-ef7cc19ca6f4` in project `forge`,
   production env `5f41e037-90e4-4674-a3ea-66bbd05fb3b4`) — where
   values land.

## Grep These

- `FACEBOOK_CLIENT_ID|FACEBOOK_CLIENT_SECRET|socialProviders.*facebook` in `apps/admin/`
- `GOOGLE_CLIENT_ID|GOOGLE_CLIENT_SECRET|socialProviders.*google` in `apps/admin/`
- `APPLE_CLIENT_ID|APPLE_CLIENT_SECRET|socialProviders.*apple` in `apps/admin/`
- `OKTA_CLIENT_ID|OKTA_CLIENT_SECRET|socialProviders.*okta` in `apps/admin/`
- `FIREBASE_|verifyIdToken|firebase-admin|signInWithPassword` in `apps/admin/`
- `BETTER_AUTH_URL|AUTH_COOKIE_DOMAIN|AUTH_TRUSTED_ORIGINS` in `apps/admin/`

## What To Build

### 1. Provision OAuth apps (external work)

For each provider, create an OAuth application pointed at
`https://admin.jesusfilm.org/api/auth/callback/{provider}`:

- **Facebook** — developers.facebook.com → app → Facebook Login → set
  redirect URI. Needs app review if public scopes beyond email.
- **Google** — console.cloud.google.com → OAuth 2.0 Client ID → Web
  application → authorized redirect URI.
- **Apple** — developer.apple.com → Services ID → Sign In with Apple
  → return URL. Requires paid Apple Developer account + domain
  verification.
- **Okta** — Okta admin console → app integration → OIDC Web Application
  → redirect URI.

For each: capture `CLIENT_ID` + `CLIENT_SECRET`.

### 2. Provision Firebase project (if Firebase fallback needed)

Firebase fallback exists to migrate existing Strapi users who authenticated
via Firebase email/password. If no such users exist in the migration path,
**this step is skippable**. Confirm with Nisal which Strapi roles migrate
to admin before investing.

If needed: `console.firebase.google.com` → project → Authentication →
service account → download JSON → extract `FIREBASE_PROJECT_ID`,
`FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`.

### 3. Set env vars on Railway `@forge/admin` service

Use the Railway MCP OR raw GraphQL with the project-scoped token
(see `~/.claude/projects/-workspace/memory/railway_prod_credentials.md`).
**Note (from feat-104):** the MCP `updateServiceTool` writes env vars
that DO propagate; `updateServiceTool` build/deploy fields do NOT
propagate. Env vars via MCP are fine.

| Variable                 | Value                                                              |
| ------------------------ | ------------------------------------------------------------------ |
| `FACEBOOK_CLIENT_ID`     | From Facebook app                                                  |
| `FACEBOOK_CLIENT_SECRET` | From Facebook app                                                  |
| `GOOGLE_CLIENT_ID`       | From Google Cloud Console                                          |
| `GOOGLE_CLIENT_SECRET`   | From Google Cloud Console                                          |
| `APPLE_CLIENT_ID`        | From Apple Developer                                               |
| `APPLE_CLIENT_SECRET`    | JWT signed with private key — see Better Auth docs for Apple setup |
| `OKTA_CLIENT_ID`         | From Okta                                                          |
| `OKTA_CLIENT_SECRET`     | From Okta                                                          |
| `OKTA_DOMAIN`            | e.g. `jesusfilm.okta.com`                                          |
| `FIREBASE_PROJECT_ID`    | Only if Firebase fallback needed                                   |
| `FIREBASE_CLIENT_EMAIL`  | Service account email                                              |
| `FIREBASE_PRIVATE_KEY`   | Private key (escape newlines or use base64; follow env.ts schema)  |

### 4. Seed the first ADMIN user

Better Auth's `user.role` is set to `ADMIN` manually via SQL the first
time. After at least one admin exists, subsequent admins can be promoted
through the UI.

```sql
-- Run against admin's Railway Postgres after signing up via the UI
UPDATE "user" SET role = 'ADMIN' WHERE email = 'tataihono.nikora@jesusfilm.org';
```

### 5. Set up a custom domain

The R1 smoke deploy lives at
`forgeadmin-production-f4d1.up.railway.app`. For SSO callbacks to match
provider-configured URIs, the canonical URL needs to be
`https://admin.jesusfilm.org`:

- Cloudflare: add CNAME `admin` → `forgeadmin-production-f4d1.up.railway.app`.
- Railway service: add custom domain `admin.jesusfilm.org` via
  `customDomainCreate` mutation.
- Cloudflare: enable Authenticated Origin Pulls for the subdomain
  (matches the pattern for `cms.jesusfilm.org` etc.).

## Constraints

- **Do NOT touch feat-104's env var matrix values.** DATABASE*URL,
  OPENROUTER_API_KEY, RAILWAY_S3*\*, BETTER_AUTH_SECRET,
  WORKFLOW_HMAC_SECRET, HOSTNAME are correct and live. Adding SSO/Firebase
  is additive only.
- **Don't deploy code changes without a PR.** The Better Auth
  implementation is already in `main` — this ticket is purely
  infrastructure / OAuth provisioning.
- **Firebase is optional.** Scope it only if actual Strapi users need to
  migrate via password. Otherwise skip.
- **Cross-subdomain session cookies** only work with the correct
  `AUTH_COOKIE_DOMAIN=.jesusfilm.org` (already set). Don't override.

## Verification

- Navigate to `https://admin.jesusfilm.org/signin` (once custom domain
  is live). Each configured provider button triggers its OAuth flow,
  callback succeeds, user row appears in the `user` table.
- After promoting to ADMIN via SQL, the mutation
  `triggerSceneEmbeddingBackfill` succeeds for the authenticated
  session (Better Auth cookie → Pothos scope-auth → passes
  `write:scene-embeddings`).
- Firebase fallback (if wired): existing Strapi password hash migrated,
  user can sign in via `/signin` with email/password, first successful
  login mints a Better Auth session.

## Watch-outs

- **Apple `APPLE_CLIENT_SECRET` is a JWT, not a static string.** Signing
  it requires the Apple private key (.p8 file) + a short signing script.
  Better Auth docs cover the pattern.
- **Facebook OAuth app review**: the default unreviewed app only
  supports `email` + `public_profile` scopes, which is enough for
  sign-in. Don't request additional scopes unless required.
- **Firebase private key env var**: Railway env var values can't contain
  raw newlines. Either escape `\n` in the string OR base64-encode the
  key and decode at startup — follow whichever pattern
  `apps/admin/src/auth/firebase.ts` expects.
- **Redirect URI exact match**: OAuth providers are strict. Register the
  production URI AND a dev URI (`http://localhost:3003/api/auth/callback/{provider}`)
  so local dev still works.
- **Cookie domain leak**: if `AUTH_COOKIE_DOMAIN=.jesusfilm.org` is
  changed to the railway.app domain, sessions won't sync with other
  `*.jesusfilm.org` apps. Keep the current value until the custom
  domain is live.
