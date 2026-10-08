---
id: "feat-634"
title: "Keep Watch header and scroll targets clear"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-10-07"
duration: 1
depends_on: []
blocks: []
tags:
  - "watch"
  - "accessibility"
  - "mobile"
---

## Problem

The floating Watch header's desktop backdrop becomes a transparent gradient
after scroll, scroll targets have no root offset, and the bottom-left feedback
launcher overlaps the first content rail on short viewports.

## Entry points

- `apps/web/src/components/FloatingSearchProvider.tsx`
- `apps/web/src/components/FeedbackLauncher.tsx` (launcher and `FeedbackLoadNotice`)
- `apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx`
- `apps/web/src/components/FeedbackLauncher.test.tsx`

## Scope

Keep the backdrop solid and blurred after the first scroll pixel, set
safe-area-aware root scroll padding for the fixed header, preserve scroll-down
retraction, and move the feedback launcher above the first rail's title band.

## Verification

- Focused floating header and feedback launcher tests.
- Web typecheck, lint, formatting, and diff checks.
- Browser check on portrait and compact landscape Watch pages.

## Resolution

- The backdrop turns opaque and blurred from the first scroll pixel on both
  mobile and desktop; scroll-down retraction remains in place.
- Root scroll padding and the desktop backdrop band are both 80px plus the
  safe-area inset, keeping anchor and focus targets below the header.
- The feedback launcher is raised above the first rail's title area, and its
  loading notice is raised above the launcher.
- The focused header and feedback suites passed (216 tests), along with Web
  typecheck, lint, Prettier, and diff checks.
- Production browser smoke could not load the interactive header selector.
- PR: https://github.com/JesusFilm/forge/pull/2614
