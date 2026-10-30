---
id: "feat-832"
title: "Remove timeline timing edits from the inspector"
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

Remove the inspector Timing section (track, start, duration, source in/out), audio
source offset, linked timing target/lock, and project duration input. Timeline
continues to own placement/trimming. Preserve effect controls including playback
speed, transitions, text animation, transform, crop and volume.

## Verification

Verify actual Inspector with text/video/audio/project selections: placement and
trim fields absent, effects retained. Scoped lint/typecheck/format. No added
imports, initialization or requests; observe component loading resource counts.

## Outcome

Removed the entire placement/trim section, audio source offset, linked timing
controls and project duration input from `inspector.tsx`, plus the unused track
helper import. Browser verified text, video and audio selections retain their
effects without start/duration/source offset/link controls. Project duration
input removal verified in source. Timeline handlers and document contracts are
unchanged. Manager typecheck, scoped ESLint, Prettier and diff checks passed.

Loading smoke: DOM/load 443/449ms; same six deferred resources (one metadata,
two waveforms, three images) as before, no new requests on selection. This
removes rendered fields and handlers and adds no initialization or dependencies.

Durable rule: timeline placement and trimming belong in the timeline; the
inspector contains appearance, sound and effect controls.
