---
id: "feat-453"
title: "Unify Watch template content rails"
owner: "codex"
priority: "P2"
status: "complete"
start_date: "2026-09-04"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "ui"
---

## Problem

Public Watch templates use several unrelated maximum widths and inline gutter
ladders. Series metadata and episode grids are not capped at all, while the
language index, language inventory, and history pages use narrower local
containers. This makes otherwise related Watch surfaces drift on wide screens.

## Entry Points — Read These First

1. `apps/web/src/lib/content-width.ts` — canonical Watch content rail tokens.
2. `apps/web/src/components/watch/SeriesPageClient.tsx` — series metadata rail.
3. `apps/web/src/components/watch/SeriesEpisodesGrid.tsx` — series episode grid.
4. `apps/web/src/components/watch/WatchLanguageIndexBrowser.tsx` — language index rail.
5. `apps/web/src/components/watch-language-inventory/LanguageInventoryPage.tsx` — inventory content rails.
6. `apps/web/src/app/[locale]/[htmlLang]/history/page.tsx` — history rail.

## Grep These

- `max-w-7xl|max-w-5xl|max-w-\[112rem\]`
- `px-5.*md:px-16.*xl:px-24`
- `WATCH_PAGE_CONTENT_CLASSES`

## What To Build

Use `WATCH_PAGE_CONTENT_CLASSES` as the single route-level content rail for all
public Watch templates. Remove template-local maximum widths and duplicated
responsive gutter ladders. Keep full-bleed backgrounds and media outside the
rail.

## Constraints

- Do not change the shared 1920px maximum or responsive gutter values.
- Do not constrain full-bleed hero artwork or video media.
- Do not change internal demo or preview-only routes.
- Preserve mobile carousel bleed behavior.

## Verification

- Run focused content-width and affected component tests.
- Run Web TypeScript validation.
- Run Prettier on changed files.
- Verify representative templates use the shared content rail token.
