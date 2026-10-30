---
id: "feat-850"
title: "Show dB level beside the volume drag pointer"
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

`audio-clip-controls.tsx` and `studio.css`: show a small dark pointer-adjacent
popover containing only the current dB level while dragging clip volume. Hide on
release/cancel/lost capture; do not show for fade gestures. Use a body portal so
clip overflow cannot crop it and generic editor output styles cannot override it.
Keep inside viewport, ignore pointer events, and reuse the existing fixed palette.

## Verification

Existing gesture tests plus drag readout/cleanup checks; browser styling/placement
check in both themes. No new media request or initial render/hydration work.

## Result

Added a pointer-adjacent body portal with only `audioDbLabel` text. Fixed existing
palette black/white colors stay readable in both themes. The pointer cannot hit
the popover; its position is bounded inside the viewport. Only volume gestures
mount it, with release/cancel/lost capture clearing it.

- Existing six gesture tests verify +30 dB, silence, release and cancellation
  cleanup. Manager typecheck and scoped ESLint/format/diff checks pass.
- Browser drag evidence: `-23.4 dB` in light mode, `+14.6 dB` in dark mode;
  background `rgb(8,8,8)`, white text, body parent, pointer-events none, within
  viewport. No popover remains after release.
- Metadata/image/waveform resource entries remain unchanged across drags. Portal
  mounts only after interaction, adding no initial markup or media loading work.
