---
id: "feat-325"
title: "Attach the shared Experience template to single-video Watch pages"
owner: "codex"
priority: "P1"
status: "complete"
start_date: "2026-07-31"
duration: 1
depends_on:
  - "feat-047"
blocks:
  - "feat-326"
tags:
  - "web"
  - "watch-page"
  - "experience"
  - "templates"
---

## Problem

Admin exposes one published `WatchSetting.defaultTemplateExperience` per
locale, and Web's `mergeWatchExperience` can append authored Experience blocks
after the generated video-page sections. Current standalone-video and episode
routes do not load or pass that Experience, so ordinary video pages always use
only their generated composition.

## Entry Points

1. `apps/web/src/lib/content.ts` - Watch settings lookup and
   `mergeWatchExperience`.
2. `apps/web/src/app/[locale]/[htmlLang]/[...rest]/page.tsx` - standalone and
   episode route composition.
3. `apps/web/src/app/[locale]/[htmlLang]/[...rest]/__tests__/page-routing.test.tsx`
   - route integration coverage.
4. `apps/admin/src/scripts/web-fixtures.json` - local published template
   Experience example.

## What To Build

1. Resolve the published default template for the page locale with bounded
   caching and Watch settings/Experience invalidation tags.
2. Pass that template into `mergeWatchExperience` for standalone-video and
   episode pages.
3. Preserve the generated player, description, navigation, Bible, sharing,
   and footer. Missing or failed template lookup must leave the current page
   unchanged.
4. Make the local template fixture a non-player supplemental block so it
   visibly demonstrates bottom-of-page attachment.
5. Ignore player-bearing blocks in append mode so an older default template
   cannot add a second player to ordinary video pages.
6. Demonstrate a complete supplemental flow locally: a promotional invitation,
   related questions, then two ways to continue the conversation.

## Constraints

- Do not create one Experience per video.
- Do not replace the canonical `HeroPlayer` or other generated page slots in
  this example.
- Do not attach the template to series landing or explicit Experience pages.
- A static question block is only a local composition example; truly
  video-relevant AI questions require a later route-aware block/data source.

## Verification

- Focused Web content and catch-all route tests cover template present,
  template absent, lookup failure, standalone video, and episode video.
- Admin fixture test confirms the template remains published and contains no
  player-bearing block.
- Web typecheck/lint pass.
- Local Admin/Web browser smoke shows the shared example after the existing
  single-video page content.
