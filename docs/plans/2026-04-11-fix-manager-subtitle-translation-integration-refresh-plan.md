---
title: "fix: Refresh manager subtitle translation integration on current main"
type: fix
status: active
date: 2026-04-11
origin: docs/brainstorms/2026-04-11-manager-transcript-stage-drift-brainstorm.md
supersedes:
  - /docs/plans/2026-03-28-002-feat-subtitle-translation-pipeline-plan.md
roadmap:
  - /docs/roadmap/media-generation/feat-031-ai-video-enrichment-pipeline.md
---

# fix: Refresh manager subtitle translation integration on current main

## Overview

This plan supersedes the March 28 subtitle-translation plan.

The March plan was written while the split-brain subtitle pipeline was still
being designed. Current main is now in a different reality:

- the core subtitle pipeline has landed
- the implementation shape changed in a few important places
- the manager job read model and operator UI evolved around it
- downstream `mux_upload` became a real durable phase
- a few stale assumptions and imported UI labels survived long after the code
  moved on

So this is not a “build the subtitle pipeline” plan. It is an **integration
refresh** plan:

1. audit the March 28 items against current main
2. preserve what landed
3. mark obsolete assumptions clearly
4. identify what is still missing
5. define the remaining hardening work with red/green TDD and a real user smoke
   test

## Found Brainstorm

Found brainstorm from 2026-04-11: `manager-transcript-stage-drift`. Using it as
context for planning.

## Problem Statement

The March 28 plan is no longer a safe source of execution truth because it
mixes three different states:

- things that really landed
- things that landed in a different shape
- things that became obsolete after later manager work
- things that are still missing and should remain on the board

That drift matters because the manager operator surface still contains some of
the old vocabulary:

- `structured_transcript`
- `subtitle_post_process`

Those names are not live runtime stages in current Forge. Meanwhile, genuinely
live behavior like `languageResults`, same-language no-op artifacts, and
downstream `mux_upload` state already exists and should be treated as part of
the current contract.

Without a superseding plan, future work risks rebuilding already-landed pieces
or preserving wording that no longer matches the real system.

## Status Legend

- **already landed**: current main implements this in the intended behavior and
  shape closely enough that it should be treated as done
- **landed but changed shape**: current main implements the behavior, but the
  plumbing, boundaries, or supporting contract differ materially from the March
  plan
- **still missing**: current main does not yet satisfy the integration or
  operator-truth requirement
- **obsolete**: the March item or assumption is no longer the right thing to
  build or preserve

## Entry Points — Read These First

1. `apps/manager/src/services/subtitleTranslation/index.ts`
2. `apps/manager/src/services/subtitleTranslation/chunker.ts`
3. `apps/manager/src/services/subtitleTranslation/translator.ts`
4. `apps/manager/src/services/subtitleTranslation/retimer.ts`
5. `apps/manager/src/services/subtitleTranslation/types.ts`
6. `apps/manager/src/services/subtitleTranslation/languageConfig.ts`
7. `apps/manager/src/lib/vtt.ts`
8. `apps/manager/src/workflows/videoEnrichment.ts`
9. `apps/manager/src/lib/state.ts`
10. `apps/manager/src/types/job.ts`
11. `apps/manager/src/lib/workflow-steps.ts`
12. `apps/manager/src/features/jobs/live-job-steps-table.tsx`
13. `docs/plans/2026-03-28-002-feat-subtitle-translation-pipeline-plan.md`
14. `docs/plans/2026-04-08-fix-manager-subtitle-retiming-structured-output-plan.md`
15. `docs/plans/2026-04-09-feat-mux-sync-for-enrichment-outputs-plan.md`
16. `docs/solutions/integration-issues/manager-job-read-model-source-language-metadata-20260409.md`
17. `docs/solutions/integration-issues/manager-mux-subtitle-override-recovery-non-destructive-replacement-20260410.md`
18. `docs/brainstorms/2026-04-11-manager-transcript-stage-drift-brainstorm.md`

## Grep These

- `structured_transcript|subtitle_post_process` in `apps/manager/src`
- `languageResults|TranslationLanguageResult` in `apps/manager/src`
- `translateSubtitles|writeNoOpTranslationArtifacts` in `apps/manager/src`
- `mux_upload|muxSync` in `apps/manager/src`
- `createStructuredOpenrouterOutput|DEFAULT_MODEL` in `apps/manager/src`
- `translation-{lang}|subtitles-{lang}` in `apps/manager/src`

