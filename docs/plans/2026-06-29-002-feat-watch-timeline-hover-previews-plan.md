---
title: "feat: Watch Timeline Hover Previews"
type: "feat"
status: "completed"
date: "2026-06-29"
roadmap: "docs/roadmap/platform/feat-222-watch-timeline-hover-previews.md"
---

# feat: Watch Timeline Hover Previews

## Overview

Add Mux storyboard hover previews to the web watch page's custom timeline.
The preview should appear above the `HeroPlayerControls` scrub bar after the
viewer has revealed the full player chrome, follow hover/focus/drag position,
and use Mux's storyboard JSON plus image tiles for the selected playback id.
This slice also tidies timeline interaction polish: scrubbed positions should
not visibly snap back to stale media time while the seek settles, and the
focused timeline should lose the odd bright white glow. The timeline should
also have a forgiving hover zone: the visual bar can stay thin, but the thumb
and preview should reveal when the pointer is anywhere around that bar.

## Problem Frame

The single-video watch page already owns a fully custom React chrome surface.
That gives Forge the right control point for timeline previews, but it also
means Mux Player's built-in chrome cannot supply trick-play UI for us. Mux
provides storyboard metadata for public playback ids at `image.mux.com`; the
web app should consume that metadata in the browser and render a small visual
preview without changing media ingestion, admin GraphQL contracts, or the
poster-first hero performance path.

The current timeline state has a visible post-scrub bounce: the UI can move to
the requested position, fall back to the last reported media time, then move
forward again when the media element catches up. That same interaction pass is
the right moment to take clearer ownership of timeline display state and align
focus styling with the rest of the chrome. The hover target should also be
larger than the 1px-tall-looking bar so the user does not have to aim
perfectly to reveal the thumb or preview.

## Requirements Trace

- R1. Timeline hover and scrub position show a visual preview frame when the
  active video has a Mux playback id and storyboard metadata is available.
- R2. The preview is lazy: no storyboard fetch during SSR, initial poster-only
  render, or pre-chrome muted preview.
- R3. The existing timeline seek behavior remains unchanged for click, drag,
  pointer capture, keyboard seek, pause/resume on drag, and coalesced seeks.
- R4. Failure is silent and non-blocking: absent playback id, failed fetch,
  malformed metadata, or missing tiles must leave the timeline usable with no
  preview.
- R5. The preview bubble stays within the timeline/control bounds on desktop
  and mobile, and does not cover adjacent controls.
- R6. The implementation follows existing watch-page performance constraints:
  no extra critical-path image preloads and no new server data dependencies.
- R7. Scrubbed seek state remains visually stable after click/drag release:
  progress, thumb, time readout, and preview stay at the requested target until
  the media element reports a coherent settled time.
- R8. Timeline focus styling removes the bright white glow while preserving an
  accessible, visible focus state.
- R9. Timeline hover, thumb reveal, preview reveal, and pointer seek use a
  forgiving hit zone around the thin visual bar, without making the bar itself
  visually bulky.

## Scope Boundaries

- This plan only changes the single-video watch page hero timeline.
- It does not add timeline previews to inline section players, mobile native,
  TV, manager review players, or admin preview surfaces.
- It does not generate or store custom storyboard assets; it uses Mux-hosted
  storyboard JSON and images.
- It does not support signed playback ids in this slice. If a future signed
  asset appears on public watch pages, storyboard signing should be planned as
  separate backend work.

## Context & Research

### Relevant Code and Patterns

- `apps/web/src/components/watch/HeroPlayerControls.tsx` owns timeline state,
  `computeScrubPct`, pointer-driven scrub, keyboard seek, portal placement,
  and auto-hide.
- `apps/web/src/components/watch/HeroPlayer.tsx` already derives
  `playbackId` from `variant.muxVideo?.playbackId`, renders the poster-first
  hero, and mounts `HeroPlayerControls` only after `chromeRevealed`.
