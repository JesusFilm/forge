---
id: "feat-246"
title: "Watch End Reflection and Next Steps"
owner: "urim"
priority: "P1"
status: "complete"
start_date: "2026-07-10"
duration: 3
depends_on: []
blocks: []
tags:
  - "web"
  - "watch-page"
  - "i18n"
---

## Problem

Watch video completion currently prioritizes auto-advancing to the next item.
That bypasses the moment when a viewer is most ready to reflect, ask a question,
connect with a person, or choose a meaningful next step.

## Entry Points — Read These First

1. `apps/web/src/components/watch/HeroPlayer.tsx` — native video completion
   state and the current Watch Next countdown.
2. `apps/web/src/components/watch/WatchSectionRenderer.tsx` — threads the
   rendered study questions and Watch actions into player-adjacent UI.
3. `apps/web/src/components/watch/WatchStudyQuestions.tsx` — editorial prompt
   shape and established Chat / Bible-question destinations.
4. `apps/web/src/components/watch/WatchPageClient.tsx` — existing Share,
   Download, and floating question-panel action callbacks.
5. `apps/web/src/components/watch/__tests__/HeroPlayer.test.tsx` — player
   lifecycle and Watch Next regression coverage.

## Grep These

- `watchNextMode|nextWatchHref|handleEnded` in `apps/web/src/components/watch/`
- `studyQuestions|WatchStudyQuestionsBlock` in `apps/web/src/`
- `openDownload|openShare|WatchModalCallbacks` in `apps/web/src/components/watch/`
- `WatchStudyQuestions|HeroPlayer` in `apps/web/messages/`

## What To Build

1. Show an accessible end-of-video reflection overlay when a Watch video ends.
   Reveal editorial study questions one at a time, falling back to the existing
   reflection prompt when a video has no editorial questions.
2. Replace end-triggered automatic Watch Next navigation with a viewer-chosen
   next-step panel. Preserve the next playable episode/chapter action whenever
   it is available.
3. Reuse existing public destinations and Watch modals for Bible questions,
   person-to-person chat, sharing, and downloads; include a route-aware Bible
   reading/deeper-learning action only where canonical Watch content supports it.
4. Respect reduced motion, focus management, keyboard escape/replay behavior,
   route changes, fullscreen, and portal boundaries in the player chrome.
5. Add locale-parity-safe copy and focused component/lifecycle coverage;
   browser-smoke the completed state without regressing initial Watch load.

## Constraints

- Keep Watch page metadata, server-rendered content, and staged interaction
  loading intact; do not move the completion feature into server data fetches.
- Do not expose client-side credentials or invent a new chat backend.
- Keep public Watch URLs on existing route helpers and use current share and
  download flows rather than duplicating their behavior.
- The reflection overlay must never auto-navigate the viewer away.

## Verification

- `pnpm --filter @forge/web test -- src/components/watch/__tests__/HeroPlayer.test.tsx src/components/watch/__tests__/WatchSectionRenderer.test.tsx`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- `pnpm --filter @forge/web check:ui-locales`
- Browser smoke the Watch end state on desktop and mobile widths, including
  question progression, each available next step, replay/escape, and reduced
  motion.
