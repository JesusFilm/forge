---
id: "feat-879"
title: "Show retained video thumbnails and descriptive names"
owner: "tataihono"
priority: "P1"
status: "complete"
start_date: "2026-10-21"
duration: 1
depends_on: []
blocks: []
tags: [manager, studio, ui]
---

## Scope

Diagnose Videos card presentation in `apps/manager/src/features/video-studio`.
Provide authenticated, bounded still thumbnails for retained video bytes through
`services/studio-library-image.ts`, preserving lazy loading and concurrency.
Display a recorded title when present, otherwise the retained filename. Never
replace actual media identity with inferred catalog source identifiers.

## Verification

Reproduce the absent video thumbnail in the workspace integration test before
fixing. Check thumbnail generation with a real local video and configured FFmpeg;
cover authorization, byte limits, image behavior and video title fallback. Retain
initial-load and request-count evidence.

## Result

The workspace reproduction failed because video cards rendered only Film, never
LibraryImage. The existing preview service also rejected video MIME types. Card
names read only filename, ignoring any recorded title; retained files are not
catalog rows and cannot inherently supply JFP titles.

Video cards now request lazy still thumbnails through the authenticated endpoint.
The broker verifies at most 16 MiB of retained bytes; local FFmpeg downscales before
sampling 30 frames, with one thread, a 12-second timeout and 512 KiB output bound.
At most 32 stills are cached by digest; every cache hit still authorizes metadata.
The existing two-transfer concurrency and visibility gates remain. Naming prefers
a recorded title, then filename, then Untitled media; full names are available on
hover. Video files still cannot be inserted as image timeline items.

All seventeen focused service/workspace/lifecycle/loading tests pass. The
regression now asserts a video thumbnail is mounted; a source.mp4 fixture with a
recorded title displays that title. Service tests cover verified video input,
cache reuse and denial before cached output. Existing lazy-load tests prove zero
initial library requests and no thumbnail transfers before visibility. A real
one-second video through the configured local decoder produced a valid 320×180,
5445-byte JPEG in 36 ms, visually inspected. Lint, format and diff checks pass.