- `apps/web/src/components/watch/__tests__/HeroPlayer.test.tsx` has focused
  custom chrome, timeline keyboard, pointer-driven scrub, fake-timer, and
  MuxVideo backend coverage.
- `packages/video-player/CLAUDE.md` says `apps/web` imports
  `@forge/video-player/mux-video` for the watch-page hero and should not
  reintroduce a MuxPlayer hero fallback.

### Institutional Learnings

- `docs/solutions/design-patterns/mux-player-custom-react-chrome-pattern-20260430.md`:
  custom chrome should keep player values in React state, bind effects to the
  lifted player state, and preserve pointer capture / auto-hide behavior.
- `docs/solutions/performance-issues/watch-hero-muxplayer-to-muxvideo-swap-20260526.md`:
  the watch hero intentionally uses bare `MuxVideo`; CSS custom properties and
  Mux Player chrome affordances are not available.
- `docs/solutions/performance-issues/web-watch-route-lighthouse-perf-campaign-lcp-bundle-fonts-20260527.md`:
  protect the watch route critical path, avoid unnecessary high-priority image
  fetches, and keep Mux work out of initial load where possible.

### External References

- Mux guide: `https://www.mux.com/docs/guides/create-timeline-hover-previews`
  documents storyboard URLs, JSON metadata, tile coordinates, CORS guidance,
  and signed URL caveats.

## Key Technical Decisions

- Use storyboard JSON rather than VTT. The custom React timeline can consume
  `{ url, tile_width, tile_height, duration, tiles[] }` directly and avoid a
  WebVTT parser.
- Fetch storyboard metadata in `HeroPlayerControls`, not in `HeroPlayer`.
  Controls already mount only after chrome reveal, so this naturally preserves
  the lazy-loading requirement.
- Introduce a focused helper, likely `apps/web/src/components/watch/mux-storyboard.ts`,
  for URL construction, response validation, and tile selection. Keeping this
  outside the component makes malformed metadata and boundary behavior easy to
  test.
- Render the preview as CSS background from the storyboard image, positioned
  by tile `x` and `y`. This avoids extra per-frame thumbnail requests and uses
  the single Mux storyboard image URL referenced by metadata.
- Keep keyboard seeking behavior unchanged. A keyboard-focused timeline may
  show the preview for the current display time, but arrow keys should still
  seek exactly as they do today.
- Treat the scrubber's requested seek target as a short-lived optimistic UI
  value. Clear it when media `currentTime` catches up near the requested time,
  playback resumes from the target, or a new user seek supersedes it. This
  prevents the progress UI from bouncing back to stale `timeupdate` state.
- Replace the current white focus ring with a subtler brand or neutral focus
  affordance that matches the chrome buttons. Do not remove keyboard focus
  visibility entirely.
- Separate the timeline's interactive hit box from its visual track. The
  component can use a taller wrapper/pseudo-padding for pointer and hover
  events while keeping the visible progress rail at the current slim height.

## Open Questions

### Resolved During Planning

- Should this require admin schema changes? No. Public Mux playback ids are
  already present on `variant.muxVideo?.playbackId`.
- Should previews be SSR-rendered? No. The preview is interaction chrome and
  should not affect SEO or the poster-first critical path.
- Should this use Mux Player native trick-play support? No. The watch hero no
  longer uses Mux Player chrome; `MuxVideo` is the intentional backend.

### Deferred to Implementation

- Exact preview dimensions and offsets: finalize against the live chrome at
  desktop and mobile widths so the bubble does not collide with the time,
  volume, language, or fullscreen controls.
- Whether to show a loading skeleton: default to no skeleton unless the first
  fetch delay feels broken in browser smoke. A missing preview is less jarring
  than a persistent spinner inside the timeline.

## High-Level Technical Design

This illustrates the intended approach and is directional guidance for review,
not implementation specification. The implementing agent should treat it as
context, not code to reproduce.

