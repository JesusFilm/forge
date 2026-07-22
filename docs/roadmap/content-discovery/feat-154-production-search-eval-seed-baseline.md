---
id: "feat-154"
title: "Production search eval seed baseline capture"
owner: "nisal"
priority: "P0"
status: "complete"
start_date: "2026-06-01"
duration: 1
depends_on:
  - "feat-148"
blocks:
  - "feat-120"
  - "feat-156"
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
     "mode": "seed-baseline",
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
6. Export the saved baseline through
   `POST /forge-search-eval-baseline-portability` with
   `action=export-baseline`, then import that sanitized JSON artifact into a
   local Mastra runtime with `action=import-baseline`.
7. Add completion notes to this ticket, or a linked production run note, with
   the production run id, artifact ids, native ids, timestamp, and any known
   limitations. Include the portability export id and imported local report ids.
8. If the production run fails because env or service contracts are missing,
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
- The baseline portability route can export a seed-only artifact from production
  and import it into local Mastra without enabling production imports.
- The recorded summary includes baseline/report ids, artifact paths, native ids,
  counts, and pass/fail state.
- `feat-120` does not proceed until this production seed baseline is captured
  or the blocker is explicitly accepted.

## Implementation Notes - 2026-06-02

- Added a constrained Mastra `seed-baseline` orchestrator posture with
  readiness preflight and non-seed flag rejection.
- Added service-authenticated baseline portability actions for preflight,
  seed-only export, and local import.
- Added `pnpm seed:search-eval:prod` to import the sanitized production export
  into local artifacts and sync imported reports into local Mastra-native
  Evaluation storage.
- Added a local native Evaluation sync test for imported baseline reports.
- Verified implementation with `pnpm --filter @forge/mastra test`,
  `pnpm --filter @forge/mastra typecheck`, and
  `pnpm --filter @forge/mastra lint`.

## Production Run - 2026-06-02

- Configured production Railway env for `@forge/mastra`:
  `ADMIN_SEARCH_EVAL_SEARCH_URL=https://admin.jesusfilm.org/api/internal/search-eval/search`
  and `MASTRA_NATIVE_EVAL_ENVIRONMENT=production`. Existing
  `ADMIN_SEARCH_EVAL_API_KEY` matched Admin's
  `SEARCH_TRACE_SAMPLING_API_KEYS`, `MASTRA_SERVICE_API_KEYS` was present,
  `DATABASE_URL` was present, and the Railway volume mounted at `/data`.
- Redeployed `@forge/mastra` so the env changes were loaded:
  deployment `a89ec579-1d20-4d54-9a55-78aa9a730c9a`, status `SUCCESS`.
- Ran the production seed-only baseline through the production-compatible
  orchestrator payload (`mode=full`, `generateCandidates=false`,
  `nativeSync=true`, `syncPromoted=false`) because production did not yet have
  this branch's `mode=seed-baseline` or
  `/forge-search-eval-baseline-portability` route deployed.
- Orchestrator run id:
  `f323a47d-0fa9-4936-b936-88a06e906cd5`.
- Offline search eval child:
  `f323a47d-0fa9-4936-b936-88a06e906cd5-offline-search-eval`, succeeded.
- Baseline artifact:
  `/data/mastra/search-eval/baselines/prod-seed-baseline-2026-06-02.json`.
- Report artifact:
  `/data/mastra/search-eval/reports/f323a47d-0fa9-4936-b936-88a06e906cd5-offline-search-eval-baseline.json`.
- Captured at `2026-06-02T01:14:31.157Z` from prompt set
  `search-eval-seed-prompts/v1`; Admin search URL
  `https://admin.jesusfilm.org/api/internal/search-eval/search`; search
  limit `20`; mode `hybrid`; content type `all`.
- Counts: `10` seed queries, locale mix `en=8`, `es=1`, `fr=1`, wins `0`,
  losses `0`, ties `10`, judge failures `0`, search failures `0`, generated
  candidates `0`, promoted sync `0`.
- Initial orchestrator native sync failed retryably, then a focused
  `sync-report` resume succeeded. Successful native resume run id:
  `26a6b22a-8cc3-44ec-9950-0a12d31a6afa`.
- Native Evaluation records:
  dataset `a7f9cbf0-20a9-4867-ac97-6f6dfd2287ad`
  (`search-eval:production:prod-seed-baseline-2026-06-02`), scorer
  `search-result-pairwise-judge`, experiment
  `fe3466ad-bb40-4c7c-8660-24d9171e3775`.
- Local portability stopgap: captured the native resume response, reconstructed
  a seed-only export artifact from the production report plus committed seed
  prompt metadata, validated it with
  `SearchEvalBaselineExportArtifactSchema`, and imported it with
  `importSearchEvalBaselineArtifact` into local root
  `.tmp/feat-154/local-import/search-eval`. Export id:
  `755d3b50-d31c-4c3d-b9ad-f8244d104cac`; imported report id:
  `f323a47d-0fa9-4936-b936-88a06e906cd5-offline-search-eval-baseline`.
- Temporarily copied sanitized production and local replay export artifacts to
  `docs/search-eval-baselines/temporary/` so local eval work can continue while
  production Admin query embeddings are blocked by the OpenRouter key limit.
  Delete that directory once production embeddings and the official
  export/import path are healthy.
- Limitation: the official authenticated production
  `/forge-search-eval-baseline-portability` export path still requires this
  branch to be deployed/merged. The production baseline itself and local
  imported artifact are captured.

## Judge Compare Run - 2026-06-02

- Ran the production judged compare against
  `prod-seed-baseline-2026-06-02` with the existing pairwise search-results
  judge and `nativeSync=true`.
- Production orchestrator run id:
  `0bb04bd5-c998-4459-b2a4-455d919ee473`.
- Offline search eval child:
  `0bb04bd5-c998-4459-b2a4-455d919ee473-offline-search-eval`, succeeded.
- Native sync child:
  `0bb04bd5-c998-4459-b2a4-455d919ee473-native-report-sync`, succeeded.
- Production comparison report artifact:
  `/data/mastra/search-eval/reports/0bb04bd5-c998-4459-b2a4-455d919ee473-offline-search-eval.json`.
- Native Evaluation records:
  dataset `a7f9cbf0-20a9-4867-ac97-6f6dfd2287ad`
  (`search-eval:production:prod-seed-baseline-2026-06-02`), scorer
  `search-result-pairwise-judge`, experiment
  `7ee5fc7a-3212-4577-81a9-84b452e3ac94`.
- Production judged counts: baseline cases `10`, report queries `10`, wins
  `0`, losses `0`, ties `5`, both irrelevant `5`, judge disagreements `0`,
  judge failures `0`, search failures `0`, native created items `0`, native
  updated items `10`.
- Also ran a local detailed compare using the imported production baseline and
  production Admin/OpenRouter env via Railway variable injection. Local report:
  `.tmp/feat-154/local-import/search-eval/reports/local-judge-compare-2026-06-02.json`.
- Local detailed judge model: `anthropic/claude-haiku-4-5`; calibration passed
  (`1/1`); totals matched production (`0` wins, `0` losses, `5` ties, `5`
  both irrelevant, `0` failures/disagreements); estimated cost `$0.02391`
  from `16,780` input tokens and `1,426` output tokens.
