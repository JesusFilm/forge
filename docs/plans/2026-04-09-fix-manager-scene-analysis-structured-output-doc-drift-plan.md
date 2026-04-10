---
title: "fix: Align manager scene analysis with structured output helper"
type: fix
status: completed
date: 2026-04-09
origin: docs/brainstorms/2026-04-08-manager-structured-llm-output-hardening-requirements.md
roadmap:
  - /docs/roadmap/content-discovery/feat-040-multimodal-scene-descriptions.md
  - /docs/roadmap/media-generation/feat-031-ai-video-enrichment-pipeline.md
---

# fix: Align manager scene analysis with structured output helper

## Overview

Bring [sceneAnalysis.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/services/sceneAnalysis.ts) onto the same shared `createStructuredOpenrouterOutput(...)` boundary already used by chapters, metadata, and subtitle retiming, then refresh the stale docs that now contradict the merged branch.

This cleanup is intentionally focused:

- upgrade the shared helper in [openrouter.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/services/openrouter.ts) so it can support scene analysis without a one-off code path
- migrate scene analysis off [parseLLMJson.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/lib/parseLLMJson.ts)
- remove `parseLLMJson.ts` if no runtime callers remain after the migration
- update the branch’s stale solution and plan docs so they describe the real post-merge state

**Implementation update (Apr 9, 2026):** Completed with green manager validation (`test`, `lint`, `typecheck`), no runtime `parseLLMJson` imports remaining in `apps/manager/src`, and a local browser sanity pass covering manager login plus a completed job page render.

## Problem Frame

The branch’s April 8 structured-output hardening work intentionally moved manager enrichment onto the shared helper in [openrouter.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/services/openrouter.ts) and removed [parseLLMJson.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/lib/parseLLMJson.ts). That is reflected in:

- [2026-04-08-manager-structured-llm-output-hardening-requirements.md](/Users/o/.codex/worktrees/1ec2/forge/docs/brainstorms/2026-04-08-manager-structured-llm-output-hardening-requirements.md)
- [2026-04-08-fix-manager-subtitle-retiming-structured-output-plan.md](/Users/o/.codex/worktrees/1ec2/forge/docs/plans/2026-04-08-fix-manager-subtitle-retiming-structured-output-plan.md)
- [apps/manager/CLAUDE.md](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/CLAUDE.md)
- [apps/manager/AGENTS.md](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/AGENTS.md)

After merging `origin/main`, scene analysis reintroduced a live runtime dependency on `parseLLMJson(...)`:

- [sceneAnalysis.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/services/sceneAnalysis.ts) still issues its own OpenRouter chat request and parses the response through `parseLLMJson(...)`
- [2026-04-06-001-feat-multimodal-scene-analysis-plan.md](/Users/o/.codex/worktrees/1ec2/forge/docs/plans/2026-04-06-001-feat-multimodal-scene-analysis-plan.md) still describes that older implementation as the completed state
- [videoforge-manager-integration.md](/Users/o/.codex/worktrees/1ec2/forge/docs/solutions/platform/videoforge-manager-integration.md) still says `parseLLMJson` is the shared manager JSON boundary

That leaves the branch in a split-brain state:

- most manager object-shaped LLM flows use the shared structured helper
- scene analysis uses a separate direct provider path plus a fallback parser
- branch docs now encode mutually incompatible truths

## Requirements Trace

- R1. Scene analysis must use the same shared `createStructuredOpenrouterOutput(...)` helper as the rest of manager.
- R2. The shared helper must support scene analysis’s multimodal input shape: `image_url` parts plus text in the same user message.
- R3. Scene analysis must keep its current operational behavior:
  - bad-frame retries with shifted thumbnails
  - empty-analysis fallback instead of crashing the pipeline
  - token usage accounting across attempts
- R4. Existing helper callers in chapters, metadata, and subtitle retiming must keep working without behavior regressions.
- R5. `parseLLMJson.ts` should be deleted if no runtime callers remain after the migration.
- R6. Stale docs must be refreshed so the branch no longer claims both “parseLLMJson is gone” and “parseLLMJson is the manager JSON boundary.”