```mermaid
sequenceDiagram
  participant HeroPlayer
  participant Controls as HeroPlayerControls
  participant Mux as image.mux.com
  participant User

  HeroPlayer->>Controls: playbackId after chrome reveal
  Controls->>Mux: GET /{playbackId}/storyboard.json?format=webp
  Mux-->>Controls: storyboard url, tile size, duration, tiles
  User->>Controls: hover/focus/drag timeline
  Controls->>Controls: clientX -> pct -> seconds -> tile
  Controls-->>User: preview bubble with storyboard background-position
  User->>Controls: pointerup / leave / hide
  Controls-->>User: seek remains existing behavior; preview hides
```

## Implementation Units

### U1. Storyboard Helper and Unit Tests

- **Goal:** Add a small, typed helper for Mux storyboard metadata that is safe
  for browser use and resilient to malformed responses.
- **Requirements:** R1, R4, R6.
- **Dependencies:** None.
- **Files:** `apps/web/src/components/watch/mux-storyboard.ts`,
  `apps/web/src/components/watch/__tests__/mux-storyboard.test.ts`.
- **Approach:** Define the minimal metadata type the UI needs, build
  `https://image.mux.com/{playbackId}/storyboard.json?format=webp`, validate
  `url`, `tile_width`, `tile_height`, `duration`, and tile `{ start, x, y }`
  entries, and expose a tile selector that chooses the last tile whose start
  time is less than or equal to the requested time. Guard against empty tile
  arrays, non-positive dimensions, and non-finite durations.
- **Patterns to follow:** Existing small watch helpers with focused tests, such
  as `apps/web/src/components/watch/download-link.ts` plus colocated tests,
  and strict TypeScript object narrowing without `any`.
- **Test scenarios:**
  - Given playback id `abc123`, URL builder returns the Mux storyboard JSON
    URL with `format=webp`.
  - Given valid metadata and a time in the middle of a tile range, selector
    returns that tile with tile dimensions and image URL.
  - Given time before first tile, selector returns the first tile.
  - Given time after the last tile, selector returns the last tile.
  - Given empty tiles, missing URL, zero tile dimensions, non-finite duration,
    or non-numeric coordinates, validation returns null instead of throwing.
- **Verification:** Helper tests cover valid, boundary, and malformed metadata
  without relying on network calls.

### U2. Lazy Storyboard Loading in HeroPlayerControls

- **Goal:** Fetch and hold storyboard metadata only after the full player
  chrome is revealed and a Mux playback id exists.
- **Requirements:** R2, R4, R6.
- **Dependencies:** U1.
- **Files:** `apps/web/src/components/watch/HeroPlayer.tsx`,
  `apps/web/src/components/watch/HeroPlayerControls.tsx`,
  `apps/web/src/components/watch/__tests__/HeroPlayer.test.tsx`.
- **Approach:** Add an optional `playbackId` prop to `HeroPlayerControls` and
  pass it from `HeroPlayer`. Inside controls, fetch storyboard metadata in an
  effect keyed by `playbackId`; use `AbortController` for cleanup and store
  `"idle" | "loading" | "ready" | "failed"` or equivalent local state. Do not
  throw on fetch failure. Do not fetch when `playbackId` is undefined.
- **Patterns to follow:** Existing control effects bind to concrete state, not
  mutable refs, and clean up timers/listeners on unmount. Preserve that style
  for network cancellation.
- **Test scenarios:**
  - With a playback id, after `revealChrome()`, controls request the storyboard
    JSON URL once.
  - Before chrome reveal, no storyboard fetch is issued.
  - Without playback id, no storyboard fetch is issued and the timeline still
    renders.
  - When playback id changes, the previous request is aborted or ignored and
    the new id is fetched.
  - When fetch rejects or returns malformed metadata, no preview is rendered
    and no uncaught error is logged.
- **Verification:** Existing chrome render tests still pass, and focused tests
  prove lazy fetch timing.

### U3. Preview Interaction and Scrub State

- **Goal:** Render a polished preview bubble that follows hover/focus/scrub
  position without disrupting the existing timeline layout, and stabilize the
  post-scrub display state so the bar does not snap back while media seeking
  settles.
