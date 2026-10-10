---
module: Studio editor
problem_type: ui_bug
tags: [studio, remotion, canvas, timeline, speed]
date: 2026-10-08
---

# Studio selection and source-time accounting

The old editor rendered one full-frame selection button per visual item. Its last
button intercepted clicks on every lower layer. Its temporary CSS translation moved
the button rather than the rendered content, so the intended text did not move live.
The synthetic baseline fixture reproduces both symptoms.

`CanvasSelection` hit-tests text ranges and visual leaf elements inside the shared
composition's `data-studio-item` wrappers. A selected item's content wins over an
overlapping layer; otherwise the visible content follows persisted compositing order.
Dragging applies a temporary transform to the rendered layer in composition coordinates,
then commits once at pointer-up. Cancellation restores the original transform. Arbitrary
custom graphics without text/media leaves use the layer fallback; this is not per-pixel
alpha hit testing. Explicit timeline selection remains available for overlapping content.

A video's source range is source time; its item duration is timeline time. Duration is
`(endMs - startMs) * fps / (1000 * playbackRate)`, rounded to a frame. Legacy rates default
to one. Source trims and crossfade pre-roll must multiply timeline time by the rate.
Both Player HLS and exported OffthreadVideo receive the same rate. Export checks compare
actual video frames and video-stream duration; AAC container padding can exceed them.

Component names and Text/Video classification are optional portable metadata. Legacy
text controls and caption/credit/title names provide presentation fallbacks; explicit
category overrides them. Grouping never changes persisted track order. Strip presentation
metadata from the preview preparation signature so renaming/regrouping does not refetch
media or remount the Player.

Verification and commands: `docs/validation/studio-editor-feedback/README.md`.
