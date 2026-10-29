---
id: "feat-892"
title: "Recover subtitle source artifact execution"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-10-28"
duration: 2
depends_on: []
blocks: []
tags:
  - "manager"
  - "mastra"
  - "subtitle-enrichment"
---

## Problem

PR #886 head `c0e6ec751c250841b90df6fbdca2c17a9b34950d` emits prototype
success callbacks without transcription or translation artifacts. Its pending
todo 016 must be recovered using current main's real subtitle runtime, not the
retired Agentic/Strapi architecture. feat-184 already shipped translation.

## Entry Points — Read These First

1. `apps/mastra/src/services/subtitle-enrichment/source.ts` — source execution.
2. `apps/mastra/src/services/subtitle-enrichment/run.ts` — existing translation.
3. `apps/mastra/src/mastra/workflows/subtitle-enrichment.ts` — strict service route.
4. `apps/manager/src/services/mastra-subtitle-enrichment.ts` — Manager bridge.
5. `docs/plans/2026-10-28-subtitle-source-artifact-execution-recovery.md`.

## What To Build

Execute approved stored transcript/VTT reuse or real Mux subtitle acquisition
inside Mastra. Validate nonempty finite timed segments before storing or
translating. Return canonical Manager-compatible artifact keys. Extend the
existing service route compatibly and export source execution for PR #1087.

## Constraints

Manager owns canonical job state, callback admission/idempotency, and Mux
publication via its existing create-first recovery path. No Admin schema,
migration, codegen, automation-store, or PR #1087 graph edits. No paid calls,
pushes, merges, or production deployment. Root owns independent review and
operator/browser smoke of the integrated callback/publication graph.

## Verification

- `pnpm --filter @forge/mastra test -- subtitle-enrichment subtitle-translation`
  — 23 files, 162 tests pass.
- `pnpm --filter @forge/manager test -- mastra-subtitle-enrichment videoEnrichment mux-sync subtitle-lab-contract subtitleEval`
  — 11 files, 91 tests pass.
- `pnpm --filter @forge/mastra typecheck --incremental false` and
  `pnpm --filter @forge/manager typecheck` pass.
- Both package linters, changed-file Prettier and `git diff --check` pass.
- Commit with enabled hooks. Deterministic provider adapters are not live
  provider proof.

## Resolution

Completed bounded source execution and the compatible Manager service bridge on
2026-10-28. Captured two failing behavioral tests before implementation:
source-only requests were rejected and an empty stored transcript falsely
reported successful subtitles. Both now pass. Real local artifact roundtrip
and deterministic Mux generation/polling/signing tests cover execution.
Translation Lab pins now include the shared transcript validator and agree
between Mastra and Manager. Independent review and integrated operator smoke
remain with the parent recovery plan; this ticket does not mark PR886's
historical todo 016 browser/publication acceptance complete.

## PR886 review repair, round 2

Replayed the two source-acquisition repairs from `a36b9ac7a` onto the
source-only PR886 layer:

- `source-mux.ts`: wait for any matching preparing subtitle track before
  checking generation support or issuing a generation POST. Uploaded English
  and Arabic become ready with zero generation POSTs, including when an old
  generated track has errored. Wrong language/type/status tracks remain
  ineligible; uploaded and generated waits retain the acquisition deadline.
- `source.ts`: classify synchronous VTT/transcript parsing and segment
  validation separately from reads. Missing VTT headers, empty cues and invalid
  timing are `source_invalid`, `retryable: false`; read failures (including a
  storage `SyntaxError`) remain `source_failed`, `retryable: true`.

Red proof captured 10 failed tests before implementation. The local source-only
HTTP tests return 400 for invalid content and 502 for transient read failures,
without artifact writes, Mux fallback or translation. The public source API,
Admin and callbacks are unchanged. This layer keeps the source-only policy digest
`3e46dd8c3b82e3b32560d5a645c08f5b2795284e3cc997b50cc68a96dc243f62`
and its original ordered files. Provider-spend tracking and its expanded graph
pin belong to PR1087.

Historical integrated validation: source/translation/graph suite (34 files, 254
tests) and Manager caller suite (12 files, 97 tests), both package typechecks and linters,
changed-file Prettier, repository format check and `git diff --check`. Commit hooks remain enabled. No live provider request,
push, merge or deployment; parent owns the fresh independent review round.

## Local stack reconstruction, 2026-10-29

Replayed original source execution and its eight-file review repair onto
`48ad42865`, without graph/provider-spend changes. Fresh source/translation
tests: 24 files, 182 tests; Manager caller tests: 11 files, 91 tests. Both
packages pass fresh nonincremental typechecks and full linters. The frozen
filtered install ran Husky and Prisma generation. The source-only byte-pin
test passes. No dependency manifest or lockfile change belongs to this layer.
