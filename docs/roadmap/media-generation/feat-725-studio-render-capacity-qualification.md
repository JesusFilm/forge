---
id: "feat-725"
title: "Qualify Studio render parallelism and memory headroom"
owner: "tataihono"
priority: "P2"
status: "not-started"
start_date: "2026-10-17"
duration: 2
depends_on: []
blocks: []
tags: [studio, rendering, worker, performance, memory]
---

## Problem

The production VM has four vCPUs and approximately 8GiB RAM. The v3 job and
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
