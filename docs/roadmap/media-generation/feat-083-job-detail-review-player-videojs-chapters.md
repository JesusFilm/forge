---
id: "feat-083"
title: "Job Detail Review Player Video.js Chapters"
owner: "vlad"
priority: "P2"
status: "complete"
start_date: "2026-04-13"
duration: 3
depends_on:
  - "feat-082"
blocks: []
tags:
  - "manager"
  - "mux"
  - "video-player"
  - "ai-pipeline"
---

## Problem

The manager job details review player can show generated chapter outlines below
the video, but the player controls do not expose chapter navigation. Operators
reviewing long videos still have to scrub manually or read the separate chapter
list, even though the enrichment pipeline already writes canonical
`chapters.json` and, for timing-backed jobs, a derived `chapters-vtt` WebVTT
artifact suitable for Video.js chapter tracks.

## Entry Points — Read These First

1. `apps/manager/src/features/jobs/review-player/review-player-card.tsx` - current review player shell, custom controls, and chapter list rendering.
2. `apps/manager/src/features/jobs/review-player/load-job-review-context.ts` - review context loader that surfaces generated chapter JSON but not a chapter-track URL today.
3. `apps/manager/src/features/jobs/review-player/review-player-presenter.ts` - mode/language presenter that keeps the player source stable across `Before` and `After`.
4. `apps/manager/src/features/jobs/review-player/review-player-types.ts` - review context and player state contracts to extend for chapter track availability.
5. `packages/video-player/src/useVideoPlayerCore.ts` - shared Video.js hook that already accepts `kind: "chapters"` text tracks and currently configures custom controls.
6. `packages/video-player/src/useVideoPlayerCore.test.tsx` - existing text-track tests, including chapter-track registration.
7. `apps/manager/src/lib/job-artifacts.ts` - artifact descriptor and route mapping for `chapters` and `chapters-vtt`.
8. `docs/plans/2026-04-09-feat-add-chapters-vtt-artifact-plan.md` - chapter WebVTT artifact contract and constraints.
9. `docs/brainstorms/2026-04-12-job-detail-review-player-videojs-chapters-brainstorm.md` - product decisions for native Video.js chapter UI.
10. `https://videojs.org/guides/text-tracks/` - official Video.js text-track guidance for chapter tracks and remote text tracks.
11. `https://videojs.com/guides/components` - official Video.js component tree showing `ChaptersButton` under `ControlBar`.

## Grep These

- `ReviewVideoPlayer\|jobs-review-video-progress\|jobs-review-video-controls` in `apps/manager/src/features/jobs/review-player/ apps/manager/src/app/globals.css`
- `chapters-vtt\|chapters"` in `apps/manager/src/`
- `VideoPlayerTextTrack\|kind: \"chapters\"\|addRemoteTextTrack\|controls:` in `packages/video-player/src/`
- `ChaptersButton\|ControlBar\|ProgressControl` in `node_modules/video.js/` if local package source is available

## What To Build

1. Surface a player-facing chapter track in the manager review context for the generated `After` state when a downloadable `chapters-vtt` artifact exists.
2. Pass the chapter track to the shared Video.js player as `kind: "chapters"` with the right label and language metadata.
3. Use native Video.js control-bar chapter behavior for navigation, rather than drawing custom manager-only markers on the current range input.
4. Keep the existing generated chapter outline panel below the player so operators can still read chapter summaries outside the control bar.
5. Preserve the `Before` state as explicit `no_live_chapters` until a live CMS chapter source exists.
6. Keep the review player read-first: do not move subtitle override, embedding sync override, or other mutating actions into this follow-up.
7. Preserve the existing review mode semantics: the `Before`/`After` switch remains a button group with `aria-pressed`, not an ARIA tablist.

## Constraints

- Follow Video.js documentation for chapter tracks and control-bar chapter UI.
- Do not invent a separate chapter marker model if a Video.js `kind="chapters"` track can satisfy the feature.
- Do not make `chapters.json` non-canonical; `chapters-vtt` remains the player/export representation.
- Do not show fake live `Before` chapters. If the current live state lacks a chapter source, render the established unavailable state.
- Do not cross-import player code from `apps/web` into `apps/manager`.
- Keep app styling aligned with the existing manager visual language and avoid unrelated player redesign.

## Verification

- Open a completed manager job with a `chapters-vtt` artifact and confirm Video.js exposes chapter navigation in the player controls.
- Select a chapter from the native Video.js chapter UI and confirm playback seeks to the expected point.
- Open a job without `chapters-vtt` and confirm the player still works without broken chapter chrome.
- Switch `Before` and `After` and confirm `After` exposes generated chapters while `Before` remains explicit about no live chapters.
- Confirm subtitle tracks still render and can be selected after the chapter-track change.
- `pnpm --filter @forge/video-player test`
- `pnpm --filter @forge/manager test -- src/features/jobs/review-player/load-job-review-context.test.ts src/features/jobs/review-player/review-player-presenter.test.ts`
- `pnpm --filter @forge/manager typecheck`
- `pnpm --filter @forge/manager lint`

## Success Criteria

- Operators can navigate generated chapters from the job detail review player controls.
- The feature uses Video.js chapter-track/control-bar behavior rather than a custom-only marker overlay.
- The existing review player comparison, subtitle, metadata, and chapter-outline behavior continues to work.
