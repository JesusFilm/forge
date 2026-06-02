---
id: "feat-148"
title: "Search eval artifact and Evaluation orchestrator"
owner: "nisal"
priority: "P0"
status: "complete"
start_date: "2026-05-30"
duration: 2
depends_on:
  - "feat-142"
blocks:
  - "feat-155"
tags:
  - "admin"
  - "mastra"
  - "search"
  - "ai-pipeline"
  - "observability"
  - "evals"
  - "developer-experience"
---

## Problem

The search eval system now has separate Mastra leaf workflows for staged query
generation, offline baseline/report artifacts, human candidate review, and
native Evaluation synchronization. Those leaves should remain independently
runnable, but operators need one thin workflow that coordinates the normal
search-eval sequence and returns a single useful summary.

This work was requested as the content-discovery `feat-144` search eval
orchestrator scope, but the current roadmap already uses `feat-144` globally in
the platform lane. This ticket therefore uses the next unique roadmap id while
preserving the requested scope and sequencing.

The next two search-eval tickets depend on this orchestration surface:

- production search eval baseline capture needs this common orchestration path.
- local production-baseline seeding needs the same resumable report/native-sync
  handoff.

This orchestrator should land first so those tickets can use the same
operator-facing defaults and resumable report/native sync handoff.

## Entry Points - Read These First

1. `docs/roadmap/content-discovery/feat-138-mastra-eval-query-generation.md`
   - staged generated candidate workflow and promotion boundary.
2. `docs/roadmap/content-discovery/feat-139-mastra-offline-search-eval-runner-reports.md`
   - baseline and comparison artifact workflow.
3. `docs/roadmap/content-discovery/feat-140-search-eval-human-promotion-regression-gates.md`
   - human review, sanitization, and durable regression truth.
4. `docs/roadmap/content-discovery/feat-142-mastra-search-eval-suite-operator-workflow.md`
   - native Dataset, Scorer, and Experiment synchronization.
5. `apps/mastra/src/mastra/workflows/eval-query-generation.ts`
   - staged candidate-generation leaf workflow.
6. `apps/mastra/src/mastra/workflows/offline-search-eval.ts`
   - baseline capture and comparison leaf workflow.
7. `apps/mastra/src/mastra/workflows/search-eval-candidate-review.ts`
   - human-review and seed/user candidate submission leaf workflow.
8. `apps/mastra/src/mastra/workflows/search-eval-native-suite.ts`
   - native Evaluation sync leaf workflow.
9. `apps/mastra/src/mastra/index.ts`
   - workflow and protected service route registration.
10. `docs/solutions/architecture-patterns/mastra-offline-search-eval-orchestration-boundary-pattern.md`
    - search eval ownership and safety boundary.
11. `docs/solutions/architecture-patterns/mastra-native-evaluation-search-eval-bridge-pattern.md`
    - native Evaluation idempotency and artifact bridge pattern.

## Grep These

```bash
rg -n "eval-query-generation|offline-search-eval|search-eval-native-suite|search-eval-candidate-review" apps/mastra/src
rg -n "writeBaseline|writeReport|readReport|mastraEvaluation|native_synced" apps/mastra/src/services/offline-search-eval
rg -n "promotionStatus|sanitizationStatus|submit-seed|submit-user|promote" apps/mastra/src apps/admin/src
rg -n "registerApiRoute|createWorkflow|createStep" apps/mastra/src/mastra
```

## What To Build

1. Add a thin Mastra workflow that coordinates existing search eval leaf
   workflows without moving their logic into a mega-workflow.
2. Keep all leaf workflows independently runnable through Studio and their
   existing service routes.
3. Support operator-friendly modes:
   - `full` for production baseline capture plus optional native/promoted sync;
   - `compare` for comparing current search against a named baseline;
   - `release-gate` for comparison plus explicit pass/fail thresholds.
4. Return one summary with child workflow ids, baseline/report ids, artifact
   paths, native Dataset/Scorer/Experiment ids, counts, and pass/fail state.
5. Make partial failures legible and resumable. A native sync failure after a
   successful report should return the report id/path so operators can retry
   sync without rerunning the search eval.
6. Preserve the human-review boundary. Generated, trace-derived, seed, or
   user-submitted candidates must not be auto-promoted.
7. Add defaults that make production baseline capture and local
   production-baseline seeding straightforward follow-ups.

## Constraints

- Do not put Mastra in the live public search request path.
- Do not collapse `eval-query-generation`, `offline-search-eval`,
  `search-eval-candidate-review`, or `search-eval-native-suite` into one
  mega-workflow.
- Do not duplicate native Evaluation records on rerun; use the existing
  native-suite idempotency contracts and support resume by report id.
- Do not silently promote generated, trace-derived, seed, or user-submitted
  candidates.
- Do not implement production baseline capture or local baseline seeding; only
  leave clear affordances for those follow-ups.
- Do not query Admin's database from Mastra or import Admin app code.

## Verification

At minimum:

```bash
pnpm --filter @forge/mastra test -- eval-query-generation offline-search-eval search-eval-native-suite search-eval-candidate-review
pnpm --filter @forge/mastra test
pnpm --filter @forge/mastra typecheck
pnpm --filter @forge/mastra lint
```

Also add focused tests for the new orchestrator workflow and route.
