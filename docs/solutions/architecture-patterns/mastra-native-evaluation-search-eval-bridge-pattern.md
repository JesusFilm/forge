---
title: "Mastra native Evaluation requires real Dataset Scorer and Experiment records"
date: "2026-05-27"
last_updated: "2026-05-27"
category: "architecture-patterns"
module: "apps/mastra"
problem_type: "architecture_pattern"
component: "service_object"
severity: "medium"
applies_when:
  - "A Mastra workflow produces eval artifacts but operators expect the built-in Evaluation UI"
  - "Search eval reports need to prepare for native Datasets, Scorers, and Experiments"
  - "A roadmap must distinguish artifact-backed reports from native Evaluation records"
related_components:
  - "apps/mastra"
  - "apps/mastra-gateway"
  - "apps/admin"
tags:
  - "mastra"
  - "native-evaluation"
  - "datasets"
  - "scorers"
  - "experiments"
  - "search-eval"
  - "studio"
related:
  - "docs/roadmap/content-discovery/feat-139-mastra-offline-search-eval-runner-reports.md"
  - "docs/roadmap/content-discovery/feat-140-search-eval-human-promotion-regression-gates.md"
  - "docs/roadmap/content-discovery/feat-142-mastra-search-eval-suite-operator-workflow.md"
  - "docs/solutions/architecture-patterns/mastra-offline-search-eval-orchestration-boundary-pattern.md"
  - "docs/solutions/integration-issues/mastra-eval-workflow-local-dev-contracts.md"
---

# Mastra Native Evaluation Requires Real Dataset Scorer And Experiment Records

## Context

Mastra Studio's built-in Evaluation area is the intended operator destination
for search evals: Overview, Scorers, Datasets, and Experiments. A workflow run
or custom JSON artifact does not automatically populate that UI.

Local package inspection showed that the installed Mastra runtime has native
Evaluation primitives available:

- `@mastra/core` exposes `mastra.datasets`, `DatasetsManager.create`,
  `Dataset.addItems`, `Dataset.startExperiment`,
  `DatasetsManager.compareExperiments`, `createScorer`,
  `mastra.addScorer`, and `mastra.listScorers`.
- The generated API metadata includes native routes such as `/datasets`,
  `/datasets/:datasetId/items`, `/datasets/:datasetId/experiments`,
  `/experiments`, `/experiments/review-summary`, and `/scores/scorers`.
- `@mastra/pg` includes storage domains and tables for `mastra_datasets`,
  `mastra_dataset_items`, `mastra_dataset_versions`, `mastra_experiments`,
  `mastra_experiment_results`, scorer definitions, and scores.

In the current feat-139 state, those native records are not created. Local API
checks returned empty datasets, experiments, and scorers even while workflows
were available. That means artifacts can be a backing layer, but they are not
the native Evaluation UI.

## Guidance

Make the native Evaluation surface the explicit destination whenever designing
Mastra-owned evals. Shape search eval concepts like this:

- Seed prompt sets and promoted regression prompts should map to native
  Datasets when feasible.
- Pairwise search judges should map to native Scorers when feasible.
- Offline search eval runs should map to native Experiments when feasible.
- Baseline/current comparisons should use native experiment comparison APIs
  where they can preserve the needed semantics.
- Search-specific detail that native Evaluation cannot model should remain in
  sanitized backing artifacts linked from native experiment metadata.

Do not claim that a run appears in Overview, Datasets, Scorers, or Experiments
unless the implementation actually creates native records. A workflow result,
route response, or filesystem report path is not enough.

For incremental tickets, add a bridge field rather than building a parallel
operator UI. Feat-139 reports use a `mastraEvaluation` projection with:

- `integrationStatus: "custom_artifact_only"`;
- intended native Dataset name, source, version, item count, target type, and
  target id;
- intended Scorer identity and kind;
- intended Experiment name, mode, report id, and baseline name;
- native IDs set to `null` until records are actually created.

That gives feat-142 a stable mapping without misleading operators or creating a
custom artifact viewer as the default UX.

## Why This Matters

The built-in Evaluation UI is only trustworthy if it reflects actual native
Mastra records. Treating custom artifacts as if they already populate native
Evaluation creates two sources of truth and makes operators inspect the wrong
surface.

The bridge pattern keeps feat-139 useful without overbuilding. It preserves the
search-specific report categories, keeps sensitive trace data out of Studio,
and leaves feat-142 free to wire the same domain model into native Datasets,
Scorers, and Experiments.

## When To Apply

- A Mastra workflow creates eval artifacts but the product target is the
  built-in Evaluation area.
- Native Mastra APIs exist locally, but the current ticket cannot safely
  populate them yet.
- Search evals need categories such as wins, losses, ties, both-irrelevant
  cases, judge disagreements, search failures, locale mix, prompt-source mix,
  generated-candidate behavior, calibration status, cost, and timing.
- A future ticket needs to promote human-reviewed eval truth into durable
  native Datasets.

## Examples

Artifact-only reports should say so directly:

```ts
const projection = {
  integrationStatus: "custom_artifact_only",
  dataset: {
    name: `search-eval:${baselineName}`,
    datasetId: null,
    source: "seed_prompt_set",
    version: promptSetVersion,
    itemCount: seedCaseCount,
    targetType: "workflow",
    targetId: "offline-search-eval",
  },
  scorers: [
    {
      id: "search-result-pairwise-judge",
      scorerId: null,
      status: "not_registered",
      kind: "pairwise_search_results",
    },
  ],
  experiment: {
    name: `search-eval-compare:${baselineName}:${reportId}`,
    experimentId: null,
    status: "not_created",
    mode: "comparison",
    reportId,
    baselineName,
  },
}
```

Feat-142 can replace the null IDs only after creating real native records:

```ts
const dataset = await mastra.datasets.create({
  name: `search-eval:${baselineName}`,
  targetType: "workflow",
  targetIds: ["offline-search-eval"],
  scorerIds: ["search-result-pairwise-judge"],
})

await dataset.addItems(seedPromptItems)

const experiment = await dataset.startExperiment({
  name: `search-eval-compare:${baselineName}:${runId}`,
  task: runOfflineSearchEvalTask,
  scorers: [searchResultPairwiseJudge],
  metadata: {
    baselineName,
    reportId,
    reportArtifactPath,
  },
})
```

Before claiming Studio visibility, validate native state, not just workflow
state:

```bash
curl http://127.0.0.1:4111/api/datasets
curl http://127.0.0.1:4111/api/experiments
curl http://127.0.0.1:4111/api/scores/scorers
```

## Related

- `docs/solutions/architecture-patterns/mastra-offline-search-eval-orchestration-boundary-pattern.md`
- `docs/solutions/integration-issues/mastra-eval-workflow-local-dev-contracts.md`
- `docs/roadmap/content-discovery/feat-139-mastra-offline-search-eval-runner-reports.md`
- `docs/roadmap/content-discovery/feat-140-search-eval-human-promotion-regression-gates.md`
- `docs/roadmap/content-discovery/feat-142-mastra-search-eval-suite-operator-workflow.md`
