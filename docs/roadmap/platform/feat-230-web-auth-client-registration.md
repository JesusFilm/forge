---
id: "feat-230"
title: "Register Web OAuth client in Auth"
owner: "urim"
priority: "P1"
status: "complete"
start_date: "2026-07-02"
duration: 1
depends_on:
  - "feat-146"
blocks: []
tags:
  - "platform"
  - "auth"
  - "web"
  - "watch"
---

## Problem

The public Web watch app needs to use the production Jesus Film Auth service for
local developer sign-in, matching Admin's posture. Auth does not yet seed Web as
a first-party OAuth client, so production Auth cannot accept Web's local,
preview, staging, or production exact-match redirect URIs.

## What Changed

- Added the `web:watch-events:write` Auth scope.
- Registered Jesus Film Web as a first-party public PKCE OAuth client across
  local, preview, staging, and production.
- Used `/watch/api/auth/callback` redirect URIs because Web is mounted under the
  `/watch` base path.

## Verification

- `pnpm --filter @forge/auth test -- src/domain/apps.test.ts src/scripts/seed-first-party-apps.test.ts`
- `pnpm --filter @forge/auth db:generate`
- `pnpm --filter @forge/auth typecheck`
- `pnpm --filter @forge/auth lint`
