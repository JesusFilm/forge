---
id: "feat-729"
title: "Start the AI render VM on demand and stop after idle"
owner: "tataihono"
priority: "P2"
status: "in-progress"
start_date: "2026-10-18"
duration: 1
depends_on: []
blocks: []
tags: [studio, rendering, infrastructure, memory, lxd]
---

## Problem

`forge-render-ai01` on `jfpai01` stays running between renders. Release its guest
memory while preserving normal durable queue admission, receipt recovery and
existing AI services. Owner authorized queue-driven startup and ten-minute idle
shutdown. Cold startup latency is not yet measured; the last guest boot alone
was 10.975s. 40GiB is configured guest RAM, not permanently resident host RAM.

## Entry Points — Read These First

1. `apps/manager/src/services/studio-render-pool-claim.ts`: existing read-only
   `pending` scan includes admitted attempts before enqueue and expired leases.
2. `apps/manager/src/services/studio-render-transport.ts`: canonical service caller.
3. `apps/studio-render/src/vm/supervisor.mjs` and `cycle-state.mjs`: drain before
   claims, resolve existing assignments before retirement.
4. `apps/studio-render/ops/on-demand/`: host controller, guest gate and service.
5. `docs/plans/2026-10-18-studio-on-demand-worker.md`: rollout and proof.

## Grep These

`STUDIO_RENDER_DEMAND_KEY`, `hasPending`, `unfinishedAssignments`, `drained`,
`forge-render-ai01`, `idleSeconds`.

## What To Build

Dedicated authenticated no-store boolean demand endpoint, with a key that cannot
claim/finish jobs. Host polls every five seconds and starts only the fixed VM.
After ten idle minutes, drain the guest, validate every assignment journal and
container retirement, recheck demand and stop gracefully. Jobs arriving in the
stop race remain in the canonical queue and wake the next cycle. Errors never
permit shutdown; no forced stop, journal reset or lease changes.

## Verification

Test authentication separation, bounded/failed queue reads, startup failure,
restart, busy/unknown guest, idle reset, drain/stop races, unresolved journals and
non-forced shutdown. Release through normal PR/main. Measure VM-start through
successful worker polling and a fresh queued production render. Record idle
shutdown/restart and host memory release before marking complete.
