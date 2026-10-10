---
title: "feat: Add Video.js chapters to job detail review player"
type: feat
status: completed
date: 2026-04-12
roadmap:
  - /docs/roadmap/media-generation/feat-085-job-detail-review-player-videojs-chapters.md
  - /docs/roadmap/media-generation/feat-082-job-detail-enrichment-review-player.md
brainstorm:
  - /docs/brainstorms/2026-04-12-job-detail-review-player-videojs-chapters-brainstorm.md
---

# feat: Add Video.js chapters to job detail review player

## Overview

Add native Video.js chapter navigation to the manager job detail review player.
The player should use the generated `chapters-vtt` artifact as a
`kind="chapters"` remote text track so operators can open the Video.js chapters
menu and seek between generated chapter cues from the player controls.

This is a focused follow-up to `feat-082`. `After` remains the generated job
output state and is the only state that can expose generated chapter navigation
in this milestone. `Before` remains the current live Mux/CMS state and should
continue to report `no_live_chapters` until a live CMS chapter source exists.

## Found Brainstorm

Found brainstorm from 2026-04-12:
[docs/brainstorms/2026-04-12-job-detail-review-player-videojs-chapters-brainstorm.md](/Users/o/.codex/worktrees/64d9/forge/docs/brainstorms/2026-04-12-job-detail-review-player-videojs-chapters-brainstorm.md).
Using it as context for planning.

Key decisions already made:

- Use native Video.js chapters UI/control bar, not custom playback-line markers.
- Use a WebVTT chapter track with `kind="chapters"`.
- Prefer `chapters-vtt` as the player-facing representation while keeping
  `chapters.json` canonical.
- Show generated `After` chapters first; do not invent live `Before` chapters.
- Keep the review card read-first and preserve the `Before`/`After`
  `aria-pressed` button-group semantics.

## Research Decision

Local context is strong because `packages/video-player`, the manager review
context, and `chapters-vtt` artifact contracts already exist. External research
is still required because the request explicitly depends on Video.js chapter
behavior.

External sources used:

