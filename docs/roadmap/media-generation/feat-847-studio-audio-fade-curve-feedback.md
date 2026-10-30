---
id: "feat-847"
title: "Audio fade shading and two-axis curve controls"
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

Refine `audio-clip-controls.tsx`: darken the removed area above each fade across
its full height, independent of the clip volume line. Support horizontal and
vertical dragging of fade curve dots. Remove instructional native tooltips and
the center output box. Keep audio gain multiplied by fades in preview/export.

## Implementation

- Optional bounded `fadeInCurvePosition` / `fadeOutCurvePosition` in the neutral
  contract default to the previous midpoint and preserve existing curve shapes.
- `audioFadeProgress` smoothly remaps time around the dragged dot, shared by
  timeline presentation and runtime gain.
- Independent straight volume hit/visible line and full-height fade SVG.
- Keep local pointer drafts, cancellation, keyboard support and single undo step.

## Verification

Two-axis gestures including reversed fade-out time, legacy envelope compatibility,
monotonic endpoints, persistence, independent shading/volume presentation, scoped
lint/typecheck/tests and browser/loading checks.

## Result

Full-height fade shading now darkens removed audio at 50% black opacity; a
separate straight gain line remains draggable. Fade dots move horizontally and
vertically, with the time-position parameter persisted and used by the shared
preview/render helper. Removed the centered output and audio control/parent clip
titles; slider labels and values remain accessible.

- Contracts: 56 tests; compositions: 74 tests; Manager: 22 gesture/session/preview
  tests. Nondefault positions are included in runtime wiring and save/reopen tests.
- Admin consumer regression checks: 5 tests using the temporary external runner
  config described in feat-846 (partial workspace installation).
- Manager/contracts/compositions typechecks, scoped lint, format and diff checks.
- Actual timeline browser checks: both curve dots update both axes, source timing
  and other music stay unchanged, tooltips/output absent, shading independent of
  +30 dB gain. Resource entries remain unchanged through envelope/volume edits
  (1 metadata, 5 filmstrip images after zoom, 2 waveform requests); no new media
  dependencies or initialization work introduced.

Matching Admin/renderer contracts still require the normal deployment flow;
production services were not deployed by this task.
