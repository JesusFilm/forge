---
id: "feat-142"
title: "Mastra native Evaluation search eval suite"
owner: "nisal"
priority: "P1"
status: "not-started"
start_date: "2026-05-27"
duration: 2
depends_on:
  - "feat-140"
blocks: []
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

Feat-138 and feat-139 introduce two separate Mastra workflows:
`eval-query-generation` stages possible eval prompts, while
`offline-search-eval` captures baselines and comparison reports. Keeping those
leaf workflows separate preserves the safety boundary between exploratory
candidate generation and durable eval reporting, but the operator experience can
still feel fragmented in Mastra Studio.

After feat-140 adds human review and promotion semantics, operators need a
native Mastra Evaluation experience for search evals: Datasets for seed and
promoted prompts, Scorers for pairwise/search-specific quality scoring,
Experiments for offline search runs, and Overview for the roll-up signal.

The suite also needs to keep feat-139 artifacts useful without making them the
final UX. Today the offline eval workflow can create named baseline and report
artifacts, but operators should not have to inspect filesystem JSON if native
Mastra Evaluation can represent the same concepts. A custom artifact browser is
a fallback only for search-specific details that native Evaluation cannot model.

## Entry Points - Read These First

1. `docs/roadmap/content-discovery/feat-138-mastra-eval-query-generation.md`
   - staged generated candidate workflow and retention/promotion boundary.
2. `docs/roadmap/content-discovery/feat-139-mastra-offline-search-eval-runner-reports.md`
   - baseline capture and comparison report workflow.
3. `docs/roadmap/content-discovery/feat-140-search-eval-human-promotion-regression-gates.md`
   - human review, sanitization, and durable regression truth model.
4. `apps/mastra/src/mastra/workflows/eval-query-generation.ts`
   - existing candidate-generation workflow.
5. `apps/mastra/src/mastra/workflows/offline-search-eval.ts`
   - existing offline eval workflow and Studio input schema.
6. `apps/mastra/src/services/offline-search-eval/artifacts.ts`
   - baseline/report artifact storage and validation.
7. `apps/mastra/src/services/offline-search-eval/report.ts`
   - report aggregation for totals, locale mix, prompt-source mix, and
     generated-candidate behavior.
8. `apps/mastra/src/mastra/index.ts`
   - workflow registration and protected service route patterns.
9. `docs/solutions/architecture-patterns/mastra-offline-search-eval-orchestration-boundary-pattern.md`
   - offline eval ownership and generated-candidate boundary.
10. `apps/mastra/node_modules/@mastra/core/dist/datasets/index.d.ts`
    - native Dataset and Experiment APIs.
11. `apps/mastra/node_modules/@mastra/core/dist/evals/base.d.ts`
    - native Scorer API.
12. `apps/mastra/node_modules/mastra/dist/commands/api/route-metadata.generated.d.ts`
    - Studio/API routes used by native Evaluation pages.

## Grep These

```
rg -n "eval-query-generation|offline-search-eval|createWorkflow|registerApiRoute" apps/mastra/src
rg -n "writeBaseline|writeReport|readBaseline|baseline-report|comparison-report|localeMix|promptSourceMix" apps/mastra/src/services/offline-search-eval
rg -n "promotionStatus|promote|regression|candidate" apps/admin/src apps/mastra/src
rg -n "DatasetsManager|startExperiment|createScorer|compareExperiments|TABLE_DATASETS|TABLE_EXPERIMENTS" apps/mastra/node_modules/@mastra/core apps/mastra/node_modules/@mastra/pg
rg -n "Mastra search eval|native Evaluation|Datasets|Scorers|Experiments|Overview" docs/roadmap docs/solutions
```

## What To Build

1. Integrate search evals with Mastra's native Evaluation area:
   - Datasets for seed prompt sets and promoted regression prompts.
   - Scorers for pairwise/search-specific scoring where the native scorer API
     can model it.
   - Experiments for offline search eval runs.
   - Overview for roll-up experiment and scoring signal where supported.
2. Keep `eval-query-generation` and `offline-search-eval` as separate leaf
   workflows unless implementation evidence proves a single workflow is clearer
   and equally safe.
