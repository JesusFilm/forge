---
id: "feat-146"
title: "Watch Transcript Audio Language Match"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-05-29"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "video"
  - "subtitles"
---

## Problem

The watch page transcript section can render a subtitle track whose language
does not match the selected audio language. This makes the transcript panel
look authoritative even when it belongs to a different dub.

## Entry Points - Read These First

1. `apps/web/src/components/watch/SubtitleTranscript.tsx` - transcript panel
   selection and rendering logic.
2. `apps/web/src/components/watch/WatchPageClient.tsx` - passes the selected
   audio language slug and subtitle list into the transcript panel.
3. `apps/web/src/components/watch/__tests__/SubtitleTranscript.test.tsx` -
   pure transcript parser coverage and regression home for transcript helpers.

## Grep These

- `watch-subtitle-transcript`
- `pickInitialSubtitleSlug`
- `audioSlug`
- `subtitles.length === 0`

## What To Build

1. Only allow transcript subtitles whose `language.slug` matches the selected
   audio language slug.
2. Render no transcript/subtitle section when the selected audio language has
   no matching subtitle track.
3. Preserve the existing fallback behavior only when no audio slug is known.
4. Add focused regression coverage for the mismatch case.

## Constraints

- Do not change subtitle overlay preference storage.
- Do not change video/audio variant selection.
- Do not change VTT parsing or cue offset normalization.

## Verification

- `pnpm --filter @forge/web test -- src/components/watch/__tests__/SubtitleTranscript.test.tsx src/components/watch/__tests__/SubtitleTranscript.render.test.tsx`
