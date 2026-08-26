---
id: "feat-425"
title: "Anchor Watch introduction coachmarks to chrome controls"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-08-26"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "watch"
  - "onboarding"
  - "accessibility"
---

## Problem

The Watch introduction tour explains Search and Language, but its rendered
desktop coachmarks still read as generic centered dialogs. The supplied
reference uses a visible callout pointer attached to the highlighted control,
so advancing the tour clearly moves attention from one interface element to
the next.

## Entry Points — Read These First

1. `apps/web/src/components/watch/WatchIntroductionTour.tsx` — target
   measurement, dialog placement, highlight, and pointer rendering.
2. `apps/web/src/components/watch/WatchIntroductionTour.test.tsx` — target
   discovery, responsive fallback, RTL, and forced-colors regressions.
3. `apps/web/src/components/FloatingSearchController.tsx` — desktop Search
   target test ID.
4. `apps/web/src/components/FloatingHeader.tsx` — Language target test ID.
5. `/tmp/codex-clipboard-328c0505-8694-43e6-9b8a-13814b88da92.png` — selected
   reference state for a pointer attached to Search.

## Grep These

- `TARGET_SELECTORS`
- `measureTarget`
- `watch-introduction-arrow`
- `watch-introduction-target-outline`
- `data-watch-tour-layout`

## What To Build

1. Position desktop steps 2 and 3 directly below the visible Search and
   Language controls when viewport space permits.
2. Render a small, seamless pointer whose tip aligns with the current target's
   horizontal center without reading as a separate outlined icon.
3. Keep the active target visually above the dimmed context and move both the
   highlight and pointer when advancing between Search and Language.
4. Preserve a centered, pointer-free fallback when the target is absent,
   hidden, forced-colors mode is active, or the viewport cannot support a
   readable anchored layout.
5. Keep the dialog accessible, focus-trapped, keyboard operable, responsive,
   RTL-safe, and coordinated with Watch playback/modal ownership.

## Constraints

- Do not make the underlying Search or Language control interactive while the
  tour owns focus.
- Do not move the close control outside the accessible dialog tree.
- Do not add page-load work; target measurement remains inside the lazy tour.
- Do not change tour eligibility, completion persistence, signup handoff, or
  localization copy.

## Verification

- Focused tests prove the pointer and highlight move from Search to Language,
  the tip aligns to each target, and centered fallbacks remain intact.
- Browser captures at the reference desktop viewport visibly show steps 2 and
  3 pointing to their respective chrome controls.
- Mobile, RTL, keyboard, scoped accessibility, format, lint, typecheck, and
  initial-resource checks remain green.

## Resolution

- Added a visible spotlight cutout and triangular connector for the Search
  and Language steps, with both moving to the newly active control.
- Added a shared dialog portal layer so the spotlight stays below the dialog
  while remaining above the Watch page.
- Kept scrolling inside the card content so the connector is not clipped.
- Verified both anchored states in a 1280 × 800 browser recording and paired
  source/implementation comparisons.
- Passed 10 focused component tests, type checking, touched-file lint, and a
  dialog-scoped accessibility scan with zero violations.
- Refined the anchored cards to a compact 440-pixel maximum width, removed
  decorative icon and eyebrow chrome from targeted steps, reduced spacing and
  action sizes, and blended the pointer into the card surface.
- Lifted the card and pointer surface to charcoal `#242424` so the compact
  coachmark stays distinct from the black Watch backdrop.
- Removed the red target border and glow, leaving the active control visible
  through the spotlight cutout alone.
