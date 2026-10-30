---
id: "feat-825"
title: "Show linked footage audio in the Studio timeline"
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

Project each video clip into a linked source-audio block in the Audio group via
`apps/manager/src/features/video-studio/timeline-layout.ts`. The block refers to
the same stored item: selection, move, trim, volume and deletion affect the
linked source clip. `timeline.tsx` must mark projections clearly, mirror drag
feedback and prevent source-audio gestures or drop targets from moving clips to
incompatible tracks. Explain linkage by source volume in `inspector.tsx`.

## Constraints

No duplicated stored items, schema migration, additional media requests or new
playback path. Existing video audio plays exactly once. Keep independent music/
narration tracks separate. Muted footage retains its visible linked block.
There is no source audio-presence metadata in the current source contract, so
this projects source audio controls without claiming an inspected waveform.

## Verification

Unit tests: linked identity, timing, overlap lanes, muted video, non-mutation and
standalone track targets. Browser-check selecting, moving/trimming either linked
representation, volume/mute and standalone audio isolation in disposable data.
Scoped lint, typecheck, format and existing editor/layout tests. Inspect loading
cost and ensure no source audio initialization is added.

## Outcome

Implemented linked source-audio presentation using the original video item.
Browser verification confirmed shared selection, horizontal movement, source
in-point trimming, mirrored keyboard movement and volume-zero muted labels;
independent music retained its original timing and volume throughout. The
video and linked block retained identical positions and widths after edits.
All 20 layout/session/preview tests, scoped ESLint and Manager typecheck passed.
Loading review: no new imports of media/player code, dependencies, media requests
or playback initialization; only memoized row projection and timeline DOM.
