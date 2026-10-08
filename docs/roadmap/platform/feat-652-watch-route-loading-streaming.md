---
id: "feat-652"
title: "Watch route loading and section streaming boundaries"
owner: "vlad"
priority: "P1"
status: "in-progress"
start_date: "2026-10-08"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "watch"
  - "performance"
---

## Problem

Watch home and experience routes wait for asynchronous route work without route-level loading fallbacks. The long home and watch detail experiences also lack independent Suspense boundaries around their hero, content rails, and footer, delaying useful visual feedback during navigation and section rendering.

## Entry Points — Read These First

1. `apps/web/src/app/[locale]/[htmlLang]/loading.tsx`
2. `apps/web/src/app/[locale]/[htmlLang]/[...rest]/loading.tsx`
3. `apps/web/src/components/home/WatchHomeExperiencePage.tsx`
4. `apps/web/src/components/watch/WatchSectionRenderer.tsx`
5. `apps/web/src/components/WatchChromeShell.tsx`
6. `apps/web/src/i18n/client-messages.ts`

## Grep These

- `ExperienceSkeleton`
- `WatchChromeShell`
- `WatchHomeTvCarousel`
- `WatchHomeFooter`
- `WatchBlockEntry`

## What To Build

Add localized loading fallbacks at both Watch route levels. Keep the root route fallback inside the existing Watch chrome and let the catch-all experience fallback inherit the chrome from its segment layout. Wrap the home hero, each rail/block and footer, plus the watch player and each body block, in independent Suspense boundaries. Preserve route layout, player behavior, exposure tracking, and stable list keys.

## Constraints

- Keep route-level skeleton UI in existing `ExperienceSkeleton`.
- The root fallback must resolve the active locale from route params because Next.js `loading.tsx` receives no props.
- Keep the catch-all fallback inside the existing Watch chrome and avoid mounting duplicate chrome.
- Do not change route data fetching, ISR behavior, or player playback semantics.

## Verification

- Web typecheck and scoped ESLint/Prettier.
- Existing Watch home, Watch section renderer, catch-all layout, and route tests.
- Compare the touched client bundle and route render behavior for material regressions.
