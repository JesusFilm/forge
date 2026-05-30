---
title: "Fix watch mobile player controls width"
type: "fix"
status: "complete"
date: "2026-05-28"
roadmap: "feat-145"
---

## Problem

On mobile watch pages, the custom player controls must extend to the available screen rails instead of reading as a narrow centered control group. The current implementation on `origin/main` already uses the desired full-width chrome contract, so the durable fix is regression coverage that prevents that layout from narrowing again.

## Scope

- Keep `apps/web/src/components/watch/HeroPlayerControls.tsx` on the shared watch rail layout:
  - `absolute inset-x-0 bottom-0`
  - `w-full`
  - `WATCH_PAGE_RAIL_PADDING_CLASSES`
- Add a focused regression assertion in `apps/web/src/components/watch/__tests__/HeroPlayer.test.tsx`.
- Do not change player behavior, timing, icons, language controls, fullscreen behavior, or media data fetching.

## Implementation Notes

`HeroPlayerControls` applies `WATCH_PAGE_RAIL_PADDING_CLASSES`, currently defined in `apps/web/src/lib/content-width.ts` as `px-10 md:px-16 xl:px-24`. The regression test asserts the rendered custom chrome keeps both the full-width positioning classes and the shared rail padding classes.

## Verification

- `pnpm --filter @forge/web test -- src/components/watch/__tests__/HeroPlayer.test.tsx`
