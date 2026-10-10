---
title: "fix: Load Video.js CSS for manager review player"
type: fix
status: completed
date: 2026-04-12
review_finding:
  - /todos/001-complete-p2-videojs-css-not-applied.md
related_pr:
  - https://github.com/JesusFilm/forge/pull/730
---

# fix: Load Video.js CSS for manager review player

## Overview

Fix the manager job detail review player so native Video.js controls are styled
by the official Video.js stylesheet. PR #730 correctly wires generated
`chapters-vtt` tracks into the native Video.js chapter menu, but review smoke
testing found that the control stylesheet is not applied on the manager route.
The first CSS-import fix also proved that the shared Video.js hook must preserve
the `video-js` player-root class for those official styles to match.

## Problem Statement

The review player currently imports `video.js/dist/video-js.css` from
`apps/manager/src/features/jobs/review-player/review-player-card.tsx`, which
lives outside the Next.js `app` directory. The user-like browser smoke test for
PR #730 reached `/dashboard/jobs/job-smoke-vtt` and found that
`.vjs-control-text` renders visibly:

```json
{
  "text": "Play",
  "width": 25.9375,
  "height": 15,
  "clip": "auto",
  "overflow": "visible",
  "position": "static"
}
```

That means the native Video.js control labels are visible in the player instead
of being visually hidden by the Video.js CSS rules. This is a user-facing visual
regression and blocks marking PR #730 ready.

Failure screenshot:
`/Users/o/.codex/worktrees/64d9/forge/output/playwright/review-failing-videojs-css-visible-control-text.png`.

## Research Notes

Relevant local context:

- `apps/manager/src/features/jobs/review-player/review-player-card.tsx:3`
  imports `video.js/dist/video-js.css` today.
- `apps/manager/src/app/layout.tsx:2` imports the manager `globals.css`.
- `apps/manager/src/app/dashboard/layout.tsx` wraps all dashboard routes,
  including `/dashboard/jobs/[id]`.
- PR #730 depends on Video.js native controls because it removes the manager
  custom playback controls and relies on `ChaptersButton`.

Relevant external docs:

- Next.js app-router CSS docs say external package stylesheets can be imported
  from files inside the `app` directory, and recommend keeping global CSS
  imports predictable in a root application entry.
- Video.js setup docs describe Video.js as a DOM-based UI around a
  `class="video-js"` media element and expect Video.js to be loaded on the page
  before creating a player.

## Implemented Solution

Moved the Video.js stylesheet import into the manager app route tree, removed
the feature-level global CSS import, and preserved Video.js player-root classes
inside the shared hook.

Implementation:

1. Add `import "video.js/dist/video-js.css"` to
   `apps/manager/src/app/dashboard/layout.tsx`, near the existing imports.
2. Remove `import "video.js/dist/video-js.css"` from
   `apps/manager/src/features/jobs/review-player/review-player-card.tsx`.
3. Add `video-js` plus any pre-existing media element classes to
   `player.el()` in `packages/video-player/src/useVideoPlayerCore.ts`, because
   browser smoke showed the official Video.js CSS import was present but scoped
   rules still missed when the player root no longer carried `video-js`.
4. Add a package-level regression test proving the player root keeps
   `video-js` and consumer classes.

This keeps the package stylesheet inside the Next.js app-router entry tree
without loading it for non-dashboard manager routes, while preserving the
Video.js DOM contract that the official stylesheet expects.

## Alternative Approaches

### Import In Root App Layout

Move the stylesheet to `apps/manager/src/app/layout.tsx` instead of the
dashboard layout.

- **Pros:** simplest global entry point; matches the existing `globals.css`
  import location.
- **Cons:** loads Video.js CSS for every manager route, including login.

### Import Through `globals.css`

Add an `@import` for Video.js inside `apps/manager/src/app/globals.css`.

- **Pros:** centralizes global CSS.
- **Cons:** ordering needs extra care, and package stylesheet imports are more
  directly represented as layout imports in the Next.js docs.

### Recreate Minimal Local CSS

Add local `.vjs-*` rules to hide control text and style the relevant control
bar pieces.

- **Pros:** very targeted.
- **Cons:** reimplements third-party styling, risks drift with Video.js, and may
  miss other native controls.

## Acceptance Criteria

- [x] `video.js/dist/video-js.css` is imported from a file inside
      `apps/manager/src/app`.
- [x] `review-player-card.tsx` no longer owns the package-level global CSS
      import.
- [x] Browser smoke confirms `.vjs-control-text` is visually hidden by Video.js
      CSS (`width <= 2`, `height <= 2`, and clipped/hidden behavior).
- [x] Native Video.js chapter menu still lists generated `Opening` and
      `Teaching` cues.
- [x] Selecting `Teaching` from the native chapter menu still seeks playback to
      about 8 seconds.
- [x] Switching subtitle language keeps generated chapter navigation available.
- [x] `Before` mode remains explicit about `no_live_chapters` and has no visible
      native chapter control.
- [x] A job with `chapters.json` but no `chapters-vtt` keeps the chapter outline
      and has no visible native chapter control.

## Verification Plan

Run the existing targeted checks:

```bash
pnpm --filter @forge/video-player test
pnpm --filter @forge/manager test -- src/features/jobs/review-player/load-job-review-context.test.ts src/features/jobs/review-player/review-player-presenter.test.ts 'src/app/api/jobs/[id]/review-context/route.test.ts' src/lib/job-artifacts.test.ts
pnpm --filter @forge/video-player typecheck
pnpm --filter @forge/video-player lint
pnpm --filter @forge/manager typecheck
pnpm --filter @forge/manager lint
pnpm run format:check
git diff --check
```

Run the user-like browser smoke against local manager plus mock Strapi:

1. Open `/dashboard/jobs/job-smoke-vtt`.
2. Assert the review player renders.
3. Assert the custom manager playback hitbox/surface controls are absent.
4. Assert `.vjs-control-text` is visually hidden by computed style.
5. Open the native Video.js chapters menu and confirm `Opening` and `Teaching`.
6. Select `Teaching` and confirm playback seeks to about 8 seconds.
7. Select language `EN` and confirm generated chapter navigation remains.
8. Switch to `Before` and confirm live chapters remain unavailable.
9. Open `/dashboard/jobs/job-json-only` and confirm the JSON outline remains
   while the visible native chapter control is absent.
10. Capture updated screenshots for the PR.

## Out Of Scope

- Changing chapter track generation or the `chapters-vtt` artifact contract.
- Reintroducing custom manager playback controls.
- Redesigning the full review player.
- Adding custom Video.js theme overrides beyond loading the official stylesheet.

## Handoff

Completed. Browser verification first reproduced the red state
(`.vjs-control-text` width `25.9375`, `position: static`, `overflow: visible`),
then confirmed the green state after the layout import plus player-root class
fix (`width: 0`, `height: 0`, clipped/hidden behavior in the full smoke; a
natural playback check measured `1x1` after a normal big-play click). Screenshots
were captured in `output/playwright/`.
