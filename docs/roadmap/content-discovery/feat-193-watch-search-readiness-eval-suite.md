---
id: "feat-193"
title: "Watch search readiness eval suite"
owner: "nisal"
priority: "P1"
status: "complete"
start_date: "2026-06-16"
duration: 4
depends_on:
  - "feat-148"
blocks:
  - "feat-194"
  - "feat-196"
tags:
  - "admin"
  - "mastra"
  - "search"
  - "evals"
  - "algolia"
  - "launch-readiness"
---

## Resolution

Completed on 2026-06-24 as an operational search-readiness eval suite. The
curated prompt set, caller-specific tracks, keyword-first / hybrid /
semantic-only execution modes, structured reports, and prod-backed verification
artifacts are in place.

This ticket is closed as eval infrastructure, not as a search launch approval.
The generated reports give the team and AI agents enough evidence to make a
launch/no-launch decision, and they surfaced follow-up relevance work around
multilingual no-results and over-promoted generic content.

Prod-backed rerun artifacts:

- Public Watch keyword-first:
  `.tmp/prod-search-eval-fixed-2026-06-23/local-runner/artifacts/reports/3895034d-00fe-400c-bbf5-7df53a0e469d-baseline.json`
  - 100 queries, 0 search failures, 0 judge failures.
- AI experience generation hybrid:
  `.tmp/prod-search-eval-fixed-2026-06-23/local-runner/artifacts/reports/88bbb0a0-3126-4c0c-acdc-8ff535f2a387-baseline.json`
  - 10 queries, 0 search failures, 0 judge failures.
- Semantic diagnostic semantic-only:
  `.tmp/prod-search-eval-fixed-2026-06-23/local-runner/artifacts/reports/365b391f-cc56-4bbd-baee-4c261b1fffed-baseline.json`
  - 8 queries, 0 search failures, 0 judge failures.

Notable readiness signals:

- `bible project` returns `The BibleProject Collection` first.
- `jesus` returns `Who Is Jesus?` and `JESUS` near the top.
- The Chinese seed now uses the canonical `mandarin-china` language slug and no
  longer fails the eval run.
- Relevance follow-ups remain for Spanish and Chinese no-result cases and
  repeated generic results such as `Football 2026`.

## Problem

The team needs a concrete launch-readiness answer for Watch search, not just
ad hoc spot checks. The current search work has multiple possible execution
modes: keyword-first, hybrid, and semantic-only diagnostics. Without a shared
eval set and a readable report, humans and AI agents cannot confidently decide
whether the current implementation is ready to launch.

Roadmap window: this week, June 16-19, 2026.

## Entry Points - Read These First

1. `docs/roadmap/content-discovery/feat-138-mastra-eval-query-generation.md`
   - historical query-generation workflow context.
2. `docs/roadmap/content-discovery/feat-139-mastra-offline-search-eval-runner-reports.md`
   - offline eval runner and report context.
3. `docs/roadmap/content-discovery/feat-148-search-eval-orchestrator-workflow.md`
   - current orchestrator entry point for eval workflows.
4. `docs/roadmap/content-discovery/feat-154-production-search-eval-seed-baseline.md`
   - production baseline capture context.
5. `apps/mastra/src/mastra/workflows/search-eval-orchestrator.ts`
   - Mastra search eval orchestration.
6. `apps/mastra/src/services/offline-search-eval/`
   - runner, report, judge, and seed prompt support.
7. `apps/admin/src/services/hybrid-search.service.ts`
   - Admin search execution surface.
8. `apps/admin/src/app/watch/demo-keyword-search/algolia-action.ts`
   - Algolia parity/fallback comparison surface.
9. `docs/search-eval-baselines/` and `docs/search-eval-reports/`
   - existing baseline and report artifacts.

## What To Build

1. Create or refresh a reusable eval dataset with 50-100 realistic Watch search
   queries.
2. Seed the dataset from real Algolia query data where available.
3. Generate additional representative queries across:
   - product titles;
   - felt needs;
   - Bible topics;
   - misspellings;
   - synonyms;
   - confusing or ambiguous searches;
   - multilingual queries;
   - scene-like queries.
4. Run the same dataset against keyword-first, hybrid, and internal-only
   semantic-only result modes.
5. Produce a report that includes ranked results, relevance scores, obvious
   failures, no-result cases, and summary metrics.
6. Make the report structured enough that both team members and AI agents can
   use it to decide whether the current search implementation is launch-ready.

## Acceptance Criteria

- 50-100 representative queries exist in a reusable eval dataset.
- Queries include product titles, felt needs, Bible topics, misspellings,
  synonyms, confusing queries, multilingual queries, and scene-like queries.
- Real Algolia-derived queries are included where available.
- Eval compares keyword-first, hybrid, and internal-only semantic-only results.
- Keyword-first brand/product cases include `bible project`, which should bring
  back Bible Project videos, and `Jesus`, which should bring back the JESUS
  film/video.
