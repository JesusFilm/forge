---
id: "feat-741"
title: "Import editorial choices into saved recommendation comparisons"
owner: "tataihono"
priority: "P1"
status: "complete"
start_date: "2026-10-19"
duration: 1
depends_on:
  - "feat-739"
blocks: []
tags:
  - "recommendations"
  - "admin"
---

## Problem

The editorial list exists only as reviewed files. Import it as a separate saved
content-only generation so existing Admin comparison and A/B tools can select it.

## Entry Points — Read These First

1. `docs/recommendations/editorial-2026-10-19/recommendations.json`
2. `apps/admin/src/services/recommendations/precomputed/contract.ts`
3. `apps/admin/src/services/recommendations/precomputed/watch-reader.ts`
4. `apps/admin/src/services/recommendations/precomputed/visit-admission.ts`
5. `docs/operations/precomputed-catalog-build.md`

## Grep These

`submitPrecomputedRecommendation`, `validatePrecomputedChoices`,
`configurePrivatePrecomputedExperiment`, `observed_fenced`.

## What To Build

A dry-run-first importer that validates editorial artifacts against the existing
producer contract, records omissions and source evidence flags, and resumes an
immutable new generation through the deployed authenticated ingest endpoint.
Use metadata evidence honestly; no new model generation or fabricated receipts.
Make the completed generation visible to existing comparison/A/B selectors.

## Constraints

Preserve existing generation IDs, checkpoints, incumbent serving, and public
experiment controls. No schema changes, direct SQL writes, production code
deployment, or public A/B activation. Preserve existing canonical identity and
parent/chapter added-value validation. Keep unresolved evidence sources empty
with explicit reasons; do not silently substitute new editorial choices.

## Verification

Unit tests for transformation, omission/reranking, errors, replay and completion.
Run a read-only production preflight before importing. Reconcile persisted source
and link counts, generation status, and unchanged public controls. Run scoped
lint/typecheck, formatting and relevant existing contract/reader tests.

## Outcome

Imported `editorial-catalog-20261019-v1` through the deployed authenticated
producer endpoint. PostgreSQL confirms status complete, 1,031 source rows and
6,147 links: 1,017 six-choice sources, nine five-choice sources after canonical
identity rejection, and five empty rows for unresolved source evidence. The
original 6,186-link review artifact is preserved. No missing targets/self-links
were found, and public controls are unchanged. No A/B experiment was activated.

Artifacts: `docs/recommendations/editorial-2026-10-19/import-preflight.json` and
`import-receipt.json`. Runbook: `docs/operations/editorial-recommendation-import.md`.
Verification: 32 focused tests passed (including native PostgreSQL producer and
HTTP lifecycle tests), scoped TypeScript check and touched-file ESLint passed.
No production code deployment or schema change was required.
