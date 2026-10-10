---
id: "feat-280"
title: "Experience Video Block Language Identity"
owner: "codex"
priority: "P1"
status: "complete"
start_date: "2026-07-22"
duration: 1
depends_on:
  - "feat-275"
blocks: []
tags:
  - "platform"
  - "admin"
  - "media"
  - "editor"
---

## Problem

Experience blocks can reference `videoId` and persisted `streamingUrl` without
capturing which Language row the media selection belongs to. That makes
localized clip authoring ambiguous because clip start/end values are meaningful
only for the selected language dub timeline.

## Entry Points

1. `apps/admin/src/domain/blocks.ts` — persistence-layer block schema.
2. `apps/admin/src/app/dashboard/experiences/experience-editor/block-helpers.ts` — editor save normalization.
3. `apps/admin/src/app/dashboard/experiences/[id]/page.tsx` — selected locale language lookup.
4. `apps/admin/src/app/dashboard/experiences/experience-editor.tsx` — save payload and picker writes.
5. `apps/admin/src/graphql/types/blocks.ts` — nested `videoDub` resolution from block identity.
6. `packages/admin-graphql/src/fragments/blocks/*` — consumer contract fragments.
7. `apps/web`, `apps/mobile`, `apps/tv` section renderers — playback URL derived from nested dub data.
8. `apps/admin/src/scripts/*` — seed/backfill normalization coverage.

## Grep These

- `videoId`
- `streamingUrl`
- `normalizeEditorBlocks`
- `VideoCarouselItemSchema`
- `MediaCollectionItemSchema`

## What To Build

1. Add `languageId` to video-bearing block shapes.
2. Store the selected dub's `Language.id` when adding/selecting videos through
   the editor picker.
3. Add a server-side and scriptable backfill that chooses the experience
   locale's `Language.id` only when that specific video has a playable dub in
   that language; otherwise it falls back to English.
4. Run the server-side backfill during experience create, locale create,
   locale update, chat mutation, and revision restore so new writes cannot
   persist ambiguous video selections.
5. Remove static stream URLs from saved blocks, seeds, and consumer fragments.
6. Expose nested `videoDub` on video-bearing block GraphQL types so consumers
   derive playback from the current dub row.

## Constraints

- Do not hard-code environment-specific Language cuid values.
- Do not persist `streamingUrl` on blocks; tolerate old JSON only long enough
  for normalization/backfill to strip it.
- Do not make schema reads fail for old persisted JSON that lacks `languageId`.
- Seeds must resolve fixture video identity into `videoId + languageId` before
  writing blocks.

## Verification

- `pnpm --filter @forge/admin test -- src/services/experience-video-language-backfill.test.ts src/app/dashboard/experiences/experience-editor.test.tsx src/app/dashboard/experiences/experience-editor/block-helpers.test.ts src/domain/blocks.test.ts src/graphql/types/blocks.test.ts`
- `pnpm --filter @forge/admin typecheck`
- `pnpm --filter @forge/admin-graphql typecheck`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/mobile typecheck`
- `pnpm --filter @forge/tv typecheck`
- `pnpm --filter @forge/admin backfill:experience-video-language-ids`