## March 28 Item Audit

### A. Core Architecture And Assumptions

| March 28 item | Status | Current-main note |
| --- | --- | --- |
| Replace full-text translation with a 3-phase split-brain subtitle pipeline | **already landed** | `apps/manager/src/services/subtitleTranslation/index.ts` orchestrates chunking, translation, retiming, and artifact writes. |
| Produce timed translated VTT per target language | **already landed** | `subtitles-{lang}.vtt` artifacts are written from the live pipeline. |
| Produce full translated text alongside subtitle output | **already landed** | `translation-{lang}.json` artifacts are written for completed languages. |
| Read transcript segments from artifact storage instead of passing translated text through workflow context | **already landed** | The live orchestrator reads the stored `transcript` artifact directly. |
| Use a single `src/services/subtitleTranslation.ts` service file | **landed but changed shape** | Current main uses a module directory: `index.ts`, `chunker.ts`, `translator.ts`, `retimer.ts`, `types.ts`, and language-config helpers. |
| Keep subtitle translation inside the enrichment workflow rather than a separate system | **already landed** | `videoEnrichment.ts` runs translation as the live `translation` step. |
| The core pipeline still needs to be built | **obsolete** | The core pipeline has already landed on current main. |
| `structured_transcript` / `subtitle_post_process` describe real live stages in Forge | **obsolete** | Current CMS enum and workflow graph do not implement those stages. |

### B. Deferred Question Resolutions From March

| March 28 item | Status | Current-main note |
| --- | --- | --- |
| Gemini 2.5 Flash as the default translation/retiming model | **already landed** | `DEFAULT_MODEL` is `google/gemini-2.5-flash` in `apps/manager/src/services/openrouter.ts`. |
| Algorithmic chunking with a 3-5 segment target size | **already landed** | `chunker.ts` implements algorithmic grouping with tests. |
| One correction retry for invalid retiming output | **already landed** | `retimer.ts` preserves the single retry plus deterministic fallback contract. |
| `p-limit(10)` concurrency for per-language fan-out | **already landed** | `index.ts` uses `pLimit(10)` for translation fan-out. |
| Include `NOTE` metadata headers in generated VTT | **already landed** | `lib/vtt.ts` emits `NOTE language`, `NOTE source`, and `NOTE generated`. |
| JSON config files for per-language prompt/glossary customization | **already landed** | `languageConfig.ts` loads config, and `src/config/languages/ja.json` exists. |
| Structured glossary injection into the translation prompt | **already landed** | `translator.ts` appends glossary instructions into the system prompt. |
| Cost estimate of roughly `$0.50` per video at 50 languages | **obsolete** | This is a historical estimate, not a verified current-main acceptance criterion. Provider/cost validation belongs with later QA and provider-comparison work. |

### C. March Implementation Phases

| March 28 item | Status | Current-main note |
| --- | --- | --- |
| Extract VTT helpers into `src/lib/vtt.ts` | **already landed** | `apps/manager/src/lib/vtt.ts` exists with direct tests. |
| Create `subtitleTranslation/types.ts` | **already landed** | The shared subtitle-translation types live there now. |
| Create language config directory and loader | **already landed** | `src/config/languages/` plus `languageConfig.ts` and tests are present. |
| Build chunker service and chunker tests | **already landed** | `chunker.ts` and `chunker.test.ts` exist. |
| Build translator service with glossary/custom prompt injection | **already landed** | `translator.ts` exists and uses both config inputs. |
| Add translator regression tests | **still missing** | There is no dedicated `apps/manager/src/services/subtitleTranslation/translator.test.ts`. |
| Build retimer with validation, retry, and deterministic fallback | **already landed** | `retimer.ts` plus `retimer.test.ts` cover the live behavior. |
| Use `parseLLMJson` as the retimer JSON boundary | **obsolete** | Retiming now uses the shared structured-output helper; later hardening intentionally removed the ad hoc path. |
| Keep the retimer-specific behavior while migrating to structured output | **landed but changed shape** | The behavior survived, but the provider boundary moved into `createStructuredOpenrouterOutput(...)`. |
| Create the subtitle orchestrator and fan out per language | **already landed** | `index.ts` does the fan-out and artifact writes. |
| Add `p-limit` dependency for concurrency control | **already landed** | The orchestrator imports and uses `p-limit`. |
| Write per-language VTT plus JSON artifacts | **already landed** | Completed language results include both artifact keys. |
| Isolate per-language failures so one target does not block others | **already landed** | `LanguageResult[]` captures success/failure per target. |
| Replace the old `services/translation.ts` path | **already landed** | The old `services/translation.ts` file is gone from current main. |
| Add `languageResults` to state as follow-up work | **obsolete** | `languageResults` is already persisted, normalized, and rendered. |
| Use a distinct state refactor in `state.ts` to model partial success | **landed but changed shape** | Partial success now flows through `JobStepDetails`, workflow projections, and read-model normalization rather than a standalone state redesign. |
| Ensure local and S3 artifact writes remain safe under concurrency | **already landed** | Current artifact writes work with the live fan-out path and existing storage boundaries. |

