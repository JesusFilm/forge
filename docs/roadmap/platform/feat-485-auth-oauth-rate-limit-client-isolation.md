---
id: "feat-485"
title: "Isolate Auth OAuth rate limits by client IP"
owner: "tataihono"
priority: "P0"
status: "complete"
start_date: "2026-09-11"
duration: 1
depends_on: []
blocks: []
tags:
  - "auth"
  - "manager"
  - "platform"
---

## Problem

Manager sign-in intermittently returns HTTP 429 at Auth's OAuth authorization
endpoint. Production Auth logs report that Better Auth cannot resolve a trusted
client IP and falls back to a shared per-path rate-limit bucket.

## Entry Points — Read These First

1. `apps/auth/src/auth/config.ts` — Better Auth options.
2. `apps/auth/src/auth/config.test.ts` — captured options and behavioral tests.
3. `apps/auth/src/auth/rate-limit.ts` — separate custom-route limiter.

## Grep These

- `ipAddressHeaders|trustedProxies|no-trusted-ip`
- `oauth2/authorize|rateLimit`

## What To Build

Configure Better Auth to resolve Cloudflare's client IP header. Exercise the
installed Better Auth OAuth authorization limiter using the application's IP
configuration: exhausting one client's budget must not reject another client.

## Constraints

Preserve rate-limit ceilings. Do not trust arbitrary forwarded chains or disable
IP tracking. Production rollout uses the normal PR-to-main flow.

## Verification

- `pnpm --filter @forge/auth test`
- `pnpm --filter @forge/auth typecheck`
- `pnpm --filter @forge/auth lint`
- Prettier check for touched files.
- After normal deployment, verify fresh Manager sign-in and Auth 429 logs.

## Implementation Evidence

The real Better Auth OAuth limiter regression failed before the IP configuration
change and passed afterward. Validation: 569 tests passed, 29 existing tests
skipped; Auth typecheck and lint passed. The change is locally verified;
production deployment and post-deploy sign-in verification remain release steps.
Durable diagnosis: `docs/solutions/auth/better-auth-shared-oauth-rate-limit-bucket.md`.
