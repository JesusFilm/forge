---
id: "feat-193"
title: "Subtitle scripture accuracy validation"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-06-16"
duration: 1
depends_on:
  - "feat-192"
blocks:
  - "feat-194"
tags:
  - "manager"
  - "mastra"
  - "subtitle-enrichment"
  - "gospel-content"
  - "validation"
---

## Problem

Biblical subtitle translation now receives gospel-aware context, but operators
still need a lightweight accuracy signal after translation. For Bible-story
videos, the system should compare translated subtitles against the likely
Scripture reference and flag risky paraphrases or doctrinally important drift.

## Entry Points - Read These First

1. `docs/plans/2026-06-16-002-feat-subtitle-scripture-accuracy-validation-plan.md`
   - implementation plan and scope boundary.
2. `docs/roadmap/media-generation/feat-192-biblical-subtitle-translation-context.md`
   - prior scripture-context detection and translation prompt steering.
3. `apps/mastra/src/services/subtitle-enrichment/`
   - Mastra-owned scripture detection, translation, retiming, validation, and
     subtitle artifact writes.
4. `apps/manager/src/services/mastra-subtitle-enrichment.ts`
   - Manager-side service contract parser for Mastra subtitle results.
5. `apps/manager/src/workflows/videoEnrichment.ts`
   - job state and artifact manifest projection for translated subtitles.
6. `apps/manager/src/features/jobs/live-job-steps-table.tsx`
   - live operator display for translation and validation summaries.

## Grep These

- `SubtitleScriptureValidation`
- `validateSubtitleScriptureAccuracy`
- `loadConfiguredBiblePassage`
- `validationSummary`
- `subtitleValidation`
- `subtitle-validation-`

## What To Build

- Add a Mastra-owned subtitle scripture validation pass for translated
  Bible-story subtitles.
- Use model knowledge as the default validation basis so validation still runs
  without a Bible API.
- Support an optional target-language Bible text source for stronger checks
  when `SUBTITLE_VALIDATION_BIBLE_PROVIDER=api_bible`,
  `SUBTITLE_VALIDATION_BIBLE_MAP_JSON`, and `API_BIBLE_API_KEY` are configured.
- Fall back from missing or failing Bible source configuration to
  `basis=model_knowledge` instead of marking validation unavailable.
- Write sanitized per-language validation artifacts and return compact
  validation summaries in Mastra language results.
- Preserve Manager's existing subtitle translation and Mux sync behavior while
  adding validation artifacts to job artifact manifests and live job details.

## Constraints

- Do not store full external Bible passage text in durable artifacts.
- Do not make Bible API availability a blocker for subtitle translation.
- Do not use validation to publish, reject, or block Mux subtitle sync in this
  slice; it is operator-visible advisory signal only.
- Do not move scripture detection, model validation, or Bible-source calls into
  Manager.
- Do not expose raw prompts, provider keys, hidden model reasoning, or
  sensitive request metadata in validation artifacts.

## Verification

- `pnpm --filter @forge/mastra test -- subtitle-enrichment`
- `pnpm --filter @forge/mastra typecheck`
- `pnpm --filter @forge/manager test -- mastra-subtitle-enrichment job-artifacts state videoEnrichment`
- `pnpm --filter @forge/manager typecheck`
