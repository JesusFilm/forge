---
title: "feat: Improve metadata generation with @mux/ai patterns"
type: feat
status: active
date: 2026-04-08
roadmap:
  - /docs/roadmap/media-generation/feat-031-ai-video-enrichment-pipeline.md
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

- [metadata.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/services/metadata.ts)

That implementation is fragile in two ways:

1. robustness
   - one malformed response becomes a blank fallback
   - prompt behavior is opaque and hard to evolve
2. quality
   - there are no explicit title/description/tag constraints
   - there is no cleanup for duplicate or low-value tags
   - tests only cover "usable" vs "blank"

We have already seen chapter and metadata steps fail when provider output drifts slightly. Metadata needs a stronger contract before artifact writing.

## Scope

In scope:

- metadata prompt structure
- metadata normalization and quality validation
- test coverage for metadata quality invariants
- optional internal options for tone, output language, transcript cleanliness, and prompt overrides

Out of scope:

- adopting `@mux/ai` as a dependency
- adding `OPENAI_API_KEY`
- forcing metadata output into native `@mux/ai` shape
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
- The service falls back to blank metadata and only later throws when nothing usable remains.
- Existing tests in [metadata.test.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/services/metadata.test.ts) cover only:
  - writes usable metadata
  - blank metadata throws

### `muxinc/ai` patterns worth borrowing

- Composable prompt sections and overrides:
  - [`src/lib/prompt-builder.ts`](https://github.com/muxinc/ai/blob/main/src/lib/prompt-builder.ts)
- Structured summarization workflow with:
  - title requirements
  - description requirements
  - keyword requirements
  - tone guidance
  - language guidance
  - transcript inclusion controls
  - [`src/workflows/summarization.ts`](https://github.com/muxinc/ai/blob/main/src/workflows/summarization.ts)
- Keyword normalization and count limiting
- Eval-style quality checks:
  - no filler phrases like `the video shows`
  - title/description length constraints
  - tag uniqueness and count caps
  - [`tests/eval/summarization.eval.ts`](https://github.com/muxinc/ai/blob/main/tests/eval/summarization.eval.ts)

### Strategic conclusion

The best first improvement is not multimodal storyboard analysis. The best first improvement is:

- prompt structure
- output normalization
- quality validation
- stronger tests

Storyboard context can remain a phase-two option if transcript-only improvements are still insufficient.

### Relevant repo learnings

- [videoforge-manager-integration.md](/Users/o/.codex/worktrees/1ec2/forge/docs/solutions/platform/videoforge-manager-integration.md)
  - shared OpenRouter client remains the right architectural boundary
  - Zod validation at boundaries is a repo pattern to keep
- [optional-railway-s3-local-fallback.md](/Users/o/.codex/worktrees/1ec2/forge/docs/solutions/platform/optional-railway-s3-local-fallback.md)
  - keep artifact naming and write flow stable

## Proposed Solution

Refactor metadata generation into three layers.

### 1. Build metadata prompts from named sections

Introduce a small repo-local prompt builder or prompt-section helper for:

- task
- title requirements
- description requirements
- tag requirements
- quality guidelines
- tone guidance
- language guidance
- transcript section

This should make metadata behavior adjustable without rewriting the whole prompt every time.

### 2. Normalize and validate metadata before writing artifacts

Move quality rules into code, not just prompt text.

Normalize:

- trim title and description
- dedupe tags
- cap tag count
- remove blank tags
- preserve `language`

Validate:

- title is non-empty and reasonably short
- description is non-empty and not obviously filler
- tags are non-empty unique strings
- metadata containing only filler or blank content fails loudly

### 3. Preserve Forge-specific fields while borrowing Mux quality patterns

`muxinc/ai` focuses on title, description, and tags. Forge also wants `topics`, `speakers`, and `language`.

This plan keeps the richer Forge artifact shape, but applies better structure to the fields Mux already handles well:

- strong title generation rules
- better descriptions
- cleaner tags

Then it carries those gains into the richer local schema.

## Technical Approach

Refactor [metadata.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/services/metadata.ts) into:

- `buildMetadataPrompt(...)`
- `normalizeMetadata(...)`
- `validateMetadataQuality(...)`
- `extractMetadata(...)`

Potential internal option type:

```ts
type MetadataGenerationOptions = {
  tone?: "neutral" | "playful" | "professional"
  outputLanguage?: string
  cleanTranscript?: boolean
  promptOverrides?: Partial<{
    task: string
    title: string
    description: string
    tags: string
    qualityGuidelines: string
  }>
}
```

These can remain internal-only at first. The value is in making the service easier to evolve and test.

## Red / Green TDD Plan

### Phase 1: Red

Expand [metadata.test.ts](/Users/o/.codex/worktrees/1ec2/forge/apps/manager/src/services/metadata.test.ts) with failing tests for:

- duplicate tags are deduped before artifact write
- blank tags are removed
- overly long or blank titles fail validation
- filler phrases like `the video shows` or `this video features` are rejected
- configured tag caps are enforced
- output language guidance is included in the generated prompt
- prompt overrides change only the targeted section
- blank-but-schema-valid metadata still fails loudly

### Phase 2: Green

Implement only enough to satisfy those tests:

- prompt section builder
- metadata normalization helper
- quality validation helper
- retry wrapper around the LLM call if missing

### Phase 3: Refactor

After green:

- simplify helper naming and types
- remove duplicated string rules
- centralize filler-phrase checks and tag normalization
- keep public artifact behavior stable

### Phase 4: Optional higher-bar validation

Add one deterministic fixture-based quality suite inspired by `muxinc/ai` evals:

- title is concise and non-filler
- description is informative and non-meta
- tags are unique and bounded

This should stay mocked, not provider-live.

## Phase 2 Option: Storyboard-assisted metadata

If transcript-only improvements still produce weak titles/descriptions, a follow-on slice can add optional storyboard context inspired by `muxinc/ai`'s multimodal summarization path.

That is intentionally deferred because it adds:

- image fetching complexity
- larger prompts
- possible provider behavior changes

and is not required to capture the first quality win.

## Acceptance Criteria

- [ ] Metadata prompt construction is split into auditable sections
- [ ] Title, description, and tags are normalized before artifact write
- [ ] Filler-style metadata is rejected instead of silently stored
- [ ] Forge keeps its richer metadata schema and current artifact key
- [ ] Automated tests cover tag dedupe, tag caps, filler-phrase rejection, and prompt section overrides
- [ ] No new provider or environment variable is required for this improvement

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

## Risks / Tradeoffs

- Harder validation may surface more metadata failures in the short term.
- Keeping Forge-specific fields means we cannot copy `muxinc/ai` output shape directly.
- Storyboard support is intentionally deferred, so transcript-only metadata may still have quality ceilings on some videos.

## Not Doing

- No `@mux/ai` package adoption
- No forced switch to native `@mux/ai` artifact shape
- No direct provider migration off OpenRouter in this plan
- No UI redesign tied to metadata schema changes
