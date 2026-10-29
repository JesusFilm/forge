---
title: "Manager execution claims must fence job ownership until explicit completion"
module: Admin
category: database-issues
problem_type: concurrency_bug
component: service_object
date: 2026-10-28
tags:
  - manager
  - mastra
  - postgresql
  - execution
  - idempotency
  - fencing
---

## Problem

An atomic check of a job's current run is insufficient to fence a provider call
or publication: another instance could transfer ownership or mark the job
terminal immediately after admission. Process-local locks also disappear on
restart. Retrying an ambiguous provider operation can repeat spend or side effects.

## Durable contract

`apps/admin/src/services/manager-execution.service.ts` owns the two service-only
GraphQL commands registered in `apps/admin/src/graphql/types/managerExecution.ts`:

- `claimManagerExecutionOperation(input: JSON!): JSON!`
- `completeManagerExecutionOperation(input: JSON!): JSON!`

Both require `MANAGER_BACKEND` **and** `write:manager-jobs` at GraphQL and service
entry. Input contains `jobId`, `runId`, SHA256 `inputDigest`, strict `operationId`
and SHA256 `operationDigest`; completion adds UUID `claimToken` and JSON `result`.
The operation IDs are `run-admission`, `audio-cleanup`,
`apply-transcript-corrections`, and `mux-publication`, plus the exact stage IDs `mastra:source`,
`mastra:correction`, `mastra:translation`, `mastra:chapters`, `mastra:metadata`,
`mastra:embeddings`, and `mastra:scene-analysis`.

Migration `0166_manager_execution_operations` creates `ManagerExecutionRun`
(primary key job/run, immutable input digest) and `ManagerExecutionOperation`
(primary key job/run/operation, digest, claim token, completion timestamp/result).
Foreign keys restrict deletion of consumed evidence.

Claims, completions, and `ManagerJobService.update` take `SELECT ... FOR UPDATE`
on the same `manager_enrichment_job` row **inside one interactive transaction**.
The lock remains held until all checks and writes commit. Admission requires
persisted `options.engine === "mastra"`, matching `options.currentRunId`, pending
or running status, and no completion timestamp. The first operation binds the
run's input digest; another digest conflicts even for a different operation ID.

One claimant receives `{status: "claimed", claimToken}`. An exact completed
operation replays `{status: "replayed", result}`. Completion also returns exactly
that replay shape. In-flight duplicates and wrong digests/tokens return conflict;
stale engine/run/terminal ownership returns stale. Replay never returns a token.
Different operation IDs on the same run may remain in flight concurrently; only
the short admission/completion transactions serialize. Every incomplete operation
keeps the ownership/terminal fence held. A repeated completion with the valid token returns the original persisted result,
never the replacement payload.

Results are measured as serialized UTF-8 JSON, including the envelope: at most
32768 bytes, 8192 UTF-16 units per string, 256 per key, 4096 nodes and 12 nesting
levels. Invalid completion leaves the claim consumed. JSON null is persisted as
JSON null and distinguished from an incomplete operation by `completedAt`.

## Integration constraints

While any operation for the job is incomplete, job updates reject engine/run
ownership changes, terminal status, and setting a completion timestamp. Same-owner
progress/artifact callbacks remain writable. **Complete the operation before
terminal callback updates or transferring ownership.**

Claims have no expiry, takeover, delete/retry command, or automatic replay while
incomplete. A timeout/crash after a possible external side effect requires explicit
outcome reconciliation; never interpret conflict as permission to repeat spend.
The fence coordinates Admin callers; it does not make the external provider
transactional or prove an external effect succeeded.

The `updateManagerJob` API now accepts optional `expectedRevision`. Migration
0166 adds `ManagerEnrichmentJob.revision`, an integer starting at zero. Every
`ManagerJobService.update`, including legacy writes without a guard, increments it.
Admin compares a supplied revision under the same job-row lock before checking
operation claims or writing. A stale snapshot raises `ConcurrentModificationError`
and changes no job data. Millisecond timestamps are deliberately not the guard.

Manager returns that revision in its raw job read model and supplies it for
callbacks, dispatch ownership, rerun reset, engine restamp, watchdog terminalization,
artifact merges, and step updates. Callback CAS errors retain the existing 503
response. The bounded callback sender retries the same run/step/sequence, so the
receiver refetches and either merges onto fresh state, drops `stale_sequence`, or
drops `stale_run`. Ownership-changing helpers fail closed instead of retrying an
old ownership intent against a newly admitted run. The input digest remains
supplied by the trusted Manager service, not recomputed from arbitrary job JSON.

### Receiver-first revision rollout

Apply migration 0166 first, then deploy Admin with the integer revision field,
optional mutation argument, unconditional update increment, and comparison under
the row lock. Regenerate `apps/admin/schema.graphql` and
`packages/admin-graphql/src/admin-graphql-env.d.ts` from the final integrated
Pothos source before merging. The recovery integrator owns that generation.
Only then deploy the Manager revision reader/writer. Manager requires a valid
integer revision from Admin; it fails closed against an old receiver. Old callers
remain compatible because the new mutation argument is optional, but old Manager
replicas still lack callback CAS. Keep new distributed dispatch disabled during
the mixed-Manager rollout and enable it only after every callback/ownership writer
runs the revision-aware code. This is a rollout order, not authorization to deploy.

## Verification

The baseline characterization failed because `ManagerJobService.update` invoked
neither a transaction nor a locking read. Real Postgres tests in
`apps/admin/src/services/manager-execution.service.db.test.ts` apply the actual
0017, 0165 and 0166 migrations in a unique schema on an explicitly supplied loopback
test database. Independent Prisma pools prove one winner among twelve competing
claims, immutable cross-operation digests, token/digest rejection, replay from a
fresh client/pool and a separate Node process, indefinite consumed claims, stale
ownership denial, in-flight
update refusal, and a waiting update observing a claim committed under the same
parent lock. A parallel seven-stage test proves the fence remains until the last stage settles,
with same-owner nonterminal callbacks allowed throughout. Measured result fixtures
exercise exactly 32768 and 32769 bytes.
These tests make no provider calls and establish no live provider outcome.

```bash
MANAGER_EXECUTION_TEST_DATABASE_URL=postgresql://lado@127.0.0.1:55891/forge_execution_fence_893_test \
  pnpm --filter @forge/admin exec vitest run \
  src/services/manager-job-revision.db.test.ts \
  src/services/manager-execution.service.db.test.ts \
  src/services/manager-execution.service.test.ts \
  src/services/manager-job.service.test.ts \
  src/graphql/types/managerExecution.test.ts
```

The recovery integrator owns final SDL and gql.tada regeneration after combining
this bounded Admin seam with the Manager/Mastra bridge and automation models.

`apps/admin/src/services/manager-job-revision.db.test.ts` also starts separate
Manager Node processes, sends real raw Admin GraphQL requests to two Prisma pools,
and holds read responses at deterministic barriers. It proves callback snapshot A
cannot write after completed operations and replacement by run B, independent
parallel step callbacks refetch after 503 without losing either artifact/sequence,
duplicate callbacks drop without a second write, and stale dispatch/reset/restamp
and watchdog cannot overwrite a newer run. A database trigger fixes `updated_at` to the same
millisecond across updates while the integer revision still advances. The
callback route publishes no applied event for a rejected stale write.

With only the revision comparison temporarily disabled (the row lock and operation
fences retained), all three callback race characterizations fail: the old callback
publishes an applied event and parallel callbacks receive no conflict/refetch.
Restoring the comparison makes them pass. This isolates the missing distributed
fence from the already-working incomplete-operation fence.
