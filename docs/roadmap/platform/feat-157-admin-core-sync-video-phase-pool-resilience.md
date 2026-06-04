---
id: "feat-157"
title: "Admin Core Sync video phase pool resilience"
owner: "tataihono"
priority: "P0"
status: "not-started"
start_date: "2026-06-04"
duration: 3
depends_on:
  - "feat-110"
  - "feat-156"
blocks: []
tags:
  - "platform"
  - "admin"
  - "core-sync"
  - "database"
  - "operations"
  - "mastra"
  - "embeddings"
  - "evals"
---

## Problem

A production full Core Sync was triggered after the Mastra AI Gateway content
embedding migration merged so Admin could refresh Core video content before the
enrichment, embedding backfill, and search eval sequence. The run stayed alive
for hours in `stepSyncVideos`, then failed before committing the `videos`
phase because the Admin worker exhausted its Prisma database connection pool.

Production evidence from 2026-06-03/2026-06-04 UTC:

- Scheduled endpoint returned runtime run id
  `wrun_01KT7TW5W4M10DQRFPYRXWRF2F`.
- Workflow row:
  - `workflow_run.id = cmpynt6oo0000t801dztgllbj`
  - `status = failed`
  - `trigger = scheduled`
  - `started_at = 2026-06-03 22:50:17.319 UTC`
  - `finished_at = 2026-06-04 02:22:03.267 UTC`
- Failure:
  `FatalError: Step "step//./src/workflows/coreSync//stepSyncVideos" failed after 3 retries`
  because `prisma.$executeRaw()` timed out fetching a connection from the pool.
  Prisma reported `connection limit: 2` and `pool timeout: 10`.
- `sync_locks.key = core-sync` released cleanly at
  `2026-06-04 02:22:03.166322 UTC`.
- Fresh phase watermarks were written for:
  - `languages` at `2026-06-03 22:50:25.827 UTC`
  - `countries` at `2026-06-03 22:50:35.439 UTC`
  - `keywords` at `2026-06-03 22:50:48.695 UTC`
  - `video-origins` at `2026-06-03 22:50:56.686 UTC`
- `videos`, `video-images`, `video-editions`, `video-subtitles`,
  `video-dubs`, and `video-dub-downloads` did not commit in this run; their
  watermarks remained on the previous successful 2026-05-25 sync.

The immediate user-visible risk is that the production all-content AI Gateway
backfill cannot safely proceed until Core Sync can complete the video content
phases. Retrying the full sync without changing pool/concurrency behavior is
likely to fail again under the same pressure.

## Entry Points - Read These First

1. `apps/admin/src/workflows/coreSync.ts` - Workflow step boundaries and the
   `stepSyncVideos` execution path that failed.
2. `apps/admin/src/services/core-sync/orchestrator.ts` - Phase sequencing,
   lock lifecycle, watermark advancement, retry behavior, and result
   aggregation.
3. `apps/admin/src/services/core-sync/phases/sync-videos.ts` - Heavy video
   upsert path, locale/study-question writes, raw SQL calls, batching, and
   transaction shape.
4. `apps/admin/src/db/client.ts` - `syncPrisma`, `DATABASE_URL_SYNC`, and
   Prisma connection-pool configuration.
5. `apps/admin/docs/core-sync-recurring-job.md` - Production trigger and
   verification checklist.
6. `docs/roadmap/content-discovery/feat-156-mastra-ai-gateway-content-embeddings.md`
   - Downstream AI Gateway embedding backfill and eval gate that depends on a
     stable content sync.
7. `apps/admin/src/scripts/run-embeds.ts` - Operator surface for transcript,
   scene, and experience embedding backfills after Core Sync succeeds.
8. `apps/mastra/src/mastra/workflows/search-eval-orchestrator.ts` and
   `apps/mastra/src/services/offline-search-eval/` - Search eval gate and
   report-writing path.

## Grep These