## Scope Boundaries

In scope:

- [openrouter.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/services/openrouter.ts)
- [openrouter.test.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/services/openrouter.test.ts)
- [sceneAnalysis.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/services/sceneAnalysis.ts)
- [sceneAnalysis.test.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/services/sceneAnalysis.test.ts)
- deleting [parseLLMJson.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/lib/parseLLMJson.ts) and [parseLLMJson.test.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/lib/parseLLMJson.test.ts) if they become dead
- stale-doc refresh in:
  - [videoforge-manager-integration.md](/Users/o/.codex/worktrees/1ec2/forge/docs/solutions/platform/videoforge-manager-integration.md)
  - [2026-04-06-001-feat-multimodal-scene-analysis-plan.md](/Users/o/.codex/worktrees/1ec2/forge/docs/plans/2026-04-06-001-feat-multimodal-scene-analysis-plan.md)
  - [2026-04-08-fix-manager-subtitle-retiming-structured-output-plan.md](/Users/o/.codex/worktrees/1ec2/forge/docs/plans/2026-04-08-fix-manager-subtitle-retiming-structured-output-plan.md)

Out of scope:

- redesigning the scene-analysis prompt, extraction schema, or artifact format
- changing [sceneAnalysisPipeline.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/workflows/sceneAnalysisPipeline.ts) or [route.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/app/api/scene-analysis/route.ts) beyond any tiny mechanical updates required by the service migration
- reworking chapters, metadata, or retimer semantics beyond compatibility verification
- new UI work or new roadmap features

## Context & Research

### Found Brainstorm

Found brainstorm from 2026-04-08: [manager-structured-llm-output-hardening-requirements.md](/Users/o/.codex/worktrees/1ec2/forge/docs/brainstorms/2026-04-08-manager-structured-llm-output-hardening-requirements.md). Using that as planning context.

Key decisions already made there:

- manager object-shaped LLM requests should converge on the shared helper
- retry/fallback behavior should be preserved rather than redesigned
- dead JSON helpers should be removed once there are no runtime callers

### Relevant Code and Patterns

- [openrouter.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/services/openrouter.ts)
  - currently owns the shared structured-output boundary
  - currently assumes string-only message content
  - currently returns parsed data only, with no usage callback or metadata hook
- [sceneAnalysis.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/services/sceneAnalysis.ts)
  - already uses `response_format: { type: "json_schema" }`
  - still makes a direct provider call and then parses with `parseLLMJson(...)`
  - needs multimodal message content and usage accounting
- [sceneAnalysis.test.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/services/sceneAnalysis.test.ts)
  - currently mocks `getOpenrouter().chat.completions.create(...)`
  - should move up one abstraction layer once scene analysis uses the shared helper
- [chapters.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/services/chapters.ts), [metadata.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/services/metadata.ts), and [retimer.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/services/subtitleTranslation/retimer.ts)
  - are the current in-repo examples of the desired helper pattern
- [apps/manager/CLAUDE.md](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/CLAUDE.md) and [apps/manager/AGENTS.md](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/AGENTS.md)
  - already document the desired steady-state convention

### Institutional Learnings

- [backfill-worker-pattern-manager-20260407.md](/Users/o/.codex/worktrees/1ec2/forge/docs/solutions/platform/backfill-worker-pattern-manager-20260407.md)
  - explicitly recommends structured outputs over freeform JSON for manager extraction work
- [multimodal-scene-analysis-pipeline.md](/Users/o/.codex/worktrees/1ec2/forge/docs/solutions/platform/multimodal-scene-analysis-pipeline.md)
  - confirms scene analysis should remain operationally resilient and error-isolated
- [videoforge-manager-integration.md](/Users/o/.codex/worktrees/1ec2/forge/docs/solutions/platform/videoforge-manager-integration.md)
  - is a stale solution doc today and needs updating as part of this cleanup

