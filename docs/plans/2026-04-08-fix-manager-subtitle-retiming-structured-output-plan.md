---
title: "fix: Harden manager subtitle retiming structured output"
type: fix
status: completed
date: 2026-04-08
origin: docs/brainstorms/2026-04-08-manager-structured-llm-output-hardening-requirements.md
roadmap:
  - /docs/roadmap/media-generation/feat-031-ai-video-enrichment-pipeline.md
---

# fix: Harden manager subtitle retiming structured output

## Overview

Apply the same structured-output boundary already proven in manager chapters and metadata to the subtitle retimer, then remove stale raw-JSON parsing guidance from the manager app docs.

**Post-merge cleanup update (Apr 9, 2026):** `origin/main` later merged scene analysis code that briefly reintroduced `parseLLMJson` on this branch. The follow-up cleanup aligned `sceneAnalysis.ts` to the same shared helper and removed the parser again, so the final branch state matches the intent captured here.

This plan is intentionally narrow:

- migrate subtitle retiming from `json_object` + manual `JSON.parse` to the shared `createStructuredOpenrouterOutput(...)` helper
- preserve the current retry, correction-prompt, validation, and deterministic fallback behavior
- remove the now-unused `parseLLMJson.ts` helper if no runtime callers remain
- update manager docs so future object-shaped LLM calls follow the shared pattern

## Problem Frame

The manager app now has two different patterns for object-shaped LLM output:

- chapters and metadata use the shared structured-output helper in `apps/manager/src/services/openrouter.ts`
- subtitle retiming still uses `response_format: { type: "json_object" }` plus `JSON.parse` in `apps/manager/src/services/subtitleTranslation/retimer.ts`

That inconsistency matters because this exact failure mode already happened in a real local enrich run. Chapters and metadata failed on malformed or wrapped model output until they were moved behind the stricter structured-output helper.

Retiming is the remaining runtime path with the same class of risk. At the same time:

- `apps/manager/src/lib/parseLLMJson.ts` appears unused
- `apps/manager/AGENTS.md` still documents `parseLLMJson.ts` as the app’s LLM JSON boundary

Without finishing this migration, manager keeps one fragile LLM JSON path and one stale set of docs.

## Requirements Trace

- R1. Subtitle retiming must use the same shared structured-output boundary as chapters and metadata.
- R2. Retiming must continue validating against `RetimingOutputSchema` before accepting an LLM result.
- R3. The current correction loop and deterministic fallback behavior in retiming must remain intact.
- R4. Dead JSON-parsing utilities should be removed once no runtime callers remain.
- R5. Manager-facing docs should explicitly direct future object-shaped LLM requests through the shared structured-output helper instead of ad hoc raw JSON parsing.

## Scope Boundaries

In scope:

- `apps/manager/src/services/subtitleTranslation/retimer.ts`
- `apps/manager/src/services/subtitleTranslation/retimer.test.ts`
- any small supporting schema/helper wiring needed to reuse the shared OpenRouter structured-output helper
- manager docs that currently encode the old pattern
- cleanup of unused `parseLLMJson.ts` if confirmed dead

Out of scope:

- plain-text generation paths such as `apps/manager/src/services/subtitleTranslation/translator.ts`
- embeddings
- non-manager apps
- new repo-wide lint rules or generic guardrails
- redesigning retiming prompts or fallback logic beyond what is needed for the structured-output migration

## Context & Research

### Relevant Code and Patterns

- `apps/manager/src/services/openrouter.ts`
  - now owns the shared structured-output boundary used by chapters and metadata
  - already applies strict JSON schema requests, OpenRouter response healing, and Zod validation
- `apps/manager/src/services/chapters.ts`
  - current in-repo example of using the shared helper for object-shaped LLM output
- `apps/manager/src/services/metadata.ts`
  - second current example of the same pattern
- `apps/manager/src/services/subtitleTranslation/retimer.ts`
  - still uses `response_format: { type: "json_object" }`
  - still manually parses model output via `safeParseRetiming()`
  - already has the important semantic contract we want to preserve:
    - retry once
    - correction prompt on retry
    - deterministic fallback if all LLM attempts fail
- `apps/manager/src/services/subtitleTranslation/types.ts`
  - already defines `RetimingOutputSchema`, which should remain the source of truth for retiming output shape
- `apps/manager/src/services/subtitleTranslation/retimer.test.ts`
  - currently covers only pure validation/fallback helpers
  - does not yet exercise the LLM boundary, retry loop, or fallback after structured-output failures
- `apps/manager/AGENTS.md`
  - stale reference to `src/lib/parseLLMJson.ts`
- `apps/manager/CLAUDE.md`
  - good place for one durable convention line about object-shaped LLM outputs

