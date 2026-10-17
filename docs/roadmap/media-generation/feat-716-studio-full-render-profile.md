---
id: "feat-716"
title: "Version the Studio full-render preparation and execution budget"
owner: "tataihono"
priority: "P1"
status: "in-progress"
start_date: "2026-10-17"
duration: 1
depends_on: ["feat-715"]
blocks: []
tags: [studio, rendering, worker]
---

## Problem and scope

Measured staging (80.177s) and packaging (26.407s in a separate read-only run)
exceed the shared 90s input limit. Introduce a fixed v2 contract with 180s input,
1200s cumulative execution and 1500s lease; preserve v1 snapshots and terminal
receipts without executing v1 under v2 bounds. Memory, CPU, PIDs and byte caps
stay fixed. See `docs/plans/2026-10-17-studio-full-render-profile.md`.

## Entry points

- `packages/studio-contracts/src/render.ts`: exact versioned profiles.
- `apps/admin/src/services/studio-authoring/render-jobs.ts`: current-only claims.
- `apps/manager/src/services/studio-render-pool-gateway.ts`: legacy receipt reads.
- `apps/studio-render/src/vm/`: input transport, cumulative deadline.
- `apps/studio-render/native/vm-watchdog.c`: matching native upper bound.
- `apps/studio-render/ops/release/`: immutable main release and legacy rollback.

## Verification and rollout

Test exact profile decoding, legacy refusal for new work, historical settlement,
transport/native parity, cancellation and immutable release validation. Drain the
existing VM before main deploys v2; publish CI-built main artifacts, select and
activate the matching VM release, then run repaired revision 21 end to end.
Preserve failed attempts and old revisions. Never publish local worktree code.
