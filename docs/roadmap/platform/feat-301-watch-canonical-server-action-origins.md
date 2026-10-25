---
id: "feat-301"
title: "Allow canonical Watch Server Action origins"
owner: "unassigned"
priority: "P0"
status: "in-progress"
start_date: "2026-07-23"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch"
  - "routing"
  - "search"
  - "server-actions"
---

## Problem

Core's canonical-host proxy now forwards Watch POST requests to Forge, but
Railway replaces the forwarded host with its upstream hostname. Next.js then
rejects Forge Web Server Actions because the public
`Origin: www.jesusfilm.org` does not match that final `x-forwarded-host`. The
canonical Watch page remains healthy for GET requests while search fails on its
POST with `500 Invalid Server Actions request` (FGE-16).

## Entry Points - Read These First

1. `apps/web/next.config.mjs` - Forge Web's deployed Next.js configuration.
2. `apps/web/src/lib/search-actions.ts` - Watch search Server Action.
3. `apps/web/scripts/next-config.test.mjs` - exact canonical-origin regression
   coverage.
4. `apps/web/railway.toml` - production Forge Web deployment configuration.

## Grep These

- `serverActions`
- `allowedOrigins`
- `Invalid Server Actions request`
- `x-forwarded-host`
- `runSearch`

## What To Build

1. Configure Forge Web's `experimental.serverActions.allowedOrigins` with the
   exact production and staging canonical Watch proxy hosts.
2. Keep all unlisted origins rejected by Next.js CSRF validation.
3. Add focused coverage for the resolved origin list.
4. Verify the actual browser journey: open canonical Watch search, submit
   `JESUS`, receive a successful Server Action POST, and render the exact-title
   result.

## Constraints

- Do not allow wildcards or the Railway upstream hostname.
- Do not weaken or bypass Next.js Server Action CSRF validation.
- Do not move search to a GET probe or treat Watch HTML health as search health.
- Keep the Core Worker responsible only for routing; Forge Web owns the Server
  Action origin policy.

## Verification

- `pnpm --filter @forge/web test -- scripts/next-config.test.mjs`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- `pnpm --filter @forge/web build`
- Browser/HAR proof on the deployed preview and then
  `https://www.jesusfilm.org/watch`: the `/watch` action POST returns `200` and
  the modal displays the exact `JESUS` result.
