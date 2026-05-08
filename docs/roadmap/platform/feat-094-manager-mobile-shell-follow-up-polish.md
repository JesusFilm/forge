---
id: "feat-094"
title: "Manager Mobile Shell Follow-Up Polish"
owner: "vlad"
priority: "P2"
status: "complete"
start_date: "2026-04-22"
duration: 1
depends_on:
  - "feat-093"
blocks:
  - "feat-095"
tags:
  - "manager"
  - "design-system"
  - "mobile"
  - "styling"
---

## Problem

The Studio shell rollout is in place, but the mobile header still has a few usability and hierarchy issues surfaced during browser review: the `Studio` wordmark is too light, the profile menu lives in the lower action row instead of the top header row, and the primary route icons do not collapse on very small screens.

## Entry Points — Read These First

1. `apps/manager/src/features/shell/manager-shell.tsx` — mobile brand row, mobile nav, and profile menu placement.
2. `apps/manager/src/components/ui/button.tsx` — existing icon-button sizing and focus treatment used by the shell.
3. `apps/manager/src/lib/utils.ts` — `cn(...)` utility for responsive class composition.

## Grep These

- `StudioBrand`
- `MobileNav`
- `StudioUserMenu`
- `lg:hidden`
- `aria-label="Open user menu"`

## What To Build

1. Increase the visual weight of the mobile `Studio` wordmark without redesigning the logo row.
2. Move the mobile user-menu trigger into the top brand/header row while keeping the desktop placement unchanged.
3. Keep the existing icon nav on normal mobile widths, but switch to a hamburger-triggered menu on very small screens.
4. Keep the lower header action row focused on page actions (`Explore`, `Select`, notifications) rather than account navigation on mobile.

## Constraints

- Preserve the existing Studio visual language and color tokens.
- Keep the change scoped to the shared shell; do not redesign Coverage page internals.
- Do not change desktop navigation behavior.
- Ensure the very-small-screen nav remains keyboard accessible.

## Verification

- `pnpm --filter @forge/manager lint`
- Browser check at `http://localhost:6302/dashboard/coverage`
- Confirm on a very small mobile viewport that:
  - the top row shows a bolder `Studio` wordmark,
  - the profile button is in the top row,
  - the primary nav appears behind a hamburger menu instead of inline icons.

## Completion Notes

- The mobile `Studio` wordmark now uses a heavier weight in the shared shell brand row.
- The mobile profile trigger moved into the top header row, leaving the lower action row focused on page controls.
- The primary mobile nav keeps inline icons on regular mobile widths and collapses to a hamburger-triggered menu at `360px` and below.