### External Research Decision

Skipped. This is manager-local, the codebase already contains the desired helper pattern, and the primary work is branch reconciliation rather than new-library design.

## Spec-Flow Analysis

This cleanup is internal, but it still has important behavior branches that the implementation must preserve:

1. **Helper happy path**
   - scene analysis sends multimodal image+text content through the shared helper
   - parsed structured output returns successfully
   - scene analysis normalizes fields and produces the same artifact/result contract as today

2. **Structured-output failure on an attempt**
   - helper throws because of parse, validation, refusal, or missing content
   - scene analysis treats that as a retryable attempt failure rather than crashing the whole analysis
   - later attempts can still succeed or fall back cleanly

3. **`bad_frames` retry path**
   - parsed output is valid but flags `inputQuality: "bad_frames"`
   - scene analysis keeps its existing shifted-thumbnail retry behavior

4. **Empty-analysis retry path**
   - parsed output is technically valid but yields an empty description
   - scene analysis preserves its existing “retry, then eventually return empty analysis” behavior

5. **Usage accounting**
   - token usage remains available to scene analysis even though request execution moves into the helper
   - retries accumulate usage totals correctly

6. **Docs truthfulness**
   - after implementation, there should be one consistent story across code, plans, and solutions about manager structured outputs

### Resolved Planning Questions

- **How should usage data flow back from the helper?**
  Keep `createStructuredOpenrouterOutput(...)` as the shared entrypoint and add an additive callback or metadata hook for usage capture. Do not change existing callers to a new return type unless absolutely necessary.

- **How should multimodal content be represented?**
  Extend the helper’s message typing so it can accept the same OpenAI chat-content array shape that scene analysis already uses for `image_url` plus `text`.

- **Should `parseLLMJson.ts` be deleted again?**
  Yes, if `rg` confirms there are no runtime callers after scene analysis is migrated. Dead tests should be removed in the same change.

## Proposed Solution

Upgrade the shared helper just enough to cover scene analysis’s real needs, then migrate scene analysis onto it and clean up the stale docs that were left behind by the merge.

Desired layering:

```text
sceneAnalysis.ts
  -> createStructuredOpenrouterOutput(...)
     - multimodal content support
     - strict JSON Schema request
     - shared parse/validation handling
     - usage callback/metadata hook
  -> scene-analysis-specific retry rules
     - bad_frames retry
     - empty-analysis retry
     - empty-analysis fallback
  -> normalization + artifact write
```

This keeps responsibilities clean:

- [openrouter.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/services/openrouter.ts) owns provider-facing structured-output mechanics
- [sceneAnalysis.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/services/sceneAnalysis.ts) owns scene-specific retry and normalization semantics
- completed plans/solutions get refreshed to describe the real branch state instead of frozen pre-merge assumptions

## Key Technical Decisions

### 1. Extend the helper instead of creating a scene-analysis-specific helper

Do not leave scene analysis as a parallel structured-output stack. Add the minimum missing capability to [openrouter.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/services/openrouter.ts):

- multimodal message content support
- usage propagation

This keeps object-shaped manager LLM work behind one boundary.

### 2. Keep the helper return shape simple for existing callers

Chapters, metadata, and retimer only need parsed data. Scene analysis is the exceptional caller because it also needs token usage. Prefer an additive hook like `onUsage` over a breaking return-shape change.

### 3. Preserve scene analysis’s soft-failure behavior

Today, malformed or unusable scene-analysis output eventually degrades to an empty analysis instead of crashing the job. The migration should preserve that. The helper may throw; the scene-analysis attempt loop should catch and handle that locally.

### 4. Refresh historical docs with “post-merge cleanup” notes instead of pretending history was different

The completed scene-analysis and retimer plans are historical artifacts. Update them to explain the new branch truth without erasing the fact that they were accurate at the time they were written.

## Implementation Units

