---
title: "A step added to a live durable workflow loop needs one worker restart after deploy"
date: 2026-09-30
category: workflow-issues
module: "apps/admin durable workflow loops"
problem_type: workflow_issue
component: background_job
severity: high
applies_when:
  - 'A PR adds, removes, or reorders a step, sleep, or hook inside a long-lived `"use workflow"` loop that already has a live run'
  - "A PR rolls back such a change"
  - "A boot check starts a new singleton durable run only when the old runtime run is terminal"
  - "An operator runbook says to cancel a durable run in the Admin workflows dashboard"
symptoms:
  - "The live run fails at worker boot with `Unconsumed event in event log: eventType=wait_created`"
  - "The workflow_run ledger row still reads running and sleeping, but no live scheduler run exists"
  - '`workflow cancel` exits 1 with no output; with --verbose it reports `Cannot transition run from terminal state "failed"`'
  - "The Admin workflows dashboard has a cancelled filter but no cancel control"
root_cause: missing_workflow_step
resolution_type: workflow_improvement
related_components:
  - "infrastructure"
  - "documentation"
tags:
  - "admin"
  - "useworkflow"
  - "event-log"
  - "replay"
  - "retention"
  - "scheduler"
  - "railway"
  - "deployment"
---

# A step added to a live durable workflow loop needs one worker restart after deploy

## Context

PR #2366 added the step `stepRunPushRetention` inside the durable loop `runRecommendationRetentionScheduler`. When the new worker booted, it replayed the live scheduler run, and the replay failed with `corrupted-event-log`. The boot check had already read that run as `running`, so no scheduler run existed until the next worker boot. The documented recovery, "cancel that run in the workflows dashboard", could not work.

Terms in this document:

- **Scheduler run:** the live durable run of a loop. Its runtime ID starts with `wrun_`.
- **Ledger row:** the admin `workflow_run` row for that run. Its `runtime_run_id` column holds the runtime ID.
- **Runtime status:** the status that the Workflow runtime (`@workflow/world-postgres`) keeps for the run.
- **Boot check:** the `ensure...Started` function that the worker calls at boot, here `ensureRecommendationRetentionSchedulerStarted`.
- **Worker restart:** `railway restart` of the `@forge/admin/worker` service. It reruns the deployed image and builds nothing.

### What happened (2026-09-29 and 2026-09-30, UTC)

- PR #2366 merged at 23:55:38. The worker applied migration `0120_push_campaigns`, and the worker deploy succeeded at about 00:04.
- The scheduler run `wrun_01M1D56P1MZXVB92FT6F551V7V` (started 2026-09-01) became terminal `failed` at 00:04:30.185Z. Its next scheduled wake was 10:30 UTC.
- `workflow inspect run <runtime_run_id> --backend @workflow/world-postgres --json` showed the error code `RUNTIME_ERROR` and this message:

  ```text
  Unconsumed event in event log: eventType=wait_created, correlationId=wait_01M1D56P27R5PQTFBRAX364NVZ, eventId=wevt_01M1D56PKN68JK9GHB3DJW9X3T. This indicates a corrupted or invalid event log.
  ```

- The ledger row `cmthx3cpy0000ma0ktf66hocc` (`workflow_key = 'recommendation-retention-scheduler'`) still showed `running`. Its summary still said `Recommendation retention scheduler sleeping until 2026-09-30T10:30:00.000Z.`
- No Forge log line reported the stop. The boot check returns `started: false` and writes no log (`apps/admin/src/services/recommendations/retention/job.ts:277-282`).
- The runtime writes one `[Workflow] Error while running workflow` line with `errorCode: RUNTIME_ERROR` (`@workflow/core@4.2.2` `dist/runtime.js:349`). A search of the worker deploy log after the deploy did not show it. Railway logsV2 can drop route-handler output (see the root `CLAUDE.md`).
- The same loop runs the recommendation privacy purge and the push purge (`apps/admin/src/workflows/recommendationRetention.ts:45`, `:54`). Both purges stopped.

