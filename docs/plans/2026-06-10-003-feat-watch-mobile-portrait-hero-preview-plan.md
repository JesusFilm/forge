---
title: "Watch Mobile Portrait Hero Preview Plan"
type: "feature"
status: "completed"
date: "2026-06-10"
origin: "User-approved LFG handoff"
roadmap: "docs/roadmap/platform/feat-175-watch-mobile-portrait-hero-preview.md"
---

# Watch Mobile Portrait Hero Preview Plan

## Summary

On mobile portrait watch pages, the muted preview hero should reserve a clean 96px black header band and then render the media preview as a square cover/fill frame. Once the user taps Watch now and commits playback, the hero should keep the existing 16:9 sound-on behavior, controls, subtitles, and language/search header behavior.

## Problem Frame

The current muted preview uses the same short 16:9 hero frame as committed playback. At a 390px-wide mobile portrait viewport this makes the video only about 219px tall, so the floating logo/search/globe sit over the video and the preview feels compressed. The user wants the pre-click preview to feel more poster-like on mobile while keeping the existing playback layout after commitment.

## Requirements

- R1. On default watch-page mobile portrait muted preview, render a black header band above the media frame with `h-24 bg-black`.
- R2. On default watch-page mobile portrait muted preview, render the media frame as `aspect-square w-full overflow-hidden`.
- R3. The media itself continues using cover/fill mode during muted preview and contain mode after playback is committed.
- R4. Remove or override the current pre-reveal `scale-y-110` stretch for the mobile portrait square preview.
- R5. Preview-only absolute layers, including click surface, loading, muted backdrop, and darken overlay, are scoped to the media frame so they do not cover the black header band.
- R6. Once `chromeRevealed` is true, the hero returns to the existing `h-[min(100svh,56.25vw)]` 16:9 playback behavior.
- R7. Desktop, tablet, custom overlay consumers, post-click controls, language/search header, subtitle overlay, and data fetching stay unchanged.
- R8. Browser smoke proves the `390x778` acceptance geometry: band height 96px, media frame starts at `y=96`, and media frame height equals rendered width.

## Key Technical Decisions

- **Scope square preview to the default watch overlay path:** `HeroPlayer` also supports custom overlay consumers. Applying the mobile portrait square frame only when `overlay == null` keeps series/custom hero surfaces unchanged while satisfying the watch-page target.
- **Use Tailwind arbitrary media variants rather than JS viewport state:** Existing code already uses Tailwind for responsive layout. A `[@media(max-width:767px)_and_(orientation:portrait)]` variant keeps the behavior CSS-owned and avoids hydration or resize state.
- **Keep one wrapper ref and height measurement:** The sticky/scroll-over code observes `hero-player-wrapper`. The wrapper should remain the measured element; only the pre-reveal mobile portrait content height changes.
- **Create an inner media frame:** Moving preview-only absolute layers into a `relative` media frame lets the outer wrapper own the black band while the media frame owns video overlays and click handling.
- **Leave committed playback layers unchanged:** `HeroPlayerControls` and `SubtitleOverlay` should stay attached to the wrapper for the committed 16:9 player state.

## Scope Boundaries

In scope:

- `apps/web/src/components/watch/HeroPlayer.tsx`
- `apps/web/src/components/watch/__tests__/HeroPlayer.test.tsx`
- `docs/roadmap/platform/feat-175-watch-mobile-portrait-hero-preview.md`

Out of scope:

- Translation changes, GraphQL/schema work, data fetching, custom player controls, language modal behavior, search UI behavior, and desktop/tablet hero redesign.

## Implementation Units

### U1. Track the watch-page preview slice

- **Goal:** Create a focused roadmap record for the approved LFG slice.
- **Requirements:** R1, R2, R3, R4, R5, R6, R7, R8
- **Dependencies:** None
- **Files:** `docs/roadmap/platform/feat-175-watch-mobile-portrait-hero-preview.md`
- **Approach:** Add a platform watch ticket with exact entry points, constraints, and verification. Mark it in progress before implementation and complete after validation.
- **Patterns to follow:** `docs/roadmap/media-generation/feat-145-watch-mobile-player-controls-width.md`
- **Test scenarios:** No runtime test; roadmap documentation only.
- **Verification:** Ticket exists and points to `HeroPlayer` plus its focused test.

### U2. Add the preview-only mobile portrait frame

- **Goal:** Reshape only the default muted preview on mobile portrait.
- **Requirements:** R1, R2, R3, R4, R5, R6, R7
- **Dependencies:** U1
- **Files:** `apps/web/src/components/watch/HeroPlayer.tsx`
- **Approach:** Add a `mobilePortraitPreviewEnabled` condition derived from `!chromeRevealed && overlay == null`. When enabled, render a hidden-by-default `h-24 bg-black` band that is displayed by the mobile portrait media query, wrap the Mux branch in a relative media frame that gains square aspect only under that query, and move preview-only absolute layers into the frame. Keep `HeroPlayerControls` and `SubtitleOverlay` at wrapper level for committed playback. Override `scale-y-110` to `scale-y-100` on the same mobile portrait preview query.
- **Patterns to follow:** Existing `HERO_FRAME_HEIGHT_CLASS`, Mux cover/contain constants, `data-testid` layout hooks, and the measured overlap guidance in `docs/solutions/design-patterns/watch-language-player-chrome-layout-20260609.md`.
- **Test scenarios:** Default muted preview wrapper includes mobile portrait `h-auto` override, renders the black band, renders a media frame with mobile portrait square classes, scopes preview click/loading/backdrop into the media frame, and the media branch overrides preview scale to `scale-y-100` for mobile portrait. After Watch now, the band disappears, the square frame classes disappear, controls render, and the wrapper still has the 16:9 height class.
- **Verification:** Focused HeroPlayer tests pass.

### U3. Browser-smoke the mobile acceptance geometry

- **Goal:** Verify the rendered mobile portrait dimensions in the local app.
- **Requirements:** R8
- **Dependencies:** U2
- **Files:** None expected unless smoke reveals a fix.
- **Approach:** Use the in-app browser/Helium-backed browser surface at `390x778` on `/watch/blessed-are-those-who-hear-and-obey.html/english.html`; measure the band, media frame, wrapper, header controls, and post-click state.
- **Patterns to follow:** Existing local browser measurement approach used for watch-page visual QA.
- **Test scenarios:** Before click: band height is 96px, media frame `top` is 96px, media frame height equals width, logo/search/globe bottoms are within the black band. After clicking Watch now: wrapper height returns to the existing 16:9 class/geometry and no preview band is present.
- **Verification:** Browser measurement output confirms the acceptance values.

## Sources

- `apps/web/AGENTS.md`
- `apps/web/CLAUDE.md`
- `apps/web/src/components/watch/HeroPlayer.tsx`
- `apps/web/src/components/watch/__tests__/HeroPlayer.test.tsx`
- `docs/solutions/design-patterns/watch-language-player-chrome-layout-20260609.md`
- `docs/solutions/design-patterns/mux-player-custom-react-chrome-pattern-20260430.md`
- `docs/solutions/performance-issues/watch-hero-muxplayer-to-muxvideo-swap-20260526.md`
