---
id: "feat-192"
title: "Biblical subtitle translation context"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-06-16"
duration: 1
depends_on:
  - "feat-184"
blocks:
  - "feat-193"
tags:
  - "manager"
  - "mastra"
  - "subtitle-enrichment"
  - "gospel-content"
---

## Problem

Mastra subtitle enrichment currently prompts translation as generic natural
language translation. Many Forge videos are Christian gospel media, and some are
direct Bible stories where generated subtitles should stay close to familiar
Bible phrasing in the target language instead of drifting into generic
paraphrase.

## Entry Points - Read These First

1. `docs/plans/2026-06-16-001-feat-biblical-subtitle-translation-context-plan.md`
   - implementation plan and scope boundary.
2. `docs/roadmap/media-generation/feat-184-mastra-subtitle-enrichment-execution.md`
   - existing Manager/Mastra subtitle ownership split.
3. `apps/admin/src/services/manager-read-model.service.ts`
   - Manager enrichment read model that supplies title and label context.
4. `apps/manager/src/workflows/videoEnrichment.ts`
   - Manager workflow step that calls Mastra subtitle enrichment.
5. `apps/mastra/src/services/subtitle-enrichment/`
   - Mastra-owned subtitle translation, retiming, and artifact writes.

## Grep These

- `ManagerVideoForEnrichment`
- `translationContext`
- `runSubtitleEnrichment`
- `buildSystemPrompt`
- `detectSubtitleScriptureContext`

## What To Build

- Add nullable title and label context to Admin's
  `ManagerVideoForEnrichment` contract.
- Pass optional video title, video label, and known Bible references from
  Manager into the Mastra subtitle enrichment service route.
- Add Mastra-local scripture-context detection that classifies source material
  as Bible story, gospel teaching, Christian general content, or other.
- Use that context to steer subtitle translation prompts toward faithful
  Christian gospel translation and close Bible-story phrasing when likely.
- Keep retiming focused on timing and segmentation without paraphrasing the
  translated text.
- Preserve existing subtitle artifact keys and Manager language-result shapes.

## Constraints

- Do not fetch licensed Bible passage text or add a Bible API in this slice.
- Do not add doctrinal validation, publication approval, or human review UI.
- Do not move Manager job state, operator UI, or Mux sync into Mastra.
- Do not store prompts, provider keys, raw full transcripts, or hidden model
  reasoning in subtitle artifacts.
- Do not hand-edit generated GraphQL artifacts without regenerating the matching
  contract outputs.

## Verification

- `pnpm --filter @forge/admin test -- manager-read-model.service schema.test`
- `pnpm --filter @forge/manager test -- admin-client route.test videoEnrichment mastra-subtitle-enrichment`
- `pnpm --filter @forge/mastra test -- subtitle-enrichment`
- `pnpm --filter @forge/admin schema:print`
- `pnpm --filter @forge/admin-graphql generate`
