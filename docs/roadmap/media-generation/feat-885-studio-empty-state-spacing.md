---
id: "feat-885"
title: "Refine media empty-state spacing"
owner: "tataihono"
priority: "P2"
status: "complete"
start_date: "2026-10-21"
duration: 1
depends_on: []
blocks: []
tags: [manager, studio, ui]
---

## Scope

In `apps/manager/src/features/video-studio/studio.css`, tighten the drop-zone
title/subtitle gap and increase spacing before the Upload button. Preserve icon
spacing and all upload behavior.

## Verification

Format and diff checks, inspect scoped spacing rules. CSS spacing only: no DOM,
initialization, requests or media loading changes; no new behavioral tests needed.

## Result

The title/subtitle gap is 4px, with 24px before Upload. Icon spacing remains 12px.
Rules are scoped to media drop-zone empty states. Formatting and diff checks pass;
loading and upload behavior are unchanged.