```bash
rg -n "stepSyncVideos|syncVideos|syncPrisma|DATABASE_URL_SYNC|connection_limit|pool_timeout" apps/admin/src apps/admin/.env.example
rg -n "executeRaw|transaction|Promise\\.all|p-limit|concurrency|batch|study_question|video_locale" apps/admin/src/services/core-sync
rg -n "runSync\\(|SyncLock|sync_state|workflow_run|core_sync_run" apps/admin/src
rg -n "run-embeds|pipeline=all|gate-report|eval:content-embedding-gate|search-eval-orchestrator" apps/admin apps/mastra docs/search-eval-reports
```

## What To Build

1. Reproduce or inspect the failed production run enough to confirm whether the
   pool timeout came from:
   - a too-small `DATABASE_URL_SYNC` / Prisma pool configuration,
   - excessive `stepSyncVideos` DB concurrency,
   - long-held transactions starving raw SQL calls,
   - competing Admin worker/web traffic on the same pool,
   - or a combination of those causes.
2. Make the Core Sync worker resilient to the full `videos` phase:
   - use a dedicated sync database URL/pool for the worker,
   - size `connection_limit` and `pool_timeout` for production DB capacity,
   - cap phase-level concurrency so `stepSyncVideos` never asks Prisma for more
     concurrent connections than the sync pool can provide,
   - avoid broad `Promise.all` fan-out inside per-video/per-locale DB writes,
   - and reduce long-held transaction scope where possible.
3. Add targeted retry/backoff for Prisma pool-timeout failures such as P2024
   where retrying the current batch is safe, but do not mask genuine data
   errors as phase success.
4. Add durable progress visibility for the `videos` phase so future long full
   runs show page/batch progress instead of appearing stuck until the final
   watermark commit.
5. Update Admin production env documentation with the selected
   `DATABASE_URL_SYNC` pool parameters and the reasoning for the chosen budget.
   Do not commit secrets or full database URLs.
6. Deploy the fix to production and verify that the production worker is using
   the intended sync pool configuration.
7. Rerun Core Sync, preferably with the narrowest safe scope first:
   - run a targeted `videos` scope if supported,
   - then run the remaining video phases,
   - otherwise rerun the full sync.
8. After Core Sync succeeds, continue the content refresh path:
   - run enrichment for the refreshed content as needed,
   - run the Mastra AI Gateway transcript, scene, and experience embedding
     backfill in controlled batches,
   - run the full Mastra native eval suite with an assigned judge,
   - run the offline/search-eval gate,
   - and store the eval report under `docs/search-eval-reports/` using the
     existing docs summary plus JSON artifact convention.

## Constraints

- Do not increase DB pool limits blindly beyond production Postgres capacity.
- Do not make Admin web/API traffic compete with a large full sync on the same
  tiny pool if `DATABASE_URL_SYNC` is available.
- Do not mark `videos` successful unless its data and watermark commit
  completed.
- Do not bypass `SyncLock`, phase watermarks, or Core-sourced overwrite
  boundaries.
- Do not print Core tokens, DB URLs, Railway variables, gateway keys, or bearer
  secrets in logs, PRs, docs, eval reports, or prompts.
- Do not run production all-content embedding replacement until the eval gate
  says the backfill is ready and rollback evidence exists.
- Keep the AI Gateway vector contract at 1536 stored dimensions unless a
  separate roadmap ticket migrates the vector schema/indexes to a different
  dimension.

## Verification

- Unit or integration tests cover the pool/concurrency behavior touched in
  `stepSyncVideos` and any shared sync helpers.
- `pnpm --filter @forge/admin test` passes for focused Core Sync tests.
- `pnpm --filter @forge/admin typecheck` passes.
- Production deployment includes the selected `DATABASE_URL_SYNC` pool
  settings and a live worker heartbeat.
- A fresh production Core Sync run completes with:
  - `workflow_run.status = succeeded`
  - `sync_locks.held_by IS NULL`
  - fresh `sync_state` watermarks for `videos`, `video-images`,
    `video-editions`, `video-subtitles`, `video-dubs`, and
    `video-dub-downloads`
  - zero phase errors for the video phases
  - coverage audit `pass`
