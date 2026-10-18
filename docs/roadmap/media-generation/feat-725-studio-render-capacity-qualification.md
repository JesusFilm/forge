---
id: "feat-725"
title: "Qualify Studio render parallelism and memory headroom"
owner: "tataihono"
priority: "P2"
status: "in-progress"
start_date: "2026-10-17"
duration: 2
depends_on: []
blocks: []
tags: [studio, rendering, worker, performance, memory]
---

## Acceptance target

Owner target: the complete repaired 8856-frame portrait project must finish in
**at most 300 seconds end to end**, including preparation, input transport,
rendering, independent codec verification and retained output. A faster render
alone does not pass. Keep full 1080x1920/30fps video and complete audio.

## Problem

At diagnosis, the production VM had four vCPUs and approximately 8GiB RAM. The v3 job and
Docker container each enforce two CPUs and 2GiB; rendering concurrency and codec
threads are one. During revision-21 attempt `cmvbzdb8z0001rut7o9g83y4u`,
CPU use is about 1.4 cores with negligible quota throttling. A 10s VM sample
measures 38.56% busy, 0% steal and 0.05% I/O wait. Raising only the CPU quota
would leave this serial bottleneck. At 8224 frames the aggregate memory cgroup
has recorded 15 limit events without an OOM kill; headroom is also tight.

## Entry Points — Read These First

1. `apps/studio-render/src/child.mjs`: `concurrency`, `offthreadVideoThreads`,
   trusted paired SDK opt-ins and fixed frame-cache size.
2. `patches/@remotion__renderer@4.0.475.patch`: paired codec threads, streaming
   backpressure and admitted remux reuse.
3. `packages/studio-contracts/src/render.ts`: immutable profile resources and
   deadlines; never silently reinterpret a persisted v3 assignment.
4. `apps/studio-render/src/vm/` and `apps/studio-render/ops/release/`: aggregate
   cgroup, watchdog, container and selected release resource parity.
5. `docs/solutions/performance-issues/studio-full-render-source-preparation.md`:
   measured production boundaries and full-render acceptance evidence.

## Grep These

`FORGE_STUDIO_CODEC_THREADS`, `FORGE_STUDIO_STREAM_FRAMES`, `concurrency`,
`offthreadVideoThreads`, `memory.max`, `cpu.max`, `STUDIO_RENDER_PROFILE`.

## What To Build

First benchmark representative portrait fixtures and the complete repaired
timeline with paired CPU/parallelism/memory configurations. Measure elapsed
time, throughput by timeline section, aggregate memory peak and limit/OOM
events, PIDs, CPU throttling and complete output verification. Compare increased
memory without extra parallelism against increased concurrency/codec threads.
Choose a measured configuration with explicit host reserve and useful memory
headroom. If resources change, introduce an exact new immutable execution
profile and update all consumers, native bounds and release identities together.

## Constraints

Use an isolated benchmark or normally drained worker; do not compete with a
production acceptance render or mutate its cgroups, deadlines or assignment.
Keep backpressure, source reuse, cancellation, independent codec proof, output
limits and historical receipts. Normal PR/main and CI-built immutable release
only. Do not assume adding VM vCPUs improves a serial renderer.

## Verification

Run scoped contract/worker and patched-consumer checks. Record reproducible
configuration and measured speed/headroom changes. Require a fresh complete
8856-frame 1080x1920/30fps render with complete AAC, independent decode and
retained-byte verification before qualifying any new production profile.

## Current host qualification (2026-10-18)

Owner authorized a render VM on existing AI host `jfpai01`. Standby KVM guest
`forge-render-ai01` now runs under Canonical LXD on the unchanged Ubuntu host:
24 pinned logical CPUs (`0-11,16-27`), 40GiB RAM, 60GiB disk, no GPU passthrough.
LAN DHCP address observed `10.2.70.237`; direct SSH has pinned host-key verification.
Docker is installed from the official signed repository with root-only socket;
guest swap disabled. Existing AI containers keep their original uptimes. Guest
reboot/cloud-init/Docker checks pass. Autostart and production dispatch remain off.

Before this VM was created, full offline host CPU/GPU-encoding prototype runs took
219.650s / 210.427s respectively, both passing full independent decode/frame count
and audio equality. CPU-only is the initial migration candidate. A full CPU run
inside the new guest completes in 242.995s (4m03s), with no OOM and 16.86GiB
peak job RAM; full independent decode/frame count and complete AAC equality pass (56.283s
operator-side verification excluded from render time). Exact GPU temporal/quality equivalence and
busy AI-host coexistence remain unqualified. The fast renderer is still prototype
code; the published v3 release still enforces its immutable 2CPU/2GiB profile.
Migration alone cannot deliver the prototype's throughput. Complete reviewed
renderer/profile/release work and full end-to-end qualification before production
cutover; preserve the original worker and assignment journals for rollback.

See `docs/plans/2026-10-17-studio-five-minute-render.md` for reproducible evidence
and host setup artifacts `/home/tataihono/forge-render-vm-setup` on `jfpai01`.

## Parallel production release in progress

Owner approved CPU parallel release and AI-host cutover. New immutable v4 uses
24 CPU / 32GiB / 4096 tasks; historical v3 stays unchanged. Sixteen bounded frame
workers feed one continuous encoder and once-global audio stitch. The independent
verifier, native cancellation, deadlines and output-size limits remain enforced.
Old worker is gracefully drained: 92 journals checked, no unfinished assignments
or containers; preserve VM/artifacts for rollback. Release config targets
`forge-render-ai01`. Focused contract, Manager, Admin, worker/native and release
tests pass; full source/image correctness and production timing gates remain.

## Remaining qualification follows jfpai01

Parallel CPU release [#2793](https://github.com/JesusFilm/forge/pull/2793) is merged
at `b79a3bc3a8f7d1b0ab3a2238127e80ce6c5383fd`; hosted run
[39103794388](https://github.com/JesusFilm/forge/actions/runs/39103794388) publishes
the exact v4 images and host bundle for `forge-render-ai01`. All 47 PR checks and
post-merge forge-ci pass. The old VM's worker is persistently disabled and drained;
keep its VM/config/journals for coordinated rollback, without dispatching it.

The exact hosted render image, without source bind mounts, completes in 241.504s;
the separate exact hosted verifier completes in 28.614s, both exit zero. Peak job
RAM 16.79GiB, tasks 1763, no OOM. Complete decode counts 8856 frames at 1080x1920/30fps;
complete AAC equals the production reference. These two stages sum 270.118s,
leaving only 29.882s for every other stage of a 300s complete-flow target. This is
not end-to-end acceptance.

Keep this ticket in progress for all remaining performance work on the AI host:

- Run fresh canonical revision 21 attempts with preparation/input delivery,
  native render/verify, retained-byte readback and total timestamps recorded.
- Investigate preparation/transport costs before adding CPUs or GPUs. The
  separate input-cache PR #2785 remains unmerged and must qualify independently.
- Measure coexistence while existing AI services are busy; CPU pinning does
  not prevent host tasks from sharing the guest's selected cores.
- Preserve native deadlines, output limits, complete audio/video checks and
  historical receipt identity in any later optimization/profile release.
- GPU encoding/decoding and authored-video temporal equivalence remain separate
  experiments; no GPU is needed for this initial CPU production cutover.

The release plan records immutable digests and cutover/production-run evidence.
Do not mark this ticket complete until the full retained-output flow is <=300s.
