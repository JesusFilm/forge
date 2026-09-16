---
title: "Select requested subtitle and language scalars before Prisma materialization"
date: "2026-09-16"
module: "apps/admin Watch GraphQL"
problem_type: "performance_issue"
tags:
  - "watch"
  - "pothos"
  - "prisma"
  - "event-loop"
---

# Subtitle scalar projection and Admin scheduling

After the duration-loader correction in #2319, production still reproduced a
selection HTTP 503 and an HTTP 200 `delivery_timeout` fallback. The fixed
30-minute window and separate outcome populations are recorded in
`docs/operations/watch-admin-duration-recovery-2026-09-16.md`.

## Evidence and cause boundary

During retained selection trace `16999250323956071879`, the pg client completed
a lookup in 2.6 ms, then independent PostgreSQL observations showed more than
250 ms waiting for the next application command (`ClientRead`). No blocker was
observed on that trace. The overlapping event-loop capture recorded a 139 ms
pause. CPU samples included Prisma response parsing, object traversal and
GraphQL serialization; those samples alone do not identify the input workload.

Bounded JSON instrumentation identified recurring `findManyVideoDub` results:
100 already-selected dubs, 100 editions, 3,660 subtitle objects and about 5.5 million
characters of Prisma JSON. The nested GraphQL selection requested only VTT, primary and two
language fields. Pothos include mode nevertheless loaded every subtitle scalar
and every language scalar. Prisma decoded and copied the unused metadata before
the application traversed the full result to enforce its embedding guard.

This is independent of the earlier nested duration `take` overfetch. A SQL row
count alone misses the cost of wide, repeatedly materialized relation objects.
It also does not prove the separate workflow-listener hypothesis in feat-513.

## Correction

`Language` and `VideoSubtitle` in `apps/admin/src/graphql/types/` now use Pothos
select mode with an ID baseline. Exposed fields and relations add their requested
selections automatically. Custom language resolvers explicitly select `name`,
`audioPreviewSize`, `createdAt` and `updatedAt`. Every requested field remains
available; no subtitle is filtered, capped or reordered, and the schema shape,
authorization, rate limits, transaction behavior and deadlines are unchanged.

The regression executes the real GraphQL schema against rows restricted to its
generated selection. It verifies omitted unused metadata, complete requested
language fields, BigInt precision, timestamps and null relations. The historical
include-mode implementation fails the narrow-materialization assertion.

## Reproduction

Use only an owned local PostgreSQL database. From `apps/admin`, with its normal
CI configuration and `DATABASE_URL` pointing to that database:

```sh
pnpm exec tsx --env-file=.env src/scripts/probe-watch-subtitle-projection.ts --baseline
pnpm exec tsx --env-file=.env src/scripts/probe-watch-subtitle-projection.ts
```

Run sequentially without competing builds or tests. The probe creates and drops
a random schema, uses the observed 100-dub/3,660-subtitle cardinality and executes
the current schema-generated Prisma projection. An independent worker issues
two catalog calls every 2.5 seconds and eight-query transaction probes with
100 ms between completions for 30 seconds. Both runs compare the complete
requested subtitle/language projection with the historical result.

| Measurement               | Historical include | Requested scalar selection |
| ------------------------- | -----------------: | -------------------------: |
| Catalog calls             |                 24 |                         24 |
| Catalog p95 / maximum     |       379 / 393 ms |               166 / 168 ms |
| Maximum event-loop delay  |             153 ms |                      31 ms |
| Transaction probes        |                263 |                        273 |
| Probe p95 / maximum       |        59 / 150 ms |                 11 / 71 ms |
| HTTP failures             |                  0 |                          0 |
| Probes over 700 ms        |                  0 |                          0 |
| Requested JSON characters |            661,341 |                    661,341 |

This isolates the scheduling component; it does **not** reproduce the complete
production timeout rate. The fixture uses synthetic metadata with the measured
row counts, not a copy of production content. Production verification remains
necessary, and a short healthy window cannot establish full feat-496 recovery.

## Production confirmation

PR #2322 deployed normally. A bounded capture on Admin `d51e4d41` returned the
same 100 dubs and 3,660 subtitles in 1.10–1.11 million characters of Prisma JSON, compared with
approximately 5.5 million characters before the change. Result parsing took 2.08–3.43 ms. The
subsequent automatic Admin/worker release `9533506f` includes both catalog fixes.
See the operations report for the separate HTTP and semantic outcome windows;
payload reduction alone is not a recovery claim. These string-size observations
use JavaScript `String.length` (UTF-16 code units), not a measured UTF-8 network
byte count; earlier descriptions rounded them as MB.

## Diagnostic discipline

Separate SQL execution, locks, pool acquisition and application callbacks.
Client-side query spans include scheduling; PostgreSQL `ClientRead` identifies
waiting for the application, not active SQL execution. A browser abort can also
occur after a successful server HTTP 200. Report these separately from Web HTTP
503s and delivery fallback reasons.

Owned inspectors, temporary wrappers and loop monitors were bounded and restored.
Do not disable an existing profiler or alter shared workflow ownership to test
this hypothesis. No persistent production configuration was changed.
