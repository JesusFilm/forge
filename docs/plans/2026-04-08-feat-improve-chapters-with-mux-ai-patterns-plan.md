---
title: "feat: Improve chapter generation with @mux/ai patterns"
type: feat
status: active
date: 2026-04-08
roadmap:
  - /docs/roadmap/media-generation/feat-031-ai-video-enrichment-pipeline.md
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
- Forge currently writes a chapter artifact only after:
  - one short prompt
  - one `parseLLMJson(...)` call
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

## Technical Approach

### Service boundary

Refactor [chapters.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/services/chapters.ts) into small units:

- `buildTimestampedTranscript(...)`
- `buildChapterPrompt(...)`
- `normalizeGeneratedChapters(...)`
- `assertUsableChapterOutline(...)`
- `generateChapters(...)`

Suggested type direction:

```ts
type ChapterInput = { transcriptText: string; segments?: TranscriptSegment[] }

type RawGeneratedChapter = {
  title: string
  startSeconds: number
  summary?: string
}
```

### Workflow call site

Update [videoEnrichment.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/workflows/videoEnrichment.ts) so the chapters step receives either:

- the full transcription result, or
- `text + segments`

This is a small call-site change, but it unlocks better chaptering without any extra Mux API work.

### Retry and observability

Add a lightweight retry wrapper around the OpenRouter call, modeled after `muxinc/ai`'s `withRetry()` pattern, but using repo-local primitives.

Also add structured log events for:

- invalid chapter rows dropped
- chapter normalization applied
- chapter density violations

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
- add structured logs and retry handling
- keep public behavior stable:
  - artifact key remains `chapters`
  - artifact file remains `chapters.json`

### Phase 4: Higher-confidence regression coverage

Add one or two fixture-driven regression tests inspired by `muxinc/ai` evals:

- a realistic transcript fixture produces multiple chronological chapters
- a long transcript stays within expected chapter-density bounds

These tests should remain mocked and deterministic, not provider-live.

## Acceptance Criteria

- [ ] Chapter generation consumes timestamp-aware transcript input rather than plain text alone
- [ ] Chapter start times are normalized in code, not trusted blindly from the model
- [ ] `endSeconds` is derived deterministically from adjacent chapters
- [ ] Generic or malformed chapter outputs fail loudly instead of being written
- [ ] Existing artifact routing remains unchanged
- [ ] Automated tests cover ordering, first-chapter-at-zero, generic-title rejection, and `endSeconds` derivation

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
- Using timestamped transcript input increases prompt length somewhat.
- Chapter density rules need to be loose enough to avoid brittle failures on short videos.

## Not Doing

- No `@mux/ai` package adoption
- No OpenAI direct-provider migration
- No full eval harness port from `muxinc/ai`
- No chapter UI redesign in this plan
