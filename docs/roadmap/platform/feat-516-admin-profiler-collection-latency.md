---
id: "feat-516"
title: "Characterize Admin profiler collection latency after deployment"
owner: "nisal"
priority: "P2"
status: "not-started"
start_date: "2026-09-16"
duration: 1
depends_on: []
blocks: []
tags:
  - "infrastructure"
  - "datadog"
  - "performance"
---

## Problem

A bounded capture near the first #2322 deployment recorded a 598 ms Admin
main-loop pause containing Datadog profile serialization, lazy source-map parsing
and garbage collection. It overlapped an additional diagnostic CPU sampler and
has no matched Watch timeout. Later timing-only observations measured ordinary
heap-plus-wall collection at 77–92 ms, not 598 ms. A local replay with unmatched
bundle paths did not reproduce the large pause. This is an unproven latency
hypothesis, not a remaining confirmed cause of Watch failure.

Read `docs/operations/watch-admin-duration-recovery-2026-09-16.md` for exact
windows and diagnostic limitations before changing observability configuration.

## Entry points and investigation

- `apps/admin/railway.toml` and `apps/admin/railway.worker.toml`: runtime-only
  `dd-trace/init` preload and Node `--enable-source-maps`.
- `apps/admin/src/observability/datadog.ts`: tracing and runtime metrics.
- Pinned `dd-trace` 5.109.0 `src/profiling/profiler.js`: synchronous `_collect`
  before asynchronous encoding/export.
- Pinned `@datadog/pprof` 5.15.0 `profile-serializer.js` and
  `sourcemapper/sourcemapper.js`: `serializeTimeProfile`, `serializeHeapProfile`,
  `mappingInfo`, and lazy source-map consumer parsing.

Reproduce first and later profile collections using an owned production build,
matching source maps, realistic allocation/call-stack load, and an independent
request probe. Record mapping, serialization, encoding, GC and request latency
separately. Test without an additional CPU profiler before claiming recurrence.
If production timing is necessary, bound collection and restore every wrapper,
monitor and inspector; leave existing profilers running.

## Constraints and verification

Do not disable profiling, remove source maps, inflate request deadlines or
change shared service settings based on CPU samples alone. Preserve APM error
stacks, continuous-profile usefulness and normal workload behavior. Only propose
a fix after a representative control reproduces the pause and a matched
experiment removes it. Release any proven correction through normal PR/main,
verify the actual deployed SHA and compare cold and warm observations.
