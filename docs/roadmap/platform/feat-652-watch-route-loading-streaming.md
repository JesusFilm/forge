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

Add localized loading fallbacks at both Watch route levels. The root route fallback is a neutral header-and-content skeleton (`WatchRouteLoadingShell`) that does not mount `WatchChromeShell`; the catch-all experience fallback inherits the real chrome from its segment layout. Wrap the home hero, each rail/block and footer, plus the watch player and each body block, in independent Suspense boundaries. Preserve route layout, player behavior, exposure tracking, and stable list keys.

## Constraints

- Keep route-level skeleton UI in existing `ExperienceSkeleton`.
- Keep `WatchChromeShell` a server component. The root fallback must not import it or `@/lib/locale`: marking the shell `"use client"` added about 12 KB gzip to the Watch home route's client JS (measured, see Verification).
- Keep the catch-all fallback inside the existing Watch chrome and avoid mounting duplicate chrome.
- A cold ISR miss is not streamed by this change: the response is a single complete HTML payload. The fallbacks are expected to matter only for client navigations (not proven locally). Improving cold-miss time to first byte needs a separate decision (pre-generated params, or Cache Components/PPR).
- Do not change route data fetching, ISR behavior, or player playback semantics.

## Verification

- Web typecheck and scoped ESLint/Prettier.
- Existing Watch home, Watch section renderer, catch-all layout, and route tests.
- Compare the touched client bundle and route render behavior for material regressions.
- Measured 2026-10-09 (Turbopack build, gzip, Watch home route client JS): main 703.8 KB, PR head with a client `WatchChromeShell` 716.6 KB, this version 704.5 KB.