### Institutional Learnings

- `docs/solutions/platform/videoforge-manager-integration.md`
  - shared client modules are the preferred app boundary for third-party SDK use
  - Zod validation at service boundaries is an existing manager pattern worth preserving

### External Research Decision

Skipped. This is manager-local, low-risk, and the codebase already contains a fresh, live-validated implementation of the exact pattern we want to reuse.

## Spec-Flow Analysis

Although this is an internal service change rather than a user-facing feature, the retimer still has a few distinct control flows that the plan must preserve:

1. **Happy path**
   - Structured helper returns an object matching `RetimingOutputSchema`
   - `validateRetimingOutput(...)` passes
   - retimer returns LLM-generated segments

2. **Schema/parse failure on first attempt**
   - Shared helper throws because the payload is empty, malformed, stringified incorrectly, or schema-invalid
   - retimer records the error in `lastErrors`
   - retry uses the correction prompt

3. **Semantic validation failure**
   - Structured helper returns schema-valid data
   - `validateRetimingOutput(...)` rejects it because of overlap, duration, or window violations
   - retry uses the correction prompt with those validation errors

4. **All attempts exhausted**
   - retimer logs fallback
   - deterministic retiming still returns valid output

### Resolved Planning Questions

- **How should structured-output parse failures behave?**
  Treat them like existing retryable retimer failures. Do not short-circuit earlier than the current logic. Preserve the correction loop and deterministic fallback contract.

- **Which docs should change?**
  Update `apps/manager/AGENTS.md` because it is stale today, and add one concise convention to `apps/manager/CLAUDE.md` so future object-shaped LLM work has a visible app-level rule.

## Proposed Solution

Migrate retiming onto the same structured-output path already used elsewhere in manager, while keeping retimer-specific semantic validation and fallback behavior in place.

The desired layering is:

```text
retimeChunk(...)
  -> build retiming or correction prompt
  -> call createStructuredOpenrouterOutput(...) with RetimingOutputSchema
  -> run validateRetimingOutput(...) for timing/overlap/window rules
  -> on failure: record errors and retry once
  -> on repeated failure: deterministicRetime(...)
```

This keeps responsibilities clean:

- `openrouter.ts` owns provider-facing structured-output reliability
- `RetimingOutputSchema` owns retiming payload shape
- `validateRetimingOutput(...)` owns retiming semantics
- `deterministicRetime(...)` remains the final safety net

## Key Technical Decisions

### 1. Reuse the shared structured-output helper instead of adding retimer-specific parsing logic

Retiming should import and call `createStructuredOpenrouterOutput(...)` rather than building a second OpenRouter JSON parsing path. This keeps JSON/object LLM behavior centralized in one app-level boundary.

### 2. Remove `safeParseRetiming()` after migration

Once the shared helper owns parse and schema validation, `safeParseRetiming()` becomes redundant. Retimer should only keep its semantic validation layer:

- overlap detection
- max-slot duration
- chunk-window bounds
- empty-output rejection

### 3. Preserve correction-loop semantics exactly

The migration should not redesign retry behavior. If the structured-output helper throws, retimer should continue to:

- capture the error text in `lastErrors`
- retry with the correction prompt
- fall back deterministically after the configured attempts are exhausted

### 4. Treat docs as part of the fix, not optional cleanup

`apps/manager/AGENTS.md` is already stale. This migration should leave the app docs more correct than before:

- AGENTS: remove the `parseLLMJson.ts` guidance and point object-shaped output to the shared helper
- CLAUDE: add a concise convention that object-shaped LLM responses use the structured helper, while plain-text tasks can still use raw completions

## Implementation Units

- [x] **Unit 1: Migrate retimer to shared structured output**

  **Goal:** Replace retimer’s direct `json_object` + `JSON.parse` path with the shared helper while preserving retry and fallback behavior.

  **Files:**
  - Modify: `apps/manager/src/services/subtitleTranslation/retimer.ts`
  - Modify: `apps/manager/src/services/subtitleTranslation/types.ts` if a JSON-schema companion export is the cleanest way to keep the schema colocated

  **Approach:**
  - Import `createStructuredOpenrouterOutput(...)` into `retimer.ts`
  - Add or colocate the JSON Schema needed for `RetimingOutputSchema`
  - Replace the raw OpenRouter call + `safeParseRetiming()` with the shared helper
  - Preserve the current try/catch loop and `lastErrors` behavior
  - Keep `validateRetimingOutput(...)` and `deterministicRetime(...)` intact

  **Notes:**
  - The helper already handles OpenRouter-specific quirks like stringified JSON content and response healing
  - This unit should not change prompt wording except where a correction prompt needs to surface structured-output error text

