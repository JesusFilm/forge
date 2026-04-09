---
title: "feat: Improve metadata generation with @mux/ai patterns"
type: feat
status: completed
date: 2026-04-08
roadmap:
  - /docs/roadmap/media-generation/feat-031-ai-video-enrichment-pipeline.md
deepened: 2026-04-08
---

# feat: Improve metadata generation with @mux/ai patterns

## Overview

Improve Forge metadata generation by selectively borrowing the best design ideas from `muxinc/ai`'s summarization workflow while keeping Forge's current runtime architecture and richer metadata artifact.

This plan intentionally replaces the earlier full migration idea with a narrower improvement strategy:

- keep Forge on the existing OpenRouter runtime path
- keep the existing `metadata.json` artifact key and download flow
- keep Forge-specific fields that `muxinc/ai` does not provide directly:
  - `topics`
  - `speakers`
  - `language`
- borrow `muxinc/ai`'s prompt structure, output cleanup, retry posture, and eval-style quality checks

## Problem Statement / Motivation

Forge metadata extraction is still a single transcript-only LLM call with a flat prompt:

- [metadata.ts](/Users/o/.codex/worktrees/cfb9/forge/apps/manager/src/services/metadata.ts)

That implementation is fragile in two ways:

1. robustness
   - one malformed response becomes a blank fallback
   - prompt behavior is opaque and hard to evolve
2. quality
   - there are no explicit title/description/tag constraints
   - there is no cleanup for duplicate or low-value tags
   - tests only cover "usable" vs "blank"

We have already seen chapter and metadata steps fail when provider output drifts slightly. Metadata needs a stronger contract before artifact writing.

There is also a language-authority gap in the current flow: transcription resolves the actual subtitle-track language from Mux, but metadata generation still receives the requested workflow language. The plan needs to make that source of truth explicit before it adds more prompt and validation logic.

## Requirements Trace

This plan is driven by four operator-visible requirements:

- metadata artifacts must be either usable and trustworthy or absent; schema-valid filler should not count as success
- the `metadata` artifact key and JSON shape must stay stable for job downloads and future downstream wiring
- generated metadata language must be deterministic, defaulting to the resolved transcript language unless an internal output-language override is supplied
- prompt and quality rules must be auditable, overrideable, and testable without rewriting the whole service

Those requirements translate into these technical obligations:

1. Move title, description, and tag quality gates out of prompt prose and into code-owned normalization and validation.
2. Feed metadata generation the resolved transcription language from `transcribe(...)`, not the raw request language currently passed by `runVideoEnrichment(...)`.
3. Keep artifact persistence fail-closed: no `metadata` write on parse failure, quality failure, or bounded second-attempt exhaustion.
4. Preserve current artifact routing, manifest keys, and workflow return behavior.
5. Add deterministic tests for invalid JSON, filler phrases, tag normalization, requested-vs-resolved language handling, and bounded recovery.

## Scope Boundaries

In scope:

- metadata prompt structure using named sections
- code-owned normalization and quality validation for title, description, and tags
- light cleanup for `topics` and `speakers` so blank or obviously duplicated values do not leak into artifacts
- workflow wiring so metadata generation receives resolved transcription language
- deterministic tests for metadata quality and bounded regeneration behavior
- optional internal options for tone, output language, and prompt overrides

Out of scope:

- adopting `@mux/ai` as a dependency
- adding `OPENAI_API_KEY`
- forcing metadata output into native `@mux/ai` shape
- adding a new transcript-cleaning subsystem beyond prompt-level guidance
- changing artifact download routes, manifest keys, or UI contracts
- full storyboard/multimodal adoption in the first slice

## Research Summary

### Internal findings

- Forge currently asks for:
  - `title`
  - `description`
  - `topics`
  - `speakers`
  - `tags`
  - `language`
- [metadata.ts](/Users/o/.codex/worktrees/cfb9/forge/apps/manager/src/services/metadata.ts) currently:
  - sends one flat prompt
  - parses JSON through [parseLLMJson.ts](/Users/o/.codex/worktrees/cfb9/forge/apps/manager/src/lib/parseLLMJson.ts)
  - falls back to blank metadata
  - only throws after the fallback result is completely unusable
