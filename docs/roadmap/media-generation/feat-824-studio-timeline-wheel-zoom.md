---
id: "feat-824"
title: "Zoom the Studio timeline with Cmd or Ctrl plus scroll"
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

Attach a native non-passive wheel listener to the Timeline root in
`apps/manager/src/features/video-studio/timeline.tsx`. Cmd/Ctrl scrolling adjusts
the existing zoom state within 0.3–4; regular scrolling passes through. Normalize
pixel/line/page deltas and bound individual wheel steps for mouse/trackpad input.
Prevent browser page zoom only for handled modified wheel gestures over Timeline.
Remove the listener on unmount and expose a shortcut hint by the zoom slider.

## Verification

Test modified/unmodified events, directions, delta normalization, clamping and
listener removal. Browser smoke using the actual Timeline component and synthetic
wheel gestures in a disposable harness; confirm slider/clip/ruler updates. Scoped
lint/typecheck/format and existing timeline scale tests. No additional dependencies,
network requests or player initialization.

## Verification evidence

All seven wheel/scale tests pass, alongside scoped ESLint, TypeScript, Prettier
and whitespace checks. Tests confirm Cmd and Ctrl, both scroll directions, regular
scroll pass-through, line/page normalization, large-delta caps, zoom bounds and
listener cleanup.

Browser smoke with the actual Timeline and synthetic cancelable wheel events in
a disposable harness confirmed Ctrl/up moved zoom 1 → 1.2214 and block width
350px → 427.48px. Cmd/down returned zoom to 1 and block width to 350px. Normal
wheel input left zoom unchanged and was not prevented. This verifies event binding,
cancellation and UI synchronization; it does not claim an OS-level mouse gesture
was generated. No test writes reached live data. Real Manager rebuilt successfully.

Performance: one native listener initializes on the Timeline root, with no
additional document listeners, dependencies, requests or player initialization.
Unmodified wheel events return without state changes. Functional zoom updates
avoid reinstalling the listener during playback or wheel events.

## Durable interaction rule

Use an explicitly non-passive native listener when a modified wheel gesture must
prevent browser zoom. Scope it to the editing surface, leave ordinary scrolling
alone, normalize wheel units, and share the existing zoom state with the slider.
