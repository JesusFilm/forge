---
id: "feat-185"
title: "Watch SEO Manifest Fetch Hardening"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-06-12"
completed_date: "2026-06-12"
duration: 1
depends_on:
  - "feat-184"
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "seo"
  - "revalidation"
---

## Problem

Production validation after `feat-184` seeded the first Watch SEO manifest
snapshot showed the sitemap routes can briefly return 503 after web cache
revalidation. Web clears its process-local manifest cache, performs a cold
fetch from Admin, and aborts after 3 seconds. The current production manifest
payload is about 3.9 MB and one cold Admin response took roughly 3.3 seconds,
so the timeout margin is too small. The failed first fetch is then cached as
`null` for 60 seconds, extending a transient cold-fetch miss into a visible
sitemap outage window.

## What To Build

- Increase the Web Watch SEO manifest fetch timeout so cold Admin responses
  have enough headroom.
- Keep serving stale manifests on refresh failures when Web already has one.
- Do not cache an initial `null` manifest for the full success TTL; retry after
  a short miss TTL instead.
- Add focused Web tests for the timeout and initial-miss cache behavior.

## Verification

- `pnpm --filter @forge/web test -- src/lib/watch-seo-manifest.test.ts src/app/sitemap.test.ts`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