- [x] **Unit 1: Extend the shared structured-output helper for multimodal content and usage**

  **Goal:** Make [openrouter.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/services/openrouter.ts) capable of serving scene analysis without breaking existing callers.

  **Files:**
  - Modify: [openrouter.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/services/openrouter.ts)
  - Modify: [openrouter.test.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/services/openrouter.test.ts)

  **Red**
  - add a failing test proving the helper accepts multimodal user content with `image_url` plus `text`
  - add a failing test proving an `onUsage`-style hook receives prompt/completion token counts
  - add a safety test proving existing string-only callers still work without passing the new option

  **Green**
  - widen the helper’s message typing to support string or content-part arrays
  - thread usage metadata back through an additive option
  - keep the existing parse/validation behavior intact for current callers

  **Refactor**
  - keep the public helper API understandable; avoid introducing a second nearly-identical helper if one additive upgrade is enough

- [x] **Unit 2: Migrate scene analysis to the shared helper**

  **Goal:** Remove the direct provider call + `parseLLMJson(...)` path from [sceneAnalysis.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/services/sceneAnalysis.ts).

  **Files:**
  - Modify: [sceneAnalysis.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/services/sceneAnalysis.ts)
  - Modify: [sceneAnalysis.test.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/services/sceneAnalysis.test.ts)

  **Red**
  - add a failing test proving scene analysis calls the shared helper instead of mocking raw `getOpenrouter()`
  - add a failing test for helper failure on repeated attempts returning empty analysis rather than throwing
  - add a failing test proving usage counts still accumulate
  - keep or add a failing test for `bad_frames` retry behavior

  **Green**
  - replace the direct `chat.completions.create(...)` call with `createStructuredOpenrouterOutput(...)`
  - catch helper failures inside the attempt loop and map them to retryable scene-analysis failures
  - preserve the existing `bad_frames` and empty-analysis retry rules
  - preserve normalization and artifact output

  **Refactor**
  - remove no-longer-needed direct OpenRouter plumbing from scene analysis once the helper is in place

- [x] **Unit 3: Remove dead JSON helper code if scene analysis was the last caller**

  **Goal:** Finish the cleanup that the April 8 retimer plan intended, but only if the repo scan really supports it.

  **Files:**
  - Delete: [parseLLMJson.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/lib/parseLLMJson.ts)
  - Delete: [parseLLMJson.test.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/lib/parseLLMJson.test.ts)

  **Red**
  - confirm with `rg` that there are zero runtime imports in `apps/manager/src`

  **Green**
  - delete the helper and its tests if it is truly dead again

  **Refactor**
  - remove or update any remaining comments that treat `parseLLMJson` as a current pattern

- [x] **Unit 4: Refresh stale branch docs**

  **Goal:** Make the branch docs truthful again after the migration.

  **Files:**
  - Modify: [videoforge-manager-integration.md](/Users/o/.codex/worktrees/1ec2/forge/docs/solutions/platform/videoforge-manager-integration.md)
  - Modify: [2026-04-06-001-feat-multimodal-scene-analysis-plan.md](/Users/o/.codex/worktrees/1ec2/forge/docs/plans/2026-04-06-001-feat-multimodal-scene-analysis-plan.md)
  - Modify: [2026-04-08-fix-manager-subtitle-retiming-structured-output-plan.md](/Users/o/.codex/worktrees/1ec2/forge/docs/plans/2026-04-08-fix-manager-subtitle-retiming-structured-output-plan.md)
  - Modify: [apps/manager/AGENTS.md](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/AGENTS.md) or [apps/manager/CLAUDE.md](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/CLAUDE.md) only if the helper upgrade makes their current wording incomplete

  **Red**
  - grep for stale `parseLLMJson` claims that remain false after the migration

  **Green**
  - update solution and plan docs so they reflect the current branch truth
  - prefer short post-implementation notes over heavy rewrites of historical plan sections

  **Refactor**
  - avoid leaving mutually contradictory claims across completed docs

## Acceptance Criteria