### What did not work

- **A prediction that the run fails at its next wake.** Before the merge, the session expected the failure at the 10:30 UTC wake. The run failed at worker boot instead, because the runtime puts every live run back in the queue at startup (see fact 3 in Why This Matters).
- **"Cancel that run in the workflows dashboard."** This was deploy step 2 in `apps/admin/CLAUDE.md`. The dashboard has no cancel control. `apps/admin/src/app/dashboard/workflows/page.tsx` has only a `cancelled` status filter (lines 18 and 25), and `apps/admin/src/app/dashboard/workflows/[runId]/page.tsx` shows only the run trace.
- **`workflow cancel` in the worker container.** The command failed with `Failed to cancel run ...: Cannot transition run from terminal state "failed"` (`EntityConflictError`). Without `--verbose`, it printed nothing and exited 1. The CLI calls `cancelRun` (`@workflow/cli@4.2.2` `dist/commands/cancel.js:73`), and `cancelRun` writes a `run_cancelled` event (`@workflow/core@4.2.2` `dist/runtime/runs.js:35-49`). The run is terminal before an operator can act, so a cancel has nothing to stop.
- **"Or redeploy the worker once more."** A new boot does repair the loop. But the root `CLAUDE.md` forbids a manual Railway redeploy unless the owner declares a break-glass emergency. A worker restart gives the same boot and publishes no code.

## Guidance

After a deploy that changes the durable call sequence of a live loop, do one worker restart. Then verify the new scheduler run in the ledger and in the runtime.

### Procedure

1. Read the ledger rows in a read-only session:

   ```sh
   railway ssh -p <forge-project-id> -e production -s @forge/admin/worker -- sh -c 'psql "$DATABASE_URL" -At -c "SET default_transaction_read_only = on; SELECT id, runtime_run_id, status, updated_at, summary FROM workflow_run WHERE workflow_key = '\''recommendation-retention-scheduler'\'' ORDER BY updated_at DESC LIMIT 3"'
   ```

2. Read the runtime status of the newest `running` row:

   ```sh
   railway ssh -p <forge-project-id> -e production -s @forge/admin/worker -- sh -c 'cd apps/admin && ./node_modules/.bin/workflow inspect run <runtime_run_id> --backend @workflow/world-postgres --json'
   ```

3. If the ledger row says `running` and the runtime status is `failed`, do the worker restart:

   ```sh
   railway restart -e production -s @forge/admin/worker -y
   ```

   This command can block for minutes. Do not wait for it. Read the ledger instead.

4. Run step 1 again. The old row must show `failed` with the summary `Recommendation retention scheduler runtime failed.` (`job.ts:85`). A new row must show `running` with a new `runtime_run_id`.
5. Run step 2 with the new `runtime_run_id`. The runtime status must be `running`.

Result on 2026-09-30: at 00:18:49 the boot check closed the old row as `failed`. It started the ledger row `cmuncxp800000mi0k8ta2b5o7` with the scheduler run `wrun_01M3QTV9G1CSFZNN1YNBBAJFAN`. The new scheduler run did one pass at once. The `recommendation-retention` purge succeeded at 00:20:03 (`Purged 0 recommendation request root(s).`), and the `push-retention` purge succeeded at 00:20:12 (`Purged 0 push delivery row(s).`). The run then slept until 2026-09-30T10:30:00Z. The worker restart did not touch the admin web service, so user traffic continued.

### Before merge

1. Read the diff of each loop in the table under When to Apply. Look for a change to its durable call sequence.
2. Count these as sequence changes: an added, removed, or reordered step call, `sleep`, or hook. A change to a branch that selects a different step also counts.
3. Do not count a change inside a step body. The runtime returns the recorded result of a completed step and does not run the body again (`@workflow/core@4.2.2` `dist/step.js:109-113`).
4. Give a changed step return shape a compatibility read in the loop. See the precedent at `recommendationRetention.ts:59-61`.
5. If the sequence changes, write the worker restart into the deploy steps of the PR. Name the loop and its ledger `workflow_key`.
6. Write the same worker restart into the rollback steps. A rollback changes the sequence again.

