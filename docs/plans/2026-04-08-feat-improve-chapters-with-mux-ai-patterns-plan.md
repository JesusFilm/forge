---
title: "feat: Improve chapter generation with @mux/ai patterns"
type: feat
status: completed
date: 2026-04-08
roadmap:
  - /docs/roadmap/media-generation/feat-031-ai-video-enrichment-pipeline.md
deepened: 2026-04-08
---

# feat: Improve chapter generation with @mux/ai patterns

## Overview

Improve Forge chapter generation by borrowing the strongest ideas from `muxinc/ai`'s open-source chaptering workflow without migrating manager onto `@mux/ai` as a runtime dependency.

This plan replaces the earlier "migrate chapters/metadata/embeddings to `@mux/ai`" direction with a narrower strategy:

- keep Forge's existing workflow shell, artifact routing, and OpenRouter client
- improve the chaptering input, prompt construction, output normalization, and test coverage using patterns proven in `muxinc/ai`
- keep the current Forge chapter artifact shape:
  - `title`
  - `startSeconds`
  - `endSeconds`
  - `summary`

## Problem Statement / Motivation

Forge chapter generation still works from a flattened transcript string:

- [chapters.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/services/chapters.ts)
- [videoEnrichment.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/workflows/videoEnrichment.ts)

That means the LLM is asked to invent chapter boundaries from plain text with no timestamp anchors. The current implementation also trusts the model to emit both `startSeconds` and `endSeconds`, then only checks that the final array is non-empty.

This creates three quality risks:

1. chapter boundaries drift because the model never sees cue timing
2. malformed or out-of-order output survives until very late
3. the current tests are too shallow to catch low-quality but non-empty chapter artifacts

Recent local work already showed that downstream steps are only as good as the transcript artifacts they consume. Chapters need a stronger contract than "non-empty JSON."

## Requirements Trace

This plan is driven by four execution-facing requirements:

1. The chapter step must consume timestamp-bearing transcript context when it exists.
   `transcription.ts` already produces `segments`, so chaptering should use that timing data instead of asking the model to infer boundaries from flattened text alone.

2. Forge must preserve the existing chapter artifact contract.
   Downstream roadmap work such as [feat-037](/Users/o/.codex/worktrees/840e/forge/docs/roadmap/content-discovery/feat-037-video-content-vectorization.md), [feat-039](/Users/o/.codex/worktrees/840e/forge/docs/roadmap/content-discovery/feat-039-chapter-based-scene-boundaries.md), [feat-040](/Users/o/.codex/worktrees/840e/forge/docs/roadmap/content-discovery/feat-040-multimodal-scene-descriptions.md), and [feat-044](/Users/o/.codex/worktrees/840e/forge/docs/roadmap/content-discovery/feat-044-recommendation-query-api.md) already treat `Chapter { title, startSeconds, endSeconds, summary }` as the baseline scene-like contract.

3. The model should provide chapter outline semantics, not own temporal integrity.
   Chapter ordering, duplicate handling, first-chapter anchoring, and `endSeconds` derivation should happen in code so malformed-but-plausible model output cannot silently persist.

4. Validation must fail before artifact persistence.
   A chapter job that produces only unusable rows should fail the step and avoid writing a misleading `chapters.json` artifact.

## Scope

In scope:

- chapter generation input shape
- chapter prompt structure
- chapter output normalization and invariants
- chapter service tests
- optional small workflow call-site adjustment so the step consumes richer transcript input

Out of scope:

- adopting `@mux/ai` as a package dependency
- adding new provider credentials
- changing artifact download routes or UI link behavior
- redesigning the chapter artifact into the minimal `@mux/ai` shape

## Research Summary

### Internal findings

- Forge transcription already preserves timestamped segments in [transcription.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/services/transcription.ts), but chapter generation ignores them and consumes only `transcription.text`.
- The shared OpenRouter client in [openrouter.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/services/openrouter.ts) already applies `timeout: 120_000` and `maxRetries: 3`, so this plan should not add a second generic retry layer without a chapter-specific reason.
- The workflow step in [videoEnrichment.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/workflows/videoEnrichment.ts) currently passes only `transcription.text` into `stepChapters(...)`, even though the full transcription result is already available in memory.
- Forge currently writes a chapter artifact only after:
  - one short prompt
  - one `createStructuredOpenrouterOutput(...)` call
  - one non-empty assertion
- Existing tests in [chapters.test.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/services/chapters.test.ts) cover only:
  - valid non-empty JSON
  - empty output throws

