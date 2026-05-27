---
id: "feat-144"
title: "Web User Accounts and Video Download Gate"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-05-27"
duration: 7
depends_on: []
blocks: []
tags:
  - "platform"
  - "accounts"
  - "auth"
  - "web"
  - "download"
  - "launchdarkly"
---

## Problem

The web watch experience should stay public, but video downloads should require
a user account during a gradual LaunchDarkly rollout. The implementation must
reuse the standalone Jesus Film Auth service in `apps/auth`; `apps/web` must
not own auth state or import another app's internals.

## Scope

- Add a server-side LaunchDarkly flag helper for `web-download-account-gate`.
- Add a web session route at `/watch/api/auth/session` that returns only
  download-gate state and a sanitized Auth login URL.
- Gate `/watch/api/download` before URL allowlisting, DNS, or upstream fetch
  when the flag is enabled.
- Allow public email signup in `apps/auth` only for validated watch-page
  callbacks.
- Preserve existing Firebase-migration public-signup protection for all other
  signup attempts.
- Keep Admin, Manager, partner, workflow, and editorial authorization out of
  public web signup.

## Verification

- Red/Green tests for Auth signup, web callback sign-in, session route, direct
  download `401`, signed-in download, and stale-session modal behavior.
- `pnpm --filter @forge/web test`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- `pnpm --filter @forge/auth test`
- `pnpm --filter @forge/auth typecheck`
- `pnpm --filter @forge/auth lint`
- User-like browser smoke with screenshots for signed-out redirect, signup
  form, download modal, and direct `401`.

## Completion Notes

- Implemented behind LaunchDarkly flag key `web-download-account-gate` with
  local/test fallback `WEB_DOWNLOAD_ACCOUNT_GATE_FALLBACK`.
- Smoke surfaced a Better Auth trusted-origin callback rejection for the web
  watch callback. Fixed by adding validated web origins to Auth
  `trustedOrigins` via `getAuthTrustedOrigins()`.
- Final smoke used `http://localhost:3030/watch/the-vine-and-the-branches/english`
  with Auth on `http://localhost:3034`; screenshots are saved under
  `.tmp/smoke/`.
