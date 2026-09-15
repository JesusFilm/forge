---
id: "feat-507"
title: "Diagnose private Admin connection failures during deployment cutover"
owner: "nisal"
priority: "P2"
status: "not-started"
start_date: "2026-09-15"
duration: 2
depends_on: []
blocks: []
tags: ["web", "admin", "infrastructure", "reliability"]
---

## Problem

At 02:34:46 UTC on 15 September, immediately after Admin deployment
`b99f39ae-106e-427e-bf22-09e80ae9c27c` became successful, Web recorded two
`fetch failed` spans against the private Admin GraphQL host. One produced a
download HTTP 503 for a crawler. Timing suggests a cutover connection race;
the exact networking cause is unconfirmed. This is separate from the Redis
admission failure tracked by feat-496.

## Entry points and evidence

- `apps/admin/railway.toml`: healthcheck and deployment configuration.
- `apps/admin/src/app/api/health/route.ts`: readiness behavior.
- `apps/web/src/lib/admin-client.ts`: private GraphQL transport and timeouts.
- `apps/web/src/app/api/download/route.ts`: upstream failure behavior.
- Traces `6aa8aec60000000004ed12ca388df571` (download) and
  `6aa8aec60000000074ae2912eb79d677` (upstream request).
- `docs/operations/watch-runtime-recovery-2026-09-15.md`.

## Investigation and verification

Correlate Railway readiness, private DNS/address changes, old-container teardown
and client keep-alive behavior. Reproduce a rolling upstream replacement locally
before changing lifecycle or transport policy. If a retry is justified, prove
that it cannot duplicate mutations; do not apply blanket GraphQL retries.
Preserve public-origin controls and private routing. Use normal PR/main deployment
and verify representative requests across cutover, including download redirects.
