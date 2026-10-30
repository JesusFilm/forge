---
id: "feat-829"
title: "Use larger filmstrips and a focused timeline timecode"
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

Apply the user's DaVinci Resolve screenshot direction to the existing timeline:
large footage thumbnails above a blue clip-name footer, green audio clips with
real waveforms above their names, and a prominent HH:MM:SS:FF timecode in the
upper-left ruler corner. Clicking the timecode switches position/remaining.
Replace the toolbar's decimal seconds/frame counter. Preserve Visual/Audio
groups and their linked clip behavior; mixed text/video stacks still work.

## Constraints

The user explicitly approved blue/green clip styling. Use existing app tokens
where possible. Per-row height must have one shared helper so group labels align
with mixed media lanes. No new media loads from layout/timecode changes. Keep
ruler/handles clipped to the declared canvas and scrolling only for real zoom.

## Verification

Test timecode rollover and remaining frames, mixed row heights and group alignment.
Browser-check taller thumbnail/name hierarchy, audio waveform/footer, timecode
toggle, seek, resize, zoom and no unintended horizontal overflow. Scoped lint,
typecheck, format and related timeline/editor tests. Compare resource counts
before/after timecode, selection and zoom interactions.

## Outcome

Footage lanes are 104px high, with a 94px clip containing a 70px thumbnail strip
and 22px blue name footer. Samples target 128px widths (three 116px frames fill
a 348px clip). Audio lanes are 72px with green clips, 32px real waveforms and
name footers. Text-only lanes remain 48px. Group label heights sum the same
shared helper; mixed visual tracks remain supported.

The 154px left ruler corner shows frame-accurate timecode. Clicking it switches
playhead/remaining modes; the old decimal/frame toolbar counter is removed.
Browser checks: final-frame remaining reads −00:00:00:01, start reads
00:00:00:00, label group heights align with rows, and scrollWidth/clientWidth
both equal 1263px without zoom overflow. Source and audio remain linked.
Timecode/mute/seek changes caused no media requests. After the larger sample
spacing change only three images load for a 350px clip, down from six.
Combined 28-test suite, scoped lint, typecheck and formatting checks passed.
Preview font HTTP 200 and HMR WebSocket verified open after restart.

Durable rule: lane geometry belongs in one shared presentation helper, used by
both clip/track heights and group label totals. The zoom scale remains independent
of row heights, artwork dimensions and the timecode display.
