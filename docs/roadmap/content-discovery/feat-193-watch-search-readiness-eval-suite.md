---
id: "feat-193"
title: "Watch search readiness eval suite"
owner: "nisal"
priority: "P1"
status: "not-started"
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

## Problem

The team needs a concrete launch-readiness answer for Watch search, not just
ad hoc spot checks. The current search work has multiple possible execution
modes: keyword-first, hybrid, semantic, and Algolia fallback. Without a shared
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
4. Run the same dataset against keyword, hybrid, semantic, and Algolia-backed
   result modes.
5. Produce a report that includes ranked results, relevance scores, obvious
   failures, no-result cases, and summary metrics.
6. Make the report structured enough that both team members and AI agents can
   use it to decide whether the current search implementation is launch-ready.

## Acceptance Criteria

- 50-100 representative queries exist in a reusable eval dataset.
- Queries include product titles, felt needs, Bible topics, misspellings,
  synonyms, confusing queries, multilingual queries, and scene-like queries.
- Real Algolia-derived queries are included where available.
- Eval compares keyword, hybrid, semantic, and Algolia-backed results.
- Output includes scored/ranked results, obvious failures, and summary metrics.
- Team members and AI agents can use the generated report to decide whether the
  current search implementation is launch-ready.

## Verification

- Run the Mastra search eval workflow against the curated query set.
- Confirm the report includes enough per-query detail to diagnose failures.
- Confirm the report includes a summary that can support a launch/no-launch
  recommendation without rereading every raw result.