- [x] [sceneAnalysis.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/services/sceneAnalysis.ts) uses `createStructuredOpenrouterOutput(...)`
- [x] [openrouter.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/services/openrouter.ts) supports scene analysis’s multimodal message shape without breaking chapters, metadata, or retimer
- [x] scene analysis still records token usage totals correctly
- [x] scene analysis still retries on `bad_frames`
- [x] scene analysis still degrades to empty analysis instead of throwing when all attempts fail
- [x] `apps/manager/src` has no runtime imports of `parseLLMJson` after the migration
- [x] [parseLLMJson.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/lib/parseLLMJson.ts) is deleted if it is truly dead
- [x] stale docs no longer claim incompatible manager structured-output patterns
- [x] `pnpm --filter @forge/manager test`
- [x] `pnpm --filter @forge/manager lint`
- [x] `pnpm --filter @forge/manager typecheck`

## Dependencies & Risks

### Dependencies

- The shared helper in [openrouter.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/services/openrouter.ts) remains the canonical manager structured-output boundary.
- Scene analysis continues to use OpenRouter with multimodal `image_url` content rather than switching providers again.

### Risks

- **Risk: helper upgrade breaks existing callers**
  - Mitigation: add compatibility tests before changing the helper signature

- **Risk: helper exceptions accidentally turn soft scene-analysis failures into hard failures**
  - Mitigation: preserve the attempt loop and explicitly test repeated helper failure → empty-analysis fallback

- **Risk: usage accounting gets lost in the migration**
  - Mitigation: add explicit tests for token accumulation through the helper callback/hook

- **Risk: doc refresh rewrites history too aggressively**
  - Mitigation: prefer additive post-merge notes in completed plan docs

## Verification

- `pnpm --filter @forge/manager test -- src/services/openrouter.test.ts`
- `pnpm --filter @forge/manager test -- src/services/sceneAnalysis.test.ts`
- `pnpm --filter @forge/manager test`
- `pnpm --filter @forge/manager lint`
- `pnpm --filter @forge/manager typecheck`

### Recommended Smoke Verification

After implementation, run two local checks:

1. A scene-analysis API smoke run against a known local video with subtitles, via [route.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/app/api/scene-analysis/route.ts), to confirm the migrated service still produces a `scene-analysis` artifact.
2. One ordinary local enrich run to confirm the shared helper upgrade did not regress chapters, metadata, or retiming behavior elsewhere in manager.

## References & Research

### Internal References

- [openrouter.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/services/openrouter.ts)
- [sceneAnalysis.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/services/sceneAnalysis.ts)
- [sceneAnalysis.test.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/services/sceneAnalysis.test.ts)
- [2026-04-08-manager-structured-llm-output-hardening-requirements.md](/Users/o/.codex/worktrees/1ec2/forge/docs/brainstorms/2026-04-08-manager-structured-llm-output-hardening-requirements.md)
- [2026-04-08-fix-manager-subtitle-retiming-structured-output-plan.md](/Users/o/.codex/worktrees/1ec2/forge/docs/plans/2026-04-08-fix-manager-subtitle-retiming-structured-output-plan.md)
- [2026-04-06-001-feat-multimodal-scene-analysis-plan.md](/Users/o/.codex/worktrees/1ec2/forge/docs/plans/2026-04-06-001-feat-multimodal-scene-analysis-plan.md)
- [videoforge-manager-integration.md](/Users/o/.codex/worktrees/1ec2/forge/docs/solutions/platform/videoforge-manager-integration.md)
- [multimodal-scene-analysis-pipeline.md](/Users/o/.codex/worktrees/1ec2/forge/docs/solutions/platform/multimodal-scene-analysis-pipeline.md)

### Git History Context

- `dba20d9` — `feat(manager): harden enrichment structured outputs`
- `0e74e5b` — `feat(manager): multimodal scene analysis pipeline (feat-038/039/040) (#658)`
- `90d4d77` — `feat(manager): structured output + bad-frame retry for scene analysis (#675)`
- `09f5538` — `fix(manager): normalize demographics enum and lowercase themes (#677)`