- Post-sync coverage compares Core and Admin for:
  - active video IDs,
  - video variant/dub IDs,
  - localized video metadata pairs,
  - language IDs,
  - and the aggregate row counts surfaced in the prior Core Sync validation.
- AI Gateway embedding backfill evidence shows transcript, scene, and
  experience rows were regenerated with provider provenance:
  `jesus-film-ai-gateway`, native dimensions `4096`, stored dimensions `1536`,
  and transform `matryoshka-truncate-1536-v1`.
- Search eval evidence is committed or linked from
  `docs/search-eval-reports/`, including run id, judge model, pass/fail
  summary, local JSON artifact path, and multilingual result deltas.

## Agent Pickup Prompt

Use this prompt for the next engineering agent:

```text
You are working in the Forge repo on roadmap ticket
docs/roadmap/platform/feat-157-admin-core-sync-video-phase-pool-resilience.md.

Goal:
Fix the production Admin Core Sync failure where the fresh full sync
runtime run wrun_01KT7TW5W4M10DQRFPYRXWRF2F failed in stepSyncVideos at
2026-06-04 02:22:03 UTC because Prisma could not fetch a DB connection
from a pool with connection_limit=2 and pool_timeout=10s. After fixing
that reliability issue, deploy it, rerun Core Sync, then continue the
content refresh: enrichment, AI Gateway embedding backfill, and the full
Mastra eval suite with saved reports.

Start here:
1. Read AGENTS.md, apps/admin/AGENTS.md, apps/admin/CLAUDE.md, and the
   roadmap ticket above.
2. Inspect apps/admin/src/workflows/coreSync.ts,
   apps/admin/src/services/core-sync/orchestrator.ts,
   apps/admin/src/services/core-sync/phases/sync-videos.ts, and
   apps/admin/src/db/client.ts.
3. Confirm the current production env shape without printing secrets:
   check whether the worker uses DATABASE_URL_SYNC, what pool parameters
   are configured, and whether web/API and worker traffic share a tiny
   pool.

Implementation direction:
- Prefer a conservative fix: dedicated sync pool configuration, bounded
  video-phase concurrency, shorter transaction scope, and safe retry/backoff
  for Prisma pool timeouts.
- Add progress visibility for long videos-phase runs.
- Add focused tests for the changed Core Sync behavior.
- Do not commit secrets, raw DB URLs, bearer tokens, gateway keys, or Railway
  variable dumps.

Production sequence after code is merged and deployed:
1. Verify Admin worker deploy and env/pool settings.
2. Trigger the narrowest safe Core Sync scope first. If phase-scoped rerun is
   supported, run videos and then the remaining video phases; otherwise run the
   full sync.
3. Monitor workflow_run, sync_locks, sync_state, and phase summaries until
   status is succeeded or failed.
4. After success, run Core/Admin coverage diffs for active videos,
   variant/dub IDs, localized metadata pairs, language IDs, and aggregate
   counts. Record any remaining Core data anomalies separately.
5. Run enrichment for refreshed content as needed.
6. Run Mastra AI Gateway embedding backfill for transcript, scene, and
   experience content using the existing 1536-dimensional truncation +
   renormalization contract.
7. Run the full Mastra native eval suite with an assigned judge, plus the
   offline/search-eval gate. Save the report under docs/search-eval-reports/
   using the established summary + JSON artifact convention.
8. Report whether search quality improved/regressed versus the previous
   English and multilingual eval baselines.

Completion criteria:
- Production Core Sync succeeds with fresh video-phase watermarks and no stuck
  lock.
- AI Gateway backfill evidence exists for transcript, scene, and experience
  content.
- Mastra native eval and offline/search eval reports are saved and summarized.
- Any remaining issue is documented as a follow-up roadmap ticket rather than
  hidden in the run notes.
```
