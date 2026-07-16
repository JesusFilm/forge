---
id: "feat-263"
title: "Watch container width consistency"
owner: "codex"
priority: "P1"
status: "complete"
start_date: "2026-07-15"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "ui"
  - "responsive-layout"
---

## Problem

Public Watch page families use different outer and section maximum widths.
The home, single-video, and shared Experience surfaces use the 1920px Watch
frame, while `/watch/languages`, language inventory, and Watch History use
route-local 112rem, `max-w-7xl`, or `max-w-5xl` caps. Series metadata and
episode sections have the opposite problem: they remain uncapped beyond the
shared frame. The drift becomes visible on wide displays and makes navigation
between Watch pages feel structurally inconsistent.
The first implementation unified only the maximum-width box; route-local
horizontal padding still left content edges visibly misaligned at ordinary
desktop widths.

## Entry Points - Read These First

1. `apps/web/src/lib/content-width.ts` - shared 1920px Watch content and rail width contracts.
2. `apps/web/src/components/watch/WatchLanguageIndexBrowser.tsx` - `/watch/languages` parent section with a route-local 112rem cap.
3. `apps/web/src/components/watch-language-inventory/LanguageInventoryPage.tsx` - repeated language inventory hero and section wrappers capped at `max-w-7xl`.
4. `apps/web/src/app/[locale]/[htmlLang]/history/page.tsx` - Watch History parent capped at `max-w-5xl`.
5. `apps/web/src/components/watch/SeriesPageClient.tsx`, `apps/web/src/components/watch/SeriesEpisodesGrid.tsx`, and `apps/web/src/components/watch/SeriesHero.tsx` - uncapped series metadata, episode, and overlay-anchor sections.
6. `apps/web/src/components/sections/Section.tsx` and `apps/web/src/components/home/WatchHomeExperiencePage.tsx` - existing 1920px reference surfaces.
7. `apps/web/src/lib/__tests__/content-width.test.ts` - shared width and Watch rail invariant coverage.

## Grep These

- `max-w-[112rem]|max-w-7xl|max-w-5xl`
- `CONTENT_MAX_WIDTH|CONTENT_WIDTH_ALIGN_CLASSES|WATCH_PAGE_CONTENT_CLASSES`
- `WatchLanguageIndexBrowser|LanguageInventoryPage|WatchHistoryPage|SeriesPageClient|SeriesEpisodesGrid`
- `max-w-[1920px]`

## What To Build

1. Make one exported 1920px Watch frame the source of truth for public Watch parent and section maximum widths.
2. Replace route-local outer width caps and gutters on the language index, language inventory, and history surfaces with the shared frame and Watch rail contract while preserving intentional inner text and card width constraints.
3. Cap series metadata and episode sections with the same shared contract without changing their responsive grid or atmospheric backdrop behavior.
4. Add regression coverage that fails when a public Watch page reintroduces a divergent outer or section maximum width.
5. Verify the linked production layout and representative local Watch routes at desktop, ultrawide, and mobile widths.

## Constraints

- Preserve the existing user-owned changes on `feat/watch-global-language-switcher` and keep this fix limited to outer/section width consistency.
- Do not remove intentional inner content measure constraints such as prose line lengths, modal widths, card widths, or player overlays.
- Keep carousel bleed, content padding, and trailing spacer ladders in lockstep.
- Do not add client-side initialization, new requests, or new dependencies.
- Visual smoke must be paired with page-load evidence because public Watch rendering changes are frontend changes.

## Verification

- Focused Vitest run passed: 8 files, 71 tests, covering the shared token,
  language index, every language-inventory frame, history, series metadata,
  episode grid, and series overlay anchor.
- Web TypeScript check passed with `tsc --noEmit` after generating UI locales.
- Scoped ESLint passed for all six changed production files. Repository-wide
  lint in the temporary Windows QA checkout was not a usable signal because
  its unchanged files were checked out with CRLF; the staged feature files
  were formatted and `git diff --cached --check` passed.
- Production baseline geometry at a 2200px viewport confirmed the reported
  defect: `/watch/languages` rendered at 1792px while `/watch` rendered at
  1920px. Exact DOM/class regression tests now require the shared 1920px token
  on all changed parent and section frames, including all eight inventory
  frames, and reject their former local caps.
- Local browser QA reached the rebuilt app, but the in-app browser security
  policy blocked the post-restart localhost reload. This was not bypassed;
  authenticated `/watch/history` would also require its OAuth flow. The class
  contract tests cover both surfaces deterministically.
- Page-load risk audit passed: the production diff only substitutes shared
  layout classes and imports the existing width constant. It adds no requests,
  scripts, dependencies, effects, listeners, hydration boundary, or client
  initialization.
- Structured review run `20260715-173831-62656525` completed with no P0-P3
  findings after strengthening the language-inventory assertions.
- Follow-up browser geometry caught a remaining gutter mismatch at a 1280px
  viewport: Languages began at 32px while home and single-video content began
  at 96px. The affected language, inventory, history, and series wrappers now
  use `WATCH_PAGE_CONTENT_CLASSES`; the Languages route no longer pads outside
  its canonical frame.
- Live local geometry at a 2200px viewport now reports the same `1920px` width,
  `132.5px` centered origin, and `96px` inner rail for home, Languages,
  language inventory, and series. The follow-up focused suite passed 40 tests
  across 6 files, and scoped ESLint passed.
