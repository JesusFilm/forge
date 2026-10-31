---
id: "feat-563"
title: "Atomic and recoverable shadow evaluation dispatch"
owner: "nisal"
priority: "P2"
status: "complete"
start_date: "2026-09-29"
duration: 3
depends_on: []
blocks:
  - "feat-565"
tags:
  - "admin"
  - "recommendations"
  - "workflows"
---

## Problem

The feat-387 retry review found two existing dispatch gaps in code: concurrent
same-ID operator invocations can both observe no prior workflow ledger and start
workers; a crash after ledger creation but before runtime start can leave a
queued ledger with no `runtimeRunId`, which later retries report as already
dispatched. No production occurrence was established. Pinning the CLI tuple and
preserving `minimumRuns` do not provide atomic dispatch or crash recovery.

## Entry Points — Read These First

1. `apps/admin/src/services/recommendations/shadow-evaluation/operator.ts` — `startExactCowatchShadowEvaluation`, `startExactShadowEvaluation`, prior-workflow lookup and exact retry comparison.
2. `apps/admin/src/services/recommendations/shadow-evaluation/job.ts` — ledger creation, `start`, runtime attachment and self-reconciliation.
3. `apps/admin/src/services/workflow-run-log.service.ts` — existing runtime identity and status transitions.
4. `apps/admin/src/workflows/recommendationShadowEvaluation.ts` — durable runtime entry and generation fencing.
5. `apps/admin/src/services/recommendations/shadow-evaluation/operator.test.ts` and `job.test.ts` — current retry and failure coverage.
6. `docs/operations/recommendation-cowatch-preflight-2026-09-29.md` — bounded refusal and current serialized operator practice.

## Grep These

- `already_dispatched|priorWorkflow|runtimeRunId`
- `dispatchRecommendationShadowEvaluation|attachWorkflowRuntimeRunId`
- `minimumRuns|expectedGeneration|ledgerRunId`

## What To Build

- Design one durable dispatch identity per exact evaluation/generation tuple,
  preserving conflict rejection for window, sample, generator and minimum runs.
- Make concurrent same-ID calls converge before starting work; verify the
  installed workflow runtime's idempotency/recovery contract before selecting a
  lock, uniqueness constraint or outbox mechanism.
- Reconcile the queued/no-runtime crash window without assuming absence of an
  attached runtime ID proves absence of a started workflow. A recovery path must
  distinguish safe retry, already running, terminal and unresolved uncertainty.
- Keep operator receipts explicit about dispatch state and preserve immutable
  configuration through every transition. Document remaining uncertainty where
  the runtime cannot safely establish a single dispatch.

## Constraints

- No production fault injection, manual SQL repair, forced redispatch or new
  evaluation IDs used to bypass uncertain state.
- Preserve shadow-only execution, generation/privacy fences, source/work bounds,
  retention and current live viewer behavior.
- Plan and review this change before implementation. Coordinate any migration
  number and production capacity with the parent/storage owner.
- This follow-up does not block the serialized local retry repair and introduces
  no feat-373 prerequisite for feat-505. It is not permission to promote or run a
  production co-watch evaluation after the current source-bound refusal.

## Verification

- Use isolated real PostgreSQL plus a controlled runtime double to race two
  identical calls and prove one dispatch identity, then reject conflicting
  configuration under the same ID.
- Exercise crashes before start, after successful start before attachment, and
  after attachment; verify retries neither duplicate work nor falsely claim it
  began. Test completed and failed generations and stale privacy fences.
- Run focused operator/job/DB tests and affected Admin lint/typecheck checks.
  Include exact retained retry and terminal receipts; no raw identities or keys.
- Update the operational instructions and run `pnpm --filter roadmap lint`.

## Resolution

The application now reserves one deterministic dispatch ledger for each exact
evaluation/generation tuple and atomically claims start ownership. Prepared
reservations can resume; attempted starts remain uncertain until runtime
attachment or supported reconciliation establishes their state. Runtime and
terminal writes are fenced by dispatch input and runtime identity. Legacy
failed or missing-runtime receipts cannot trigger blind redispatch.

The [operator record](../../operations/recommendation-shadow-dispatch-2026-09-29.md)
contains the recovery contract and validation: 93 focused worker tests, an
independent 59-test parent rerun including 17 real PostgreSQL cases, full Admin
typecheck/lint/format checks and a successful production Workflow build.
The installed runtime still cannot disprove an unacknowledged start without an
ID. That explicit uncertainty requires investigation, not forced recovery.
No production evaluation, graph approval or live promotion is inferred.
