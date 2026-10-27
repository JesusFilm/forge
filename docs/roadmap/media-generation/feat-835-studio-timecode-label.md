---
id: "feat-835"
title: "Remove the visible playhead label"
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

Remove the visible Playhead caption above the timeline timecode. Retain the
Remaining mode label and accessible button/output names and toggle behavior.

## Verification

Check the focused diff and formatting. This removes a text node only; no added
rendering work, media requests, initialization or dependencies.

## Outcome

Removed the visible caption in position mode; timecode and click-to-toggle remain.
Accessible labels are preserved. Formatting and whitespace checks passed.
