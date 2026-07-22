---
id: "feat-286"
title: "Web Tailscale dev-origin hydration"
owner: "codex"
priority: "P2"
status: "complete"
start_date: "2026-07-22"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "developer-experience"
  - "nextjs"
---

## Problem

Forge Web renders server HTML over a Tailscale Serve hostname, but Next.js 16
blocks the remote host's dev-only HMR resource because `allowedDevOrigins` only
contains `127.0.0.1`. React hydration then never reaches the Watch subtree, so
buttons are visible but inert during remote QA. The same failure also occurs
when the browser uses the machine's direct tailnet IP.

## Entry Points - Read These First

1. `apps/web/next.config.mjs` - owns the current `allowedDevOrigins` setting and
   reads the public canonical origin during Next config evaluation.
2. `apps/web/scripts/allowed-dev-origins.test.mjs` - focused config regression
   coverage for canonical remote-development hosts.
3. `docs/solutions/runtime-errors/nextjs-alloweddevorigins-hydration-dead-127-0-0-1-20260520.md`
   - prior incident and the established diagnosis for inert SSR HTML.

## Grep These

- `allowedDevOrigins`
- `NEXT_PUBLIC_CANONICAL_ORIGIN`
- `Blocked cross-origin request to Next.js dev resource`
- `webpack-hmr`

## What To Build

1. Preserve the existing `127.0.0.1` development origin.
2. When `NEXT_PUBLIC_CANONICAL_ORIGIN` is a valid URL, add its hostname to
   `allowedDevOrigins` so an explicitly configured Tailscale hostname or IP can
   hydrate in development.
3. Ignore malformed or absent canonical origins without making config import
   fail.
4. Verify the actual Tailscale URL loads JavaScript assets, hydrates, and opens
   a client-side Watch control without emitting a blocked-origin warning.

## Constraints

- Do not hardcode a personal tailnet hostname, tailnet suffix, or device IP.
- Do not use a wildcard that widens every development origin.
- Do not change production routing, headers, authentication, or data access.
- Keep the environment-specific hostname in the ignored local environment
  file, not tracked source.

## Verification

- Focused Vitest coverage proves valid host inclusion, missing-value fallback,
  and malformed-value fallback.
- `pnpm --filter @forge/web lint` and `pnpm --filter @forge/web typecheck` pass.
- Remote browser QA through Tailscale opens the search overlay and reports no
  browser console errors or Next dev blocked-origin warning.
- Compare the warm remote page-load duration before and after the config change
  to ensure the hydration fix does not degrade loading performance.

## Resolution

- `allowedDevOrigins` now preserves loopback and includes the hostname from a
  valid `NEXT_PUBLIC_CANONICAL_ORIGIN` without widening to a wildcard.
- Focused config coverage passes for valid, missing, malformed, and duplicate
  loopback inputs; the full Web test suite, lint, and typecheck also pass.
- Remote QA at the Tailscale Serve HTTPS URL opens the client-side search
  overlay with no browser console errors or hostname blocked-origin warning.
- Warm remote loads remained comparable to the pre-fix baseline.
