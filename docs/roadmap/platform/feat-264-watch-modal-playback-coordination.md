---
id: "feat-264"
title: "Pause Watch playback for every modal"
owner: "codex"
priority: "P2"
status: "in-progress"
start_date: "2026-07-16"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "watch"
  - "playback"
  - "accessibility"
---

## Problem

Watch playback can continue beneath question, feedback, quiz, and other modal
surfaces because pause ownership is split between page-local and beta-specific
effects. Overlapping modal lifecycles can also resume media before every overlay
has finished closing.

## Entry Points — Read These First

1. `apps/web/src/app/[locale]/[htmlLang]/layout.tsx` — Watch-scoped providers
   and global launchers.
2. `apps/web/src/components/FloatingSearchProvider.tsx` — global search modal
   lifecycle, including its closing animation.
3. `apps/web/src/components/watch/WatchPageClient.tsx` — existing page-owned
   modal pause and resume behavior.
4. `apps/web/src/components/watch/BetaTesterModalProvider.tsx` — media identity
   and late-attachment safeguards from the beta modal rollout.
5. `docs/plans/2026-07-16-001-fix-watch-modal-playback-coordination-plan.md` —
   reviewed implementation plan and acceptance examples.

## What To Build

1. Add a Watch-layout-scoped token registry that aggregates every active modal
   owner through its visible close lifecycle.
2. Add one shared media hook that pauses all Watch players and resumes only the
   exact media element that was playing before the first modal opened.
3. Register search, language, download, share, question, feedback, beta-tester,
   series, and authored quiz dialogs without changing their focus ownership.
4. Cover hero, home-carousel, and authored inline media, including autoplay and
   source-change attempts while modal activity is active.

## Constraints

- Keep the provider scoped to Watch routes.
- Preserve search/feedback and question/beta mutual-exclusion behavior.
- Preserve focus return, scroll lock, lazy loading, and close animations.
- Never resume media that attached after modal activity began or was replaced
  while a modal was active.

## Verification

- Run focused provider, modal-owner, and player component tests.
- Run Web type checking, lint, and CI-sensitive checks for the touched scope.
- Browser-smoke an active hero, home carousel, and authored inline player with
  representative built-in, global, and lazy dialogs.
- Capture a screenshot of a visible overlay with playback paused underneath.
