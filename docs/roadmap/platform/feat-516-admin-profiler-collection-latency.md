---
id: "feat-516"
title: "Characterize Admin profiler collection latency after deployment"
owner: "nisal"
priority: "P2"
status: "complete"
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

## Proven local correction — September 18

An owned production build now reproduces the cold collection without a second
CPU sampler. Two catalog controls measured 742–815 ms synchronous collection
and 910–931 ms independent health probes. Preparing already-loaded source maps
between event-loop turns reduces those to 209–215 ms and 270–285 ms respectively,
while preserving mapped source locations and continuous profiling. Later
collections, GC, async encoding and RSS are recorded separately.

See `docs/solutions/performance-issues/datadog-first-collection-lazy-source-maps-20260918.md`
and `docs/validation/watch-followups-2026-09-18/profiler-collections.json`.
The installed-dependency regression fails on the original package and passes
with the pinned patch, including indexed maps, yielding, lazy unused modules and
malformed-map error behavior. Production acceptance is recorded below; no claim
is made that this explains warm-process Watch selection failures.

## Production acceptance — September 18

PR #2339 merged as `c813991ad3645aebdb50d6b1cac92a47b5aad250` after
98 successful checks and one skip. Admin deployment
`985ecb1b-981a-4515-8438-2fd5a1c4c875` and worker deployment
`695f26a0-9264-4885-be04-5f175d973a30` completed automatically. Both running
revisions and installed patches were verified; the Admin process itself
confirmed profiling remained enabled.

A timing-only observer installed at process age 15 seconds captured the first
ordinary collection at 00:25:35 UTC: heap 92.51 ms + wall 157.12 ms = 249.63 ms.
At 00:27:46 a later collection took 62.27 + 94.27 = 156.54 ms. Maximum loop
delay over the respective 70-second windows was 370.41 and 186.12 ms. No second
CPU sampler ran. Both wrappers, monitors and inspectors were restored, with
separate closure checks. This completes the demonstrated cold-profiler
correction; the old warm-process measurement is not a matched cold control.

A selection still exceeded the upstream deadline about nine seconds after the
later collection. That separate failure keeps feat-496 open. See
`docs/operations/watch-followups-verification-2026-09-18.md` for the distinct
request outcomes and limits.
