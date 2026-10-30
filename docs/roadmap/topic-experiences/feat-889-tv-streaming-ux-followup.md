---
id: "feat-889"
title: "Resolve reviewed Watch TV streaming UX improvements"
owner: "ekkasit"
priority: "P1"
status: "in-progress"
start_date: "2026-10-28"
duration: 3
depends_on: []
blocks: []
tags: [tv, apple-tv, android, ux, accessibility, playback]
---

## Problem

The API-connected simulator review exposed four bounded areas: changing dub may
change story position, Apple TV pre-play track selection lacks search, native
search cards repeat titles and omit useful content types, and detail/player text
has specific readability problems. The owner authorized these areas together
and requested agents combine their work into one local integration branch.

## Entry Points — Read These First

- `docs/plans/2026-10-28-tv-streaming-ux.md`
- `apps/tv/CLAUDE.md`
- `apps/tv/src/components/watch/LanguagePanel.tsx`
- `apps/tv/src/components/watch/SubtitlePanel.tsx`
- `apps/tv/src/components/search/nativeSearchResults.ts`
- `apps/tv/modules/native-swift-player/ios/NativeSwiftPlayerView.swift`
- `apps/tv/modules/native-android-player/android/src/main/java/expo/modules/nativeandroidplayer/NativeAndroidPlayerView.kt`
- `apps/tv/src/components/watch/VideoBackdrop.tsx`

## Grep These

`activeVariantIndex|resumeAtSeconds|selectedAudioId|transportBarCustomMenuItems|subtitle: result.label|scrim|ellipsize`

## What To Build

1. Investigate the JESUS English North American Indigenous to Thai switch at
   18:22. Confirm edition/asset and timeline facts before changing behavior.
   Preserve position and pause intent; never infer scene mapping from a duration
   ratio or guessed offset. Implement only a correction justified by evidence.
2. Add searchable audio and subtitle selection to Apple TV detail panels before
   playback, reusing native search patterns where possible. Preserve independent
   audio/subtitle selection, current choices, error/empty states and focus/Back.
3. Fix Apple TV native search card titles and content-type presentation without
   changing native text input, Siri dictation, routing, or spatial focus behavior.
4. Improve the detail text scrim and full selected-language readability. Measure
   contrast before changing secondary tokens; avoid a global palette sweep.
5. Deliver an English screenshot checklist with persistent local checkboxes.

## Constraints

Keep Native A on Apple TV, native Media3 on Android, hidden Profile, analytics,
recommendations and feedback behavior. No app-context cross-imports or generated
GraphQL edits. Use modules/config plugins/committed patches for native changes.
Production publication follows the normal PR-to-main flow; the owner authorized push and merge on 2026-10-29 once checks are clear. Preserve the user's existing checkout
and simulator data. Physical-device checks require separately available targets.

## Verification

Focused behavioral tests; TV typecheck, lint, Jest and touched-file formatting;
applicable native builds; both target smoke journeys and comparable performance
checks for changed loading/rendering. Validate typed search, selection, Back,
focus, readable worst-case backgrounds, native result announcements and actual
video playback. Record exact limitations. Review and merge task branches into
`codex/tv-streaming-ux`; update this ticket only when required work is verified.

## Current state — 2026-10-28

All four implementation tracks are merged locally on `codex/tv-streaming-ux`.
Integrated static checks, Apple/Android native builds and the changed functional
journeys pass. The English screenshot checklist is ready. Keep this ticket
`in-progress`: Android startup observations remain inconclusive, with all samples
and positive/negative deltas retained in the plan and harness evidence. Do not
turn this limitation into a passing performance claim. The combined Chromecast
APK is prepared; the owner explicitly chose to leave installation for later.

## Publication review — 2026-10-29

PR #2954 contains the integrated changes. Refreshed TV static checks and all
2,425 tests pass. Targeted Android detail-path measurements show 0.715 ms added
median normalization work, one request per query, and 2,928 extra gzip bytes
(1.070%). The approximate under-1% payload expectation was not met; the earlier
whole-startup measurement remains inconclusive. Keep the historical performance
gate and this ticket open until the limitation is explicitly accepted for merge
or reproducible startup evidence resolves it. See the plan for all measurements.
