---
module: Admin video duration loader
date: 2026-09-16
problem_type: performance_issue
component: service_object
severity: high
symptoms:
  - "Watch selection exceeded the 700 ms Web-to-Admin deadline around small database operations"
  - "Prisma transferred 142,956 dub rows for a 216-video duration batch with nested take: 5"
  - "Concurrent catalog hydration delayed an independent small-transaction probe beyond 700 ms"
root_cause: wrong_api
resolution_type: code_fix
tags:
  - prisma
  - postgres
  - event-loop
  - recommendations
  - dataloader
---

# Nested relation limits can still transfer the complete dubbed catalog

## Evidence and causal boundary

The pinned Prisma 6.19.3 adapter implements the duration loader's nested
`dubs: { take: 5 }` by reading every matching relation row and trimming the
result in application memory. A bounded production capture on Admin revision
`b96f5f738d3357e228da1d05bb79ec9ea2d02d68` recorded the exact projection used by
`createLoaders().videoPrimaryDubDurationById`: 142,956 rows for 216 videos,
ordered by duration, with OFFSET but no LIMIT. A separate 45-second capture
transferred 2,098,676 rows across 30 video-dub SELECTs. CPU samples included pg
result parsing, Prisma processing and garbage collection.

The hypothesis was that concurrent catalog hydration blocks the shared event
loop long enough to delay unrelated transaction callbacks. An isolated local
PostgreSQL fixture with 216 videos and 662 dubs each reproduces that mechanism.
The checked-in probe runs the actual loader, with the historical implementation
as an explicit control. An independent worker sends two catalog requests every
2.5 seconds and sequential eight-query transaction probes for 30 seconds.
It asserts identical duration results, counts HTTP failures separately, and
measures scheduling with `monitorEventLoopDelay`. The probe is not a simulated
selection mutation or a production error-rate estimate.

| Isolated matched workload  | Historical loader |    Bounded SQL |
| -------------------------- | ----------------: | -------------: |
| Catalog requests           |                24 |             24 |
| Catalog p95 / maximum      |  1,800 / 1,811 ms | 52.4 / 54.7 ms |
| Small transaction probes   |               197 |            271 |
| Probe p95 / maximum        |      633 / 738 ms | 11.9 / 89.2 ms |
| Probes exceeding 700 ms    |                 3 |              0 |
| Maximum event-loop pause   |          418.9 ms |        15.3 ms |
| HTTP failures (both paths) |                 0 |              0 |

Probes run sequentially with 100 ms between completions, so the faster treatment
completes more probes. Catalog arrival rate is identical. These final runs were
sequential without concurrent builds/tests from this task, after incorporating
main revision `3028f3305c1b01c2e4671ec9686ee51280dd1115`. The fixture includes the
existing partial duration index from migration 0035. Read-only production
inspection confirmed that index exists and is valid; no migration is required.

Separate local `EXPLAIN (ANALYZE, BUFFERS)` measures database execution without
transferring the result set: 103.0 ms / 142,992 rows before, versus 3.6 ms / 216
rows afterward. A conservative earlier fixture with only a basic video-ID index
took 109 ms versus 231 ms inside PostgreSQL, but still reduced end-to-end
catalog maximum from 2,013 ms to 252 ms and transaction maximum from 780 ms to
85 ms. This distinction prevents mistaking total client time for database time.

The production browser baseline at 01:28:42–01:29:38 UTC recorded 12 served
recommendation responses (six cards each), with no delivery fallback. Five of
six selections acknowledged; one browser abort corresponds to Web HTTP 503
trace `6aa9f0f5000000002968452ed5de64cd`: Web took 704 ms, its upstream deadline
expired at 700 ms, and Admin's selection took 814 ms. The served-item lookup
took 574 ms and the revocation lookup 187 ms. Those span durations include
application scheduling and are not measurements of PostgreSQL execution alone.

## Separate measurements

- Pool acquisition: 5,757 observations in 45 seconds; maximum 116.7 ms. The
  largest queue snapshot was 44 waiters. Client callback timing also includes
  scheduling, so it does not isolate time spent waiting for a connection.
- Database execution and locks: 433 independent `pg_stat_activity` snapshots
  over 45 seconds found three advisory-blocking samples, with query ages of
  1.0, 8.8 and 112.2 ms. Other active catalog/retrieval queries reached 1.86 s.
  These later samples cannot disprove lock waits during the earlier failure.
