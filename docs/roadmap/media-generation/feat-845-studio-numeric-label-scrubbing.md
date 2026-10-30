---
id: "feat-845"
title: "Scrub numeric values by dragging their labels"
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

Show percent units beside crop inputs. Remove native numeric spinners throughout
the editor. Shared NumberField labels support horizontal pointer dragging, with
existing step/bounds and one committed edit per gesture. Crop units serve as the
visible drag labels. Preserve typing, Enter/blur commit and disabled fields.

## Entry points

- `apps/manager/src/features/video-studio/number-field.tsx`
- `apps/manager/src/features/video-studio/inspector.tsx`
- `apps/manager/src/features/video-studio/studio.css`

## Verification

Check pointer drag for integer/fractional steps, limits, cancellation, one edit,
keyboard entry, disabled fields and crop units in the actual inspector. Check
loading behavior, scoped lint/typecheck and formatting.

## Outcome

Shared NumberField labels scrub with pointer capture at one field step per 4px.
The input previews during movement; releasing commits one edit. Cancellation
restores the input and commits nothing; disabled fieldsets cannot scrub. Existing
min/max and decimal steps apply. Crop fields show draggable percent units beside
compact inputs, and explicit input names exclude decorative unit text. Native
number spinners are hidden in Chromium and Firefox with scoped editor CSS.

Three gesture tests cover fractional previews/one commit, bounds/cancellation,
and crop units/disabled fields. Actual-inspector browser checks: 40px crop-unit
drag saves 10%; 40px Scale label drag saves 1.5 from 1; typing 1.25 still commits.
The 200px sidebar has zero horizontal overflow and all four units are visible.

Loading smoke: isolated real-component DOM/load 453/458ms with one existing
metadata request and lazy media resources. Prior warm fixture was 383/385ms;
this single sample is cache-sensitive, not a benchmark. The change adds no
requests, effects or initialization observers, and pointer movement previews
without rerendering the editor or adding undo entries. Manager typecheck,
scoped lint, formatting and whitespace checks pass.

## Durable guidance

Numeric scrubbing should commit once per gesture and leave typing intact. Hide
native spinner chrome without changing numeric input semantics, and give inputs
explicit accessible names when decorative units are inside the native label.
