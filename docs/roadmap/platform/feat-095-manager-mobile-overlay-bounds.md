---
id: "feat-095"
title: "Manager Mobile Overlay Bounds"
owner: "vlad"
priority: "P2"
status: "complete"
start_date: "2026-04-22"
duration: 1
depends_on:
  - "feat-094"
blocks:
  - "feat-096"
tags:
  - "manager"
  - "design-system"
  - "mobile"
  - "styling"
---

## Problem

The shared mobile shell now places profile and navigation controls in the top row, but their popup panels can still extend outside the visible viewport on small screens. That breaks basic usability in the in-app browser and makes profile/navigation actions partially inaccessible.

## Entry Points — Read These First

1. `apps/manager/src/features/shell/manager-shell.tsx` — `StudioUserMenu` and `MobileNav` popup positioning.
2. `apps/manager/src/components/ui/button.tsx` — mobile trigger button sizing and focus treatment.

## Grep These

- `StudioUserMenu`
- `MobileNav`
- `absolute right-0 top-full`
- `shadow-[0_24px_56px_rgba(8,8,8,0.14)]`

## What To Build

1. Constrain mobile shell popups to the viewport instead of letting them size purely from their trigger position.
2. Keep desktop dropdown behavior unchanged.
3. Add mobile max-height and scrolling so taller panels remain usable on short screens.

## Constraints

- Preserve the existing Studio visual language and tokens.
- Keep the fix scoped to shared mobile shell overlays.
- Do not redesign the desktop menus.

## Verification

- `pnpm --filter @forge/manager lint`
- Browser check at `http://localhost:6302/dashboard/coverage`
- Confirm on a mobile viewport that the profile menu and hamburger menu stay fully inside the screen and remain scrollable if needed.

## Completion Notes

- Mobile profile and hamburger panels now use viewport-bounded overlay positioning instead of trigger-relative dropdown geometry.
- Both mobile overlay paths keep a max-height and internal scrolling so the controls remain reachable on short screens.