- [videoEnrichment.ts](/Users/o/.codex/worktrees/cfb9/forge/apps/manager/src/workflows/videoEnrichment.ts) passes the requested workflow language into `stepMetadata(...)`, while [transcription.ts](/Users/o/.codex/worktrees/cfb9/forge/apps/manager/src/services/transcription.ts) separately resolves and returns the actual subtitle-track language.
- The shared [openrouter.ts](/Users/o/.codex/worktrees/cfb9/forge/apps/manager/src/services/openrouter.ts) client already owns `timeout: 120_000` and `maxRetries: 3`, so the remaining robustness gap is invalid or low-quality model output rather than missing transport retries.
- Metadata step failures already mark the step failed and fail the overall job, even if chapters or embeddings completed in parallel.
- Existing tests in [metadata.test.ts](/Users/o/.codex/worktrees/cfb9/forge/apps/manager/src/services/metadata.test.ts) cover only:
  - writes usable metadata
  - blank metadata throws

### `muxinc/ai` patterns worth borrowing

- [`src/lib/prompt-builder.ts`](https://github.com/muxinc/ai/blob/main/src/lib/prompt-builder.ts) renders XML-like tagged prompt sections and `buildWithContext(...)` appends dynamic context sections without rewriting the whole prompt.
- [`src/workflows/summarization.ts`](https://github.com/muxinc/ai/blob/main/src/workflows/summarization.ts) uses separate title, description, keywords, and quality sections for audio-only summarization, with default limits of:
  - 10 title words
  - 50 description words
  - 10 keywords
- The same workflow resolves output language as:
  - explicit override first
  - otherwise transcript-track language
- The summarization workflow normalizes keywords case-insensitively, drops blanks, and enforces the cap after cleanup.
- [`tests/eval/summarization.eval.ts`](https://github.com/muxinc/ai/blob/main/tests/eval/summarization.eval.ts) validates:
  - title under 100 characters
  - description under 1000 characters
  - case-insensitive tag uniqueness and count caps
  - no medium-referential filler phrases like `the video shows`, `this video features`, or `a video of`

### Strategic conclusion

The best first improvement is still not multimodal storyboard analysis. The highest-confidence first improvement is:

- prompt structure
- language-source-of-truth cleanup
- output normalization
- quality validation
- stronger deterministic tests

Storyboard context can remain a phase-two option if transcript-only improvements are still insufficient.

### Relevant repo learnings

- [videoforge-manager-integration.md](/Users/o/.codex/worktrees/cfb9/forge/docs/solutions/platform/videoforge-manager-integration.md)
  - shared OpenRouter client remains the right architectural boundary
  - Zod validation at boundaries is a repo pattern to keep
- [optional-railway-s3-local-fallback.md](/Users/o/.codex/worktrees/cfb9/forge/docs/solutions/platform/optional-railway-s3-local-fallback.md)
  - keep artifact naming and write flow stable

## Key Technical Decisions

### 1. Resolved output language is authoritative

Persisted `metadata.language` should come from:

- `outputLanguage` when an internal override is explicitly supplied, otherwise
- the resolved transcription language returned by `transcribe(...)`

Do not let the raw workflow request language or model-echoed `language` field override persisted truth. This keeps the artifact language aligned with the generated text while preserving the existing artifact shape.

### 2. Do not stack generic transport retries on top of the shared OpenRouter client

The shared client already retries transport failures. The remaining reliability gap is schema-invalid or quality-invalid content. This plan should therefore add at most one metadata-specific regeneration attempt, and only when the first response fails schema parsing or quality validation.

### 3. Title, description, and tags are the hard quality gate

`topics` and `speakers` should receive light normalization, but they should not become first-slice blockers by themselves. The core success contract is:

- title is usable
- description is usable
- tags are usable

If those core fields remain unusable after normalization and the bounded second attempt, the metadata step should fail without writing an artifact.

## Proposed Solution

Refactor metadata generation into four layers.

### 1. Build auditable prompts from named sections

Introduce a small repo-local tagged prompt builder for:

- task
- title requirements
- description requirements
- keyword requirements
- quality guidelines
- tone guidance
- language guidance
- transcript context

Prompt overrides should stay section-scoped so one rule can change without rewriting the entire prompt.

### 2. Resolve metadata language from workflow truth

Metadata generation should consume the resolved transcription language from the transcription result, not the raw workflow request input.

Default language behavior:

- use `outputLanguage` when provided
- otherwise use `transcription.language`

That resolved language should drive both prompt guidance and the persisted `language` field.

### 3. Normalize and validate metadata before writing artifacts

Move quality rules into code, not only prompt text.

Normalize:

- trim title and description
- trim and drop blank `topics`, `speakers`, and `tags`
- dedupe tags case-insensitively while preserving the first surviving spelling
- enforce tag caps after cleanup
- set `language` from resolved output language, not from model echo

Validate:

- title is non-empty, concise, and not prefixed with filler such as `a video of` or `the video shows`
- description is non-empty, bounded, and free of medium-referential filler phrases
- tags are non-empty unique strings within the configured cap
- metadata with blank or filler-only core fields fails loudly before artifact write

### 4. Add one bounded recovery path for invalid model output

If the first response is schema-invalid or quality-invalid:

- run one corrective regeneration attempt
- if the second attempt is still invalid, throw a typed metadata error
- write no artifact in either failure case

This preserves Forge's richer metadata shape while keeping the `metadata` artifact key and download flow unchanged.

## High-Level Technical Design

Non-prescriptive flow:

```text
transcription.text + transcription.language + internal metadata options
  -> build sectioned prompt with transcript context
  -> call OpenRouter completion
  -> parse schema
  -> normalize metadata
  -> validate title/description/tags quality
  -> if first response is invalid: regenerate once with corrective guidance
  -> if valid: write metadata artifact and return normalized result
  -> if still invalid: throw metadata-quality error and leave artifact absent
```

## Technical Approach

### Service boundary and file targets

Keep [metadata.ts](/Users/o/.codex/worktrees/cfb9/forge/apps/manager/src/services/metadata.ts) as the public orchestration entrypoint for the first slice. It should own:

- prompt construction
- completion calls
- normalization and validation
- bounded regeneration
- final artifact write

Touch points for the slice:

- [metadata.ts](/Users/o/.codex/worktrees/cfb9/forge/apps/manager/src/services/metadata.ts)
- [metadata.test.ts](/Users/o/.codex/worktrees/cfb9/forge/apps/manager/src/services/metadata.test.ts)
- [videoEnrichment.ts](/Users/o/.codex/worktrees/cfb9/forge/apps/manager/src/workflows/videoEnrichment.ts)
- [videoEnrichment.test.ts](/Users/o/.codex/worktrees/cfb9/forge/apps/manager/src/workflows/videoEnrichment.test.ts)

### Internal-only options

Keep the first-slice options internal. The useful options are:

- tone
- output language
- prompt overrides for named sections

Transcript cleanliness should stay prompt-level only unless repo evidence shows a real need for a separate preprocessing layer.

### Recovery and observability

- Preserve the existing `parseLLMJson(...)` warning signals for parse and schema failures.
- Add metadata-specific quality rejection paths so the step error distinguishes:
  - schema-invalid output
  - quality-invalid output
  - empty-but-schema-valid output
- Do not write `metadata` when any of those conditions survive the bounded second attempt.

## System-Wide Impact

- Workflow wiring:
  - metadata generation should default to `transcription.language`, aligning the artifact with the actual source transcript rather than the raw request language
- Failure propagation:
  - metadata quality rejection will still fail the metadata step and therefore the overall job
  - chapters, translations, or embeddings may still complete in parallel, so error text needs to make metadata rejection reasons explicit for operators
- Artifact and UI contracts:
  - keep the `metadata` logical key, downloadable route, and manifest entry unchanged
  - keep `runVideoEnrichment(...)` return behavior unchanged aside from returning normalized tags
- Downstream readiness:
  - stronger metadata quality improves future reuse without forcing a schema migration in this slice

## Red / Green TDD Plan

### Phase 1: Red

Expand [metadata.test.ts](/Users/o/.codex/worktrees/cfb9/forge/apps/manager/src/services/metadata.test.ts) with failing tests for:

- duplicate tags are deduped case-insensitively before artifact write
- blank `topics`, `speakers`, and `tags` are removed during normalization
- overly long or blank titles fail validation
- filler phrases like `the video shows`, `this video features`, or `a video of` are rejected
- configured tag caps are enforced after cleanup
- default `language` comes from resolved transcription language when no override is supplied
- output language guidance is included in the generated prompt only when an override is supplied
- prompt overrides change only the targeted section
- first schema-invalid or quality-invalid output triggers exactly one corrective regeneration attempt
- blank-but-schema-valid metadata still fails loudly

Add one workflow-level red case in [videoEnrichment.test.ts](/Users/o/.codex/worktrees/cfb9/forge/apps/manager/src/workflows/videoEnrichment.test.ts) to assert metadata generation receives `transcription.language`, not the raw request language.

### Phase 2: Green

Implement only enough to satisfy those tests:

- prompt section builder
- metadata normalization helper
- quality validation helper
- resolved-language wiring from transcription to metadata generation
- one bounded validation-triggered regeneration path

### Phase 3: Refactor

After green:

- simplify helper naming and types
- remove duplicated string rules
- centralize filler-phrase checks, length limits, and tag normalization rules
- keep public artifact behavior stable

### Phase 4: Optional higher-bar validation

Add one deterministic fixture-based quality suite inspired by `muxinc/ai` evals:

- title is concise and non-filler
- description is informative and non-meta
- tags are unique and bounded
- requested-vs-resolved language cases stay deterministic

This should stay mocked, not provider-live.

## Phase 2 Option: Storyboard-assisted metadata

If transcript-only improvements still produce weak titles/descriptions, a follow-on slice can add optional storyboard context inspired by `muxinc/ai`'s multimodal summarization path.

That is intentionally deferred because it adds:

- image fetching complexity
- larger prompts
- possible provider behavior changes

and is not required to capture the first quality win.

## Acceptance Criteria

- [x] Metadata prompt construction is split into auditable named sections with targeted overrides
- [x] Persisted `metadata.language` is deterministic: explicit output-language override or resolved transcription language
- [x] Title, description, and tags are normalized before artifact write, while `topics` and `speakers` receive light cleanup
- [x] Filler-style or otherwise unusable metadata is rejected instead of silently stored
- [x] One schema-invalid or quality-invalid model response can recover via a single bounded regeneration attempt; repeated invalid output writes no artifact
- [x] Forge keeps its richer metadata schema and current artifact key
- [x] Automated tests cover tag dedupe, tag caps, filler-phrase rejection, requested-vs-resolved language handling, and prompt section overrides
- [x] No new provider or environment variable is required for this improvement

## Verification

### Automated

```bash
pnpm --filter @forge/manager test
pnpm --filter @forge/manager lint
pnpm --filter @forge/manager typecheck
```

### Browser / workflow QA

1. Create a new enrich job for a video with a usable English transcript.
2. Wait for metadata to complete.
3. Open the `metadata` artifact and confirm:
   - title is non-empty
   - description is non-empty
   - tags are unique
   - no obvious filler phrases like `the video shows`
   - `language` matches the generated metadata language
4. Run a job where transcription resolves a concrete language from Mux and verify metadata uses that resolved language by default rather than the raw request string such as `auto`.
5. Keep invalid-response recovery in deterministic mocked tests rather than manual QA; the manual workflow should only confirm success-path artifact quality.

## Risks / Tradeoffs

- Harder validation may surface more metadata failures in the short term and therefore fail more whole enrichment jobs.
  Mitigation: allow one bounded regeneration attempt and make metadata rejection reasons explicit in the step error path.
- Using resolved output language as source of truth may expose prior assumptions that the raw request language was authoritative.
  Mitigation: cover requested-vs-resolved language behavior in both service and workflow tests.
- Keeping Forge-specific fields means we cannot copy `muxinc/ai` output shape directly.
- Storyboard support is intentionally deferred, so transcript-only metadata may still have quality ceilings on some videos.

## Not Doing

- No `@mux/ai` package adoption
- No forced switch to native `@mux/ai` artifact shape
- No direct provider migration off OpenRouter in this plan
- No change to fail-closed metadata step semantics or artifact routing contracts in this slice
- No UI redesign tied to metadata schema changes
