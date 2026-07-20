---
id: "feat-275"
title: "Watch Experience Media Card White Outline"
owner: "codex"
priority: "P2"
status: "complete"
start_date: "2026-07-20"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "experience"
  - "ui"
---

## Problem

Numbered media cards on Watch Experience pages render a red gradient hover and
keyboard-focus frame. The approved treatment is a continuous solid-white frame
around the full card perimeter with no red or gradient in the interaction
indicator.

## Entry Points - Read These First

1. `apps/web/src/components/sections/MediaCollection.tsx` - Experience media
   card markup and hover/focus outline overlay.
2. `apps/web/src/components/sections/MediaCollection.test.tsx` - focused media
   collection rendering and style-contract coverage.
3. `apps/web/src/components/watch/SiblingCarousel.tsx` - local precedent for a
   solid-white card outline rendered above caption and bevel layers.

## Grep These

- `media-collection-card-hover-outline`
- `watch-home-gradient-outline`
- `group-hover:opacity-100`
- `group-focus-visible:opacity-100`

## What To Build

1. Replace the Experience media-card red gradient hover indicator with a solid
   white frame that covers the complete card outline.
2. Apply the same frame for keyboard focus.
3. Keep the outline overlay above the card bevel, text, and preview layers.
4. Preserve both horizontal and vertical card shapes.

## Constraints

- Do not change shared Watch home, search, or chapter-card hover treatments.
- Do not change Experience routing, media data, Mux preview loading, card
  content, text scrims, or backdrop behavior.
- Do not add a shared styling abstraction for this localized correction.

## Verification

- `pnpm --filter @forge/web test -- src/components/sections/MediaCollection.test.tsx`
- Browser smoke the numbered Christmas Experience media grid with pointer and
  keyboard focus, confirming a continuous solid-white frame and no red gradient
  while card previews and navigation remain unchanged.
- Capture lightweight page-load performance evidence for the same route and
  confirm the style-only change adds no initial-load work or resources.

## Completion Evidence

- Focused `MediaCollection` suite: 17/17 passing.
- Web TypeScript and scoped ESLint checks: passing.
- Browser smoke at 1280x720 and 390x844: the interaction overlay renders a
  continuous 4px solid-white frame with no gradient or shadow; keyboard focus
  reaches full opacity and the compiled pointer-hover rule remains present.
- Page-load check: no new requests, effects, or client initialization were
  introduced; a warm local dev reload reached DOMContentLoaded in 3.35 seconds.
