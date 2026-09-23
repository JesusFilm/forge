# Watch authored-block dub fanout — September 23, 2026

## Proven scope

One retained `GetWatchSettings` operation at 02:02:38 UTC contains 62 separate
`VideoDub.findFirst` calls. Four authored block fields bypass the existing
preferred-dub loader and query independently for each video/language identity.
The ten-connection main pool is shared with recommendation requests.

The same primary-log ingestion second has 60 slow acquisitions, maximum
pending count 102 and maximum acquisition 102 ms. Those events are not
request-correlated: the production trace identifies a competing workload,
not the cause of the historical selection 503 or delivery timeout fallback.

Trace `6ab3333c000000006c62ce4aacd4fd55`, settings span
`7604331360358271055`, completes in 183.430176 ms. The trace is linked to an
ordinary Watch page request. No production load generator was used.

## Controlled result and fix

The isolated PostgreSQL fixture has 62 synthetic videos, two playable dubs
per video and nested language selection. Five simultaneous requests reproduce
the observed lookup shape against the production ten-connection pool. A local
TCP proxy adds an explicit three-millisecond server-response delay; this is a
network-delay model, not a measured reconstruction of the historical incident.
Twenty rounds per phase run in ABBA order with the same records and pool limit.
An unrelated `SELECT 1` starts five milliseconds into each burst.

| Measurement            | Scalar phases | Batched phases |
| ---------------------- | ------------- | -------------- |
| SQL commands per round | 621           | 16             |
| Peak queued calls      | 301           | 0              |
| Unrelated read p95     | 200 / 311 ms  | 6.84 / 8.81 ms |
| Complete workload p95  | 406 / 547 ms  | 29.6 / 30.6 ms |

The change batches each request's authored video/language pairs by Pothos
selection. At most 100 keys enter a batch. SQL selects one winner per exact
pair, then Prisma hydrates the requested relations. Keep the original duration
DESC null ordering and ID tie-break, publication/deletion checks and nonnull
HLS/DASH/share eligibility. This is distinct from preferred-language fallback.
Availability and identity are rechecked after hydration; withdrawn or reassigned
winners return null. Original database errors propagate.

Artifact: `docs/validation/watch-block-dub-batch-20260923/comparison.json`.
The query count includes nested-language SQL and the competing read, not just
Prisma method calls. The latency result proves avoidable queue contention in
this workload; it does not establish sub-200 ms production recommendations.

## Reproduce safely

Use a new, owned PostgreSQL 18/pgvector container and a database named
`watch_q7n`, bound to loopback on an unused port. Never use a shared database.
Set `DATABASE_URL` only for these commands to that disposable fixture, then:

```bash
pnpm --filter @forge/admin exec prisma db push --skip-generate
BLOCK_DUB_DB_TEST=1 pnpm --filter @forge/admin exec vitest run src/services/selected-block-video-dub.db.test.ts
CI=1 pnpm --filter @forge/admin exec tsx --tsconfig tsconfig.json ../../docs/validation/watch-block-dub-batch-20260923/reproduce.ts
```

The benchmark refuses a non-loopback host or different database name, seeds
synthetic `q7n-*` catalog rows and closes its clients/proxy. Stop the owned
container afterward; do not delete or change another task's service. The
baseline-only option is `--baseline-only`; complete execution compares scalar
and batched code without changing the source tree.

## Regression, review and release gates

Four actual GraphQL regressions fail with 62 scalar calls each on the original
code and pass with one batched selection/hydration pair, preserving requested
nested fields. Service tests cover pair identity, order, duplicate/missing
keys, request isolation, selection groups, bounds, withdrawal/reassignment and
error identity. Real PostgreSQL tests compare scalar and batched results for
language separation, ties, null duration, missing/deleted/unpublished/unplayable
rows and HLS/DASH/share eligibility. All 141 focused tests pass, including the
two real PostgreSQL checks.

All 7,348 Admin tests pass in the separate rerun, and typechecking, lint,
production build, schema generation and consumer introspection generation pass.
The generated schema and consumer contract are unchanged. An initial local full-suite run had one UI timeout while an
incorrectly invoked typecheck exhausted Node's default heap; rerun with the
repository's configured typecheck script and separate test execution. Do not
increase a test or API deadline to hide that result.

Sequential Compound Engineering review covers correctness, testing,
maintainability, project standards, agent access, past learnings, security,
performance, API compatibility, reliability, adversarial races and TypeScript.
The review added coverage for missing block identity. No blocking finding
remains. The two-query selection/hydration path adds a round trip for a lone
lookup; the proven improvement applies to sibling fanout. No database mutation,
schema, UI, flag, deadline, retry or pool-size change is included. Fresh-main
incorporation and normal PR CI remain release requirements.

Verify the exact automatic Admin/worker revision and production settings query
shape after release. Report selection HTTP failures separately from delivery
HTTP 200 timeout fallbacks. A short quiet window remains insufficient for a
recovery claim. The user requested one final bounded pass; if the historical
fault remains unresolved, close the investigation with that limitation explicit
and move on, rather than continuing indefinite observation.
