---
id: "feat-827"
title: "Contain timeline decorations within the scroll canvas"
owner: "tataihono"
priority: "P2"
status: "complete"
start_date: "2026-10-20"
duration: 1
depends_on: []
blocks: []
tags: [manager, studio, ui]
---

## Problem and reproduction

At a 1080px viewport, actual Timeline component: scroll viewport 1078px,
track canvas 968px, but scrollWidth 1097px. The last absolute ruler label
extends 19px beyond the intended canvas. No zoom overflow is required.
Candidate causes: ruler text protrusion, intrinsic thumbnail width, intentional
zoom width. DOM measurement isolates protrusion: ruler scrollWidth 987px vs
clientWidth 968px, while the declared canvas fits exactly.

## Change

Contain decorations in `.nle-track-area` in
`apps/manager/src/features/video-studio/studio.css` with `overflow: clip`.
The explicit canvas width continues to govern scrolling; don't hide scrolling
on `.nle-timeline-scroll` or change time scale. This also contains the playhead's
handle when seeking to the end of a zoomed canvas.

## Verification

Browser-check actual Timeline at the reproducing viewport: scrollWidth must
match clientWidth without zoom overflow, even after images load. Maximum zoom
must still create intentional scroll width. Check start/end seeking, narrow and
wide viewports. CSS-only change: no new scripts/requests/rendering work.

## Outcome

Browser reproduction passed after the one-rule CSS fix: at 1080px, scrollWidth
now equals clientWidth (1078px), down from 1097px. With loaded Mux filmstrips,
maximum zoom still produces a 2800px canvas and the expected 2910px scroll area
including track labels. End seeking stays within that canvas. At the default
1280px viewport and minimum zoom, clientWidth and scrollWidth both equal 1278px.
Formatting and whitespace checks pass. No runtime/network changes or new tests
for this CSS-only correction; the browser width assertion exercises actual
layout, which unit scale tests cannot cover.

Durable rule: clip absolute ruler labels and playhead handles inside the declared
track canvas. Their visual extents must not enlarge the scroll container beyond
the intentional zoom width.
