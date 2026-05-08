---
id: "feat-097"
title: "Manager Mobile Notifications in Profile Menu"
owner: "vlad"
priority: "P2"
status: "not-started"
start_date: "2026-04-22"
duration: 1
depends_on:
  - "feat-096"
blocks: []
tags:
  - "manager"
  - "design-system"
  - "mobile"
  - "styling"
---

## Problem

The mobile header is still too busy with separate icons for notifications, profile, and navigation. On smaller widths the standalone notifications button competes with the more important profile and navigation controls. The better mobile pattern is to fold notifications into the profile menu while keeping the desktop header unchanged.

## Entry Points — Read These First

1. `apps/manager/src/features/shell/manager-shell.tsx` — mobile top-row controls, `NotificationButton`, and `StudioUserMenu`.
2. `apps/manager/src/components/ui/button.tsx` — shared icon button treatment used by the shell.

## Grep These

- `NotificationButton`
- `StudioUserMenu`
- `aria-label="Notifications"`
- `mobile = false`

## What To Build

1. Remove the standalone notifications button from the mobile header row.
2. Add a notifications item inside the mobile user menu.
3. Keep the desktop notifications button unchanged in the lower header actions area.

## Constraints

- Preserve the current Studio visual language and spacing.
- Keep the change scoped to the shared manager shell.
- Do not redesign the desktop header.

## Verification

- `pnpm --filter @forge/manager lint`
- Browser check at `http://localhost:6302/dashboard/coverage`
- Confirm on a mobile viewport that notifications are no longer a separate top-row button and are instead available through the user menu.
