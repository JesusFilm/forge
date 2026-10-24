---
id: "feat-778"
title: "Keep Watch films playable when sessionStorage is blocked"
owner: "vlad"
priority: "P2"
status: "complete"
start_date: "2026-10-21"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "watch"
---

## Problem

When a browser blocks site data (Chrome "Block all site data", some embedded
and privacy browsers), reading `window.sessionStorage` itself throws a
`SecurityError`. The Watch film page read it unguarded in two places:

- `SiblingCarousel` consumed the chapter-carousel handoff inside a render-time
  `useState` initializer. The throw reached the route error boundary, so the
  whole film page showed "Something went wrong" instead of the film.
- `WatchPageClient` wrote the same handoff right before `router.push` in a
  chapter click. The throw skipped the push, so the chapter never opened.

Blocking only `localStorage` was already fine. Every other `sessionStorage`
call on the Watch film path was already guarded. Found in the 2026-10-20
website audit follow-up (rounds 04 and 05); the caller was confirmed from
captured getter stacks in a production build. Field impact is unknown.

## Entry Points — Read These First

1. `apps/web/src/components/watch/chapter-navigation.ts` — the handoff key,
   type, and the best-effort `writeWatchChapterCarouselPreserveState` /
   `consumeWatchChapterCarouselPreserveState` helpers.
2. `apps/web/src/components/watch/SiblingCarousel.tsx` —
   `consumePreservedCarouselIndex`, called from a `useState` initializer.
3. `apps/web/src/components/watch/WatchPageClient.tsx` — the chapter
   navigation callback that writes the handoff and then pushes.

## Grep These

- `WATCH_CHAPTER_CAROUSEL_PRESERVE_KEY`
- `sessionStorage` under `apps/web/src/components/watch`

## What To Build

- Read and write the chapter-carousel handoff only through the two helpers.
  Both catch getter, read, write and quota errors.
- When storage is unusable, keep the handoff in module memory for the same
  tab. Chapter navigation is a client push in one JS realm, so the target
  carousel still keeps its scroll position. The memory copy is read once and
  never survives a reload, matching a new tab's empty `sessionStorage`.
- A stored handoff wins over a stale memory one; consuming clears both.

## Constraints

- No blanket storage refactor. The recommendation tab-correlation, feedback
  intro, collection download, language-option cache and home-carousel calls
  are already guarded and stay unchanged.
- Recommendation tab correlation stays fail-open to the trusted href. Do not
  move its nonce to memory: that would invent a correlation the server cannot
  distinguish from a real tab claim.

## Verification

- `pnpm --filter @forge/web exec vitest run src/components/watch/__tests__/SiblingCarousel.test.tsx src/components/watch/__tests__/WatchPageClient.navigation.test.tsx`
  — the two blocked-getter cases fail on the old code.
- `next build` + `next start`, then load `/watch/jesus.html/english.html` in
  Chromium and Firefox with a throwing `window.sessionStorage` getter: the
  film renders, a chapter click opens the chapter, and play, search, the
  language picker and the download dialog still work.
