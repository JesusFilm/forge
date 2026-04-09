---
id: "feat-075"
title: "TV App — Experience Detail Screen (SDUI Renderers)"
owner: "urim"
priority: "P1"
status: "not-started"
start_date: "2026-04-15"
duration: 7
depends_on:
  - "feat-073"
blocks:
  - "feat-076"
tags:
  - "tv"
---

## Problem

When a user selects an Experience from the home screen rail, the TV app needs to render that Experience's content blocks in a vertical, D-pad-navigable feed. This requires TV-adapted renderers for the core block types.

## Entry Points — Read These First

1. `docs/brainstorms/2026-04-10-tv-app-prototype-requirements.md` — Experience screen and renderer sections
2. `apps/mobile-v2/src/components/sections/SectionDispatcher.tsx` — mobile dispatcher to adapt
3. `apps/mobile-v2/src/components/sections/SectionWrapperRenderer.tsx` — structural wrapper pattern
4. `apps/mobile-v2/src/components/sections/ContainerRenderer.tsx` — container wrapper
5. `apps/mobile-v2/src/components/sections/VideoCardRenderer.tsx` — video block renderer
6. `apps/mobile-v2/src/components/sections/TextRenderer.tsx` — text block renderer
7. `apps/mobile-v2/src/components/sections/BibleQuotesCarouselRenderer.tsx` — carousel renderer
8. `apps/mobile-v2/src/lib/normalizer.ts` — block type mapping (18 types)

## Grep These

- `kind === ` in `apps/mobile-v2/src/components/sections/SectionDispatcher.tsx` — all handled block types
- `NormalizedBlock` in `apps/mobile-v2/src/` — type shape used by renderers
- `contentParagraphs` in `apps/mobile-v2/src/` — how JSON text arrays are rendered

## What To Build

### Renderers (TV-adapted, 10-foot UI)

1. **SectionWrapperRenderer**: Recursively renders child blocks with optional background color. Structural pass-through — required because most blocks are nested inside these.
2. **ContainerRenderer**: Renders child Text + RelatedQuestions blocks. Layout wrapper.
3. **VideoHeroRenderer**: Full-width hero with static thumbnail, title overlay. Select enters full-screen playback (connects to feat-076).
4. **VideoCardRenderer**: Landscape video card with thumbnail + title. Focusable. Select enters playback.
5. **TextRenderer**: Large readable text (min ~24sp heading, ~18sp body). Max line width ~80 characters for readability at 10 feet.
6. **BibleQuotesCarouselRenderer**: Horizontal D-pad-navigable carousel of quote cards. Each card shows reference + text. TVFocusGuideView to contain horizontal focus.
7. **PlaceholderRenderer**: Logs unhandled block type in dev, renders nothing. Prevents crashes from unrecognized blocks.

### Screen

8. **Experience detail screen** (`app/experience/[slug].tsx`): Fetch Experience via `GET_WATCH_EXPERIENCE`, normalize blocks, render via SectionDispatcher in a vertical FlatList. D-pad up/down scrolls between sections. First focusable element receives initial focus.
9. **Loading/error/empty states**: Same pattern as home screen.

## Constraints

- Renderers receive the same `NormalizedBlock` types as mobile-v2 — do NOT create parallel type hierarchies
- 10-foot UI: all text readable from couch distance. Use generous padding and spacing.
- Back button (menu) returns to home screen
- Do NOT implement NavigationCarousel, VideoCarousel, MediaCollection, QuizButton, EasterDates — PlaceholderRenderer handles these

## Verification

- Navigating to an Experience from home shows its blocks rendered vertically
- SectionWrapper/Container correctly render nested child blocks
- Video blocks show thumbnails and are focusable
- Text blocks are large and readable
- BibleQuotes carousel navigates horizontally with D-pad
- Unhandled block types silently skip (no crash, dev log only)
- Back button returns to home screen with focus memory preserved