3. Register or create native search-eval scorer definitions. The first scorer
   should model pairwise baseline-vs-current result quality when feasible; if
   native scorers require a single numeric score, encode win/loss/tie classes
   into score plus reason/metadata without losing the custom report categories.
4. Create or synchronize native Datasets:
   - seed prompt dataset from feat-139 seed prompts;
   - promoted regression dataset from feat-140;
   - no generated or trace-derived prompt enters a durable dataset until
     human-promoted.
5. Run offline evals as native Experiments where feasible. Dataset item input
   should carry query/locale/search options; output should carry sanitized
   Admin search results; ground truth should carry baseline or expected-result
   anchors as appropriate.
6. Store search-specific report fields in native experiment/result metadata
   where safe: baseline name, report id/path, prompt-set version, search config,
   locale, prompt source, generated/promoted state, search failures, judge
   disagreement class, both-irrelevant class, cost, and timing.
7. Use native experiment comparison APIs where they fit. If native comparison
   cannot express win/loss/tie/both-irrelevant/judge-disagreement cleanly, keep
   the custom JSON report as a backing detail and link it from native experiment
   metadata.
8. Make the built-in Evaluation pages the canonical operator entry point for
   search evals once native records are written. Custom artifact browsing is
   fallback only for gaps native Evaluation cannot model.
9. Make the Studio workflow cards and descriptions obvious for operators, but
   avoid creating a separate custom suite UI unless native Evaluation cannot
   model required review or report concepts.
10. Show the current safety state through native dataset/result metadata where
    possible: generated, pending review, promoted, rejected/archived, seed
    baseline, comparison report, and regression-gate readiness.
11. Ensure generated candidates remain exploratory until promoted through
    feat-140 review contracts. The suite must not silently promote or gate on
    generated candidates.
12. Add operator-friendly defaults and result summaries so the normal path does
    not require hand-writing JSON payloads.
13. Document which search-eval concepts native Evaluation can model directly
    and which require backing artifact metadata.

## Constraints

- Do not put Mastra in the live search request path.
- Do not move live query embedding generation into Mastra.
- Do not collapse generated-candidate staging and baseline/regression truth into
  one unsafe state machine.
- Do not promote generated or user-submitted candidates without feat-140 human
  review and sanitization.
- Do not query Admin's database from Mastra; use authenticated Admin HTTP
  contracts only.
- Do not expose raw sensitive trace text, vectors, provider secrets, bearer
  tokens, or unsanitized source payloads in the suite UI/workflow output.
- Do not build a custom artifact viewer unless native Mastra Evaluation cannot
  model the required search-eval concept.
- Do not expose artifact filesystem paths as the only way to inspect baselines
  or reports. Paths may appear as debug metadata, but native Evaluation records
  should be the primary operator surface when available.
- Do not change public search REST or GraphQL response shapes.

## Verification

- Operators can open Mastra Studio's native Evaluation area and see search eval
  Datasets, Scorers, and Experiments that were actually created by the system.
- Native Datasets contain seed/promoted prompt items only; generated candidates
  remain absent until promoted.
- Native Scorers are registered or stored with names/descriptions that make the
  search-eval scoring semantics clear.
- Native Experiments are created for offline search eval runs and contain
  sanitized item results, scores, and metadata sufficient to navigate back to
  search-specific report artifacts when needed.
- Overview/Experiments display real native records; the PR does not claim
  visibility based only on custom JSON artifacts.
- Search-specific categories are represented either directly in scorer
  reason/metadata or through linked backing reports: wins, losses, ties,
  both-irrelevant cases, judge disagreements, judge failures, search failures,
  locale mix, prompt-source mix, generated-candidate behavior, calibration
  status, cost, and timing.
- The native Evaluation flow clearly distinguishes artifact/report outputs from
  durable regression truth and promoted gates.
- The existing leaf workflows still work independently.
- Generated candidates remain exploratory until promoted through feat-140.
- Baseline capture and comparison reports still run outside the live search
  request path.
- Run focused validation for touched scopes, including:

```
pnpm --filter @forge/mastra test
pnpm --filter @forge/mastra typecheck
```