- [x] **Unit 2: Raise retimer test coverage to the service boundary**

  **Goal:** Add regression coverage for the retimer control flow, not just its pure helpers.

  **Files:**
  - Modify: `apps/manager/src/services/subtitleTranslation/retimer.test.ts`

  **Test scenarios:**
  - successful structured-output retiming returns LLM-produced segments
  - schema/parse failure on first attempt retries and succeeds on correction attempt
  - semantic validation failure retries with correction feedback
  - repeated structured-output failure falls back to `deterministicRetime(...)`
  - repeated semantic failure also falls back deterministically

  **Notes:**
  - Mock the shared structured-output helper rather than mocking raw OpenRouter responses
  - Keep existing pure-function tests for `validateRetimingOutput(...)` and `deterministicRetime(...)`

- [x] **Unit 3: Remove dead helper and update manager docs**

  **Goal:** Eliminate stale JSON-boundary guidance and align app docs with the new pattern.

  **Files:**
  - Delete: `apps/manager/src/lib/parseLLMJson.ts` if `rg` confirms no runtime callers remain
  - Modify: `apps/manager/AGENTS.md`
  - Modify: `apps/manager/CLAUDE.md`

  **Approach:**
  - Confirm `parseLLMJson.ts` has no runtime importers
  - Remove it
  - Update AGENTS key-files guidance so it no longer points at deleted/stale code
  - Add one concise structured-output convention to CLAUDE for future object-shaped LLM requests

## Acceptance Criteria

- [x] `apps/manager/src/services/subtitleTranslation/retimer.ts` no longer uses `response_format: { type: "json_object" }`
- [x] `apps/manager/src/services/subtitleTranslation/retimer.ts` no longer manually calls `JSON.parse` on model output
- [x] retimer uses the shared structured-output helper and still validates with `validateRetimingOutput(...)`
- [x] retimer still retries once and still falls back to `deterministicRetime(...)` after repeated failure
- [x] retimer tests cover helper failure, semantic validation failure, retry, and fallback paths
- [x] `apps/manager/src/lib/parseLLMJson.ts` is removed if no runtime callers remain
- [x] `apps/manager/AGENTS.md` and `apps/manager/CLAUDE.md` describe the new object-shaped LLM output pattern accurately

## Dependencies & Risks

### Dependencies

- This plan assumes the current shared structured-output helper in `apps/manager/src/services/openrouter.ts` is the intended long-term boundary and lands with the same workstream or before this change.

### Risks

- **Risk: strict schema handling increases fallback frequency**
  - Mitigation: preserve current retry/fallback semantics and add service-boundary tests for both helper and semantic failures

- **Risk: correction prompts become less effective if helper errors are too generic**
  - Mitigation: keep the caught helper error text in `lastErrors` so retry prompts still receive concrete feedback

- **Risk: docs cleanup misses one stale reference**
  - Mitigation: use `rg` during implementation to find all remaining `parseLLMJson` mentions in `apps/manager`

## Verification

- `pnpm --filter @forge/manager test -- src/services/subtitleTranslation/retimer.test.ts`
- `pnpm --filter @forge/manager test -- src/services/subtitleTranslation/index.test.ts`
- `pnpm --filter @forge/manager test -- src/workflows/videoEnrichment.test.ts`
- `pnpm --filter @forge/manager test`
- `pnpm --filter @forge/manager lint`
- `pnpm --filter @forge/manager typecheck`

### Recommended Smoke Verification

If local manager secrets are available, rerun a real local enrichment workflow against a known-good Mux asset after the change. This is worthwhile because the original problem class already reproduced only under live provider behavior, not just unit tests.

## References & Research

### Internal References

- `docs/brainstorms/2026-04-08-manager-structured-llm-output-hardening-requirements.md`
- `docs/roadmap/media-generation/feat-031-ai-video-enrichment-pipeline.md`
- `docs/solutions/platform/videoforge-manager-integration.md`
- `apps/manager/src/services/openrouter.ts`
- `apps/manager/src/services/chapters.ts`
- `apps/manager/src/services/metadata.ts`
- `apps/manager/src/services/subtitleTranslation/retimer.ts`
- `apps/manager/src/services/subtitleTranslation/types.ts`
- `apps/manager/src/services/subtitleTranslation/retimer.test.ts`
- `apps/manager/AGENTS.md`
- `apps/manager/CLAUDE.md`

### Research Summary

- Found brainstorm from 2026-04-08: `manager-structured-llm-output-hardening`. Used as planning context.
- Local repo context was sufficient, so no external research was required.
- The codebase already contains a working structured-output implementation for chapters and metadata, making this a consistency and cleanup fix rather than a new design problem.
