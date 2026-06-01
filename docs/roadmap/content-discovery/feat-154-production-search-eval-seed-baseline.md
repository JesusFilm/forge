---
id: "feat-154"
title: "Production search eval seed baseline capture"
owner: "nisal"
priority: "P0"
status: "not-started"
start_date: "2026-06-01"
duration: 1
depends_on:
  - "feat-148"
blocks:
  - "feat-120"
tags:
  - "admin"
  - "mastra"
  - "search"
  - "ai-pipeline"
  - "observability"
  - "evals"
  - "production"
---

## Problem

Before `feat-120` changes multilingual semantic search behavior, the team needs
a production baseline for the current semantic search workflow. The baseline
should use the committed seed prompt set only, run against production Admin
search through the existing Mastra search-eval orchestration path, and persist
the resulting baseline/report/native Evaluation artifacts so later multilingual
work can compare against a known pre-change state.

This ticket is intentionally operational and narrow. It should not sample user
trace data, generate new candidate prompts, promote candidates, or change live
public search behavior. Its job is to prove and record the production seed
baseline before multilingual scene embeddings and localized snippets alter the
search corpus.

## Entry Points - Read These First

1. `docs/roadmap/content-discovery/feat-139-mastra-offline-search-eval-runner-reports.md`
   - seed prompt baseline capture and report artifacts.
2. `docs/roadmap/content-discovery/feat-140-search-eval-human-promotion-regression-gates.md`
   - seed prompt and human-review boundaries.
3. `docs/roadmap/content-discovery/feat-142-mastra-search-eval-suite-operator-workflow.md`
   - native Dataset, Scorer, and Experiment sync.
4. `docs/roadmap/content-discovery/feat-148-search-eval-orchestrator-workflow.md`
   - thin orchestrator workflow and summary contract.
5. `docs/roadmap/content-discovery/feat-120-localized-scene-embeddings-and-snippets.md`
   - multilingual semantic search work that should wait for this baseline.
6. `docs/solutions/integration-issues/mastra-eval-workflow-local-dev-contracts.md`
   - local smoke and production-like operator runbook details.
7. `apps/mastra/src/mastra/workflows/search-eval-orchestrator.ts`
   - production orchestration entry point.
8. `apps/mastra/src/mastra/workflows/offline-search-eval.ts`
   - seed baseline capture leaf workflow.
9. `apps/mastra/src/mastra/workflows/search-eval-native-suite.ts`
   - native Evaluation sync leaf workflow.
10. `apps/mastra/src/services/offline-search-eval/seed-prompt-set.ts`
    - seed prompt data source for this baseline.

## Grep These

```bash
rg -n "search-eval-orchestrator|forge-search-eval-orchestrator" apps/mastra/src
rg -n "seed-prompt|seed-baseline|capture-baseline" apps/mastra/src
rg -n "ADMIN_SEARCH_EVAL_SEARCH_URL|ADMIN_SEARCH_EVAL_API_KEY|MASTRA_SERVICE_API_KEYS" apps/mastra/src apps/admin/src
rg -n "native Evaluation|Dataset|Scorer|Experiment|mastraEvaluation" apps/mastra/src docs/solutions docs/roadmap
```

## What To Do

1. Confirm production Mastra has the production Admin search-eval service
   contract configured:
   - `ADMIN_SEARCH_EVAL_SEARCH_URL`
   - `ADMIN_SEARCH_EVAL_API_KEY`
   - `MASTRA_SERVICE_API_KEYS`
   - persistent Mastra storage
   - production search-eval artifact root
2. Run the orchestrator against production with seed-only defaults:

   ```json
   {
     "mode": "full",
     "baselineName": "prod-seed-baseline-YYYY-MM-DD",
     "searchMode": "hybrid",
     "contentType": "all",
     "generateCandidates": false,
     "submitSeedCandidates": false,
     "nativeSync": true,
     "syncPromoted": false
   }
   ```

3. Use the committed seed prompt set as the only query source. Do not sample
   Admin traces, read user-submitted candidates, generate new candidates, or
   auto-promote anything.
4. Capture the operator summary from the orchestrator response:
   - orchestrator run id
   - child workflow run ids
   - baseline/report ids
   - artifact paths
   - native Dataset/Scorer/Experiment ids
   - counts by locale/source/result
   - pass/fail state
5. Verify the native Mastra Evaluation pages show the production seed baseline
   Dataset, Scorer, and Experiment records.
6. Add completion notes to this ticket, or a linked production run note, with
   the production run id, artifact ids, native ids, timestamp, and any known
   limitations.
7. If the production run fails because env or service contracts are missing,
   fix or document that operational blocker without widening into multilingual
   search implementation.

## Constraints

- Do not put Mastra in the live public search request path.
- Do not change public search REST or GraphQL response shapes.
- Do not implement `feat-120` multilingual embeddings, translations, snippets,
  or ranking changes in this ticket.
- Do not use user trace data or raw user-submitted queries for this baseline.
- Do not generate new eval candidates or promote candidates.
- Do not sync promoted Admin candidates during this seed-only baseline.
- Do not query Admin's database directly from Mastra; use the existing
  authenticated Admin search-eval HTTP contracts.
- Do not treat a partial artifact as the final baseline unless the failure is
  explicitly recorded and the run is resumable.

## Verification

- Production route call succeeds with HTTP 200 and an `ok: true` orchestrator
  result for the seed-only baseline payload.
- The `offline-search-eval` child run captures the baseline from seed prompts.
- The native sync child run creates or reuses native Dataset, Scorer, and
  Experiment records without duplicating prior native records.
- Mastra Studio shows the production seed baseline in native Evaluation.
- The recorded summary includes baseline/report ids, artifact paths, native ids,
  counts, and pass/fail state.
- `feat-120` does not proceed until this production seed baseline is captured
  or the blocker is explicitly accepted.