### After the worker deploy

1. Wait until the worker deploy succeeds.
2. Wait a few more minutes. On 2026-09-30 the deploy succeeded at about 00:04 UTC, and the replay failed at 00:04:30 UTC.
3. Read the ledger row with procedure step 1. Use the `workflow_key` of the changed loop.
4. Read the runtime status with procedure step 2.
5. Do not trust the ledger summary alone. The heartbeat text `sleeping until ...` stays after the scheduler run fails.
6. If the runtime status is `failed` or `cancelled` and the ledger row says `queued` or `running`, do the worker restart.
7. After the worker restart, confirm three things: the old row is terminal, a new row is `running`, and the new runtime status is `running`.
8. Confirm the first pass of the loop in its own ledger rows. For the retention loop, find new `recommendation-retention` and `push-retention` rows with the status `succeeded`.

### Rules for the worker restart

- Use `railway restart -e production -s @forge/admin/worker -y`. It reruns the deployed image and builds nothing.
- Do not use `railway up` or a manual Railway redeploy. The root `CLAUDE.md` forbids both unless the owner declares a break-glass emergency.
- Get the owner's approval first. The worker restart is still a production action.
- Do not restart the admin web service. It does not run workflow replays.

### Loops that one worker restart does not repair

For `recommendation-episode-finalization-recovery` and `search-trace-retention-scheduler`, the boot check reads only the heartbeat age of the ledger row. A worker restart inside the freshness window returns `started: false` again. For the finalization recovery loop, do the worker restart when the last heartbeat is more than 15 minutes old. For the search trace retention loop, the window is 36 hours. This case has not occurred yet. The owner decides between a wait and a manual close of the stale ledger row before the worker restart.

### Options for self-repair (not built)

These options can remove the manual step. None of them exists for the retention loop today.

- **A periodic re-check.** Call the boot check function on a timer. The profile reconciliation scheduler does this every 5 minutes (`instrumentation.ts:28`, `:276-279`, `:289-317`). The retention boot check already closes a terminal run and starts a new one, and its advisory lock already prevents a second scheduler.
- **One delayed re-check after boot.** Call the boot check function once more a few minutes after boot. This option covers only the boot order in fact 4.
- **A version gate on the run start time.** Put the new step behind a check of `getWorkflowMetadata().workflowStartedAt`, which stays the same for the life of a run (`@workflow/core@4.2.2` `dist/workflow/get-workflow-metadata.d.ts`, `dist/workflow.js:146`). Old runs then replay the old sequence without failure. But an old infinite loop then never runs the new step, so it still needs a new scheduler run.

## Why This Matters

Four facts explain the failure. A fifth fact explains why only a new worker boot repairs it. A path that starts with `dist/` points into the named npm package under `node_modules`, not into the repo.

**1. Replay reads the event log in strict order.** The runtime rebuilds a run: it runs the workflow function again against the whole event log, from the first event (`@workflow/core@4.2.2` `dist/events-consumer.js:26-31`, `:56-79`). Each step and each sleep gets a correlation ID from a ULID generator that the run ID and start time seed (`dist/workflow.js:65-69`, `:87`; `dist/step.js:13`; `dist/workflow/sleep.js:9`). A step matches log events by correlation ID only, and it does not compare the step name (`dist/step.js:55`). If no subscriber takes the current event, the runtime fails the run with the slug `corrupted-event-log` (`dist/events-consumer.js:80-104`, `dist/workflow.js:76-77`, `@workflow/errors@4.1.0` `dist/index.js:28`).

