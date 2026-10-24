---
id: "feat-254"
title: "Keep Watch single-page footer above sticky player"
owner: "urim"
priority: "P2"
status: "complete"
start_date: "2026-07-15"
duration: 1
depends_on:
  - "feat-250"
blocks: []
tags:
  - "web"
  - "watch"
  - "ui"
---

## Problem

The footer added to playable single-video Watch pages can paint underneath the
sticky hero player when the viewer reaches the end of the page. The first strip
of footer content is therefore partially hidden by the still-pinned video,
especially at tablet landscape viewport sizes.

## Entry Points — Read These First

1. `apps/web/src/components/home/WatchHomeFooter.tsx` — the shared footer whose
   root currently has no explicit positioning or stacking layer.
2. `apps/web/src/components/watch/HeroPlayer.tsx` — the positioned sticky hero
   that remains pinned while later content scrolls over it.
3. `apps/web/src/components/watch/WatchSectionRenderer.tsx` — the body sheet
   that already paints above the sticky hero before the footer begins.
4. `docs/solutions/design-patterns/mux-player-custom-react-chrome-pattern-20260430.md`
   — the established sticky-hero paint-order and stacking-context contract.

## Grep These

- `data-testid="watch-home-footer"`
- `data-testid="hero-player-wrapper"`
- `className={`sticky relative w-full`
- `watch-body-zone`

## What To Build

1. Give the shared Watch footer an explicit positioned stacking layer above the
   sticky hero without changing its content, dimensions, or route composition.
2. Add focused regression coverage for the footer root's layer contract.
3. Verify a playable single-video page can scroll fully into the footer at the
   affected tablet landscape viewport and at a representative desktop viewport.

## Constraints

- Preserve the sticky hero and frosted-body scroll-over composition.
- Do not add compensating footer padding or a fixed player-height spacer.
- Keep the existing footer copy, links, images, background, and test identifier.
- Do not move the footer into the client-side player bundle.
- Do not change series, embed, inventory, history, or authored-experience route
  composition.

## Verification

- Run the focused Watch footer component test.
- Run Web type checking and linting for the touched scope.
- In a browser, scroll a playable single-video page to the footer at the
  screenshot's 1280x960 tablet landscape viewport and confirm the entire footer
  paints above the sticky video.
- Repeat the scroll smoke at a representative desktop viewport and confirm the
  sticky hero and body sheet still retain their existing behavior.
