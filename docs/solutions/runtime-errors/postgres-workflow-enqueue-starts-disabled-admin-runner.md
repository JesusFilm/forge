---
module: Admin workflow runtime
date: 2026-09-18
problem_type: runtime_error
component: background_job
severity: high
symptoms:
  - Admin executes workflow queue callbacks with WORKFLOW_RUNNER_ENABLED=false.
  - The explicit startup gate passes unit tests while enqueue starts listeners.
root_cause: scope_issue
resolution_type: code_fix
tags: [workflow, postgres, graphile, runner, enqueue, performance]
---

# Enqueue can start the Postgres workflow runner implicitly

## Cause and correction

`apps/admin/src/instrumentation.ts` gates explicit `world.start()`, but pinned
`@workflow/world-postgres` 4.1.1 also calls its private `start()` from `queue()`.
That private function initializes worker utilities, migrates the queue, and
starts Graphile listeners. Mocking `world.start()` cannot establish that the
web process only enqueues.

`patches/@workflow__world-postgres@4.1.1.patch` gates listener startup on the
existing `WORKFLOW_RUNNER_ENABLED=true` opt-in. False and unset remain enqueue
only, matching the application's default-off policy. Queue initialization and
durable insertion still run. True retains the dependency's existing
implicit-consumer behavior. The dedicated worker remains responsible for
execution; no serialization, deduplication, retry, rescheduling or storage code
is duplicated. No new environment variable or deployment-setting change is
required. The SDK reads this process setting while initializing the queue, so
change it through ordinary process deployment, not dynamically after startup.

The upstream API describes `start()` as starting background tasks; inspect the
pinned implementation as well as the [World interface](https://github.com/vercel/workflow/blob/main/packages/world/src/interfaces.ts).
Re-evaluate this patch when upgrading the package. Never carry it forward by
assuming a future queue has the same initialization behavior.

## Reproduction and regression

`apps/admin/src/services/workflow-queue.db.test.ts` forks real producer/consumer
processes using the actual SDK, HTTP handlers and PostgreSQL queue. The original
package fails the assertion that a disabled producer has no callback deliveries
after several poll cycles. The patched package passes. After the producer exits,
the separate worker consumes its persisted jobs, retries a transient HTTP 503,
reschedules a wake-up and deduplicates repeated keyed enqueue. Tests also cover
binary input transport, forwarded headers, cancellation through `workflow/api`,
and true-enabled implicit-consumer compatibility. Both false and unset are
tested: preserving the SDK's unset-enabled default would violate Admin's policy.

Use an owned disposable database; `world.start()` performs the SDK's existing
active-run recovery, so these tests must never point at a shared queue:

```bash
WORKFLOW_POSTGRES_URL=<owned-local-database-url> pnpm --filter @forge/admin workflow:setup:postgres
WORKFLOW_QUEUE_TEST_DATABASE_URL=<owned-local-database-url> pnpm --filter @forge/admin test -- src/services/workflow-queue.db.test.ts --no-file-parallelism
```

Run this gate explicitly against a disposable service. Ordinary unit runs skip
the integration tests unless their explicit URL is set. It is not yet wired
into CI: the available GitHub credential cannot update workflow files.

## Scheduling evidence and limits

A matched local control ran 45 jobs and 250 independent HTTP probes per trial,
in baseline/fixed/fixed/baseline order. Each callback parsed and serialized a
2,724,891-character synthetic catalog three times; both variants performed the
same work. Baseline used the original package with the runner setting false;
fixed used the patch with a separate true-enabled consumer. Admin consumed 45
jobs before and zero afterward; the fixed worker consumed all 45.

| Independent Admin HTTP probes | Baseline trials  | Fixed trials     |
| ----------------------------- | ---------------- | ---------------- |
| p95                           | 35.82 / 35.86 ms | 1.43 / 1.40 ms   |
| maximum                       | 49.13 / 55.74 ms | 9.75 / 7.83 ms   |
| Admin maximum loop delay      | 58.43 / 66.03 ms | 11.95 / 14.27 ms |

This proves scheduling isolation for the controlled workload. The callback is
synthetic, not an identified production workflow. Neither baseline exceeds the
700 ms Watch deadline; do not claim this explains historical Watch timeouts.
See `docs/operations/watch-followups-verification-2026-09-18.md` for production
revision checks and release acceptance.

## Prevention

Test the operation that implicitly initializes a dependency, across actual
process and persistence boundaries. A disabled explicit startup call is not a
proof of disabled background execution. Retain deployment and worker-consumption
verification separately from the application flag and source-code inspection.

Related: `docs/roadmap/platform/feat-513-admin-workflow-enqueue-only-runtime.md`
and `docs/operations/watch-admin-duration-recovery-2026-09-16.md`.
