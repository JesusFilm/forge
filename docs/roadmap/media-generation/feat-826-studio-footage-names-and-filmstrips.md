---
id: "feat-826"
title: "Show footage names and Mux timeline filmstrips"
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

Show catalog footage titles and multiple time-sampled Mux frames across video
clips in `apps/manager/src/features/video-studio/timeline.tsx`. Include the
footage name on linked audio. Add a Manager-only authenticated metadata route
using existing Studio source authorization and Admin read models. No persisted
schema or composition changes.

## Constraints

Keep lookup independent from player startup. Bound image count, use lazy images,
reuse identical source/range lookups, and avoid requests on playhead ticks or
horizontal moves. Signed source playback requires separately signed thumbnails.
Fallback to source identity if catalog/artwork is unavailable. Preserve trims,
selection and linked audio interactions.

## Verification

Test source identity, sampled times/rate/trim, signed image URLs and failure paths.
Run scoped tests, lint, typecheck and format. Browser-check names, image loading,
full-width fill at different zoom levels and editing interactions; record resource
counts/timing to verify bounded loading outside the player critical path.

## Outcome

Catalog titles appear on video and linked audio blocks, with the full title in
video tooltips. Video blocks show up to 16 lazy Mux WebP samples from the trimmed
source range, distributed across their full width. These direct samples avoid
whole-film storyboard cadence collapsing a short excerpt to the same frame.
Signed playback gets separate thumbnail tokens with time/width claims.
No Admin schema or persisted document changes were required.

Validation: 17 focused tests passed, with scoped lint/typecheck/format checks.
Real project lookup returned five footage ranges titled “LUMO - Luke 18:9-43”
in 670 ms; the first image from each returned HTTP 200 (3.5–5.2 KB).
Browser interaction checks used the actual Timeline with a disposable session
and real Mux images: six loaded frames filled 348 px; two filled 103 px at
minimum zoom; sixteen filled 1398 px at maximum zoom. A keyboard move preserved
identical video/linked-audio positions. Across zoom changes and movement there
was one metadata request and at most sixteen image resources.

Loading trace in that component check: page load completed at 563 ms; metadata
started at 764 ms; the first images started at 832 ms. The metadata/image work
is gated after load and never blocks player preparation. The real preview
continues to use the existing separate playback path.

Durable rule: footage artwork lookup keys include source identity and trim range,
not timeline position/playhead/zoom. Reuse bounded sample URLs when zooming;
never attach the video playback JWT to thumbnail requests. Mux image parameters
must be included in thumbnail token claims for signed sources.
