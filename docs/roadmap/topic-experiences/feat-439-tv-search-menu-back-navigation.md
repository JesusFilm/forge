---
id: "feat-439"
title: "TV search Menu back navigation"
owner: "ekkasit"
priority: "P0"
status: "complete"
start_date: "2026-08-27"
duration: 1
depends_on: []
blocks: []
tags:
  - "tv"
  - "tvos"
  - "search"
  - "navigation"
---

## Problem

On physical Apple TV, pressing Menu/Back from the Search screen exits or
suspends Jesus Film Watch instead of returning to Home. Search does not claim
the tvOS Menu key, so the event bypasses Expo Router.

## What To Build

1. Claim the tvOS Menu key while Search is mounted.
2. Consume `hardwareBackPress` and pop to the previous route.
3. Replace with Home when Search was opened as a root/deep-link route.
4. Restore the default Menu-key behavior when Search unmounts.
5. Preserve the existing Android Back choreography.

## Verification

- Unit-test pop and root-route fallback behavior.
- Guard the native Menu-key claim and cleanup wiring.
- `pnpm --filter @forge/tv test -- --runInBand`
- `pnpm --filter @forge/tv typecheck`
- `pnpm --filter @forge/tv lint`
- Physical Apple TV: Home -> Search -> Menu returns to Home and keeps the app
  foregrounded.

## Resolution

Search now claims and consumes the tvOS Menu key, with a root-route fallback to
Home. The native search dependency preserves React Native's Menu recognizer
while disabling the other parent tap/long-press recognizers required for native
keyboard input. Physical Apple TV verification confirmed Home -> Search -> Menu
returns to the app's Home screen instead of the tvOS launcher.