- Output includes scored/ranked results, obvious failures, and summary metrics.
- Team members and AI agents can use the generated report to decide whether the
  current search implementation is launch-ready.

## Verification

- Run the Mastra search eval workflow against the curated query set.
- Confirm the report includes enough per-query detail to diagnose failures.
- Confirm the report includes a summary that can support a launch/no-launch
  recommendation without rereading every raw result.

## Progress Notes

- 2026-06-21: Expanded
  `apps/mastra/src/services/offline-search-eval/seed-prompt-set.ts` to
  `search-eval-seed-prompts/v5` with exactly 100 reusable readiness prompts.
- The prompt set now includes product titles, felt needs, Bible topics,
  misspellings, synonyms, confusing searches, multilingual searches, and
  scene-like searches.
- Added explicit keyword-first brand/product readiness checks for
  `bible project` and `jesus`.
- Seeded the set from Algolia Productivity MCP analytics for
  `FJYYBFHBHS / video-variants-prd`, covering 2026-05-22 through 2026-06-21.
  The top non-empty query, `jesus` with count=88 and nbHits=395, is preserved
  as the canonical high-traffic baseline prompt.
- Added no-result regressions from Algolia analytics, including
  `walking wih jesus`, `walking wth jesus`, `jrius daughter`,
  `finding hope when life feels heavy`, and `world cup 2026 outreach`.
- Added focused tests that enforce the 100-query size, unique IDs, required
  readiness categories, Algolia-derived baseline coverage, no-result typo
  coverage, and multilingual/locale-mismatch cases.
- Added internal-only `semantic-only` execution through Admin's eval route.
  Public REST and GraphQL still treat `semantic-only` as an unknown mode and
  fall back to `hybrid`.
- Extended Mastra offline eval and orchestrator schemas to accept `hybrid`,
  `keyword-first`, and `semantic-only`, while rejecting `algolia-backed`.
- Native Evaluation projection now preserves `semantic-only` and includes the
  requested search mode in dataset, experiment, and report outcome source keys
  so mode-by-mode evidence does not overwrite itself.
- 2026-06-23: Added caller-specific eval tracks for `public-watch`,
  `ai-experience-generation`, and `semantic-diagnostic`.
- Existing 100-query v5 launch-readiness prompts stay in the `public-watch`
  track. Additional AI-agent and semantic-diagnostic prompts are included for
  their caller-specific use cases.
- Offline eval runner, workflow, orchestrator, reports, judge rubrics, artifact
  schemas, and native Evaluation sync now carry `callerTrack`.
- Caller tracks define their own default baseline names and search modes:
  public Watch uses `seed-baseline` plus `keyword-first`, AI experience
  generation uses `seed-baseline-ai-experience-generation` plus `hybrid`, and
  semantic diagnostics uses `seed-baseline-semantic-diagnostic` plus
  `semantic-only`.
- The runner rejects unsupported caller-track/search-mode pairs before Admin
  search, refuses to overwrite baselines owned by another caller track, and
  rejects baseline/current caller-track mismatches before judge calls. Legacy
  untracked artifacts normalize to `public-watch`.
- Reports now include `callerTrackMix` and `trackSummaries`, including selected
  mode, suitability, no-result count, totals, and representative failures.
- Algolia is prompt provenance only in this ticket; no Algolia-backed execution,
  fallback path, or follow-up ticket is in scope.
- Code-level implementation is verified below. A launch/no-launch decision
  still requires running the Mastra eval workflow against a configured Admin
  search-eval endpoint and reviewing the produced report.
- 2026-06-24: Closed after prod-backed local runner verification. The suite
  completed across public Watch keyword-first, AI experience generation hybrid,
  and semantic diagnostic semantic-only tracks with 0 search failures and 0
  judge failures. Reports are suitable for launch-readiness review, while the
  relevance findings are follow-up search-quality work.

## Implementation Verification Notes

- Passed:
  `pnpm --filter @forge/admin test -- hybrid-search.keyword-first hybrid-search.service route.test.ts`
- Passed:
  `pnpm --filter @forge/admin test -- hybrid-search.bible-project`
- Passed:
  `pnpm --filter @forge/mastra test -- seed-prompt-set runner offline-search-eval search-eval-orchestrator native-evaluation admin-search-eval-client search-eval-native-suite artifacts report`
- Passed:
  `pnpm --filter @forge/mastra test -- seed-prompt-set report artifacts judge runner offline-search-eval search-eval-orchestrator native-evaluation search-eval-native-suite search-eval-baseline-portability baseline-portability`
- Passed: `pnpm --filter @forge/mastra typecheck`
- Typecheck caveat: `pnpm --filter @forge/admin typecheck` was not rerun during
  the caller-track implementation; prior verification noted pre-existing Prisma
  schema drift in `apps/admin/src/services/transcript-embedding.service.ts` for
  `sourceKind`.