- Application: the 45-second capture recorded a maximum event-loop pause of
  180.5 ms. Local controlled reproduction isolates the loader's effect without
  production locks, Redis admission or background workflows.
- Runtime limits: current Admin cgroup counters showed no CPU throttling or
  memory-limit/OOM events. These counters do not explain earlier containers.

Temporary pg wrappers had a 55-second automatic restoration timer and explicit
finally cleanup. All captures removed their loop monitors and verified that
the inspector was closed. The independent read-only database observer exited.
No persistent production setting changed.

## Fix and regression

`apps/admin/src/services/video-primary-dub-duration.ts` uses a parameterized
LATERAL query to select the five longest eligible dubs inside PostgreSQL and
project one duration per video. It preserves the existing primary-language
preference within those five, longest-dub fallback, deleted/unpublished rules,
positive duration requirement, null handling and non-null HLS semantics.
DataLoader still owns request-local batching, order and caching.

`apps/admin/src/services/recommendations/playback-episode.db.test.ts` checks real PostgreSQL
semantics and replays Prisma's emitted SELECTs to measure transferred rows.
The regression fails on the historical implementation (143,208 rows against a
1,296-row bound), and passes with the scalar projection (216 rows). CI runs it
through its existing Watch PostgreSQL entry point, without changing the workflow
(the available GitHub credential cannot modify workflow files). Mocking `findMany` alone cannot
detect this failure.

Reproduce against a dedicated local database, sequentially without other builds:

```sh
DATABASE_URL=<local-disposable-postgres> pnpm --filter @forge/admin exec tsx src/scripts/probe-video-duration-runtime.ts --baseline
DATABASE_URL=<local-disposable-postgres> pnpm --filter @forge/admin exec tsx src/scripts/probe-video-duration-runtime.ts
```

The script rejects non-local hosts, creates a uniquely named schema and removes
only that schema. Do not run a load fixture against production or a database
owned by another task.

## Remaining uncertainty

This fixes a demonstrated source of application stalls, not every possible
deadline failure. Selection does not use Redis admission. Earlier unmatched
Redis incidents, delivery fallbacks, other nested relation loaders and workflow
execution in the Admin process require separate evidence. In particular,
`@workflow/world-postgres` 4.1.1 starts listeners when queueing work even when
the application's startup runner gate is off; its contribution has not been
causally isolated. Keep feat-496 open until release monitoring supports recovery.

## Release continuation

The duration fix alone did not finish recovery: its first production window
still contained a selection HTTP 503 and an HTTP 200 timeout fallback. A second
proven workload, wide subtitle/language materialization, was corrected in #2322.
Read `docs/operations/watch-admin-duration-recovery-2026-09-16.md` for the later
fixed observation window and its separate HTTP, semantic and browser findings.
Do not attribute every observed delay to this one loader.

## September 22: the Mux fallback has the same unbounded relation read

The playback-ID fallback also used nested `take: 5`. Its join to the Mux table
adds a second failure mode: a parallel hash can exhaust PostgreSQL shared memory
under concurrent catalog reads before Prisma trims the results. A representative
owned fixture with existing production indexes reproduced SQLSTATE 53100 in
20/40 actual Prisma calls. A parameterized LATERAL projection preserved all
206 playback choices and passed 40/40 calls in 32–83 ms. Real database tests
must measure transferred rows, including visibility and null/ordering semantics;
mocked relation arrays conceal both the overscan and PostgreSQL plan.

See [the catalog recovery record](../../operations/watch-catalog-memory-recovery-2026-09-22.md)
for the bounded production plans, failed row-count regression, rejected initial
fixture, actual Next build workload and release obligations. Preserve the
existing index set when comparing query candidates: omitting the playable
duration index initially made the bounded join slower. Do not fix this by
raising shared-memory limits, adding mutation retries or enlarging deadlines
without evidence. The initiating database failure and subsequent synchronous
error-formatting amplification require separate corrections and measurements.

The final CASE-based query and logger are verified in both production roles at
`ce421561ee9bcf89991dea5a060a656e45c3434b`. A bounded read-only executed plan
returns the 206 selected catalog rows in 9.982 ms using the existing indexes;
production's current shared-memory mount is 64,000,000 bytes. The
[release verification](../../operations/watch-runtime-release-verification-2026-09-22.md)
retains the historical-load uncertainty and separate timeout populations.
Compiled-symbol checks must survive minification: verify the distinctive final
SQL and revision rather than requiring a helper's source-level function name.