**2. The inserted step moved every later correlation ID.** The old loop called `stepRunScheduledRecommendationRetention`, then `stepNextRecommendationRetentionRun`, then `sleep`. PR #2366 put `stepRunPushRetention` between the first two (`apps/admin/src/workflows/recommendationRetention.ts:45`, `:54`, `:66-67`). In the replay, the new step took the ID that the log had for `stepNextRecommendationRetentionRun`. That step then took the ID that the log had for the sleep, but with a `step_` prefix. The next log event was `wait_created` with a `wait_` prefix, so no subscriber matched it. This sequence follows from the source and matches the observed `eventType=wait_created`. Replay starts at the first event, so the first loop iteration in the log already diverges. Thus every live run of an infinite loop fails after such a change.

**3. Every worker boot replays every live run.** `startWorkflowWorld()` awaits `world.start()` before it calls any boot check (`apps/admin/src/instrumentation.ts:252-253`, `:262-280`). In `@workflow/world-postgres@4.1.1`, `start()` starts the queue and then calls `reenqueueActiveRuns` (`dist/index.js:45-48`). That function enqueues every `pending` and `running` run with no delay and logs `Re-enqueued N active run(s) on startup` (`@workflow/world@4.1.1` `dist/recovery.js:10-38`). The worker executes the replay as an HTTP request to its own `/.well-known/workflow/v1/flow` route (`@workflow/world-postgres` `dist/queue.js:112-151`). Only the worker consumes the queue, because the patched `dist/queue.js:218-222` starts the listeners only when `WORKFLOW_RUNNER_ENABLED === 'true'`. Thus a run that sleeps until 10:30 UTC still replays at boot, which matches the failure at 00:04:30.185Z.

**4. The boot check reads the run before the replay fails.** The boot check reads the newest `queued` or `running` ledger row from the last 36 hours (`job.ts:237-247`). It then reads the runtime status with a 1-second deadline (`job.ts:25`, `:43-69`, `:248-250`). It closes the row and starts a new scheduler run only when the runtime status is terminal (`job.ts:28-36`, `:266-283`). On 2026-09-30 the runtime status was still `running`, so the check returned `started: false`. A timeout of the runtime lookup gives the same result, because the lookup then returns `null`. A likely reason for this order, not verified here: Next.js can hold the replay request until `register()` returns, and the boot check runs inside `register()`.

**5. The boot check runs only at boot.** Its only call site is `startWorkflowWorld()` at `instrumentation.ts:267`. That function runs only when `shouldStartWorkflowWorld()` is true: `WORKFLOW_RUNNER_ENABLED=true` and `WORKFLOW_TARGET_WORLD=@workflow/world-postgres` (`instrumentation.ts:149-155`, `:397-399`). No timer calls the boot check again. The 36-hour filter (`RECOMMENDATION_RETENTION_HEALTH_HOURS = 36`, `retention.service.ts:24`) lets a later boot skip a stale row, but it starts nothing by itself.

**Why the worker restart repairs the loop.** At the second boot, the old scheduler run is `failed`, so `reenqueueActiveRuns` skips it. The boot check reads the terminal status, closes the ledger row (`job.ts:71-91`), and starts a new scheduler run (`job.ts:284-309`). The new code writes the event log of the new run, so every later replay matches. The advisory lock (`job.ts:253-256`) prevents a second scheduler.

