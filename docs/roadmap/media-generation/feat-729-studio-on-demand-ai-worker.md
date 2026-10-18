---
id: "feat-729"
title: "Start the AI render VM on demand and stop after idle"
owner: "tataihono"
priority: "P2"
status: "complete"
start_date: "2026-10-18"
duration: 1
depends_on: []
blocks: []
tags: [studio, rendering, infrastructure, memory, lxd]
---

> Superseded by owner decision 2026-10-19 (feat-731): production returns to
> always-on Proxmox VM109 on `jfp00`. The AI guest is disabled/off and the demand
> monitor is retired. Historical measurements below remain evidence, not current
> activation instructions. See `docs/plans/2026-10-19-studio-always-on-proxmox.md`.

## Problem

`forge-render-ai01` on `jfpai01` stays running between renders. Release its guest
memory while preserving normal durable queue admission, receipt recovery and
existing AI services. Owner authorized queue-driven startup and ten-minute idle
shutdown. Measured cold request-to-worker claim is 19.891s. 40GiB is configured guest RAM, not permanently resident host RAM.

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

## Completed production qualification

PR #2795 deploys the Manager endpoint. PR #2796 fixes the real Python client's
edge identity without relaxing Cloudflare policy. Reviewed controller main
`591f6e5acd736743ccb45fe297e9679d79f00516` is active/enabled under the existing
trusted LXD administrator, with lingering,5s polling and600s idle policy. Guest
autostart is disabled only after the real healthy controller cycle.

Fresh cold attempt `cmvdn6d2y0001not28ojfrv0x` acquires its canonical lease
19.891s after request. Full retained output succeeds in412.579s, separately read
back by digest; the source remains draft revision21. Native job retirement is
complete, and all15 existing AI services retain their identities/start times and
restart counts. The five-minute full-flow target remains open in feat-725.

Real automatic stop completed at 10:04:45.907Z, 609.239s after idle began,
including graceful shutdown. QEMU exits and host available memory increases by
19.59GiB. The enabled watcher uses 12.95MiB at the final snapshot, with zero
restarts. All8856 video frames decode, and complete AAC matches the reference.
All15 existing AI services remain unchanged. Exact evidence is in the plan and
operator artifact bundle. Failure-injection expansion is tracked separately in
feat-730; no claim of exhaustive distributed-failure qualification is made.