### D. March Acceptance Criteria And Quality Gates

| March 28 item | Status | Current-main note |
| --- | --- | --- |
| Chunk into 3-5 segment thought blocks at sentence boundaries | **already landed** | Backed by `chunker.ts` and tests. |
| Creative translation remains plain-text and unconstrained by subtitle formatting | **already landed** | `translator.ts` explicitly instructs the model not to worry about timing or formatting. |
| Retiming redistributes translated text across original time windows | **already landed** | `retimer.ts` validates output inside the chunk window. |
| Dynamic merge/split behavior for language geometry | **already landed** | The live retimer plus deterministic fallback implement this behavior. |
| Max subtitle slot duration around 7 seconds | **already landed** | `retimer.ts` enforces the 7-second bound. |
| Retry invalid retiming output once with explicit feedback | **already landed** | Covered in `retimer.ts` and tests. |
| Deterministic fallback always produces valid timing | **already landed** | Covered in `retimer.test.ts`. |
| One `subtitles-{lang}.vtt` artifact per completed target language | **already landed** | Live manifest and storage writes reflect this. |
| One `translation-{lang}.json` artifact per completed target language | **already landed** | Live manifest and storage writes reflect this. |
| Multi-language fan-out with a 10-language concurrency cap | **already landed** | This is the current implementation shape. |
| `languageResults` tracked in durable job state | **already landed** | Workflow, read model, and UI all use it now. |
| Chunker, retimer, and VTT helper tests exist | **already landed** | `chunker.test.ts`, `retimer.test.ts`, and `vtt.test.ts` exist. |
| Integration test for the pipeline with mocked LLM behavior | **already landed** | `index.test.ts` and `videoEnrichment.test.ts` cover the live integration seams. |
| Edge-case tests for empty segments, long segments, and awkward chunk boundaries | **already landed** | Covered in the existing subtitleTranslation and VTT tests. |
| Glossary terms are injected and proven “respected” in quality validation | **landed but changed shape** | Prompt injection is implemented, but stronger quality proof belongs to follow-on QA/prompt-tuning work. |
| Pipeline cost stays under a March-era estimate | **obsolete** | Cost benchmarking is not the right acceptance gate for this integration refresh. |
| “No blank screens” is proven end to end on the operator surface | **still missing** | The pipeline aims to prevent this, but the current repo still lacks the requested real user smoke proof on the manager job page. |

## Current-Main Additions Since March

These were not first-class parts of the March plan, but they are now part of
the live integration contract and must be preserved by any implementation work.

| Current-main item | Status | Why it matters |
| --- | --- | --- |
| Same-language translation requests write no-op artifacts instead of looking empty | **already landed** | Operators need a truthful artifact trail when source and target match. |
| Source-language truth is promoted from materialization into the top-level job read model | **already landed** | Operators can see what language was actually used without spelunking nested artifacts. |
| `mux_upload` is a real downstream durable phase with sync/skip/override meaning | **already landed** | Subtitle work no longer ends at artifact creation. |
| Manager job detail UI still carries stale legacy step descriptions | **still missing** | This is the main operator-truth gap left open on current main. |

## What This Superseding Plan Should Actually Deliver

The remaining work is narrow and integration-focused:

1. remove or quarantine stale legacy step vocabulary so the operator UI only
   describes real current-main workflow stages
2. preserve and explicitly test the live translation contract:
   - partial success
   - all-fail
   - same-language no-op
   - durable `languageResults`
3. preserve operator-visible separation between translation results and
   downstream `mux_upload` state
4. add the missing targeted regression tests and a real user smoke test
5. document the post-March reality clearly enough that future work starts from
   current main instead of re-reading branch archaeology

## Proposed Solution

Treat the March plan as historical context and use this refresh as the new
execution source of truth.

### 1. Preserve the live pipeline, not the March file structure

