---
id: "feat-445"
title: "Watch Home Video Timeline Controls"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-09-04"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "watch"
  - "ui"
  - "video"
  - "responsive-design"
---

## Problem

The Watch Home hero's circular next-video control shows only one generic skip
action. Viewers cannot see the recently played video or scan the next three
videos before choosing where to continue. The existing timed progress ring
communicates when the hero will advance, but the control does not show the
surrounding playback timeline.

## Entry Points - Read These First

1. `apps/web/src/components/home/WatchHomeTvCarousel.tsx` - hero overlay,
   responsive next-video controls, progress ring, and thumbnail rendering.
2. `apps/web/src/components/home/useWatchHomeTvCarousel.ts` - active and next
   slide selection for sequenced and fallback hero queues.
3. `apps/web/src/components/home/__tests__/WatchHomePage.test.tsx` - integrated
   hero rendering and advance behavior.
4. `apps/web/src/app/globals.css` - existing progress and reduced-motion
   animations.

## Grep These

- `WatchHomeVideoTimeline`
- `watch-home-current-progress`
- `WATCH_HOME_TV_TIMELINE_FUTURE_COUNT`
- `thumbnailUrl`
- `watch-home-progress-ring`

## What To Build

1. Render one actual previous video, the current video, and three actual future
   videos as circular thumbnail controls on desktop. Keep mobile intentionally
   compact with only the current video and the next video.
2. Keep the current video's timed progress ring as the playback indicator and
   retain a generic icon fallback when no thumbnail is available.
3. Let viewers select any non-current circle without disrupting carousel timer,
   media, played-history, or keyboard-focus behavior.
4. Keep the visible window linear: do not wrap a missing previous or future
   position to the opposite end of the queue.
5. Add focused coverage for the desktop initial four-circle state, the desktop
   steady-state five-circle timeline, the two-circle mobile timeline, direct
   selection, focus retention, and ring reset.

## Constraints

- Do not change hero sequence composition, random first-video selection,
  preview duration, played-video persistence, mute behavior, or route handling.
- Do not add eager or priority image loading for the next thumbnail; only the
  active hero poster may compete for LCP priority.
- Keep both desktop and mobile controls responsive and keyboard accessible.
- Do not change GraphQL fields, generated artifacts, or admin data fetching.

## Verification

- `pnpm --filter @forge/web test -- src/components/home/__tests__/WatchHomePage.test.tsx src/components/home/__tests__/useWatchHomeTvCarousel.test.ts`
- `pnpm --filter @forge/web typecheck`
- Run scoped formatting and lint checks for touched Web files.
- `git diff --check`
- Browser smoke `/watch` at desktop and narrow widths: the control shows the
  next thumbnail, the ring remains visible, click/tap advances to that video,
  and the preview updates to the following video.
- Confirm the new thumbnail remains lazy-loaded and adds no preload competing
  with the active hero poster.

## Resolution

- Desktop renders a linear circular timeline with one actual past video, the
  current video, and three real future videos. The opening desktop state has
  four circles because no past video exists yet. Mobile shows only the current
  and next video to keep the hero quiet and uncluttered at narrow widths.
- The current circle retains the timed playback ring. Direct selection routes
  through the carousel hook and preserves keyboard focus as the window shifts.
- Queue prefetching stays three videos ahead, so future circles never wrap to
  already watched entries.
- The timeline thumbnails are lazy-loaded without priority and use fixed `48px`
  and `36px` responsive image hints. On mobile, the current/next pair shares one
  horizontal action row with Watch Now and mute instead of occupying a separate
  row below them.
- The single responsive mute/unmute control now sits in the hero action row
  immediately beside Watch Now instead of being duplicated beside the timeline.
- Timeline circles and the mute control use one uniform crisp 1px
  semi-transparent light ring inset from the edge. The ring uses overlay
  blending at low opacity so it responds to the underlying image; hover gently
  increases its contrast without adding blur or directional shading.
- The action row remains mounted across slide changes, preserving keyboard
  focus on Watch Now and mute/unmute during automatic playback advances.

## Validation Results

- Focused Watch Home page and carousel-hook tests: 45 passed.
- Web typecheck and targeted ESLint: passed.
- `git diff --check`: passed.
- Desktop browser smoke: initial four-circle state, steady-state five-circle
  timeline, direct selection, thumbnail ordering, playback ring, and two
  consecutive keyboard-focus recovery cycles verified at 1280 x 800.
- Mobile browser smoke: exactly the current and next circles remain visible at
  320 x 700, 375 x 667, and 430 x 800. Browser geometry measured zero
  horizontal overflow and a 0 px center-line delta across Watch Now, mute, and
  both circles. A 568 x 320 compact-landscape pass with the representative
  longer label `Watch This Video Now` also remained on one line without
  clipped control content.
- Browser resource timing: timeline images remained lazy with automatic fetch
  priority and were served at the expected small responsive widths. A cold
  development load kept the hero poster as the LCP element (1172 ms); FCP was
  464 ms, CLS 0.04, and TTFB 196.4 ms.
- Scoped axe verification reported zero carousel violations. The console
  emitted no timeline-control errors; the existing media-collection
  duplicate-key and Next Image sticky-parent diagnostics remain unrelated.
