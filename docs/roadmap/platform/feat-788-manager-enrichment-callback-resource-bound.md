---
id: "feat-788"
title: "Bound Manager enrichment callback admission state"
owner: "vlad"
priority: "P2"
status: "in-progress"
start_date: "2026-10-23"
duration: 1
depends_on: []
blocks: []
tags:
  - "manager"
  - "security"
  - "ai-pipeline"
---

## Problem

PR #1087 retains distinct callback address keys in a process-lifetime Map before bearer rejection. Entries never expire unless the same key returns. S2 identifies a resource bound defect; production exhaustion and address spoofing through Cloudflare are not established.

## Entry Points — Read These First

1. `apps/manager/src/app/api/internal/enrichment-callback/route.ts` — pre-auth admission.
2. `apps/manager/src/app/api/internal/enrichment-callback/route.test.ts` — dummy callback tests.
3. `apps/manager/src/lib/state.run-ownership.test.ts` — callback/watchdog versus dispatch/reset/restamp interleavings.
4. `apps/mastra/src/mastra/workflows/forge-video-enrichment.test.ts` — full current Manager caller shape.
5. `docs/fixtures/manager-enrichment-steps.json` — both app-local callback inventories.
6. `docs/plans/2026-06-01-001-feat-manager-enrichment-mastra-finishable-stages-plan.md` — the 49-file PR intent.

## Grep These

- `callbackRateLimitBuckets|checkCallbackRateLimit|readClientRateLimitKey`
- `currentRunId|callbackSequences|FORGE_ENRICHMENT_MASTRA_RAMP_ENABLED`

## What To Build

Bound retained address length and cardinality, expire unused windows, and document header trust. Preserve cheap admission before bearer validation, body bounds, run fencing, monotonic job transitions, feature flags, and the two-phase handoff. Diagnose the existing Manager test failure and merge current main normally into the PR branch, reconciling each conflict semantically.

## Independent correction round 2

Candidate `86d9dc7cc31aa2b5c70e062423bee2d3c51b354b` was rejected on four P2 findings. Queue ownership-changing state writes with callbacks/watchdogs; atomically retire prior-run metadata on rerun reset; accept/preserve optional `videoTitle`; align the complete callback step vocabulary; and fail closed when selected engine persistence fails. See `docs/plans/2026-10-23-manager-callback-bounded-admission-plan.md` and the compound solution `docs/solutions/security-issues/manager-callback-bounded-pre-auth-admission.md`. Preserve original S2 bounds and the integrated main; keep this feature in progress pending new exact-head independent acceptance.

## Constraints

Local correction and dummy-only verification. No providers, production state, credentials, activation, push, or public PR mutation. Keep this ticket in progress until independent acceptance. Related broader pipeline work remains in `feat-031`.

## Verification

Run callback resource-bound and auth/job regression tests; full Manager tests; touched Mastra and feature-flag tests; Manager/Mastra typecheck and strict lint; format, roadmap, diff, and commitlint checks. Record exact heads, merge resolutions, logs, qualifications, and reviewer brief in the private implementation packet.
