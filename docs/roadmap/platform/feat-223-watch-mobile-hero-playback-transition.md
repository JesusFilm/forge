---
id: "feat-223"
title: "Watch mobile hero playback transition"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-06-30"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "mobile"
---

## Problem

Mobile portrait Watch pages intentionally use a tall muted hero preview so the
first screen feels cinematic and shows more of the image. When the user taps
`Watch now`, or when chapter carousel navigation lands with `?autoplay=1`, the
hero frame can collapse from the tall preview to the 16:9 playback frame too
abruptly. Carousel navigation can also briefly render the tall preview frame
before the autoplay player settles, making page-to-page movement feel jumpy.

## Entry Points - Read These First

1. `apps/web/src/components/watch/HeroPlayer.tsx` - mobile portrait preview
   height classes, `chromeRevealed`, `autoplayParam`, and wrapper overflow.
2. `apps/web/src/components/watch/__tests__/HeroPlayer.test.tsx` - focused
   layout and autoplay coverage for the hero shell.
3. `apps/web/src/components/watch/WatchPageClient.tsx` - chapter carousel
   navigation appends `?autoplay=1` when playback has been activated.
4. `docs/solutions/design-patterns/watch-chapter-optimistic-navigation-feedback.md`
   - existing chapter navigation feedback and route-settle behavior.

## Grep These

- `HERO_FRAME_HEIGHT_CLASS`
- `MOBILE_PORTRAIT_PREVIEW_WRAPPER_CLASS`
- `data-mobile-portrait-preview`
- `autoplayParam === "1"`
- `playbackFrameActive`
- `transition-[height,margin-bottom,top]`

## What To Build

1. Make the mobile portrait muted preview use an explicit square frame height
   (`100vw`) instead of `h-auto`, so CSS can interpolate to the 16:9 playback
   height.
2. Animate the hero wrapper's `height`, `margin-bottom`, and sticky `top`
   together with a single easing curve, respecting reduced-motion settings.
3. Treat `?autoplay=1` landings as compact playback-frame renders before
   chrome has fully revealed, preventing chapter carousel navigations from
   flashing through the oversized preview frame.
4. Keep custom overlay consumers on the existing non-mobile-preview path.
5. Do not change playback controls, subtitles, fullscreen behavior, language
   switching, admin GraphQL, or public Watch URL shapes.

## Constraints

- Keep the tall muted preview on initial mobile portrait page load.
- Keep desktop and tablet hero sizing unchanged.
- Keep the poster-first activation model; do not mount the Mux video earlier
  for ordinary first loads.
- Do not reintroduce route-level black bridges or change the chapter carousel
  link contract.

## Verification

- `pnpm --filter @forge/web test -- src/components/watch/__tests__/HeroPlayer.test.tsx`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- Browser smoke at `390x844` on
  `/watch/jesus.html/the-beginning/english.html`: initial hero wrapper is
  square (`390px`), `data-mobile-portrait-preview="true"`, and transition
  properties include `height`, `margin-bottom`, and `top`.
- Browser smoke at `390x844` on
  `/watch/jesus.html/the-beginning/english.html?autoplay=1`: initial hero
  wrapper is compact 16:9 (`219.375px`), `data-mobile-portrait-preview="false"`,
  and overflow is hidden.

## Completion Evidence

- `HeroPlayer` now animates the frame geometry instead of snapping through
  `h-auto`.
- Autoplay chapter landings render directly in the compact playback frame.
- Focused HeroPlayer coverage was updated for the mobile transition and
  autoplay landing behavior.
