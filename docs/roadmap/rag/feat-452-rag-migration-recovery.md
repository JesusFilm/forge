---
id: "feat-452"
title: "Recover omitted RAG migration contracts"
owner: "jaco"
priority: "P0"
status: "complete"
start_date: "2026-09-04"
duration: 3
depends_on: ["feat-431", "feat-432"]
blocks: ["feat-435"]
tags: ["rag", "migration", "operations", "documentation"]
---

## Problem

The `jesusfilm-rag` migration copied the source registry and core runtime, but
left Forge metadata pointing at source-lifecycle records that were never
ported. It also omitted the accepted source-scoped raw-document promotion path
used to avoid reacquiring metered sources, and retained references to an
architecture and ADR corpus that does not exist in Forge.

## Entry Points — Read These First

1. `apps/rag/docs/source-status.yaml`, `apps/rag/docs/source-map.yaml`, and
   `JesusFilm/jesusfilm-rag/docs/slices/` — dangling lifecycle references and
   their historical source material.
2. `JesusFilm/jesusfilm-rag/scripts/copy-raws.sh`,
   `JesusFilm/jesusfilm-rag/docs/ops/copy-raws.md`, and ADR-0014 — the omitted
   metered-source promotion contract.
3. `apps/rag/src/`, `apps/rag/docs/eval-approach.md`, and
   `JesusFilm/jesusfilm-rag/docs/decisions/` — live architecture and ADR
   references requiring a Forge-local authority.
4. `docs/roadmap/rag/evidence/feat-428/` through `feat-434/` — migration
   evidence that must be described accurately without inventing production
   proof.

## Grep These

- `slice_file`
- `docs/architecture.md`
- `ADR-00`
- `copy-raws`
- `prepared locally`

## What To Build

- Restore and adapt the durable source and slice records, including the
  GotQuestions multilingual deferral and null-language evidence.
- Validate that lifecycle and documentation references resolve, and reconcile
  stale aggregate source-map claims.
- Add a Forge-safe, source-scoped local-to-production raw-document promotion
  command with explicit targets, digest verification, and tests.
- Restore or supersede architecture and accepted decision records still cited
  by the Forge implementation.
- Record the migration audit honestly: distinguish implemented behavior from
  missing historical proof, and keep the live small-source proof in
  `feat-435`.

## Constraints

- Preserve Forge's Prisma, target-profile, typed-error, import-law, and
  PR-to-main deployment conventions; do not recreate legacy implementation
  choices blindly.
- Do not run production writes or include secrets, bearer values, or corpus
  text in evidence.
- Do not mark `feat-435` complete or fabricate the pending small-source proof.

## Verification

- Every lifecycle and documentation reference introduced or retained by this
  work resolves to a tracked Forge file.
- Raw promotion rejects unsafe targets and mismatched source/digest state; its
  focused tests pass without a production connection.
- RAG tests, typecheck, lint, dependency-cruiser, status checks, dashboard
  verification, and repository formatting pass.

## Resolution

Completed in [Forge PR #2164](https://github.com/JesusFilm/forge/pull/2164).

The recovery restores the durable lifecycle, architecture, and decision records;
reconciles source planning and dashboard state; makes missing lifecycle targets a
test failure; and adds preview-pinned, source-scoped raw-document promotion with
unit and real-Postgres integration coverage. Historical proof that was never
recorded remains explicitly unclaimed, and the live small-source proof and final
retirement stay in `feat-435`.
