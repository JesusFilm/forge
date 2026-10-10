---
id: "feat-233"
title: "Watch home card hover backdrop polish"
owner: "vlad"
priority: "P2"
status: "complete"
start_date: "2026-07-03"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "ui"
---

## Problem

The `/watch` home section background changes abruptly when hovering individual
cards. The current card-level hover clears the section background between
adjacent cards and swaps the active background with a large opacity jump, making
the motion feel harsh.

## Entry Points - Read These First

1. `apps/web/src/components/home/WatchHomeSection.tsx` - section-level hover
   background state and backdrop layers.
2. `apps/web/src/components/home/WatchHomeCard.tsx` - card hover/focus event
   callbacks and local card hover treatment.
3. `apps/web/src/components/home/__tests__/WatchHomePage.test.tsx` - home page
   rendering and hover regression coverage.

## Grep These

- `onHoverImageChange`
- `watch-home-section-hover-backdrop`
- `poster-hover-zoom`

## What To Build

1. Keep a stable default section background while hovered card artwork fades in
   as a softer overlay.
2. Avoid clearing the hover backdrop when moving between cards inside the same
   section.
3. Preserve keyboard focus parity for the same hover backdrop behavior.
4. Add regression coverage for the backdrop layer and pointer movement between
   cards.

## Constraints

- Do not change watch home data fetching or public `/watch` link generation.
- Do not introduce a new animation library.
- Keep the effect understated so card hover remains legible over the section
  artwork.

## Verification

- `pnpm --filter @forge/web test -- WatchHomePage`
- Visual smoke of `/watch` at desktop width, confirming card hover no longer
  flashes the section background.
