---
id: "feat-577"
title: "Bound Core sync workflow steps to prevent overlapping retries"
owner: "nisal"
priority: "P1"
status: "in-progress"
start_date: "2026-09-30"
duration: 3
depends_on: []
blocks:
  - "feat-578"
tags:
  - "admin"
  - "core-sync"
  - "workflow"
---

## Problem

Core sync wraps each entire phase in one durable Workflow step. A full Videos
phase exceeds the local HTTP transport's observed five-minute ceiling. The
queue retries while the original request continues writing. All attempts
share the same run ID and therefore pass the run-level lock check. Cancellation
prevents future steps but does not interrupt already-running phase bodies.

## Entry Points — Read These First

1. `apps/admin/src/workflows/coreSync.ts`: stepSyncVideos and other phase steps.
2. `apps/admin/src/services/core-sync/orchestrator.ts`: runSyncPhase, lock
   heartbeat, watermark advancement, and finishSyncRun.
3. `apps/admin/src/services/core-sync/phases/`: pagination and reconciliation.
4. `docs/solutions/workflow-issues/transcript-embedding-backfill-cancel-and-resume-operations.md`:
   existing target-sharded solution to the same transport boundary.

## What To Build

Persist one execution record per run and phase. Short Workflow steps enqueue or
observe that record and sleep while the dedicated native worker runs the phase.
A Postgres session advisory lock serializes phase writers across replicas and
releases on process death. Completed results are replayed without rerunning the
phase. Restart recovery repeats the existing idempotent phase, at most three
attempts; it does not claim to resume at a page boundary. The original workflow
remains available for already-dispatched executions.

Keep fetch-start watermark semantics, parent caps, source ownership and guarded
full-catalog deletion. Complete deferred parent/child links after all video pages.
Failed phase executions record failed sync stats so the catalog publisher cannot
snapshot their partially committed rows. Cancellation is checked before admitting
a phase; it does not forcibly interrupt an already-running phase.

## Verification

Test real Postgres concurrent enqueue, exclusive workers, dead-owner recovery,
completed-result replay, failed-phase watermark preservation, and first-import
cross-page series links. Test bounded Workflow polling and importer/backfill
regressions. Production deploy and daily schedule verification remain required.