- **Requirements:** R1, R3, R4, R5, R7, R9.
- **Dependencies:** U1, U2.
- **Files:** `apps/web/src/components/watch/HeroPlayerControls.tsx`,
  `apps/web/src/components/watch/__tests__/HeroPlayer.test.tsx`.
- **Approach:** Track a preview percentage independent of the existing
  `scrubPct` so passive hover can show a preview without seeking. On pointer
  move over the timeline, compute pct using the existing timeline rect logic
  and derive preview seconds. During active drag, reuse the local scrub pct so
  preview and thumb stay aligned. Hide preview on pointer leave, lost pointer
  capture, failed metadata, zero duration, and chrome hidden state. Position
  the preview with a clamped left value and `transform` so it remains inside
  the timeline/control region. While touching the same state, add a settled
  seek target so pointerup/click-to-seek does not immediately fall back to the
  stale media `currentTime` before the media element catches up. Expand the
  timeline's interactive wrapper or vertical padding so hover and pointer
  movement near the bar reveal the thumb/preview and compute pct from the same
  widened hit zone, while the inner visible track remains slim.
- **Patterns to follow:** Existing pointer-capture scrub code in
  `HeroPlayerControls.tsx`; do not weaken pause/resume or coalesced-seek
  behavior while adding hover-only state.
- **Test scenarios:**
  - Hover at 50 percent of a 120 second video shows the tile whose start time
    is closest at or before 60 seconds.
  - Hover inside the expanded timeline area but above/below the visible slim
    bar reveals the thumb and preview.
  - Hover at the left and right edges clamps preview placement within the
    timeline bounds.
  - Pointerdown inside the expanded timeline area but off the visible slim bar
    still seeks to the correct percent.
  - Pointer leave hides the preview without changing `player.currentTime`.
  - Pointer drag keeps existing seek behavior and also updates the preview.
  - Pointerup after a drag keeps progress, thumb, and time display at the
    final requested time while the mock player still reports the old
    `currentTime`.
  - When the mock player later emits `timeupdate` near the requested target,
    the optimistic target clears without a visible backward jump.
  - Lost pointer capture clears preview state and leaves auto-dim able to
    resume.
  - Keyboard `ArrowRight`, `ArrowLeft`, `Home`, `End`, `PageUp`, and
    `PageDown` continue to seek to the same values as before.
- **Verification:** Focused tests assert `data-testid` preview presence,
  selected background image/position, and unchanged timeline seek outcomes.

### U3b. Timeline Focus Polish

- **Goal:** Remove the bright white focused-timeline glow and replace it with
  a calmer focus state that still supports keyboard users.
- **Requirements:** R8.
- **Dependencies:** U3.
- **Files:** `apps/web/src/components/watch/HeroPlayerControls.tsx`,
  `apps/web/src/components/watch/__tests__/HeroPlayer.test.tsx`.
- **Approach:** Adjust the timeline class names currently using
  `focus:ring-2 focus:ring-white/60` and related white focus styling. Prefer a
  subtle brand-red or low-opacity neutral treatment already used elsewhere in
  the chrome, and keep `focus-visible` semantics where practical so mouse
  interactions do not show keyboard focus treatment.
- **Patterns to follow:** `ChromeButton` focus styling and existing watch
  chrome classes, without introducing a new design token for this small slice.
- **Test scenarios:**
  - Focused timeline class list no longer contains the white ring/glow classes.
  - Focused timeline still exposes a visible focus affordance class.
  - Keyboard seek tests continue to pass with the revised focus class names.
- **Verification:** Unit assertion for class names plus browser smoke for
  visual confirmation.

### U4. Visual and Browser Verification

- **Goal:** Prove the preview behaves well in the real browser across the
  watch-page layouts that matter.
- **Requirements:** R1, R2, R3, R5, R6, R7, R8, R9.
- **Dependencies:** U1-U3b.
- **Files:** `apps/web/src/components/watch/HeroPlayerControls.tsx`,
  `docs/roadmap/platform/feat-222-watch-timeline-hover-previews.md`,
  optionally `docs/solutions/` if implementation reveals a durable pattern.
