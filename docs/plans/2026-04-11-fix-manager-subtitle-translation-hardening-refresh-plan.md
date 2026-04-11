---
title: "fix: Refresh manager subtitle translation hardening on current main"
type: fix
status: active
date: 2026-04-11
origin: docs/brainstorms/2026-04-11-manager-transcript-stage-drift-brainstorm.md
roadmap:
  - /docs/roadmap/media-generation/feat-031-ai-video-enrichment-pipeline.md
---

# fix: Refresh manager subtitle translation hardening on current main

## Overview

Refresh the March subtitle-translation plan so it matches the manager that
exists on current main, then use that refreshed plan to finish the quality work
that is still missing:

- remove or quarantine stale `structured_transcript` /
  `subtitle_post_process` operator vocabulary
- align acceptance criteria with the live translation + `mux_upload` graph
- add the highest-value red/green tests around `languageResults`, partial
  success, same-language no-op output, and prompt/config behavior
- prove the operator surface tells the truth about translation results and
  downstream Mux sync state

This is a hardening refresh, not a greenfield subtitle feature and not a plan
to revive a normalized-transcript stage.

## Problem Frame

The March 28 subtitle plan was directionally right, but it is now partially
stale:

- the split-brain subtitle pipeline is already live in
  `apps/manager/src/services/subtitleTranslation/`
- retiming already uses the shared structured-output boundary
- `languageResults` are already persisted and surfaced through the workflow/read
  model
- `mux_upload` is now a real downstream phase with operator-visible state

At the same time, current main still has truth drift in the operator surface:

- `apps/manager/src/types/job.ts` still carries imported VideoForge step names
  that do not run in Forge
- `apps/manager/src/features/jobs/live-job-steps-table.tsx` still describes
  nonexistent `structured_transcript` and `subtitle_post_process` stages as if
  they are current runtime behavior
- the existing tests do not fully lock down the highest-risk behavior for the
  translation step and its operator-facing readout

If we implement from the old plan without refreshing it, we risk shipping a PR
that is internally inconsistent with current main.

## Entry Points — Read These First

1. `apps/manager/src/services/subtitleTranslation/index.ts`
   - live subtitle pipeline orchestration, including per-language fan-out,
     same-language no-op artifacts, and all-fail behavior
2. `apps/manager/src/services/subtitleTranslation/translator.ts`
   - plain-text translation prompt assembly; currently under-tested
3. `apps/manager/src/services/subtitleTranslation/retimer.ts`
   - structured-output retiming, retry/correction loop, deterministic fallback
4. `apps/manager/src/workflows/videoEnrichment.ts`
   - translation step persistence, artifact manifest projection, and
     downstream `mux_upload`
5. `apps/manager/src/types/job.ts`
   - `WorkflowStepName`, `JobStepDetails`, `TranslationLanguageResult`,
     `MuxSyncComparison`
6. `apps/manager/src/lib/workflow-steps.ts`
   - current live step list used to build job steps
7. `apps/manager/src/lib/state.ts`
   - read-model normalization for `details.languageResults`
8. `apps/manager/src/features/jobs/live-job-steps-table.tsx`
   - operator-facing copy and rendering for translation and Mux sync state
9. `docs/brainstorms/2026-04-11-manager-transcript-stage-drift-brainstorm.md`
   - source-of-truth brainstorm for the stale-step-name cleanup decision
10. `docs/solutions/integration-issues/manager-job-read-model-source-language-metadata-20260409.md`
    - precedent for promoting operator-visible truth into the read model
11. `docs/solutions/integration-issues/manager-mux-subtitle-override-recovery-non-destructive-replacement-20260410.md`
    - confirms `mux_upload` is now a real recovery-sensitive operator phase
12. `docs/plans/2026-04-09-feat-mux-sync-for-enrichment-outputs-plan.md`
    - defines the current downstream Mux sync contract that this plan must
      reference, not replace

## Grep These

- `structured_transcript|subtitle_post_process` in `apps/manager/src`
- `languageResults|TranslationLanguageResult` in `apps/manager/src`
- `translateSubtitles|writeNoOpTranslationArtifacts` in `apps/manager/src`
- `getTranslationArtifactManifest|getTranslationStepDetails` in
  `apps/manager/src`
- `mux_upload|muxSync` in `apps/manager/src`
- `createStructuredOpenrouterOutput` in `apps/manager/src/services`

## Requirements Trace

- R1. The refreshed plan must treat current main as the implementation baseline.
  It must not describe subtitle translation as missing or future work.
