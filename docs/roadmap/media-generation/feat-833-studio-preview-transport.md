---
id: "feat-833"
title: "Add compact playback controls beneath the preview"
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

Remove item count, FPS and Start from timeline header. Replace the preview's
single play button with a compact scrub bar and centered start, previous frame,
stop, play/pause, next frame, end and loop controls inspired by the reference.
Use existing session seeks and Remotion playback; loop is local playback state.
Keep all buttons labelled and keyboard accessible, reuse app colors.

## Verification

Browser-check scrub, stepping, start/end, stop and loop toggle using the actual
transport component. Run existing playback/session tests, scoped lint, typecheck,
format. Check loading/resource counts and ensure transport actions do not refetch
preview media.

## Outcome

`preview-transport.tsx` adds a 45px compact scrubber/button bar beneath the actual
preview stage. Actions seek through EditorSession and pause for frame/scrub/stop
operations; Stop returns to zero. Play from the final frame restarts. Loop toggles
local editor state passed to the existing Remotion Player's loop prop. Timeline
header now contains only its title and zoom control.

Actual-component browser checks: end reaches frame 299 / 00:00:09:29, previous
frame reaches 298, play toggles Pause, loop toggles pressed, Stop returns frame
zero and Play, scrub keyboard advances to frame one with matching timeline.
No added media requests during actions. Loop Player wiring checked in source;
the isolated transport fixture does not render the media player itself.

20 existing preview-state, editor-session and timeline-layout tests passed,
scoped ESLint, manager typecheck, formatting and whitespace checks passed.
Warm component load DOM/load 245/262ms versus previous fixture 443/449ms; cold
observation 749/756ms (cache variation, not a speedup claim). Same deferred six
resources: metadata, two waveforms, three thumbnails. No new initialization or
network work. Actual remote app returns normal authentication redirect (307).

Durable rule: playback controls command seeks through EditorSession; player
frame updates remain observations. Transport state must not enter preview media
identity or trigger preparation requests.
