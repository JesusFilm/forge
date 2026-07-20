---
id: "feat-263"
title: "Watch container width consistency"
owner: "codex"
priority: "P1"
status: "in-progress"
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

## Entry Points - Read These First

1. `apps/web/src/lib/content-width.ts` - shared 1920px Watch content and rail width contracts.
2. `apps/web/src/components/watch/WatchLanguageIndexBrowser.tsx` - `/watch/languages` parent section with a route-local 112rem cap.
3. `apps/web/src/components/watch-language-inventory/LanguageInventoryPage.tsx` - repeated language inventory hero and section wrappers capped at `max-w-7xl`.
4. `apps/web/src/app/[locale]/[htmlLang]/history/page.tsx` - Watch History parent capped at `max-w-5xl`.
5. `apps/web/src/components/watch/SeriesPageClient.tsx` and `apps/web/src/components/watch/SeriesEpisodesGrid.tsx` - uncapped series metadata and episode sections.
6. `apps/web/src/components/sections/Section.tsx` and `apps/web/src/components/home/WatchHomeExperiencePage.tsx` - existing 1920px reference surfaces.
7. `apps/web/src/lib/__tests__/content-width.test.ts` - shared width and Watch rail invariant coverage.

## Grep These

- `max-w-[112rem]|max-w-7xl|max-w-5xl`
- `CONTENT_MAX_WIDTH|CONTENT_WIDTH_ALIGN_CLASSES|WATCH_PAGE_CONTENT_CLASSES`
- `WatchLanguageIndexBrowser|LanguageInventoryPage|WatchHistoryPage|SeriesPageClient|SeriesEpisodesGrid`
- `max-w-[1920px]`

## What To Build

1. Make one exported 1920px Watch frame the source of truth for public Watch parent and section maximum widths.
2. Replace route-local outer width caps on the language index, language inventory, and history surfaces with the shared contract while preserving intentional inner text and card width constraints.
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

- `pnpm --filter @forge/web exec vitest run src/lib/__tests__/content-width.test.ts src/components/watch/WatchLanguageIndexBrowser.test.tsx src/components/watch/__tests__/SeriesPageClient.test.tsx src/components/watch/__tests__/SeriesEpisodesGrid.test.tsx src/app/[locale]/[htmlLang]/languages/page.test.tsx src/app/[locale]/[htmlLang]/videos/[languageSlug]/page.test.tsx src/app/[locale]/[htmlLang]/history/page.test.tsx`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- Browser geometry checks on `/watch`, a single-video route, `/watch/languages`, `/watch/english.html/videos`, `/watch/history`, and a series route at mobile, desktop, and greater-than-1920px widths.
- Page-load evidence confirms the shared class substitution adds no requests, scripts, hydration, or client initialization.
