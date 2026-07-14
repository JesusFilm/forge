---
id: "feat-250"
title: "Watch single-video page footer parity"
owner: "urim"
priority: "P2"
status: "complete"
start_date: "2026-07-13"
duration: 1
depends_on:
  - "feat-235"
blocks: []
tags:
  - "web"
  - "watch"
  - "ui"
---

## Problem

Watch Home ends with the ministry footer, but playable single-video pages stop
after their video content. Viewers landing on a standalone video or contextual
episode cannot reach the footer navigation, social, giving, legal, contact, or
newsletter links without returning to the homepage.

## Entry Points — Read These First

1. `apps/web/src/components/home/WatchHomeFooter.tsx` — the existing static
   footer to reuse without redesigning it.
2. `apps/web/src/app/[locale]/[htmlLang]/[...rest]/page.tsx` — the catch-all
   route whose video and episode branches render `WatchPageClient`.
3. `apps/web/src/app/[locale]/[htmlLang]/[...rest]/__tests__/page-routing.test.tsx`
   — route-branch regression coverage.
4. `docs/plans/2026-07-13-003-feat-watch-single-page-footer-plan.md` — scoped
   implementation plan and verification contract.

## What To Build

1. Render the existing Watch footer after playable two-segment video pages.
2. Render the same footer after playable three-segment contextual episode
   pages.
3. Keep the footer in server route composition rather than the client player
   bundle.
4. Cover both video shapes and the unchanged series branch in route tests.

## Constraints

- Keep the footer's current copy, links, images, styling, and test identifier.
- Do not add it to series, one-segment, history, inventory, embed, or
  builder-authored experience surfaces.
- Do not change player hydration or client-side interaction behavior.

## Verification

- Focused catch-all route tests cover standalone video, contextual episode,
  and unchanged series behavior.
- Web type checking and linting pass for the touched scope.
- Desktop and mobile browser smoke show the footer after playable video
  content without degrading initial player rendering.
