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
3. `docs/plans/2026-06-01-001-feat-manager-enrichment-mastra-finishable-stages-plan.md` — the 49-file PR intent.

## Grep These

- `callbackRateLimitBuckets|checkCallbackRateLimit|readClientRateLimitKey`
- `currentRunId|callbackSequences|FORGE_ENRICHMENT_MASTRA_RAMP_ENABLED`

## What To Build

Bound retained address length and cardinality, expire unused windows, and document header trust. Preserve cheap admission before bearer validation, body bounds, run fencing, monotonic job transitions, feature flags, and the two-phase handoff. Diagnose the existing Manager test failure and merge current main normally into the PR branch, reconciling each conflict semantically.

## Constraints

Local correction and dummy-only verification. No providers, production state, credentials, activation, push, or public PR mutation. Keep this ticket in progress until independent acceptance. Related broader pipeline work remains in `feat-031`.

## Verification

Run callback resource-bound and auth/job regression tests; full Manager tests; touched Mastra and feature-flag tests; Manager/Mastra typecheck and strict lint; format, roadmap, diff, and commitlint checks. Record exact heads, merge resolutions, logs, qualifications, and reviewer brief in the private implementation packet.