- R2. Operator-facing step names and descriptions must not imply live
  `structured_transcript` or `subtitle_post_process` runtime stages.
- R3. The translation contract must explicitly cover:
  - partial success across target languages
  - all-target failure
  - same-language no-op translation output
  - durable `languageResults`
  - artifact manifest truth for completed languages only
- R4. The read model and job detail UI must present translation results and
  downstream `mux_upload` state truthfully without inventing extra workflow
  stages.
- R5. The implementation must use red/green TDD for each unit of work.
- R6. The implementing PR must include a real user smoke test on the running
  manager UI.
- R7. The work must stay inside the manager + docs scope and must not broaden
  into provider benchmarking, speaker attribution, full-content translation, or
  a new normalized-transcript feature.

## Scope Boundaries

In scope:

- manager job step vocabulary cleanup or quarantine
- translation-step contract hardening on current main
- targeted tests for pipeline behavior, read-model hydration, and operator UI
- job-detail truthfulness for translation + existing Mux sync state
- plan and doc refresh so future work starts from the live system

Out of scope:

- re-architecting the subtitle pipeline
- changing the CMS job-step enum to add new subtitle stages
- provider comparison work in `feat-049`
- production QA-set expansion in `feat-048`
- speaker-attribution work in `feat-050`
- full-content translation work in `feat-065`
- redesigning Mux subtitle override internals beyond referencing the current
  `mux_upload` contract

## Current-Main Reality

### What already exists

- `translateSubtitles(...)` already:
  - reads the transcript artifact from storage
  - chunks once
  - fans out across target languages with bounded concurrency
  - writes `subtitles-{lang}.vtt` and `translation-{lang}.json`
  - writes same-language no-op artifacts when source and target match
- `videoEnrichment.ts` already persists `languageResults` on the translation
  step and runs `mux_upload` as a real downstream step
- `state.ts` already normalizes `languageResults` from persisted job details
- retiming already uses `createStructuredOpenrouterOutput(...)` and should not
  be reworked back toward manual JSON parsing

### What is stale

- `apps/manager/src/types/job.ts` still exposes imported legacy names in
  `WorkflowStepName`
- `apps/manager/src/features/jobs/live-job-steps-table.tsx` still describes
  those legacy names as if they are real current steps
- the March 28 plan still says `languageResults` are not yet stored, which is
  no longer true on current main

### What still needs quality work

- explicit behavioral tests for same-language no-op and multi-language partial
  success in the workflow layer
- targeted tests for translation prompt/config assembly
- operator-surface tests so job detail copy and status rendering stay aligned
  with the live workflow graph

## Proposed Solution

Keep the live pipeline and harden the surrounding contract.

### 1. Separate live workflow truth from legacy compatibility

The current plan should prefer truthful live vocabulary while still allowing
historical compatibility where needed. The likely shape is:

- keep a live step list for current Forge jobs
- keep legacy imported names only as compatibility inputs if old jobs can still
  surface them
- render any legacy step names with neutral archival copy, not with a false
  description of active current-main behavior

### 2. Treat `languageResults` and no-op artifacts as first-class operator truth

The refreshed plan should stop talking about `languageResults` as future work
and instead preserve them as part of the translation contract. That includes:

- translation step details are durable and normalized through the read model
- same-language no-op output still produces artifacts and a completed language
  result
- partial success means:
  - completed step if at least one target language succeeded
  - failed step only when every target language failed

### 3. Reference `mux_upload` as a real downstream phase

This refresh should not redesign Mux sync, but it must acknowledge that
subtitle translation no longer ends at artifact generation. The job detail UI
must let operators see translation results and current `mux_upload` state
together without implying that translation itself owns Mux-side recovery logic.

### 4. Prefer narrow, high-value tests over broad refactors

This work should add tests where current drift is most expensive:

- pipeline contract
- prompt/config assembly
- read-model hydration
- operator-facing rendering

It should not become a catch-all cleanup across unrelated enrichment domains.

## Key Decisions And Assumptions

1. **Current main is canonical.**
   The rewrite will not preserve March assumptions that contradict current code.

2. **Legacy step names should stop reading as current runtime stages.**
   Preferred implementation: remove them from operator-facing current copy and
   keep only a narrow compatibility path for historical records if needed.

3. **`mux_upload` stays referenced, not re-specified.**
   This plan only verifies that translation results and Mux sync state are
   visible together in the operator surface.

4. **Empty target-language input is not a new product surface in this plan.**
   During implementation, confirm whether the enrich route can actually produce
   `translateTo: []`. If yes, add a small explicit guard or skipped-state rule
   in the same PR. If no, lock the invariant in tests and keep the scope narrow.

