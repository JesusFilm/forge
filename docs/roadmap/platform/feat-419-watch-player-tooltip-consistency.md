---
id: "feat-419"
title: "Watch player tooltip consistency"
owner: "urim"
priority: "P1"
status: "in-progress"
start_date: "2026-08-22"
duration: 1
depends_on:
  - "feat-418"
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "subtitles"
  - "accessibility"
  - "i18n"
---

## Problem

The compact Watch subtitle tooltip can wrap `Subtitles` and its active
language onto separate lines with a dangling middle dot. The other icon-only
player controls have accessible names but no equivalent visible tooltip.

This is a focused follow-up to FGE-92. It preserves subtitle availability,
delivery, modal behavior, and the visible subtitle icon states delivered by
`feat-418`.

Implementation contract:
[`docs/plans/2026-08-22-2330-fix-watch-player-tooltip-consistency-plan.md`](../../plans/2026-08-22-2330-fix-watch-player-tooltip-consistency-plan.md).

## Entry Points — Read These First

1. `apps/web/src/components/watch/ChromeButton.tsx` — shared icon-button tooltip rendering.
2. `apps/web/src/components/watch/HeroPlayerControls.tsx` — dynamic player actions and subtitle state.
3. `apps/web/src/components/watch/__tests__/HeroPlayerControls.test.tsx` — focused chrome behavior.
4. `apps/web/src/components/watch/__tests__/HeroPlayer.test.tsx` — integrated subtitle-state coverage.
5. `docs/solutions/ui-bugs/watch-subtitle-discoverability-hydration.md` — FGE-92 constraints and residuals.

## Grep These

- `ChromeButton`
- `hero-chrome-`
- `role="tooltip"`
- `subtitlesHeading`
- `toggleOn`
- `toggleOff`

## What To Build

1. Render one-line, viewport-contained tooltips only on hover-capable pointer hover or keyboard focus.
2. Apply the shared tooltip to play/pause, mute/unmute, audio language, subtitles, and fullscreen.
3. Use explicit localized subtitle states: `Subtitles: Off`, `Subtitles: On (EN)`, `Subtitles: On`, and `Subtitles: Not available`.
4. Keep each button's accessible name and tooltip text aligned as state changes.
5. Preserve the existing outline, filled, dimmed, and visible language-code subtitle states.

## Constraints

- Reuse existing locale messages only after grammar and compact-width validation.
- Do not wrap or truncate tooltip text; a failing supported string blocks merge.
- Do not change sliders, modal ownership, preferences, catalog availability, VTT delivery, or fullscreen portals.
- Do not broaden into FGE-70, FGE-72, or FGE-75.
- Do not deploy production or send a Help Scout reply.

## Verification

- Run focused `HeroPlayerControls` and `HeroPlayer` tests, Web typecheck, changed-file lint and format, and `git diff --check`.
- Enumerate catalog-derived candidates and render the widest strings with the production font.
- Verify pointer, keyboard, and touch behavior at desktop, 320px portrait, and compact landscape sizes.
- Confirm no initial request, dependency, eager media, or modal-loading regression.
