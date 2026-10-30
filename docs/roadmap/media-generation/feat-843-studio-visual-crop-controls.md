---
id: "feat-843"
title: "Arrange crop values around a visual frame"
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

Replace four crop rows with numeric percentage fields positioned around a central
frame: top above, bottom below, left and right beside it. Visualize the retained
area while preserving numeric validation, blur/Enter commit and accessible labels.

## Entry points

- `apps/manager/src/features/video-studio/inspector.tsx`: Crop section.
- `apps/manager/src/features/video-studio/number-field.tsx`: optional hidden label.
- `apps/manager/src/features/video-studio/studio.css`: scoped crop grid styles.

## Verification

Check input positions and edits in the actual inspector, minimum panel width,
unchanged validation and loading requests. Scoped lint, typecheck and formatting.

## Outcome

Four percentage inputs now surround a central crop frame. Its inset rectangle
reflects the saved retained area. Existing NumberField uses an optional hidden
label while keeping native accessible names; other number fields are unchanged.

Browser actual-component verification: top 20% and bottom 10% save crop fractions
0.2/0.1 and produce diagram inset `20% 0% 10%`. Attempting bottom 85% with top
20% is rejected by the existing visible-area validation. Grid height is 114px
and fits the 200px inspector with zero horizontal overflow. Loading smoke in the
isolated harness: DOM/load 383/385ms, one metadata request and existing lazy
thumbnail/waveform behavior; no added requests, effects or dependencies. This
is not an end-to-end performance improvement claim.

Manager typecheck, scoped ESLint, formatting and whitespace checks pass.
