# Watch exposure internal ID future-write experiment

Status: local go for review; no production activation, existing-row rewrite, schema or index change.

`WatchSurfaceExposure.id` is an internal text primary key with an existing Prisma `@default(cuid())`. All three writers had explicitly supplied a 36-character `randomUUID()` while the externally meaningful `eventId` is a separate unique UUID. The proposed writer change omits `id` for issued `createMany`, evidence `createManyAndReturn(skipDuplicates: true)`, and single-event `create`. Prisma 6.19.3 generated distinct 25-character CUIDs in the native checks. The primary key, event UUID uniqueness, all secondary indexes, exact replay/conflict logic, report ordering and 29-day expiry remain in place. Mixed old UUID and new CUID IDs are valid text keys; the change affects future rows only.

## Equal-cohort physical proof

A task-owned disposable PostgreSQL 18.6 database used two otherwise identical schemas with the current production table columns, constraints and seven indexes, including the six-key narrow window index. Each schema received the same 100,000 logical facts across the same 7,143 windows, event UUIDs, paths, kinds, timestamps and 29-day expiries. The fixture mixed 57,144 served, 42,140 first rendered, 358 eligible and 358 repeated rendered facts with equal event/receipt timestamps. Half the batches used `createMany`; half used `createManyAndReturn(skipDuplicates: true)`. Only the internal `id` differed: explicit random UUID text versus omitted ID with Prisma CUID default. Batch order alternated between cohorts. Counts of distinct `id` and `event_id` were 100,000 in each; report aggregates were identical.

| PostgreSQL 18.6 allocated bytes |     UUID ID |    CUID ID |             Difference |
| ------------------------------- | ----------: | ---------: | ---------------------: |
| Heap                            |  23,412,736 | 22,142,976 |             −1,269,760 |
| Primary-key index               |   7,921,664 |  4,997,120 |             −2,924,544 |
| All indexes                     |  27,811,840 | 24,887,296 |             −2,924,544 |
| Total relation                  |  51,265,536 | 47,071,232 | **−4,194,304 (8.18%)** |
| WAL during paired inserts       | 100,937,568 | 95,781,584 |             −5,155,984 |

The measured 8.18% total relation benefit exceeds the explicit 2% gate. It includes B-tree page-packing/locality effects and must not be reduced to an 11-byte string-length assumption or extrapolated to the existing production table. A separate local PostgreSQL 16.15 repeat measured 8.19% total benefit; the first PG18 run without `skipDuplicates` measured 8.00%, and the final production-shaped `skipDuplicates` run above is authoritative. WAL values include local transaction/index effects and are not a production filesystem prediction.

Per 500-row batch in the final PG18 run, median/p95 `createMany` latency was 64.82/76.73 ms for UUID and 61.86/74.85 ms for CUID. `createManyAndReturn` was 70.41/89.62 ms for UUID and 68.79/81.09 ms for CUID. There was no material insert-latency regression. These local medians do not prove production tail latency.

## Correctness and verification

The native `watch-exposure.service.db.test.ts` suite passed 9/9 on both owned PG16 and PG18. Its added case exercises all three actual writers, served-item uniqueness, unique CUID and event UUID values, exact replay and conflict, distinct-repeat status, equal-time deterministic report output, coexistence with an explicitly inserted old-format UUID primary key, original 29-day expiry, and the bounded `(expires_at,id)` deletion path. The 60,000-fact report test remains under its unchanged query budget. The focused unit suite passed 11/11; scoped ESLint, Prettier and Admin TypeScript typecheck passed.

The disposable benchmark script and aggregate PG18 receipt are local at `/tmp/forge-exposure-cuid-experiment-owned-20260930/benchmark.cjs` (SHA-256 `7578b0938f61750be3e5fdd2081154ecd957bda4f0d62d56ff7e7909b79be829`) and `/tmp/forge-exposure-cuid-experiment-owned-20260930/benchmark-pg18-final.json` (SHA-256 `bb09be43d95db1a23d393448c902e8dfcdcb6edf6f47dca69fd5823ee6c79b9e`). The script guards its database name and two local-only ports. It creates/drops only schemas in its own disposable database. No production database, service, deployment or shared local database was contacted.

This is a future-write change. It neither shrinks existing exposure rows nor alters the 29-day privacy expiry. Production benefit and serving health remain unmeasured and are outside this local experiment.
