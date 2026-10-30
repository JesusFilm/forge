---
id: "feat-859"
title: "Preview inspector numeric drags in real time"
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

Connect NumberField label scrubbing in the inspector to a temporary preview
document. Update the player and selection frame during the gesture, coalescing
pointer movement to animation frames. Commit once on release; cancel on pointer
loss, window blur or unmount. Keep drafts out of undo, autosave and recovery.

## Verification

Actual numeric gestures with an EditorSession and inspector; cancellation,
single undo, full precision, unchanged source signature, scoped regressions,
Manager typecheck/lint/format and loading-impact review.

## Result

Inspector transforms, crop, source focus, speed, text appearance and transition
duration send validated temporary documents to the player and selection frame.
Only the last value per animation frame is rendered; release commits one edit.
Drafts never enter the save/recovery document or undo stack, and are invalidated
by selection/document replacement. Numeric display precision remains unchanged.

Gesture and preview integration checks verify live X/Y/scale/rotation/opacity,
crop, nested text controls, invalid crop, cancellation and single undo. The
loading regression check confirms one preparation request and one player mount
through a long drag, with no intermediate autosave. Existing canvas, settings,
autosave and preview-signature regressions pass; Manager typecheck, scoped lint
and formatting pass. Remote preview fonts return 200 and HMR connects.
