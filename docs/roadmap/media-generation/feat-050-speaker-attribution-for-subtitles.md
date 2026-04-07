---
id: "feat-050"
title: "Speaker Attribution for Subtitles"
owner: "vlad"
priority: "P1"
status: "not-started"
start_date: "2026-05-01"
duration: 31
depends_on:
  - "feat-031"
blocks: []
tags:
  - "manager"
  - "web"
  - "subtitles"
---

## Problem

Generated subtitles currently treat all dialogue as a single anonymous stream. For interviews, conversations, and teaching formats, viewers and editors need speaker-aware subtitle output so captions are easier to follow and later translation or QA work can preserve who said what.

## Entry Points — Read These First

1. `apps/manager/src/services/transcription.ts` — transcript generation and subtitle artifact creation
2. `apps/manager/src/workflows/videoEnrichment.ts` — where speaker-aware subtitle generation would run
3. `apps/cms/src/api/video-subtitle/content-types/video-subtitle/schema.json` — subtitle storage contract in CMS
4. `apps/web/src/components/sections/Video.tsx` — player subtitle consumption path
5. `apps/web/src/components/sections/VideoHero.tsx` — hero subtitle parity path
6. `apps/cms/schema.graphql` — GraphQL contract exposed to web/mobile consumers

## Grep These

- `ai_generated|vttSrc` in `apps/cms/`
- `subtitle track|captions|track` in `apps/web/src/components/sections/`
- `transcribe|subtitle` in `apps/manager/src/`
- `speakers` in `apps/manager/src/services/metadata.ts`

## What To Build

1. Extend the subtitle pipeline so a transcript can optionally carry speaker labels or speaker-segment metadata.
2. Decide whether speaker attribution lives inside enriched VTT cues, a parallel artifact, or both.
3. Update CMS and GraphQL contracts only as needed so speaker-aware subtitle data can be stored and consumed safely.
4. Preserve a clean fallback for videos where speaker attribution is unavailable or unreliable.
5. Make sure subtitle rendering remains readable when speaker labels are shown.

## Constraints

- Do NOT require speaker attribution for every subtitle track.
- Prefer additive schema changes over breaking the existing subtitle contract.
- Keep viewer UX readable on mobile-sized players; speaker labels should help, not clutter.

## Verification

- Run the pipeline on a multi-speaker video and confirm speaker labels survive into the saved subtitle artifact
- Confirm subtitle playback still works for videos without speaker attribution
- Validate that any GraphQL additions compile cleanly in consuming apps
