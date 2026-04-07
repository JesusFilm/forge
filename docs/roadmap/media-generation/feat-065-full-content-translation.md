---
id: "feat-065"
title: "Full Content Translation"
owner: "vlad"
priority: "P2"
status: "not-started"
start_date: "2026-10-01"
duration: 61
depends_on:
  - "feat-049"
blocks: []
tags:
  - "translation"
  - "ai-pipeline"
  - "media"
---

## Problem

Current translation work improves parts of the enrichment pipeline, but the platform still needs a fuller translation story across subtitles, supporting metadata, audio previews, and possibly generated outputs. Full content translation is required to move from experimental multilingual support to broad usable coverage.

## Entry Points — Read These First

1. `apps/manager/src/services/translation.ts` — current translation path
2. `apps/manager/src/workflows/videoEnrichment.ts` — translation step orchestration
3. `apps/cms/src/api/video-subtitle/content-types/video-subtitle/schema.json` — translated subtitle storage
4. `apps/cms/src/api/language-audio-preview/content-types/language-audio-preview/schema.json` — translated audio preview contract
5. `docs/roadmap/media-generation/feat-049-alternative-transcription-and-translation-models.md` — provider benchmark input

## Grep These

- `translation` in `apps/manager/src/`
- `video-subtitle` in `apps/cms/src/api/`
- `language-audio-preview` in `apps/cms/src/api/`
- `targetLanguage` in `apps/manager/src/services/translation.ts`

## What To Build

1. Define the translation surface area that counts as "full content translation" for the platform.
2. Support translation output across the relevant media and metadata entities with consistent storage contracts.
3. Decide how translation quality is reviewed and when a translation can be published automatically.
4. Make the workflow extensible to more languages without turning every run into a custom case.

## Constraints

- Do NOT treat translated metadata as equivalent to a full translated viewing experience unless subtitles or audio are covered too.
- Prefer one translation contract across related entities where possible.
- Keep provider and cost assumptions explicit.

## Verification

- A video can move through a multi-language translation workflow end to end
- Translation outputs are stored in the right CMS entities or artifacts
- Editors can inspect translated outputs before publication when needed