### `muxinc/ai` patterns worth borrowing

- Timestamped transcript input instead of plain transcript text:
  - [`src/primitives/transcripts.ts`](https://github.com/muxinc/ai/blob/main/src/primitives/transcripts.ts)
  - [`src/workflows/chapters.ts`](https://github.com/muxinc/ai/blob/main/src/workflows/chapters.ts)
- Sectioned prompt construction with explicit:
  - timestamp usage
  - chapter-density guidance
  - title guidance
  - output language handling
- Structured output generation with schema-backed parsing
- Post-generation normalization:
  - drop invalid rows
  - sort by start time
  - ensure the first chapter starts at `0`
- Keep the raw AI schema narrow:
  - `muxinc/ai` asks the model only for chapter starts/titles, then normalizes ordering after parsing
- Higher-bar tests and evals:
  - [`tests/integration/chapters.test.ts`](https://github.com/muxinc/ai/blob/main/tests/integration/chapters.test.ts)
  - [`tests/eval/chapters.eval.ts`](https://github.com/muxinc/ai/blob/main/tests/eval/chapters.eval.ts)

### Relevant repo learnings

- [videoforge-manager-integration.md](/Users/o/.codex/worktrees/1ec2/forge/docs/solutions/platform/videoforge-manager-integration.md)
  - keep shared OpenRouter usage centralized
  - keep Zod validation at boundaries
- [optional-railway-s3-local-fallback.md](/Users/o/.codex/worktrees/1ec2/forge/docs/solutions/platform/optional-railway-s3-local-fallback.md)
  - keep artifact writing behavior and key naming stable

## Proposed Solution

Improve Forge chapters in four layers.

### 1. Change chapter input from plain text to timestamped transcript context

Instead of passing `transcription.text` into `generateChapters(...)`, pass a richer input derived from:

- `transcription.segments`, or
- a helper that renders segments into a timestamped transcript string like:

```text
[0s] Intro line
[14s] Main point begins
[52s] Transition to next section
```

This mirrors the strongest `@mux/ai` improvement without forcing manager to fetch transcript tracks again.

### 2. Split chapter prompting into explicit sections

Replace the current one-shot prompt with a small prompt builder that contains:

- task
- output format
- chapter count guidance
- timestamp guidance
- title quality guidance
- optional language guidance

The goal is not to copy `@mux/ai` verbatim. The goal is to make Forge's prompt auditable and testable.

### 3. Normalize model output before writing artifacts

Keep Forge's richer artifact schema, but stop trusting the model for final structure.

Normalize in code by:

- filtering invalid rows
- sorting by `startSeconds`
- forcing the first chapter to start at `0`
- deriving `endSeconds` from the next chapter boundary instead of trusting the model for both boundaries
- rejecting generic titles like `Chapter 1`

`summary` can remain model-generated, but the temporal structure should become code-owned.

### 4. Raise the test bar to match the new contract

Borrow the spirit of `muxinc/ai`'s integration/eval suite, but keep tests deterministic and local:

- ordering invariants
- first chapter starts at `0`
- no duplicate start times
- chapter density stays within a configured bound
- generic titles fail validation

## Key Technical Decisions

### 1. Keep the chapter input contract aligned with Forge transcription output

`generateChapters(...)` should move from a raw transcript string to a repo-local input object built from the existing transcription result:

- transcript text for fallback compatibility
- transcript segments for timestamp-aware chaptering
- transcript language when prompt wording or artifact defaults need it

The workflow should pass the already-fetched transcription result into chapter generation rather than refetching Mux text tracks or recreating transcript state elsewhere.

### 2. Ask the model for a chapter outline, not final chapter timings

The raw LLM schema should narrow to the fields the model is best suited to infer:

- `title`
- `startSeconds`
- `summary`

`endSeconds` should become code-owned and derived after normalization:

- intermediate chapters derive `endSeconds` from the next normalized chapter start
- the terminal chapter derives `endSeconds` from the last transcript-segment end when timing exists
- if no trustworthy terminal bound exists, the last chapter may remain `null` rather than inventing a false end time

This follows the strongest `muxinc/ai` pattern while preserving Forge's richer persisted artifact shape.

### 3. Keep retry changes minimal in this plan

The current shared OpenRouter client already retries transient provider failures. This plan should therefore prioritize:

- structured error context around chapter extraction failures
- normalization/drop logging for unusable rows
- deterministic tests that distinguish provider failure from invalid model content

Do not add a second generic `withRetry()` wrapper unless chapter-specific evidence shows the shared client retry behavior is insufficient.

### 4. Preserve the current chapter artifact contract for downstream work

Even though the raw model schema should narrow, the persisted artifact must remain:

- `title`
- `startSeconds`
- `endSeconds`
- `summary`

That keeps current workflow returns, artifact downloads, and upcoming scene-boundary/vectorization work compatible while improving chapter quality at the boundary.

## High-Level Technical Design

```text
transcription result (text + segments + language)
  -> build timestamped transcript from segments when available
  -> build chapter prompt with timestamp and density guidance
  -> request raw chapter outline from OpenRouter
  -> parse raw outline with Zod
  -> normalize outline into persisted Chapter[]
     - drop invalid or generic rows
     - sort and de-duplicate start times
     - force first chapter start to 0
     - derive endSeconds from the next boundary
     - clamp the final endSeconds to the last transcript segment when available
  -> assert usable normalized output
  -> write chapters artifact and return stable workflow result
```

## Technical Approach

### Unit 1: Chapter service contract and normalization

Primary files:

- [chapters.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/services/chapters.ts)
- [chapters.test.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/services/chapters.test.ts)

Refactor the service into a few pure, testable responsibilities:

- build a compact timestamped transcript string from `segments` when present, with plain-text fallback when they are absent
- build the chapter prompt from explicit sections instead of one opaque instruction block
- parse a raw chapter-outline schema that does **not** ask the model for final `endSeconds`
- normalize the parsed outline into the persisted Forge `Chapter[]` contract
- reject fully invalid or generic output before artifact persistence

The normalization pass should explicitly handle:

- out-of-order start times
- duplicate start times
- a missing `0` start by anchoring the first chapter to `0`
- terminal `endSeconds` derivation from transcript timing when available

### Unit 2: Workflow boundary update without changing downstream behavior

Primary files:

- [videoEnrichment.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/workflows/videoEnrichment.ts)
- [videoEnrichment.test.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/workflows/videoEnrichment.test.ts)

Update the chapter step so it receives timestamp-aware transcription context from the already-computed transcription result.

This unit should keep these contracts stable:

- artifact key remains `chapters`
- artifact file remains `chapters.json`
- workflow output still exposes chapter titles and `startSeconds`
- chapter-step failure still fails the job before a misleading artifact manifest entry is merged

### Unit 3: Regression fixtures and quality-focused coverage

Primary files:

- [chapters.test.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/services/chapters.test.ts)
- optional fixture data colocated with the service tests if inline test payloads become noisy

Raise coverage from "non-empty JSON" to chapter-quality contract coverage:

- timestamped transcript rendering from segment input
- generic-title rejection
- chronological sorting and duplicate-start handling
- deterministic `endSeconds` derivation
- valid single-chapter behavior on sparse transcripts
- reasonable chapter-density outcomes on longer transcript fixtures

Keep the higher-bar cases deterministic and provider-mocked. Do not port `muxinc/ai`'s live eval harness into Forge.

## System-Wide Impact

- [videoEnrichment.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/workflows/videoEnrichment.ts) already returns only `title` and `startSeconds` in its top-level output, so the workflow return shape can stay unchanged while the chapter service input grows richer.
- [storage.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/services/storage.ts) and the job artifact manifest continue to treat `chapters` as a single downloadable artifact; this plan should not change storage keys or download routing.
- Roadmap work in [feat-037](/Users/o/.codex/worktrees/840e/forge/docs/roadmap/content-discovery/feat-037-video-content-vectorization.md), [feat-039](/Users/o/.codex/worktrees/840e/forge/docs/roadmap/content-discovery/feat-039-chapter-based-scene-boundaries.md), [feat-040](/Users/o/.codex/worktrees/840e/forge/docs/roadmap/content-discovery/feat-040-multimodal-scene-descriptions.md), and [feat-044](/Users/o/.codex/worktrees/840e/forge/docs/roadmap/content-discovery/feat-044-recommendation-query-api.md) all assume the current chapter artifact shape; preserving it avoids cascading plan churn.
- Observability should follow the manager app's existing structured JSON logging style: log normalization outcomes and failure reasons, but do not log full transcript content.
- Because durable workflow retries are not the primary safety mechanism today, chapter-step failures need to be explicit, deterministic, and test-covered instead of hidden behind layered retry behavior.

## Red / Green TDD Plan

### Phase 1: Red

Add failing tests first in:

- [chapters.test.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/services/chapters.test.ts)
- new helper-focused tests if needed next to the service

Required red cases:

- builds a timestamped transcript from segment input
- normalizes out-of-order model output into chronological order
- forces the first chapter to start at `0`
- derives `endSeconds` from the next chapter instead of trusting model output
- rejects empty or fully invalid chapter arrays
- rejects generic chapter titles such as `Chapter 1`
- preserves artifact writing only for valid normalized output

### Phase 2: Green

Implement the smallest changes needed to make those tests pass:

- richer chapter input
- prompt builder
- normalization helper
- local `endSeconds` derivation
- better validation

### Phase 3: Refactor

After green:

- extract prompt and normalization helpers into clean pure functions
- tighten naming and types
- add structured logs and clearer error context around unusable model output
- keep public behavior stable:
  - artifact key remains `chapters`
  - artifact file remains `chapters.json`

### Phase 4: Higher-confidence regression coverage

Add one or two fixture-driven regression tests inspired by `muxinc/ai` evals:

- a realistic transcript fixture produces multiple chronological chapters
- a long transcript stays within expected chapter-density bounds

These tests should remain mocked and deterministic, not provider-live.

## Acceptance Criteria

- [x] Chapter generation consumes timestamp-aware transcript input rather than plain text alone
- [x] Chapter start times are normalized in code, not trusted blindly from the model
- [x] `endSeconds` is derived deterministically from adjacent chapters
- [x] Generic or malformed chapter outputs fail loudly instead of being written
- [x] Existing artifact routing remains unchanged
- [x] Automated tests cover ordering, first-chapter-at-zero, generic-title rejection, and `endSeconds` derivation

## Verification

### Automated

```bash
pnpm --filter @forge/manager test
pnpm --filter @forge/manager lint
pnpm --filter @forge/manager typecheck
```

### Browser / workflow QA

1. Create a fresh enrich job from coverage.
2. Confirm the chapter step succeeds on a known good English transcript.
3. Open the `chapters` artifact and verify:
   - first chapter starts at `0`
   - chapters are ordered
   - no duplicate start times
   - `endSeconds` advances with the next chapter

## Risks / Tradeoffs

- Stronger validation may turn some previously "successful but low quality" jobs into failures.
- Mitigation: start by rejecting clearly unusable outlines only: missing titles, missing/invalid start times, generic placeholder titles, and arrays that normalize to zero usable chapters.
- Using timestamped transcript input increases prompt length somewhat.
- Mitigation: render compact `[12s] line` transcript context from existing segments instead of sending raw VTT or JSON.
- Chapter density rules need to be loose enough to avoid brittle failures on short videos.
- Mitigation: treat density as prompt guidance plus fixture-based QA coverage, not as a hard validator that rejects otherwise-usable short or sparse transcripts.
- Final chapter timing can be ambiguous when transcript timing is incomplete.
- Mitigation: derive the terminal `endSeconds` from the final transcript segment when available; otherwise preserve `null` on the last chapter rather than fabricating certainty.

## Not Doing

- No `@mux/ai` package adoption
- No OpenAI direct-provider migration
- No full eval harness port from `muxinc/ai`
- No chapter UI redesign in this plan

## Sources & References

- [chapters.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/services/chapters.ts)
- [chapters.test.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/services/chapters.test.ts)
- [transcription.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/services/transcription.ts)
- [videoEnrichment.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/workflows/videoEnrichment.ts)
- [openrouter.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/services/openrouter.ts)
- [videoforge-manager-integration.md](/Users/o/.codex/worktrees/1ec2/forge/docs/solutions/platform/videoforge-manager-integration.md)
- [optional-railway-s3-local-fallback.md](/Users/o/.codex/worktrees/1ec2/forge/docs/solutions/platform/optional-railway-s3-local-fallback.md)
- [`muxinc/ai` `src/workflows/chapters.ts`](https://github.com/muxinc/ai/blob/main/src/workflows/chapters.ts)
- [`muxinc/ai` `src/primitives/transcripts.ts`](https://github.com/muxinc/ai/blob/main/src/primitives/transcripts.ts)
- [`muxinc/ai` `tests/integration/chapters.test.ts`](https://github.com/muxinc/ai/blob/main/tests/integration/chapters.test.ts)
- [`muxinc/ai` `tests/eval/chapters.eval.ts`](https://github.com/muxinc/ai/blob/main/tests/eval/chapters.eval.ts)