The live subtitle pipeline already works. The refresh should not rebuild it or
collapse it back into an older shape. It should keep:

- the module split under `src/services/subtitleTranslation/`
- the current workflow boundary in `videoEnrichment.ts`
- the current read-model projection for `languageResults`
- the current storage artifact shape

### 2. Make operator truth a first-class acceptance bar

The new plan should explicitly require that the manager job detail page tell the
truth about:

- what steps actually run
- which target languages succeeded or failed
- whether a same-language request produced a no-op artifact set
- what happened in downstream `mux_upload`

### 3. Remove stale UI/type drift without widening scope

This refresh should not invent a Loom-style normalized transcript stage. It
should either:

- remove `structured_transcript` / `subtitle_post_process` from current
  operator-facing behavior, or
- quarantine them as legacy labels for historical jobs only

### 4. Treat Mux sync as adjacent, not swallowed

`mux_upload` is a real phase today, but it stays its own contract. This refresh
should prove that the operator can see it alongside translation results without
folding sync state into translation state.

## Red/Green TDD Units

- [ ] **Unit 1: Audit and correct live step vocabulary**

  **Goal:** Make the current job-step surface match the actual Forge workflow
  graph.

  **Files:**
  - Modify: `apps/manager/src/types/job.ts`
  - Modify: `apps/manager/src/lib/workflow-steps.ts`
  - Modify: `apps/manager/src/features/jobs/live-job-steps-table.tsx`
  - Modify: `apps/manager/src/lib/workflow-steps.test.ts`
  - Add: `apps/manager/src/features/jobs/live-job-steps-table.test.tsx`

  **Red**
  - Add a failing test proving current Forge jobs only build the live step list:
    `transcription`, `translation`, `chapters`, `metadata`, `embeddings`,
    `mux_upload`
  - Add a failing UI test proving legacy names do not render misleading
    normalized-transcript or subtitle-post-process copy

  **Green**
  - Keep any compatibility-only legacy handling narrow
  - Render truthful copy for live steps

- [ ] **Unit 2: Lock the live translation contract**

  **Goal:** Treat current-main translation behavior as a stable integration
  contract rather than a loose implementation detail.

  **Files:**
  - Modify: `apps/manager/src/services/subtitleTranslation/index.test.ts`
  - Modify: `apps/manager/src/workflows/videoEnrichment.test.ts`
  - Modify: `apps/manager/src/lib/state.test.ts`

  **Red**
  - Add failing tests for:
    - partial success with per-language failure details
    - all-target failure
    - same-language no-op artifact writes
    - `languageResults` read-model normalization

  **Green**
  - Keep `LanguageResult[]` as the single source of truth
  - Keep artifact-manifest and step-detail projection in sync

- [ ] **Unit 3: Cover the untested prompt/config seam**

  **Goal:** Close the most obvious missing regression coverage in the live
  pipeline.

  **Files:**
  - Modify: `apps/manager/src/services/subtitleTranslation/translator.ts`
  - Add: `apps/manager/src/services/subtitleTranslation/translator.test.ts`

  **Red**
  - Add failing tests for glossary injection
  - Add failing tests for custom prompt inclusion
  - Add failing tests that the creative-translation phase stays plain-text and
    unconstrained by timing instructions

  **Green**
  - Keep prompt construction deterministic and small

- [ ] **Unit 4: Prove the operator page matches the data model**

  **Goal:** Ensure the manager UI reflects translation results and `mux_upload`
  status honestly.

  **Files:**
  - Modify: `apps/manager/src/features/jobs/live-job-steps-table.tsx`
  - Add: `apps/manager/src/features/jobs/live-job-steps-table.test.tsx`
  - Reuse: `apps/manager/src/features/jobs/mux-sync-presenter.test.ts`

  **Red**
  - Add a failing UI test that renders:
    - a partial-success translation step
    - visible `languageResults`
    - visible `mux_upload` comparison state
  - Add a failing UI test for same-language no-op output so the page does not
    present it as missing work

  **Green**
  - Keep translation and Mux sync as separate but visible operator truths
  - Keep Mux state sourced from the persisted `muxSync` artifact report

## User Smoke Test

The implementing PR must include a real user smoke test on a running manager UI
after the red/green units are green.

### Required scenario

Open a real job detail page that shows:

- the live step graph only
- a translation row with visible `languageResults`
- a visible `mux_upload` row or comparison state

### Minimum smoke matrix

