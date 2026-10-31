---
id: "feat-851"
title: "Hide audio control focus outlines during pointer drags"
owner: "tataihono"
priority: "P1"
status: "complete"
start_date: "2026-10-20"
duration: 1
depends_on: []
blocks: []
tags: [manager, studio, audio]
---

## Scope

`apps/manager/src/features/video-studio/studio.css`: suppress slider focus outlines
while the audio controls have `data-dragging`. The volume line never paints a focus outline, including after release; fade
handles retain keyboard focus outlines outside pointer gestures. No media, hydration or initialization changes.

## Verification

Browser computed outline during a volume drag and keyboard focus outside the
gesture; scoped formatting and diff checks.

## Result

Browser verification of the actual control recorded `outline: none` during a
volume drag with the dB readout intact. Keyboard ArrowUp focus outside the gesture
retains a solid outline. CSS-only state override adds no script, media requests,
initialization or layout work. Formatting and diff checks pass.

## Follow-up correction

The drag-only override restored the volume outline on release because the
control remains focused. Suppress the volume focus outline unconditionally via
`.nle-audio-controls .nle-audio-volume:focus`; this also wins against the existing
slider `:focus-visible` rule. Keyboard volume adjustment remains available.
Formatting and diff checks pass; the correction changes only outline paint.
