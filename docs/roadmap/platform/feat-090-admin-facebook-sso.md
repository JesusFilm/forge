---
id: "feat-090"
title: "Add Facebook SSO to admin app"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-04-14"
duration: 1
depends_on:
  - "feat-086"
blocks: []
tags:
  - "platform"
  - "admin"
  - "auth"
  - "sso"
---

## Problem

The admin app's login screen and Better Auth config supported Google, Apple,
and Okta, but not Facebook. That left a common OAuth provider missing from the
Unit 5 auth surface and forced future agents to rediscover where social
provider wiring lived.

## Entry Points

1. `apps/admin/src/auth/config.ts`
2. `apps/admin/src/app/login/page.tsx`
3. `apps/admin/src/config/env.ts`
4. `apps/admin/.env.example`

## What Changed

1. Added `FACEBOOK_CLIENT_ID` / `FACEBOOK_CLIENT_SECRET` to the validated env.
2. Enabled Better Auth's Facebook social provider with `disableSignUp: true`
   to preserve the invitation-only auth posture.
3. Rendered the Facebook button on `/login` only when the provider is
   configured.

## Verification

- `pnpm --filter @forge/admin typecheck`
- `pnpm --filter @forge/admin test`
- `pnpm --filter @forge/admin lint`
- `pnpm --filter @forge/admin build`
