---
id: "feat-861"
title: "Centre the timeline timecode and remove its remaining-time toggle"
owner: "tataihono"
priority: "P1"
status: "complete"
start_date: "2026-10-21"
duration: 1
depends_on: []
blocks: []
tags: [manager, studio, ui]
---

## Scope

Remove the clickable remaining-time mode from `timeline.tsx`. Always display the
current playhead timecode, centred vertically and horizontally in its existing
corner cell. Remove obsolete button hover/cursor and remaining-label styles.

## Verification

Existing timecode formatting tests, Manager typecheck, scoped lint/format/diff.
Static markup/CSS only; no new loading or rendering initialization work.

## Result

The timecode is a passive output of the current playhead position, centred in
both axes. Remaining-time state, click handler, pressed state, tooltip and hover
styles are removed. Existing timecode tests, Manager typecheck, scoped ESLint,
Prettier and diff checks pass. No dependencies, effects, requests or layout reads
were added; one local state hook was removed.
