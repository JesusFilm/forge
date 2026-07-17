---
id: "feat-250"
title: "Watch Chapter Outline White"
owner: "codex"
priority: "P2"
status: "complete"
start_date: "2026-07-13"
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

Watch chapter cards render a red outline on hover and while currently playing,
but the approved treatment for both states is a white frame. The red play
button remains a separate treatment and should stay red.

## Entry Points - Read These First

1. `apps/web/src/components/watch/SiblingCarousel.tsx` - chapter hover and
   current outline layers.
2. `apps/web/src/components/watch/__tests__/SiblingCarousel.test.tsx` - focused
   carousel style regression coverage.
3. `docs/roadmap/platform/feat-240-watch-chapter-thumbnail-outline.md` - prior
   implementation that introduced the red hover/current outline.

## Grep These

- `sibling-carousel-hover-outline`
- `sibling-carousel-active-outline`
- `border-brand-red`
- `border-white`

## What To Build

1. Change the inactive chapter-card hover and keyboard-focus outline to white.
2. Change the active/current and optimistic-pending chapter outline to white.
3. Keep the play control red.
4. Keep the outline above the caption and bevel layers.

## Constraints

- Do not change Watch routing, navigation feedback, data fetching, or preview
  loading.
- Do not change shared home or media card outline treatments.
- Preserve keyboard focus parity with hover behavior.

## Verification

- `pnpm --filter @forge/web test -- src/components/watch/__tests__/SiblingCarousel.test.tsx`
- Browser smoke a Watch chapter carousel and confirm both the active card and
  an inactive hovered card receive a continuous white frame while the play
  button remains red.
