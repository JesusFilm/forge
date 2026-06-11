---
title: "feat: Watch Hero Chapter Transition Feedback"
type: "feat"
status: "completed"
date: "2026-06-11"
roadmap: "docs/roadmap/platform/feat-180-watch-hero-chapter-transition-feedback.md"
origin: "user request"
---

# feat: Watch Hero Chapter Transition Feedback

## Summary

When a user clicks an episode in the Watch chapter carousel, show the clicked
episode's title and cover in the hero immediately while the real route
navigation resolves. The pending hero cover transitions through black, pulses
while loading, and clears when the route commits.

## Problem Frame

The existing chapter carousel pending state proves that a normal link click was
accepted, but the hero remains on the previous route until Next finishes the
navigation. For a single-video page, this makes the visible player cover/title
feel late even though the carousel has acknowledged the click.

## Requirements

- R1. Normal left-clicks on a non-active chapter card immediately publish the
  clicked chapter title and resolved cover image to the hero.
- R2. Modified clicks, already-active clicks, and non-routable cards do not
  publish pending hero state.
- R3. The pending hero title and cover are visual only; the real player source,
  Mux metadata, route, and media lifecycle remain route-derived.
- R4. The pending cover uses a black transition before the image fades in.
- R5. The cover pulses while the pending navigation is loading.
- R6. Pending hero state self-invalidates when the current video or language
  changes after route commit.

## Key Technical Decisions

- KTD1. Lift pending preview state to `WatchPageClient`. This is the smallest
  shared client boundary above both `HeroPlayer` and `SiblingCarousel`.
- KTD2. Keep `SiblingCarousel` as `next/link`. The existing normal-click guard
  remains the authority for which clicks can set pending state.
- KTD3. Pass a typed `pendingHeroPreview` prop to `HeroPlayer`. The component
  renders pending title/poster overlays, but keeps playback id, source,
  subtitles, Mux Data, and chrome state bound to the committed route block.
- KTD4. Use CSS opacity/animation states rather than timers. The black layer
  and cover image can animate from prop changes, and route commit naturally
  removes the pending overlay.

## Implementation Units

### U1. Pending Chapter Preview Contract

- **Goal:** Share pending chapter preview data between the carousel and hero.
- **Requirements:** R1, R2, R6.
- **Files:** `apps/web/src/components/watch/SiblingCarousel.tsx`,
  `apps/web/src/components/watch/WatchPageClient.tsx`,
  `apps/web/src/components/watch/WatchSectionRenderer.tsx`.
- **Approach:** Add a small exported type containing `href`, source video id,
  target video id, language slug, title, and poster URL. Invoke a callback from
  `SiblingCarousel` inside the existing normal-click branch. In
  `WatchPageClient`, store the payload and derive validity from the current
  route video id and language slug before passing it to the renderer.
- **Test scenarios:**
  - Normal click calls the callback with title, href, ids, language slug, and
    resolved poster URL.
  - Modified click does not call the callback.
  - Route identity change invalidates pending state in the page client.

### U2. Hero Pending Cover Overlay

- **Goal:** Render immediate hero title/cover feedback without changing media.
- **Requirements:** R3, R4, R5.
- **Files:** `apps/web/src/components/watch/HeroPlayer.tsx`,
  `apps/web/src/components/watch/__tests__/HeroPlayer.test.tsx`.
- **Approach:** Add a `pendingHeroPreview` prop. When present, render an
  absolute black transition layer and a pending poster layer above the
  committed poster/player. Use a pulse animation class while pending. Render
  the pending title in the existing overlay title slot while leaving Mux props
  and playback state route-derived.
- **Test scenarios:**
  - Pending preview renders a black transition layer and pending poster.
  - Pending title replaces the visible pre-reveal title.
  - Pending preview does not alter Mux playback id, poster prop, or metadata.
  - No pending preview keeps the existing poster-first behavior.

### U3. Page-Level Propagation Coverage

- **Goal:** Prove the shared state bridge works across the mocked page
  boundary.
- **Requirements:** R1, R2, R6.
- **Files:** `apps/web/src/components/watch/__tests__/WatchPageClient.download.test.tsx`,
  `apps/web/src/components/watch/__tests__/SiblingCarousel.test.tsx`.
- **Approach:** Extend existing tests instead of adding a new broad fixture.
  Keep mocks focused on props/callback behavior, not real Embla or media
  playback.
- **Test scenarios:**
  - Page client passes a valid pending preview to the renderer after the
    renderer mock invokes `onChapterPreviewPending`.
  - Re-rendering with a different video id clears the pending preview.

## Verification Plan

- `pnpm --filter @forge/web test -- src/components/watch/__tests__/SiblingCarousel.test.tsx src/components/watch/__tests__/HeroPlayer.test.tsx src/components/watch/__tests__/WatchPageClient.download.test.tsx`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- Local Watch dev server and Helium/browser smoke on a chapter-carousel route.

## Risks

- The pending poster may be absent for a child with no usable image. In that
  case the hero should still transition through black and update the title,
  while the route commit supplies the final committed hero.
- The pending overlay must not obscure the custom controls after the user has
  already revealed playback chrome. Scope the pending title/poster feedback to
  the pre-reveal hero cover state.
