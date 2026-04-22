---
id: "feat-074"
title: "TV App — Home Screen (Hero + Experiences Rail)"
owner: "urim"
priority: "P1"
status: "complete"
start_date: "2026-04-15"
duration: 5
depends_on:
  - "feat-073"
blocks:
  - "feat-076"
tags:
  - "tv"
---

## Problem

The TV app needs a home screen that lets users discover and browse Experiences using D-pad navigation. The home screen uses a featured hero at the top (from the `isHomepage` Experience) and a horizontal rail of all available Experiences below.

## Entry Points — Read These First

1. `docs/brainstorms/2026-04-10-tv-app-prototype-requirements.md` — Home Screen Layout section
2. `apps/mobile-v2/src/lib/queries.ts` — `LIST_EXPERIENCES` and `GET_WATCH_EXPERIENCE` queries
3. `apps/mobile-v2/src/components/sections/VideoHeroRenderer.tsx` — hero renderer to adapt for TV
4. `apps/tv/app/index.tsx` — home screen route (from feat-073 scaffolding)

## Grep These

- `LIST_EXPERIENCES` in `apps/mobile-v2/src/` — how the Experience list is fetched
- `isHomepage` in `apps/mobile-v2/src/` — how the homepage Experience is identified
- `TVFocusGuideView` in react-native-tvos docs — focus containment API
- `hasTVPreferredFocus` — initial focus control

## What To Build

1. **FocusableCard component**: Base pressable element with visible focus ring (border glow), 1.05x scale-up on focus, `onPress` handler. Uses `hasTVPreferredFocus` for initial focus.
2. **ContentRail component**: Horizontal FlatList of FocusableCards, wrapped in TVFocusGuideView to constrain D-pad left/right within the rail. Rail title label above.
3. **Home screen hero**: Fetch `isHomepage` Experience via `GET_WATCH_EXPERIENCE`, extract VideoHero block. Render as a full-width static thumbnail with title/subtitle overlay. No auto-preview (deferred).
4. **Experiences rail**: Fetch all Experiences via `LIST_EXPERIENCES`. Render as FocusableCards showing ogImage + title. Select pushes to `experience/[slug]`.
5. **Focus navigation**: D-pad up/down moves between hero and rail. Focus memory (in-memory ref) remembers last-focused rail card.
6. **Loading state**: Centered spinner while fetching.
7. **Error state**: Error message with focusable "Retry" button.
8. **Empty state**: "No Experiences available" message.

## Constraints

- Use `ogImage` from `LIST_EXPERIENCES` for rail card thumbnails — do NOT add new CMS image fields
- Static thumbnails only — no auto-preview on focus
- 10-foot UI: minimum text size ~24sp, generous card spacing, high-contrast focus ring

## Verification

- Home screen shows hero area with the homepage Experience's VideoHero image
- Experiences rail shows cards for all Experiences from CMS
- D-pad left/right scrolls rail, up/down moves between hero and rail
- Focus ring is clearly visible on the currently focused card
- Select on a card navigates to the Experience detail route
- Loading spinner shows during fetch, error screen with retry on failure
