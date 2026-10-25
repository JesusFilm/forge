---
id: "feat-222"
title: "Watch timeline hover previews"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-06-29"
duration: 2
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "mux"
---

## Problem

The single-video watch page has custom React player chrome with a seek
timeline, but hovering or scrubbing the timeline only shows the progress
thumb and time readout. Users cannot visually preview the target scene before
seeking, which makes long-form videos harder to scan and makes the custom
chrome feel less capable than familiar streaming players.

Mux exposes storyboard metadata for public playback ids, so the watch page can
render tile previews without changing admin GraphQL or media processing.

The current scrubber state also feels unstable: after a user scrubs, the
timeline can jump to the requested location, snap back to stale media time,
then move forward again once the media element reports the seek. The focused
timeline also has an overly bright white glow that does not match the rest of
the player chrome. The thumb is also too fussy to reveal because the user has
to hover almost exactly on the thin visual bar; hovering in the area around the
bar should be enough.

## Entry Points - Read These First

1. `docs/plans/2026-06-29-002-feat-watch-timeline-hover-previews-plan.md` -
   implementation plan for this slice.
2. `apps/web/src/components/watch/HeroPlayerControls.tsx` - custom React
   timeline, pointer-driven scrub, keyboard seek, portal layout, and
   auto-hide behavior.
3. `apps/web/src/components/watch/HeroPlayer.tsx` - supplies the selected
   Mux playback id and owns poster-first activation.
4. `apps/web/src/components/watch/__tests__/HeroPlayer.test.tsx` - existing
   custom chrome and timeline test coverage.
5. `docs/solutions/design-patterns/mux-player-custom-react-chrome-pattern-20260430.md`
   - first-party React chrome pattern and pointer-capture guidance.
6. `docs/solutions/performance-issues/web-watch-route-lighthouse-perf-campaign-lcp-bundle-fonts-20260527.md`
   - watch route LCP and Mux loading constraints.

## Grep These

- `data-testid="hero-chrome-timeline"`
- `handleTimelinePointerDown`
- `handleTimelinePointerMove`
- `computeScrubPct`
- `scrubPct`
- `displayTime`
- `focus:ring-2 focus:ring-white/60`
- `h-1 min-w-0 flex-1`
- `group-hover:opacity-100`
- `playbackId = variant.muxVideo?.playbackId`
- `resolveMuxHeroPosterUrl`
- `storyboard`

## What To Build

1. Add a small client-safe storyboard helper for Mux storyboard JSON URLs and
   tile selection.
2. Pass the current `playbackId` from `HeroPlayer` into `HeroPlayerControls`.
3. Fetch storyboard JSON lazily only after the full chrome has been revealed
   and a public `playbackId` is available.
4. Render a hover/focus/scrub preview bubble above the timeline using the
   storyboard image and `background-position` from the selected tile.
5. Stabilize scrub state so the progress bar, thumb, time readout, and preview
   stay pinned to the user's requested seek target until the media element
   catches up, without a visible snap-back.
6. Remove the odd white focus glow from the timeline while preserving a usable
   keyboard/focus affordance consistent with the rest of the player chrome.
7. Expand the timeline hover/pointer hit zone so the thumb and preview reveal
   when the pointer is near the bar, while preserving the current thin visual
   bar design.
8. Keep pointer-driven scrub behavior intact: pointer capture, paused-during-
   drag behavior, coalesced seeks, and final pointerup seek must continue to
   work.
9. Hide the preview cleanly when metadata is unavailable, the fetch fails, the
   pointer leaves the timeline, or the control surface auto-hides.

## Constraints

- Do not change public `/watch/{slug}.html/{language}.html` URLs.
- Do not change admin GraphQL schema, `apps/admin/schema.graphql`, or
  `packages/admin-graphql` generated files.
- Do not mount the Mux player earlier than the current poster-first activation
  flow.
- Do not fetch storyboard metadata during SSR or the initial poster-only
  render.
- Do not use Mux Player's native chrome or reintroduce the `MuxPlayer` hero
  backend.
- Keep the feature inactive when `playbackId` is absent and playback falls
  back to `variant.hls`.

## Verification

- `pnpm --filter @forge/web test -- src/components/watch/__tests__/HeroPlayer.test.tsx`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- Browser smoke on `/watch/jesus.html/english.html`: reveal chrome, hover the
  timeline at start/middle/end, drag the scrubber, leave the timeline, and
  confirm the preview appears, updates, seeks correctly, and disappears.
- Manual scrub smoke confirms the bar does not jump forward, snap back, then
  advance again after pointerup or click-to-seek.
- Keyboard focus smoke confirms the timeline no longer shows the bright white
  glow, while focus is still discoverable.
- Hover smoke confirms the thumb and preview reveal when the pointer is above
  or below the thin bar inside the expanded timeline area.
- Network smoke confirms no `storyboard.json` request before chrome reveal on
  normal initial load.

## Completion Evidence

- Added `apps/web/src/components/watch/mux-storyboard.ts` and focused unit
  coverage for Mux storyboard URL construction, metadata validation, and tile
  selection.
- `HeroPlayer` now passes the selected Mux playback id into
  `HeroPlayerControls`; controls lazily fetch storyboard JSON only after the
  full chrome is revealed.
- The timeline now uses a taller interactive hit zone with the same slim
  visual rail, so hovering near the bar reveals the thumb/preview without
  pixel-perfect aiming.
- Scrub display state now keeps the requested seek target visible until media
  time catches up, preventing the visible snap-back.
- The timeline focus treatment no longer uses the white `focus:ring-2
focus:ring-white/60` glow; it uses a subtler focus-visible treatment.
- Focused validation passed:
  `pnpm --filter @forge/web test -- src/components/watch/__tests__/mux-storyboard.test.ts src/components/watch/__tests__/HeroPlayer.test.tsx`
  (99 passed, 2 existing todo).
- `pnpm --filter @forge/web typecheck` passed.
- `pnpm --filter @forge/web lint` passed.
- Browser smoke was not run in this environment: `agent-browser` was not
  installed, no Playwright package is available to `apps/web`, and no local
  admin/web services were listening for a representative watch route.

## Plan

Implementation plan:
`docs/plans/2026-06-29-002-feat-watch-timeline-hover-previews-plan.md`
