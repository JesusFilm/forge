---
id: "feat-155"
title: "Remove legacy Admin search eval harness"
owner: "nisal"
priority: "P1"
status: "complete"
start_date: "2026-06-01"
duration: 1
depends_on:
  - "feat-148"
blocks: []
tags:
  - "admin"
  - "mastra"
  - "search"
  - "evals"
  - "cleanup"
  - "developer-experience"
---

## Problem

Admin still carries the original local semantic-search eval harness:
`apps/admin/src/scripts/eval-search.ts`,
`apps/admin/src/services/search-eval/`, `apps/admin/eval/`, package scripts,
eval-only env keys, and long-form runbook docs. That was useful before the
Mastra search eval leaves and native Evaluation bridge existed, but it now
creates two eval ownership paths for search quality work.

Mastra should be the search eval owner going forward. Admin should keep only
the live search APIs, search trace capture/labeling, and authenticated internal
contracts that Mastra needs. Removing the legacy local harness reduces operator
confusion, stale docs, OpenRouter/env clutter, and duplicated judge/report
logic.

## Entry Points - Read These First

1. `docs/roadmap/content-discovery/feat-148-search-eval-orchestrator-workflow.md`
   - current Mastra orchestration path for baseline capture, comparison,
     native Evaluation sync, and release-gate summaries.
2. `docs/roadmap/content-discovery/feat-154-production-search-eval-seed-baseline.md`
   - production seed baseline capture that should exist before deleting the old
     local Admin fallback.
3. `apps/admin/src/scripts/eval-search.ts`
   - legacy CLI entry point to remove.
4. `apps/admin/src/services/search-eval/`
   - legacy Admin harness modules and tests to delete or migrate only if still
     used by non-harness Admin behavior.
5. `apps/admin/eval/`
   - legacy committed harness data directory.
6. `apps/admin/src/services/search-eval/query-classifier.ts`
   - trace quality/abuse labeling helper that may need relocation instead of
     deletion if Admin still uses it.
7. `apps/admin/package.json`
   - remove `eval:search*` scripts.
8. `apps/admin/src/config/env.ts`
   - remove eval-only env vars after confirming no remaining Admin code uses
     them.
9. `apps/admin/CLAUDE.md` and `apps/admin/eval/README.md`
   - delete the old harness runbook and replace any surviving pointers with
     Mastra-native search eval guidance.
10. `apps/mastra/src/mastra/workflows/search-eval-orchestrator.ts`
    - canonical replacement operator path.
11. `apps/mastra/src/services/offline-search-eval/`
    - canonical report, judge, artifact, and native Evaluation sync path.

## Grep These

```bash
rg -n "eval:search|eval-search|Semantic search eval harness|search-eval" apps/admin docs
rg -n "OPENROUTER_QUERY_CLASSIFIER_MODEL|EVAL_JUDGE_CONCURRENCY|EVAL_SEARCH_CONCURRENCY|EVAL_GIT_SHA" apps/admin docs
rg -n "apps/admin/src/services/search-eval|apps/admin/eval|apps/admin/src/scripts/eval-search" docs apps/admin
rg -n "search-eval-orchestrator|forge-search-eval-orchestrator|search-eval-native-suite" apps/mastra docs
```

## What To Build

1. Confirm the Mastra search eval path is the accepted replacement before
   deleting Admin's local harness:
   - production seed baseline from `feat-154` exists or the team explicitly
     accepts deleting the fallback first;
   - `search-eval-orchestrator` can capture/compare reports and sync native
     Evaluation records;
   - operators know the Mastra route/Studio workflow to use instead of
     `pnpm eval:search`.
2. Remove the legacy Admin CLI:
   - delete `apps/admin/src/scripts/eval-search.ts`;
   - remove all `eval:search*` scripts from `apps/admin/package.json`;
   - remove any references from shell docs, runbooks, and local-dev notes.
3. Classify every module under `apps/admin/src/services/search-eval/` before
   deletion:
   - delete harness-only modules such as baseline, calibration, judge,
     fingerprint, query generation, runner, reporter, and CLI search-client
     code;
   - relocate any surviving Admin trace-labeling or sampling helpers out of
     the `search-eval` namespace so Admin no longer has a legacy eval service
     directory;
   - preserve behavior for query quality/abuse labeling if it is still part of
     Admin trace processing.
4. Remove legacy operator data under `apps/admin/eval/`. If any regression,
   calibration, or seed prompt data still has value, migrate it into the Mastra
   search eval artifact/seed-prompt model before deletion.
5. Clean Admin env and config:
   - remove eval-only env vars such as `EVAL_JUDGE_CONCURRENCY`,
     `EVAL_SEARCH_CONCURRENCY`, and `EVAL_GIT_SHA`;
   - keep `OPENROUTER_API_KEY` only for Admin features that still require it;
   - keep or rename any model env used by non-harness offline classifiers.
6. Update docs and roadmap references:
   - remove the "Semantic search eval harness" section from `apps/admin/CLAUDE.md`;
   - update remaining search-eval docs to point operators at Mastra;
   - mark old plan/brainstorm docs as historical if they remain useful, rather
     than leaving them as current runbooks.
7. Tighten references in current roadmap tickets and solutions docs so future
   work does not tell agents to modify deleted Admin harness files.

## Constraints

- Do not remove Admin's live search REST or GraphQL APIs.
- Do not remove Admin search trace capture, query quality/abuse labeling,
  sampling contracts, or catalog context/candidate contracts that Mastra still
  consumes.
- Do not remove Mastra search eval workflows, native Evaluation sync, report
  artifacts, seed prompt sets, or production baseline artifacts.
- Do not delete useful promoted/regression eval data unless it has been migrated
  or explicitly declared obsolete.
- Do not keep compatibility shims whose only purpose is preserving
  `pnpm eval:search`; the goal is one search eval owner.
- Do not move live user search orchestration into Mastra as part of this
  cleanup.

## Verification

- No Admin package scripts expose `eval:search`.
- `rg` finds no current-runbook references to `apps/admin/src/scripts/eval-search.ts`,
  `apps/admin/eval/`, or the legacy local Admin harness.
- Admin typecheck and tests pass without the legacy
  `apps/admin/src/services/search-eval/` namespace.
- Mastra search eval workflow tests still pass.
- Search trace labeling/sampling tests still pass if they reused any old
  `search-eval` helpers.
- Operators can still run the replacement Mastra search eval path.

Run focused validation for touched scopes, including:

```bash
pnpm --filter @forge/admin test
pnpm --filter @forge/admin typecheck
pnpm --filter @forge/mastra test -- offline-search-eval search-eval-native-suite search-eval-orchestrator
pnpm --filter @forge/mastra typecheck
```
