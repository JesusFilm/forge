---
id: "feat-839"
title: "Remove redundant timeline timecode border"
owner: "tataihono"
priority: "P2"
status: "complete"
start_date: "2026-10-20"
duration: 1
depends_on: []
blocks: []
tags: [manager, studio, ui]
---

## Scope

Remove the rounded button border inside the timeline timestamp cell. Keep the
cell divider, keyboard focus indication and current/remaining time toggle.

## Entry points

- `apps/manager/src/features/video-studio/studio.css`: `.nle-timecode`.

## Verification

Inspect computed border/radius and toggle behavior in the actual Timeline
component. Check formatting and whitespace. CSS-only change adds no rendering,
hydration, initialization or network work.

## Outcome

The generic `.nle-editor button` selector outranked the timestamp reset. Scope
its selector to `.nle-editor .nle-timecode` and explicitly remove rounding.
Browser computed styles confirm border 0px, radius 0px and shadow none in both
time modes; clicking still toggles to the remaining time. The existing keyboard
focus outline is preserved. Formatting and whitespace checks pass. No JavaScript,
requests or loading paths changed.