- **Approach:** Run focused unit tests, typecheck, and lint. Start the web app
  only if needed for browser smoke. Verify a representative watch route at
  desktop and mobile widths: initial load has no storyboard request before
  chrome reveal; hover start/middle/end shows correct preview; drag still
  seeks; preview hides after leave and auto-hide. Capture completion evidence
  in the roadmap ticket when done.
- **Patterns to follow:** Prior watch hero plans record concrete browser and
  network evidence in the roadmap completion section.
- **Test scenarios:**
  - Desktop watch route: preview does not overlap time, volume, language, or
    fullscreen controls.
  - Mobile portrait watch route: preview remains inside viewport/control
    bounds and does not cover the main chrome buttons incoherently.
  - Hovering slightly above and below the visible timeline rail reveals the
    thumb and preview without requiring pixel-perfect aim.
  - Pointer scrub on a real watch route does not visibly snap back between
    pointerup and media seek settlement.
  - Keyboard focus on the timeline no longer shows the bright white glow.
  - Normal initial page load: resource timing shows no `storyboard.json`
    request before chrome reveal.
- **Verification:** Unit tests plus browser smoke evidence are enough for this
  UI-only slice; no admin codegen or schema drift checks are required.

## Risk Analysis & Mitigation

- **Critical-path regression:** Lazy fetch from controls only after chrome
  reveal; do not preload storyboard images.
- **Timeline behavior regression:** Keep existing seek tests green and add
  hover-specific tests that prove hover alone does not seek. Add a regression
  test for the post-scrub snap-back so the progress bar stays controlled by
  the requested target while the media element catches up.
- **Accessibility regression from focus polish:** Remove the bright glow, not
  focus visibility. Keep a visible focus affordance and verify keyboard seek
  still works.
- **Hit-zone layout regression:** Expand the interactive area without changing
  the visible rail height or causing neighboring controls to shift.
- **Malformed Mux metadata:** Validate shape and fail closed with no preview.
- **CORS / image access issues:** Mux documents `image.mux.com` storyboard
  URLs and recommends `crossorigin` when video and storyboard hosts differ.
  Since this UI uses CSS backgrounds and does not read pixels from canvas,
  it should not need pixel access, but browser smoke should still verify image
  rendering.
- **Signed URL future:** Public watch pages appear to use public playback ids.
  Signed storyboard URLs need separate token plumbing and are out of scope.

## Validation Plan

- `pnpm --filter @forge/web test -- src/components/watch/__tests__/mux-storyboard.test.ts src/components/watch/__tests__/HeroPlayer.test.tsx`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- Browser smoke on a representative watch route at desktop and mobile widths.

## System-Wide Impact

- End users get a familiar scene-preview affordance when scanning videos.
- Web performance should remain stable because all storyboard work is
  post-chrome interaction work.
- Admin, mobile, TV, manager, and generated GraphQL contracts are unaffected.

## Completion Evidence

- Added Mux storyboard helper and tests:
  `apps/web/src/components/watch/mux-storyboard.ts`,
  `apps/web/src/components/watch/__tests__/mux-storyboard.test.ts`.
- Updated `HeroPlayerControls` to fetch storyboard JSON lazily after chrome
  reveal, render a storyboard-backed preview bubble, use a wider timeline hit
  zone, stabilize post-scrub display state, and replace the white focus glow.
- Updated `HeroPlayer` to pass the selected `playbackId` into controls.
- Focused tests passed:
  `pnpm --filter @forge/web test -- src/components/watch/__tests__/mux-storyboard.test.ts src/components/watch/__tests__/HeroPlayer.test.tsx`
  (99 passed, 2 existing todo).
- `pnpm --filter @forge/web typecheck` passed.
- `pnpm --filter @forge/web lint` passed.
- Browser smoke deferred: `agent-browser` is not installed, `apps/web` has no
  Playwright dependency, and no local admin/web services were listening.