## Red/Green TDD Units

- [ ] **Unit 1: Make job-step vocabulary truthful**

  **Goal:** Stop current jobs and current UI copy from implying live
  `structured_transcript` / `subtitle_post_process` stages while preserving any
  historical compatibility that still matters.

  **Files:**
  - Modify: `apps/manager/src/types/job.ts`
  - Modify: `apps/manager/src/lib/workflow-steps.ts`
  - Modify: `apps/manager/src/features/jobs/live-job-steps-table.tsx`
  - Modify: `apps/manager/src/lib/workflow-steps.test.ts`
  - Add or modify: `apps/manager/src/features/jobs/live-job-steps-table.test.tsx`

  **Red**
  - Add a failing step-list test that asserts current Forge-created jobs include
    only the live steps:
    `transcription`, `translation`, `chapters`, `metadata`, `embeddings`,
    `mux_upload`
  - Add a failing UI test that proves legacy names do not render misleading
    current-main descriptions
  - Add a failing UI test that proves live steps still render the expected copy
    and icon treatment

  **Green**
  - Introduce a clearer distinction between live Forge steps and any
    compatibility-only legacy names
  - Update step descriptions so current operators only see truthful live-stage
    explanations
  - If legacy names must still render, label them as legacy/imported history
    rather than a live normalized-transcript pipeline

  **Refactor**
  - Centralize step metadata so step names, descriptions, and icons do not
    drift separately

- [ ] **Unit 2: Lock the subtitle-translation pipeline contract**

  **Goal:** Make the current-main behavior around partial success, all-fail,
  and same-language no-op explicit in tests and workflow projections.

  **Files:**
  - Modify: `apps/manager/src/services/subtitleTranslation/index.ts`
  - Modify: `apps/manager/src/services/subtitleTranslation/index.test.ts`
  - Modify: `apps/manager/src/workflows/videoEnrichment.ts`
  - Modify: `apps/manager/src/workflows/videoEnrichment.test.ts`
  - Modify: `apps/manager/src/lib/state.ts`
  - Modify: `apps/manager/src/lib/state.test.ts`

  **Red**
  - Add a failing workflow test for partial-success translation:
    - one target completes
    - one target fails
    - step remains completed
    - artifact manifest includes only completed language artifacts
    - `details.languageResults` persists both outcomes
  - Add a failing workflow test for all-target failure:
    - translation step fails
    - language-level errors are preserved for operator inspection
  - Add a failing pipeline test for same-language no-op:
    - translator and retimer are not called
    - both subtitle and translation artifacts are still written
    - result is marked completed with source-equals-target semantics
  - Add a failing read-model test proving `languageResults` survive round-trip
    normalization for the translation step

  **Green**
  - Keep `translateSubtitles(...)` as the source of truth for language-level
    outcomes
  - Keep `videoEnrichment.ts` deriving artifact manifest entries and step
    details from the same `LanguageResult[]`
  - Ensure same-language no-op output remains visible and operator-legible
    rather than looking like a missing translation

  **Refactor**
  - Extract or tighten any shared helper that derives translation manifest
    entries and step details so future changes cannot update one without the
    other

- [ ] **Unit 3: Add prompt/config regression coverage for translation**

  **Goal:** Close the most obvious untested path in the subtitle pipeline
  without broadening into provider-benchmark work.

  **Files:**
  - Modify: `apps/manager/src/services/subtitleTranslation/translator.ts`
  - Add: `apps/manager/src/services/subtitleTranslation/translator.test.ts`
  - Reuse: `apps/manager/src/services/subtitleTranslation/languageConfig.test.ts`

  **Red**
  - Add a failing translator test for glossary injection
  - Add a failing translator test for custom prompt inclusion
  - Add a failing translator test proving the prompt remains plain-text and does
    not reintroduce timing/format instructions into the creative-translation
    phase

  **Green**
  - Keep prompt assembly deterministic and small
  - Keep raw chat completion usage here, because this is intentionally
    plain-text generation rather than JSON-shaped output

  **Refactor**
  - If needed, extract prompt construction into a small exported helper to make
    tests focused and stable

