---
id: "feat-334"
title: "Watch player volume preference persistence"
owner: "codex"
priority: "P1"
status: "complete"
start_date: "2026-08-04"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "watch"
  - "player"
---

## Problem

Watch committed playback volume resets when a person moves between video pages.
After someone changes volume or mute state, subsequent Watch pages should start
from that preference instead of the player default.

## Entry Points

1. `apps/web/src/components/watch/HeroPlayerControls.tsx` - committed Watch
   player chrome volume and mute controls.
2. `apps/web/src/lib/watch-volume-preference.ts` - browser-safe preference
   serialization.
3. `apps/web/src/components/watch/__tests__/HeroPlayerControls.test.tsx`,
   `apps/web/src/components/watch/__tests__/HeroPlayer.test.tsx`, and
   `apps/web/src/lib/watch-volume-preference.test.ts` - regression coverage.

## What To Build

1. Persist committed playback `volume` and `muted` state in browser storage
   after volume or mute interaction.
2. Apply a stored preference when a new Watch player controls instance mounts
   on another page.
3. Ignore missing, malformed, or out-of-range stored values.
4. Keep autoplay previews muted; only committed Watch playback should use this
   preference.

## Verification

```bash
pnpm --filter @forge/web test src/lib/watch-volume-preference.test.ts src/components/watch/__tests__/HeroPlayerControls.test.tsx
pnpm --filter @forge/web test src/components/watch/__tests__/HeroPlayer.test.tsx
pnpm --filter @forge/web exec eslint src/lib/watch-volume-preference.ts src/lib/watch-volume-preference.test.ts src/components/watch/HeroPlayer.tsx src/components/watch/HeroPlayerControls.tsx src/components/watch/__tests__/HeroPlayer.test.tsx src/components/watch/__tests__/HeroPlayerControls.test.tsx
pnpm --filter @forge/web typecheck
```
