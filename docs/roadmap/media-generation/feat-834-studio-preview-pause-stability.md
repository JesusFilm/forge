---
id: "feat-834"
title: "Prevent preview movement when pausing"
owner: "tataihono"
priority: "P2"
status: "complete"
start_date: "2026-10-20"
duration: 1
depends_on: []
blocks: []
tags: [manager, studio, playback]
---

## Scope

Reproduce pause movement against the real Preview/composition with local synthetic
HLS. Distinguish player seek commands, media synchronization and layout movement;
fix the demonstrated cause and retain pause/scrub/cut behavior.

## Verification

Run a repeatable browser pause probe reporting source time immediately before and
after pause, and seek events. Compare before/after. Run relevant existing tests,
scoped lint/typecheck/format and check startup/request counts.

## Outcome

The real Preview/HLS pause probe failed before the fix: -1.85, -2.58 and +3.03
frames of media movement with an unchanged session playhead. Remotion's tighter
paused seek tolerance corrected independent video-clock drift. No stale session
seek command or layout change was required to reproduce it.

The editor now uses a synchronous imperative pause handle for buttons, Space,
and other pause paths. It freezes video elements before React's effect delay,
maps the top active footage's source time to timeline frames using prepared
source offsets and playback rate, and aligns the player/session to that frame.
Explicit seek commands still take precedence. The helper follows composition
track paint order and excludes transparent/premounted/inactive footage.

Final actual-player probe passes three pauses: -0.41, 0, -0.98 frames, within the
current-frame bound; no multi-frame footage jump. The earlier corrected trial
also passed -0.60, +0.005, -0.74. Cut playback reached frame 389, visited cuts
90/180/270, reported zero blank/unready samples and no errors. Explicit seek
reached frame 90. The helper has rate/offset/bounds/paint-order tests; real-player
probe is necessary to cover synchronous pause timing, beyond helper arithmetic.

17 focused tests, scoped ESLint, manager typecheck, Prettier and diff checks pass.
No new network work or media identity changes. First decoded frame observed at
1663ms versus 1779ms before (warm/cold variation, no speedup claim). Changes add
one inert wrapper and a ref handle; DOM/media enumeration occurs only at pause.
No continuous sampling, effect-driven fetches or extra playback listeners added.
Durable diagnosis/repair captured in the existing Studio preview cut-buffering
solution and pause-probe instructions in the validation README.