- [Video.js Text Tracks guide](https://videojs.org/guides/text-tracks/) — chapter
  tracks are a supported text-track kind for video navigation; the `default`
  attribute is required for the chapters menu to show; remote text tracks are
  recommended because they can be removed.
- [Video.js Components guide](https://videojs.com/guides/components) — the
  default `ControlBar` includes `ChaptersButton`, hidden unless relevant tracks
  exist.
- [Video.js Options guide](https://videojs.com/guides/options/) — component
  options can be configured through player options such as `controlBar`.
- [Video.js ChaptersButton source docs](https://docs.videojs.com/control-bar_text-track-controls_chapters-button.js.html) —
  `ChaptersButton` selects `kind="chapters"` tracks and its menu items seek the
  player to cue start times.

## Repo Workflow Notes

- Current branch: `feat/job-detail-review-player-videojs-chapters`.
- PR target: `main`.
- Commit style: conventional commits, for example
  `feat(manager): add review player chapter navigation`.
- Never skip hooks with `--no-verify`.
- Before opening a PR, run package-specific validation plus CI-sensitive format
  checks because `.github/workflows/ci.yml` always runs `pnpm run format:check`
  and affected package lint/typecheck/test jobs.

## Current State

### Manager Review Player

- `apps/manager/src/features/jobs/live-job-detail-screen.tsx` renders
  `ReviewPlayerCard` below the job detail page's `Error Log` and fetches
  `/api/jobs/[id]/review-context`.
- `apps/manager/src/features/jobs/review-player/load-job-review-context.ts`
  builds `before` from live CMS/Mux state and `after` from generated artifacts.
  It currently reads `chapters.json` into `after.chapters` and hardcodes
  `before.chapters` as `no_live_chapters`.
- `apps/manager/src/features/jobs/review-player/review-player-presenter.ts`
  selects review mode and subtitle language while preserving one stable playback
  URL.
- `apps/manager/src/features/jobs/review-player/review-player-card.tsx` passes
  only subtitle tracks into `@forge/video-player` and renders its own custom
  play, mute, fullscreen, range scrubber, and time display.

### Shared Video Player

- `packages/video-player/src/useVideoPlayerCore.ts` is the shared Video.js hook.
  It currently initializes Video.js with `controls: false` and registers remote
  tracks through `addRemoteTextTrack(...)`.
- The hook already accepts `VideoPlayerTextTrack.kind` values including
  `"chapters"`, but existing manager code never passes a chapter track.
- `packages/video-player/src/useVideoPlayerCore.test.tsx` already verifies that
  chapter tracks are registered and removed without remounting the player.

### Chapter Artifacts

- `apps/manager/src/lib/job-artifacts.ts` already resolves `chapters-vtt` as a
  downloadable `text/vtt` artifact and exposes it through the existing artifact
  route.
- `docs/plans/2026-04-09-feat-add-chapters-vtt-artifact-plan.md` establishes
  `chapters.json` as canonical and `chapters-vtt` as derived only when chapter
  timing is bounded.

## Proposed Solution

Add a small review-context chapter-track contract and an opt-in native Video.js
control mode.

The manager loader should surface a generated chapter track on the `After`
snapshot only when `job.artifacts["chapters-vtt"]?.kind === "downloadable"`.
The URL should come from the existing artifact route via `buildArtifactHref`, so
the player wrapper stays thin and does not need to know artifact-route details.

The presenter should carry that track into `state.player`, independent of the
selected subtitle language. The manager player wrapper should pass both the
selected subtitle track and the generated chapter track to `useVideoPlayerCore`.
The chapter track must be registered with `kind: "chapters"` and `default: true`
so Video.js can expose the chapters menu.

The shared hook should gain an opt-in mode for native Video.js controls, likely
`controls?: "custom" | "native"` or `nativeControls?: boolean`. The default
must preserve the existing custom-control behavior for current web and manager
consumers. The manager review-player surface can then opt into native controls
for this feature without accidentally changing the web player.

Keep the existing chapter outline below the player driven by `chapters.json`,
even when `chapters-vtt` is missing. Native chapter navigation is the only part
that should be gated on the WebVTT artifact.

## Implementation Plan

### Phase 1: Red Tests for Review Context

- Add failing tests in
  `apps/manager/src/features/jobs/review-player/load-job-review-context.test.ts`
  that expect:
  - `after` includes a player-facing chapter track URL when `chapters-vtt` is
    downloadable.
  - `after.chapters` still comes from `chapters.json`.
  - `before.chapters` remains `no_live_chapters`.
  - JSON-only chapter jobs keep the chapter outline data but have no native
    chapter track.
- Add or extend tests in
  `apps/manager/src/features/jobs/review-player/review-player-presenter.test.ts`
  that expect:
  - the chapter track is present only in `After`.
  - the chapter track is independent of subtitle language selection.
  - switching to `Before` removes the chapter track without changing the stable
    playback URL.

Expected red state: TypeScript/test failures because the review types do not
yet have a chapter-track field.

### Phase 2: Green Review Contract

- Extend `apps/manager/src/features/jobs/review-player/review-player-types.ts`
  with a small chapter track shape. Prefer a dedicated field, for example:

  ```ts
  export type ReviewChapterTrack = {
    languageCode: string
    label: string
    src: string
    source: "artifact"
    isGenerated: true
  }
  ```

- Put that track under the chapter domain or snapshot where it is close to the
  generated chapter data, for example:

  ```ts
  chapters: {
    status: "available"
    value: {
      chapters: ReviewChapter[]
      track?: ReviewChapterTrack
    }
  }
  ```

- In `load-job-review-context.ts`, create the track only when `chapters-vtt` is
  downloadable:

  ```ts
  const afterChapterTrack =
    job.artifacts["chapters-vtt"]?.kind === "downloadable"
      ? {
          languageCode: job.sourceLanguageCode?.toLowerCase() ?? "und",
          label: "Generated chapters",
          src: buildArtifactHref(job.id, "chapters-vtt"),
          source: "artifact",
          isGenerated: true,
        }
      : undefined
  ```

- Thread the track through `buildReviewPlayerState(...)` into `state.player`
  without coupling it to subtitle language.

### Phase 3: Red Tests for Native Video.js Controls

- Add failing tests in `packages/video-player/src/useVideoPlayerCore.test.tsx`
  that expect an opt-in native-controls mode to:
  - initialize Video.js with `controls: true` while preserving the default
    `controls: false`.
  - register a `kind: "chapters"` track with `default: true` when requested.
  - keep subtitle track selection behavior intact.
  - reuse the existing player instance when chapter tracks appear/disappear.
- Keep the existing progress/time regression test intact for custom controls.
  Native-controls mode may not need `sliderRef`/`timeRef`, but custom consumers
  must keep the requestAnimationFrame time sync behavior.

Expected red state: tests fail because the hook has no native-controls option
and chapter tracks currently default to `false` unless the caller opts in.

### Phase 4: Green Shared Player Hook

- Add an opt-in controls option to `VideoPlayerCoreOptions`, defaulting to the
  current custom mode.
- Build Video.js options from `VIDEO_JS_OPTIONS` without changing defaults for
  existing consumers.
- For native mode, set `controls: true` and rely on the default `ControlBar`
  instead of the manager's custom playback line for chapter navigation.
- Preserve remote text-track cleanup through `removeRemoteTextTrack(...)`.
- Do not change `apps/web` player behavior in this PR unless a test proves an
  opt-in type update is required.

### Phase 5: Red/Green Manager Player UI

- Update `ReviewVideoPlayer` in
  `apps/manager/src/features/jobs/review-player/review-player-card.tsx` to pass
  both tracks:
  - selected subtitle track, when present
  - generated chapter track, when present, with `kind: "chapters"` and
    `isDefault: true`
- Opt this review-player surface into native Video.js controls.
- Hide or bypass the manager custom hitbox, surface buttons, and custom control
  row for native-controls mode so the UI does not present competing playback
  controls.
- Keep the mute/fullscreen behavior available through Video.js native controls.
- Keep the existing generated chapter outline panel below the player.
- Add a component-level render test if practical, especially if the existing
  `.context/compound-engineering/todos/033-pending-p3-add-review-player-card-render-test.md`
  remains unresolved when implementation starts. At minimum, cover the track
  construction in presenter/unit tests and use a browser smoke for actual
  Video.js menu behavior.

### Phase 6: User Smoke Test

Run a user-facing smoke test before marking the work done:

1. Start manager locally with the usual environment (`pnpm fetch-secrets` if
   needed, then `pnpm --filter @forge/manager dev`).
2. Open a completed job detail page with `chapters-vtt`.
3. Confirm `After` is default and the review card still appears below `Error Log`.
4. Confirm the Video.js control bar exposes a chapters menu/button.
5. Select a chapter and confirm playback seeks to the chapter's start.
6. Change subtitle language and confirm chapter navigation remains available.
7. Switch to `Before` and confirm it still reports live chapters unavailable.
8. Open or simulate a job with `chapters.json` but no `chapters-vtt` and confirm
   the outline still renders and there is no broken chapter control.
9. Capture screenshots or a short note of the tested job IDs/states in the PR
   description.

## Acceptance Criteria

- [x] `After` review state exposes native Video.js chapter navigation when
      `chapters-vtt` is downloadable.
- [x] Selecting a chapter from the Video.js chapter UI seeks playback to that
      cue's start time.
- [x] `Before` review state remains explicitly `no_live_chapters`.
- [x] Jobs with `chapters.json` but no `chapters-vtt` preserve the existing
      chapter outline panel and do not show broken chapter UI.
- [x] Subtitle tracks continue to load and language selection stays independent
      of chapter navigation.
- [x] The shared player hook defaults remain unchanged for existing custom
      control consumers.
- [x] The `Before`/`After` switch remains a button group with `aria-pressed`.
- [x] Red/green TDD is followed for the review context, presenter, and shared
      player hook changes.
- [x] A browser/user smoke test verifies the native chapters UI on a real
      manager job detail page.

## Risks And Mitigations

- **Shared package regression:** `@forge/video-player` is used outside this
  manager surface. Mitigate by making native controls opt-in and adding tests
  that prove defaults stay custom.
- **Missing `chapters-vtt`:** not every job has the derived artifact. Mitigate
  by gating only native chapter navigation on `chapters-vtt` and keeping the
  JSON outline panel.
- **Broken or unreadable VTT:** the browser can fail to load a track even when
  the manifest says it exists. Mitigate by keeping the review card usable and
  documenting smoke coverage; do not fail the whole review context for a
  track-load problem. If the VTT track is absent or fails to load, the native
  chapter control stays absent/hidden while the `chapters.json` outline remains
  usable.
- **Control-bar layout drift:** native Video.js controls will look different
  from the existing custom range. Mitigate by limiting the change to the review
  player and using the existing manager visual frame around the player.
- **Polling churn:** avoid tying chapter-track availability to unrelated job
  `updatedAt` changes; use the same review-context refresh boundary already in
  place.

## Verification

Red/green target tests:

```bash
pnpm --filter @forge/video-player test -- src/useVideoPlayerCore.test.tsx
pnpm --filter @forge/manager test -- src/features/jobs/review-player/load-job-review-context.test.ts src/features/jobs/review-player/review-player-presenter.test.ts
```

Pre-PR validation:

```bash
pnpm --filter @forge/video-player test
pnpm --filter @forge/video-player typecheck
pnpm --filter @forge/video-player lint
pnpm --filter @forge/manager test -- src/features/jobs/review-player/load-job-review-context.test.ts src/features/jobs/review-player/review-player-presenter.test.ts src/app/api/jobs/[id]/review-context/route.test.ts src/lib/job-artifacts.test.ts
pnpm --filter @forge/manager typecheck
pnpm --filter @forge/manager lint
pnpm run format:check
```

User smoke test:

- Completed job with `chapters-vtt`: verified the native Video.js chapter menu
  appears, lists `Opening` and `Teaching`, selecting `Teaching` seeks playback
  to 8 seconds, subtitle selection still works, and the chapter outline still
  renders.
- Job without `chapters-vtt`: verified the player and `chapters.json` outline
  still render and the visible native control-bar chapters button is absent.
- `Before` mode: verified live chapters remain unavailable and the review card
  stays coherent.

## Out Of Scope

- Creating live CMS chapter relations or showing live `Before` chapters.
- Replacing `chapters.json` as the canonical chapter artifact.
- Custom chapter markers on the manager range input.
- Moving subtitle override, embedding sync override, or other mutating actions
  into the review player.
- Redesigning the full job detail page or the web watch player.

## Handoff

Implementation completed on `feat/job-detail-review-player-videojs-chapters`.
Red/green tests and the browser smoke test passed; update `feat-085` to
`complete` with this implementation commit.