**Impact if nobody acts** (from this session's analysis of the code, not observed): retention health goes unhealthy when an expired row is older than 24 hours, or when the last successful purge is older than 36 hours (`apps/admin/src/services/recommendations/retention.service.ts:1097-1160`, `contracts.ts:36`, `retention.service.ts:24`). When `RECOMMENDATION_SEMANTIC_SERVING_ENABLED` is `"true"`, the serving path then refuses with `retention_overdue` (`apps/admin/src/services/recommendations/delivery.factory.ts:93-100`, `manifest.service.ts:67-74`). No Forge health signal or ledger state shows the stop before that point, because the ledger row still reads `running`. The runtime error line is easy to miss. The workflows dashboard lists runtime status only for the newest runs, and a scheduler run that started weeks earlier is not among them.

## When to Apply

Apply this guidance to every change to the durable call sequence of these loops, and to every rollback of such a change. These `"use workflow"` functions in `apps/admin/src/workflows/` run `while (true)` with a durable `sleep`. The worker replays each live run at every boot.

| Loop function                                                                                  | Ledger `workflow_key`                             | Boot check function                                                                                                                       | How the boot check finds a dead run                                                                                                                                  |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `runRecommendationRetentionScheduler` (`recommendationRetention.ts:35`)                        | `recommendation-retention-scheduler`              | `ensureRecommendationRetentionSchedulerStarted` (`apps/admin/src/services/recommendations/retention/job.ts:232`)                          | Terminal runtime status. It ignores rows older than 36 hours.                                                                                                        |
| `runRecommendationControlReadinessScheduler` (`recommendationControlReadiness.ts:3`)           | `recommendation-control-readiness-scheduler`      | `ensureRecommendationControlReadinessSchedulerStarted` (`apps/admin/src/services/recommendations/control-readiness/job.ts:261`)           | Terminal runtime status. It ignores rows older than 36 hours (`job.ts:23`).                                                                                          |
| `runRecommendationProfileReconciliationScheduler` (`recommendationProfileReconciliation.ts:3`) | `recommendation-profile-reconciliation-scheduler` | `ensureRecommendationProfileReconciliationSchedulerStarted` (`apps/admin/src/services/recommendations/profiles/reconciliation.job.ts:98`) | Terminal runtime status, or a heartbeat older than 15 minutes with no active runtime run (`reconciliation.job.ts:129-146`). A timer runs this check every 5 minutes. |
| `runRecommendationEpisodeFinalizationRecovery` (`recommendationEpisodeFinalization.ts:16`)     | `recommendation-episode-finalization-recovery`    | `ensureRecommendationEpisodeFinalizationRecovery` (`apps/admin/src/services/recommendations/finalization/job.ts:456`)                     | Heartbeat older than 15 minutes only (`apps/admin/src/services/recommendations/finalization/job.ts:52`).                                                             |
| `runSearchTraceRetentionScheduler` (`searchTraceRetention.ts:26`)                              | `search-trace-retention-scheduler`                | `ensureSearchTraceRetentionSchedulerStarted` (`apps/admin/src/services/search-trace-retention/job.ts:252`)                                | Heartbeat older than 36 hours only (`apps/admin/src/services/search-trace-retention.service.ts:14`, `:261-269`).                                                     |
| `runVideoDbBackupScheduler` (`videoDbBackup.ts:25`)                                            | `video-db-backup-scheduler`                       | `ensureVideoDbBackupSchedulerStarted` (`apps/admin/src/services/video-db-backup/job.ts:300`)                                              | Terminal runtime status (`apps/admin/src/services/video-db-backup/job.ts:268-298`).                                                                                  |
| `runStudioCalendarScheduler` (`studioCalendar.ts:4`)                                           | `studio-calendar-scheduler`                       | `ensureStudioCalendarSchedulerStarted` (`apps/admin/src/services/studio-authoring/calendar-scheduler.ts:125`)                             | Terminal or missing runtime status (`calendar-scheduler.ts:145-165`). It does nothing when `MANAGER_API_BASE_URL` or `MANAGER_TRIGGER_API_KEY` is unset.             |
| `runStudioCalendarPublicationScheduler` (`studioCalendar.ts:29`)                               | `studio-calendar-publication`                     | `ensureStudioCalendarPublicationSchedulerStarted` (`calendar-scheduler.ts:128`)                                                           | The same as the row above.                                                                                                                                           |

Related workflow functions:

- `runCoreSyncScheduler` (`coreSync.ts:67`) also loops forever. But no code in `apps/admin/src` calls `start(runCoreSyncScheduler`. Core Sync uses an in-process timer instead (`apps/admin/src/services/core-sync/job.ts:301`).
- `runPushCampaign` (`pushCampaign.ts:103`) does not loop forever. But a live campaign run can sleep until a zone instant (`pushCampaign.ts:142`), so a change to its step order fails live campaign runs at boot in the same way. Its boot recovery is `ensurePushCampaignRecovery` (`instrumentation.ts:284-286`).
- Other finite workflows can also sleep with a live run at boot: `runRecommendationEpisodeFinalization`, `runCoreSyncQueued`, and `runTranscriptEmbeddingBackfill`. A change to their step order fails those live runs in the same way.

A change inside a step body, a new workflow function, or a change to a workflow with no live run does not need the worker restart.

## Examples

### Deploy step 2 in `apps/admin/CLAUDE.md`

The same docs PR as this learning corrects deploy step 2 of the push campaign rollout.

Before:

```markdown
2. **Restart the recommendation-retention scheduler run once.** U1 added
   `stepRunPushRetention` inside the durable
   `runRecommendationRetentionScheduler` loop. The run that is alive at deploy
   time replays an event log without that step, so the SDK can fail it with
   `corrupted-event-log`. Cancel that run in the workflows dashboard and confirm
   `ensureRecommendationRetentionSchedulerStarted` starts a fresh one (or
   redeploy the worker once more). The 36-hour freshness guard does not do this
   by itself.
```

After:

```markdown
2. **Restart the worker once after the deploy.** U1 added
   `stepRunPushRetention` inside the durable
   `runRecommendationRetentionScheduler` loop. At boot, the worker replays the
   live scheduler run, and the replay fails with `corrupted-event-log`. The boot
   check `ensureRecommendationRetentionSchedulerStarted` can read the run before
   it fails, so no scheduler runs until the next worker boot. After the worker
   deploy succeeds, run `railway restart -e production -s @forge/admin/worker -y`.
   Then confirm that a new `recommendation-retention-scheduler` ledger row is
   `running` with a new `runtime_run_id`. The workflows dashboard has no cancel
   control, and `workflow cancel` refuses a run that is already `failed`. See
   `docs/solutions/workflow-issues/new-step-in-durable-workflow-loop-needs-worker-restart-after-deploy.md`.
```

### The rollback paragraph

Before:

```markdown
A rollback also removes `stepRunPushRetention` from the retention
loop, so cancel the live recommendation-retention scheduler run once after it,
as deploy step 2 does, or its replay can fail with `corrupted-event-log`.
```

After:

```markdown
A rollback also removes `stepRunPushRetention` from the retention loop, so the
replay of the live scheduler run fails with `corrupted-event-log` at the boot of
the rolled-back worker. Restart the worker once after the rollback deploy, as
deploy step 2 does.
```

## Related

- `docs/solutions/runtime-errors/useworkflow-nested-group-step-event-log-corruption.md`: the same `Unconsumed event in event log` error from a different cause, repeated dynamic calls of one step. Its rule that local tests cannot prove event-log validity also applies here.
- `docs/solutions/workflow-issues/transcript-embedding-backfill-cancel-and-resume-operations.md`: the same worker service and CLI, and `workflow cancel` on a run that is still live. It also records the `Re-enqueued N active run(s) on startup` log line.
- `docs/solutions/best-practices/admin-postgres-workflow-operations-pattern-20260501.md`: the split between the ledger row and the runtime run that this incident shows can diverge.
- `docs/solutions/platform/admin-search-trace-retention-pattern.md`: a sibling scheduler that warns that a long-lived ledger can hide a dead loop.
- `docs/solutions/best-practices/workflow-dispatch-test-mode-divergence-20260421.md`: why no vitest suite catches a replay mismatch.