- [ ] **Unit 4: Prove the operator surface tells the truth**

  **Goal:** Ensure the job-detail surface reflects current-main translation and
  downstream sync reality.

  **Files:**
  - Modify: `apps/manager/src/features/jobs/live-job-steps-table.tsx`
  - Add or modify: `apps/manager/src/features/jobs/live-job-steps-table.test.tsx`
  - Reuse: `apps/manager/src/features/jobs/mux-sync-presenter.test.ts`

  **Red**
  - Add a failing UI test that renders a completed job with:
    - a partial-success translation step
    - failed language details from `languageResults`
    - a `mux_upload` comparison report
  - Assert the page shows:
    - truthful translation step description
    - per-language failure details
    - current Mux sync state next to the related subtitle artifact
  - Add a failing UI test for same-language no-op output so operators do not
    mistake it for missing work

  **Green**
  - Render translation and Mux sync state in a way that matches existing
    workflow/read-model truth
  - Keep Mux sync presentation sourced from the persisted `muxSync` artifact
    report rather than ad hoc recomputation in the component

  **Refactor**
  - Prefer small presenter/helpers over burying artifact interpretation inline
    in the table component

## User Smoke Test

The implementing PR must include one real operator smoke pass on a running
manager UI after tests are green.

### Required smoke scenario

Use a local or non-production-safe job that exercises:

- a completed translation step with at least one target language
- visible `languageResults` on the translation row
- visible `mux_upload` state on the same job detail page

### Preferred smoke matrix

1. **Same-language no-op case**
   - source language equals one requested target language
   - confirm the job detail page shows completed translation output rather than
     looking empty or failed

2. **Cross-language case**
   - at least one translated subtitle artifact exists
   - confirm the job detail page shows the related Mux sync state for that
     artifact

### Smoke acceptance

- only live current-main steps are described as active workflow behavior
- no fake normalized-transcript stage appears in operator-facing copy
- translation failure or no-op details are legible from the job detail page
- Mux sync status is visible without leaving the job page

## Branch And PR Workflow

Follow the repo workflow rules in `CLAUDE.md`, `AGENTS.md`, and
`.claude/commands/pr.md`.

- Suggested branch: `fix/manager-subtitle-hardening-refresh`
- Keep the PR in one scope: manager + directly related docs/tests only
- Use conventional commits
- Target `main`
- Expect squash merge
- Do not skip pre-commit hooks with `--no-verify`
- In the PR description, include:
  - the red/green test list that was run
  - the user smoke test result
  - a short note that the plan was refreshed against current main rather than
    the March branch assumptions

## Verification

### Automated

- `pnpm --filter @forge/manager test -- src/lib/workflow-steps.test.ts src/lib/state.test.ts src/services/subtitleTranslation/index.test.ts src/services/subtitleTranslation/languageConfig.test.ts src/services/subtitleTranslation/translator.test.ts src/workflows/videoEnrichment.test.ts src/features/jobs/live-job-steps-table.test.tsx src/features/jobs/mux-sync-presenter.test.ts`
- `pnpm --filter @forge/manager typecheck`
- `pnpm --filter @forge/manager lint`
- `rg -n "structured_transcript|subtitle_post_process" apps/manager/src`

### Manual

- Run the manager app locally
- Open a job detail page that exercises translation output
- Confirm only truthful live step descriptions are shown
- Confirm translation details and Mux sync state are both visible

## Risks And Non-Goals

- Do not let this turn into a full renaming/refactor across unrelated artifact
  history. Compatibility should stay as small as possible.
- Do not re-open the retimer structured-output migration. That work is already
  completed and should stay intact.
- Do not absorb `feat-048`, `feat-049`, `feat-050`, or `feat-065` into this PR.
  If this hardening work reveals bigger gaps, create a follow-up instead of
  widening the scope mid-stream.

## References

- `docs/brainstorms/2026-04-11-manager-transcript-stage-drift-brainstorm.md`
- `docs/plans/2026-03-28-002-feat-subtitle-translation-pipeline-plan.md`
- `docs/plans/2026-04-08-fix-manager-subtitle-retiming-structured-output-plan.md`
- `docs/plans/2026-04-09-feat-mux-sync-for-enrichment-outputs-plan.md`
- `docs/solutions/integration-issues/manager-job-read-model-source-language-metadata-20260409.md`
- `docs/solutions/integration-issues/manager-mux-subtitle-override-recovery-non-destructive-replacement-20260410.md`
- `docs/roadmap/media-generation/feat-031-ai-video-enrichment-pipeline.md`
- `docs/roadmap/media-generation/feat-048-production-transcription-qa-and-prompt-tuning.md`
- `docs/roadmap/media-generation/feat-049-alternative-transcription-and-translation-models.md`
- `docs/roadmap/media-generation/feat-050-speaker-attribution-for-subtitles.md`
- `docs/roadmap/media-generation/feat-065-full-content-translation.md`
