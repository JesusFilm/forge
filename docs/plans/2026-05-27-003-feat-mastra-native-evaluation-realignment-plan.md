---
id: "2026-05-27-003"
title: "Mastra Native Evaluation Realignment"
status: "active"
created: "2026-05-27"
origin: "user clarification in Codex thread"
owner: "codex"
---

# Mastra Native Evaluation Realignment Plan

## Problem

Feat-139 correctly keeps Admin out of Mastra's live path and creates offline
search-eval artifacts, but the roadmap drifted toward custom artifact browsing
as the operator destination. The target is Mastra's native Evaluation area:
Overview, Scorers, Datasets, and Experiments.

## Investigation Findings

- `@mastra/core` exposes native dataset APIs through `mastra.datasets`,
  `DatasetsManager.create`, `Dataset.addItems`, `Dataset.startExperiment`, and
  experiment comparison helpers.
- `@mastra/core/evals` exposes `createScorer`, `MastraScorer.run`, and scorer
  registration through the `scorers` config or `mastra.addScorer`.
- Mastra Studio/API includes native routes for `/datasets`,
  `/datasets/:datasetId/items`, `/datasets/:datasetId/experiments`,
  `/experiments`, `/experiments/review-summary`, `/scores/scorers`, and stored
  scorer routes.
- `@mastra/pg` includes Postgres storage domains for datasets, experiments,
  scores, and stored scorer definitions. `apps/mastra/src/mastra/index.ts`
  already uses `PostgresStore` as the default Mastra storage domain, so native
  Evaluation persistence is technically available when the Mastra DB is
  configured.
- Current local native Evaluation state is empty: `/api/datasets` and
  `/api/experiments` return empty lists, and `/api/scores/scorers` returns `{}`.
  Therefore feat-139 must not claim that its search evals are visible in native
  Evaluation yet.

## Decisions

1. Feat-139 remains an offline runner and structured artifact PR. It should
   preserve artifacts as a search-specific backing layer, and add explicit
   metadata that maps each report to the intended native Dataset, Scorer, and
   Experiment shape without claiming those records exist.
2. Feat-140 should define promoted eval truth so it can feed native Mastra
   Datasets, not only Admin regression JSON or Admin tables.
3. Feat-142 becomes the convergence ticket for actual native Evaluation writes:
   seed/promoted Datasets, registered Scorers, Experiment runs, and Overview
   visibility. A custom artifact viewer is fallback only for fields native
   Evaluation cannot model.
4. Feat-141 should use promoted datasets and native experiment results as its
   evidence source for retrieval-strategy investigation.

## Implementation Units

### U1: Add Native Evaluation Projection To Reports

Files:

- `apps/mastra/src/services/offline-search-eval/types.ts`
- `apps/mastra/src/services/offline-search-eval/report.ts`
- `apps/mastra/src/services/offline-search-eval/artifacts.ts`
- `apps/mastra/src/services/offline-search-eval/*.test.ts`

Approach:
Add a required `mastraEvaluation` projection block to report artifacts. It must
state `integrationStatus: "custom_artifact_only"` and include the intended
native dataset, scorer, and experiment names with null native IDs. This creates
a stable bridge for feat-142 while avoiding false claims.

Test scenarios:

- Finalized reports include native Evaluation projection metadata.
- Artifact validation rejects malformed projection metadata.
- Existing baseline and compare report tests continue to pass.

### U2: Realign Roadmap Documents

Files:

- `docs/roadmap/content-discovery/feat-139-mastra-offline-search-eval-runner-reports.md`
- `docs/roadmap/content-discovery/feat-140-search-eval-human-promotion-regression-gates.md`
- `docs/roadmap/content-discovery/feat-141-mastra-retrieval-strategy-investigation.md`
- `docs/roadmap/content-discovery/feat-142-mastra-search-eval-suite-operator-workflow.md`

Approach:
Make native Mastra Evaluation the explicit destination. State where each ticket
fits and keep custom artifact browsing as fallback only.

Test scenarios:

- Grep confirms feat-142 names native Overview, Scorers, Datasets, and
  Experiments as the target.
- Grep confirms no roadmap claims feat-139 already populates native Evaluation.

### U3: Compound Native Evaluation Learning

Files:

- `docs/solutions/architecture-patterns/mastra-offline-search-eval-orchestration-boundary-pattern.md`
- A new or updated `docs/solutions/` note if the mapping is not already covered.

Approach:
Document that native Mastra Evaluation exists in the installed package and
should be the operator destination. Capture the storage/API evidence and the
safe incremental bridge pattern.

Test scenarios:

- Solution docs validate frontmatter.
- The docs distinguish artifact storage from native Evaluation UI records.

## Validation

- `pnpm --filter @forge/mastra test -- offline-search-eval`
- `pnpm --filter @forge/mastra typecheck`
- `pnpm --filter @forge/mastra lint`
- `python /home/vscode/.codex/plugins/cache/compound-engineering-plugin/compound-engineering/3.9.0/skills/ce-compound/scripts/validate-frontmatter.py <updated-solution-doc>`