1. **Same-language no-op job**
   - confirm the page shows completed translation output and artifact presence
   - confirm it does not look like a skipped or missing translation

2. **Cross-language job**
   - confirm at least one translated subtitle artifact is visible
   - confirm the related `mux_upload` status is visible next to that outcome

### Smoke acceptance

- no fake normalized-transcript stage appears in current operator-facing copy
- partial success and no-op states are readable
- translation and `mux_upload` remain separate but both visible

## Acceptance Criteria

### Functional

- [ ] The superseding plan clearly marks each substantive March 28 item as:
      `already landed`, `landed but changed shape`, `still missing`, or
      `obsolete`
- [ ] The current-main execution baseline is documented with exact file paths
- [ ] Stale `structured_transcript` / `subtitle_post_process` live-stage wording
      is either removed or explicitly quarantined as legacy-only
- [ ] The live translation contract explicitly covers:
      - partial success
      - all-fail
      - same-language no-op artifacts
      - durable `languageResults`
- [ ] The plan treats `mux_upload` as a real downstream phase without absorbing
      its logic into translation

### Quality Gates

- [ ] Red/green TDD units are defined for the remaining work
- [ ] A real user smoke test is required, not optional
- [ ] Verification includes manager test, typecheck, lint, and UI truth checks

## Scope Boundaries

In scope:

- manager subtitle translation integration truth
- job-step vocabulary drift
- operator-page truth around `languageResults` and `mux_upload`
- targeted regression tests
- plan/doc refresh

Out of scope:

- provider benchmarking in `feat-049`
- production QA-set expansion in `feat-048`
- speaker attribution in `feat-050`
- full-content translation in `feat-065`
- CMS sync redesign
- a brand-new normalized transcript workflow stage

## Branch And PR Workflow

Follow repo workflow rules from `CLAUDE.md`, `AGENTS.md`, and
`.claude/commands/pr.md`.

- Suggested branch: `fix/manager-subtitle-integration-refresh`
- Keep the PR scoped to manager + directly related docs/tests
- Use conventional commits
- Target `main`
- Expect squash merge
- Do not use `--no-verify`
- In the PR description, call out:
  - what from March was already landed
  - what changed shape
  - what was intentionally marked obsolete
  - what still missing work was implemented
  - the user smoke test result

## Verification

### Automated

- `pnpm --filter @forge/manager test -- src/lib/workflow-steps.test.ts src/lib/vtt.test.ts src/lib/state.test.ts src/services/subtitleTranslation/index.test.ts src/services/subtitleTranslation/chunker.test.ts src/services/subtitleTranslation/retimer.test.ts src/services/subtitleTranslation/languageConfig.test.ts src/services/subtitleTranslation/translator.test.ts src/workflows/videoEnrichment.test.ts src/features/jobs/live-job-steps-table.test.tsx src/features/jobs/mux-sync-presenter.test.ts`
- `pnpm --filter @forge/manager typecheck`
- `pnpm --filter @forge/manager lint`
- `rg -n "structured_transcript|subtitle_post_process" apps/manager/src`

### Manual

- Run the manager app locally
- Open the job detail page used for smoke verification
- Confirm only real current-main steps are described as live behavior
- Confirm translation details and `mux_upload` state are both visible

## Related Work And References

- `docs/plans/2026-03-28-002-feat-subtitle-translation-pipeline-plan.md`
- `docs/plans/2026-04-08-fix-manager-subtitle-retiming-structured-output-plan.md`
- `docs/plans/2026-04-09-feat-mux-sync-for-enrichment-outputs-plan.md`
- `docs/plans/2026-04-04-feat-source-language-priority-for-enrichment-plan.md`
- `docs/plans/2026-04-02-fix-manager-job-artifact-links-plan.md`
- `docs/solutions/integration-issues/manager-job-read-model-source-language-metadata-20260409.md`
- `docs/solutions/integration-issues/manager-mux-subtitle-override-recovery-non-destructive-replacement-20260410.md`
- `docs/solutions/platform/videoforge-manager-integration.md`
- `docs/roadmap/media-generation/feat-031-ai-video-enrichment-pipeline.md`
- `docs/roadmap/media-generation/feat-048-production-transcription-qa-and-prompt-tuning.md`
- `docs/roadmap/media-generation/feat-049-alternative-transcription-and-translation-models.md`
- `docs/roadmap/media-generation/feat-050-speaker-attribution-for-subtitles.md`
- `docs/roadmap/media-generation/feat-065-full-content-translation.md`
