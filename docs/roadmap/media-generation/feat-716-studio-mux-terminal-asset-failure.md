---
id: "feat-716"
title: "Stop Studio Mux reconciliation after terminal asset failure"
owner: "nisal"
priority: "P1"
status: "complete"
start_date: "2026-10-16"
duration: 1
depends_on: []
blocks: []
tags: [manager, admin, studio, mux, reliability]
---

## Problem

The Studio Mux dispatcher treats every asset status other than `preparing` as
ready. A Mux asset in terminal `errored` state therefore fails ready-proof
validation while its durable job remains `PROCESSING`. The pending scan then
rediscovers the same job indefinitely, producing a warning every 10–20 seconds
without a recoverable next action.

## Entry Points — Read These First

1. `apps/manager/src/services/studio-render-mux.ts` — authenticated Mux asset observation.
2. `apps/manager/src/services/studio-mux-runner.ts` — durable candidate reconciliation.
3. `apps/manager/src/services/studio-mux-dispatch.ts` — Manager-to-Admin RPC port.
4. `apps/admin/src/services/studio-authoring/mux-jobs.ts` — canonical Mux job state transitions.
5. `apps/admin/src/services/studio-authoring/render-rpc.ts` — trusted render-worker boundary.

## Grep These

- `observeStudioMuxAsset|runStudioMuxCandidate|mux-upload-failed`
- `PROCESSING|FAILED|mux-pending|Mux render intent`

## What To Build

Recognize Mux's terminal `errored` asset state explicitly. Add a trusted,
idempotent Admin transition that marks only the matching `PROCESSING` asset job
as `FAILED`, and invoke it from Manager reconciliation. Preserve the exact
asset identity and never create a replacement upload or asset.

## Constraints

Provider calls stay outside Admin transactions. A failure acknowledgment must
match the stored asset ID and must not mutate a ready job. Unknown provider
states remain errors rather than being silently classified as terminal. Do not
retry a consumed dispatch or trigger another paid provider action.

## Verification

Cover `preparing`, `ready`, and `errored` observations; assert an errored asset
is acknowledged once, reaches `FAILED`, leaves the pending scan, and never
stages or creates a replacement. Run focused Manager tests, touched lint/type
checks, Admin type checks, and roadmap validation.
