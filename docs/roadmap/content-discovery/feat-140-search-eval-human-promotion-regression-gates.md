---
id: "feat-140"
title: "Search eval human promotion and regression gates"
owner: "nisal"
priority: "P0"
status: "not-started"
start_date: "2026-05-25"
duration: 3
depends_on:
  - "feat-139"
blocks:
  - "feat-141"
tags:
  - "admin"
  - "mastra"
  - "search"
  - "ai-pipeline"
  - "observability"
  - "evals"
---

## Problem

Generated eval candidates are useful for scale, but they should not become
long-lived regression gates until a human has reviewed and promoted them. The
system needs a promotion path that turns sanitized, source-anchored candidates
into durable benchmarks while keeping raw production traces subject to the
30-day deletion rule.

This completes the hybrid truth model: source-anchored for scale,
judge-scored for nuance, and human-promoted for regression gates.

## Entry Points - Read These First

1. `docs/brainstorms/2026-05-25-mastra-embedding-search-migration-requirements.md`
   - human-promoted regression gate decision.
2. `docs/roadmap/content-discovery/feat-138-mastra-eval-query-generation.md`
   - generated candidate storage and promotion status.
3. `docs/roadmap/content-discovery/feat-139-mastra-offline-search-eval-runner-reports.md`
   - Mastra eval report output to review.
4. `apps/admin/eval/README.md`
   - existing regression and calibration artifact guidance.
5. `apps/admin/eval/regressions.json`
   - current hand-edited regression case store.
6. `apps/admin/src/services/search-eval/regressions.ts`
   - regression loading and validation.
7. `apps/admin/src/services/search-eval/reporter.ts`
   - report details that should support promotion decisions.
8. `apps/admin/src/app/dashboard/search/page.tsx`
   - existing Admin search/debug surface that could host review affordances.

## Grep These

```
rg -n "regressions.json|loadRegressions|Regression|calibration" apps/admin/eval apps/admin/src/services/search-eval
rg -n "candidate|promotion|approved|sanitized|human" apps/admin/src apps/mastra/src docs/roadmap
rg -n "dashboard/search|workflow reports|eval reports" apps/admin/src/app apps/mastra/src
```

## What To Build

1. Add a human review and promotion workflow for generated eval candidates.
   Promotion must record reviewer identity, review timestamp, source anchors,
   sanitization status, and expected-result notes.
2. Ensure promoted evals can survive beyond the 30-day raw trace retention
   window without retaining unsafe raw trace data.
3. Add regression-gate loading so promoted evals can be used by Mastra offline
   eval runs and CI-sensitive search checks.
4. Preserve or migrate the existing hand-edited `apps/admin/eval/regressions.json`
   flow so current regression cases are not lost.
5. Add clear rejection/archive states for low-quality, ambiguous, abusive, or
   unsanitized candidates.
6. Document the review standards for source-anchored, judge-scored, and
   human-promoted cases.

## Constraints

- Do not retain raw per-query production traces longer than 30 days.
- Do not promote candidate queries that contain personal data, abusive content,
  prompt-injection content, or unclear viewer intent.
- Do not rely on LLM judge output alone as the durable expected-result truth.
- Do not change public search response shapes.
- CMS/Strapi is being deleted. Do not add, preserve, or depend on CMS support in
  this ticket. Promoted cases should reference Admin/Core-owned content IDs.
- Do not place Mastra in the live search request path.

## Verification

- A generated candidate can be reviewed, sanitized, promoted, and loaded as a
  durable regression case.
- Rejected candidates do not enter regression gates.
- Raw trace retention still deletes per-query trace data after 30 days while
  preserving only approved sanitized benchmarks and aggregates.
- Existing hand-edited regression cases still load.
- Run focused validation for touched scopes, including:

```
pnpm --filter @forge/admin test -- search-eval/regressions.test.ts search-eval/runner.test.ts search-eval/reporter.test.ts
pnpm --filter @forge/mastra test
pnpm --filter @forge/admin typecheck
```
