---
title: Admin Core Sync video phase Prisma pool timeout resilience
date: 2026-06-04
category: database-issues
module: apps/admin core sync
problem_type: database_issue
component: background_job
symptoms:
  - Full Admin Core Sync fails in the video phase with Prisma P2024 pool timeout errors.
  - Long video pages leave Workflow runs looking idle because phase progress is only visible at completion.
  - Low production sync pool settings make one large phase contend with normal Admin traffic.
  - Retrying a failed transaction can double-count diagnostics if stats mutate inside the retry body.
root_cause: config_error
resolution_type: code_fix
severity: high
related_components:
  - database
  - service_object
tags:
  - admin-core-sync
  - prisma
  - p2024
  - connection-pool
  - workflow
  - video-sync
  - database-url-sync
  - retries
---

# Admin Core Sync video phase Prisma pool timeout resilience

## Problem

Admin Core Sync can run for several minutes on the full video catalog. In production, the video phase hit Prisma P2024 connection-pool timeouts with `connection_limit=2` and `pool_timeout=10`, aborting the run before downstream AI Gateway refresh and embedding work could safely proceed.

## Symptoms

- Workflow run `wrun_01KT7TW5W4M10DQRFPYRXWRF2F` failed in `stepSyncVideos`.
- The failure included Prisma's pool-timeout shape: "Timed out fetching a new connection from the connection pool".
- The run could not advance the video watermark, so follow-on content refresh gates correctly stayed blocked.
- Operators could see phase completion logs, but not durable per-phase progress in `workflow_run.details` during a long page loop.

## What Didn't Work

- **Only rerunning the full sync.** With the same low pool budget and no local retry boundary, the video phase can fail again at the next pool-pressure spike.
- **Only increasing Prisma timeouts.** A larger `pool_timeout` gives pressure more time to clear, but it does not make the page write resilient when a single checkout still times out.
- **Retrying too deep inside the transaction.** Retrying row-level operations makes it harder to reason about idempotency and can duplicate diagnostics, relation work, or partial counters.
- **Advancing downstream embedding/backfill work first.** AI Gateway content refresh depends on a successful Core Sync, fresh watermarks, an unlocked sync ledger, and a passing coverage audit.

## Solution

Use a dedicated, production-tuned sync pool and wrap the video phase's idempotent page-sized database work in a Prisma P2024 retry helper.

The retry helper should identify typed `code === "P2024"` first and fall back to Prisma's pool-timeout message for log shapes that do not preserve the code. Keep retry logs sanitized and structured:

```ts
await withPrismaPoolTimeoutRetry(
  () =>
    prisma.$transaction(async (tx) => {
      // page-scoped upserts, relations, localized metadata, and cleanup
    }, CORE_SYNC_TRANSACTION_OPTIONS),
  { operation: `core-sync.videos.page.${offset}` },
)
```

The page loop must not mutate run-level counters inside the retry body. Accumulate per-attempt stats locally and merge them only after the transaction has succeeded:

```ts
const pageResult = await withPrismaPoolTimeoutRetry(
  async () => {
    let pageUpdated = 0
    let pageErrors = 0

    await prisma.$transaction(async (tx) => {
      // pageErrors += localizedResult.errors + localizedResult.skippedLanguages
      // pageUpdated++ after each successfully processed Core video
    }, CORE_SYNC_TRANSACTION_OPTIONS)

    return { errors: pageErrors, updated: pageUpdated }
  },
  { operation: `core-sync.videos.page.${offset}` },
)

stats.updated += pageResult.updated
stats.errors += pageResult.errors
```

For the video phase, also hoist stable lookup maps (`keyword`, `bibleBook`) outside the per-page transaction and load existing page videos with one `findMany` rather than one `findUnique` per Core video. That shortens each transaction's connection hold time while preserving the `source === "MANAGER"` skip rule.

Finally, persist throttled phase progress through the workflow ledger. The orchestrator emits `{ phase, completed, total, elapsedMs }`, and the workflow job stores it under `workflow_run.details.coreSyncProgress` so operators can distinguish "stuck" from "still making page progress".

## Why This Works

Prisma P2024 is a checkout failure, not proof that the logical page is invalid. Retrying the whole page transaction preserves the database's rollback boundary and lets transient pressure clear without fragmenting the write path.

The local page-result pattern is load-bearing. If a transaction body increments `stats.errors` and then Prisma throws P2024 before commit, the retry attempt can succeed while the run still carries phantom errors. Those phantom errors block watermark advancement and can make a healthy retry look like a partial sync. Returning page stats from the successful attempt avoids that.

Moving stable reads out of the transaction reduces time spent holding a connection. Durable progress writes use the normal workflow ledger path rather than the sync transaction itself, so progress can remain visible even when the sync pool is saturated.

## Prevention

- Wrap Prisma pool-timeout retries around idempotent page, batch, or cleanup units, not individual row calls.
- Keep aggregate counters, watermarks, and "success gates" outside retryable transaction bodies unless the value is committed only after the transaction returns.
- Log retry attempts with operation, attempt, next attempt, and delay only; do not include database URLs, connection strings, or payloads.
- Size `DATABASE_URL_SYNC` against production database capacity. A useful starting point for Admin Core Sync is `connection_limit=5&pool_timeout=60`, then tune after measuring live headroom.
- Add a regression test where the transaction callback runs, a P2024 is thrown after the callback, and the second attempt succeeds. Assert counters reflect only the successful attempt plus legitimate final diagnostics.
- Do not run all-content embedding replacement, backfill, or eval gates until Core Sync succeeds, watermarks are fresh, the lock/ledger is clear, and coverage audit passes.

## Related Issues

- Roadmap ticket: [feat-157 Admin Core Sync video phase pool resilience](../../roadmap/platform/feat-157-admin-core-sync-video-phase-pool-resilience.md)
- [Core Sync Per-Page Upsert Pattern](../cms/core-sync-per-page-upsert-pattern.md)
- [Admin Core Sync High-Volume Bulk Upsert Pattern](../performance-issues/admin-core-sync-high-volume-root-phase-bulk-upsert-20260507.md)
- [Prisma bind-variable cap in Core Sync soft-delete tails](./postgres-prepared-statement-bind-variable-limit-32767-20260504.md)
- [Bounded parallelism per target workflow pattern](../best-practices/bounded-parallelism-per-target-workflow-pattern-20260505.md)
