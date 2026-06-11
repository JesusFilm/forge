---
id: "feat-177"
title: "Watch Subtitle Overlay Forge Track Guard"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-06-11"
duration: 1
depends_on:
  - "feat-035"
blocks: []
tags:
  - "web"
  - "ai-pipeline"
  - "graphql"
---

## Problem

The Watch player can render captions from Mux-native generated subtitle tracks even when the language/subtitles modal has no selectable subtitle for that language. On `watch/jesus.html/english.html`, Mux exposes an English `Generated subtitles` HLS text track while Forge's modal options are sourced from admin `VideoEdition.subtitles`. The overlay should reflect only the subtitle state selected through Forge's modal.

## Entry Points — Read These First

1. `apps/web/src/components/watch/SubtitleOverlay.tsx` — overlay currently listens to any active `subtitles` or `captions` text track on the player.
2. `apps/web/src/components/watch/HeroPlayer.tsx` — injects Forge-selected VTT tracks with label `__forge_subtitle__` and disables built-in tracks when subtitle state is known.
3. `apps/web/src/components/watch/WatchPageClient.tsx` — computes `subtitleVttSrc` from admin-backed `video.subtitles` and persisted subtitle preference.
4. `apps/web/src/components/watch/LanguagePickerModal.tsx` — renders selectable subtitle languages from the admin-backed subtitle list.
5. `apps/web/src/lib/content.ts` — normalizes `VideoEdition.subtitles` into `WatchVideoRecord.subtitles`.

## Grep These

- `SubtitleOverlay` in `apps/web/src/components/watch/`
- `__forge_subtitle__` in `apps/web/src/components/watch/`
- `subtitleVttSrc` in `apps/web/src/components/watch/`
- `textTracks` in `apps/web/src/components/watch/`

## What To Build

1. Add a single shared label constant for Forge-injected subtitle tracks in the Watch player code.
2. Update `SubtitleOverlay` so it only attaches cue listeners to the Forge-injected subtitle track, never to Mux-native or generated tracks such as `Generated subtitles`.
3. Keep the existing `HeroPlayer` behavior that disables built-in tracks and injects the selected Forge VTT track.
4. Add focused tests that prove native Mux/generated subtitle tracks are ignored and the Forge track still renders cues.

## Constraints

- Do not add English to the modal unless admin `VideoEdition.subtitles` contains an English VTT row.
- Do not disable Mux metadata, chapter, or thumbnail tracks.
- Do not change subtitle preference persistence, language switching, audio routing, or GraphQL payload shape.
- Do not hand-edit generated GraphQL output.

## Verification

- `pnpm --filter @forge/web test -- src/components/watch/__tests__/SubtitleOverlay.test.tsx`
- `pnpm --filter @forge/web test -- src/components/watch/__tests__/HeroPlayer.test.tsx`
- Browser smoke on a Watch page where Mux exposes generated subtitles: no overlay appears until a Forge modal subtitle is enabled, and enabling a Forge subtitle still displays cues.
