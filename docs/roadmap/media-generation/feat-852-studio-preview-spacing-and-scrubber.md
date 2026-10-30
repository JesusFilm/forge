---
id: "feat-852"
title: "Remove preview top space and style transport scrubber"
owner: "tataihono"
priority: "P1"
status: "complete"
start_date: "2026-10-20"
duration: 1
depends_on: []
blocks: []
tags: [manager, studio, ui]
---

## Scope

Move Add content from the standalone preview toolbar into the editor header in
`apps/manager/src/features/video-studio/editor.tsx`. Top-align the fitted preview
without changing its aspect ratio. Style the existing native preview position
range as a thin track with a small red marker in `studio.css`, using existing
palette colors and WebKit/Firefox thumb rules. Preserve timeline seek and keyboard
range behavior. No new media requests, initialization or dependencies.

## Verification

Manager typecheck, scoped formatting and diff checks; browser component smoke.

## Result

Removed the standalone toolbar row; Add content retains its existing action in
the header. Preview fit retains its aspect ratio and now starts at the top of
the available canvas area. The native range has explicit thin-track and red
marker styles for WebKit and Firefox. Browser smoke confirms ArrowRight seeks
both preview position and timeline playhead to frame 1. Manager typecheck and
scoped formatting/diff checks pass. The change moves existing markup and changes
CSS paint/alignment only, adding no loading, media, initialization or hydration
work. Authenticated full-editor visual verification remains with the remote
preview session; component smoke uses the actual transport with a local fixture.

## Full-width scrubber refinement

Removed transport horizontal padding so the position range spans the preview
pane edge to edge. The red marker now matches the 3px track height in both
WebKit and Firefox rather than protruding beyond it. The 16px input hit area
remains for pointer interaction. Formatting and diff checks pass. CSS sizing
only: no additional requests, client initialization or hydration work.

## Corrected track height

User clarified that the track should grow to match the original red marker,
rather than shrinking the marker to the track. Both track and marker are now
12px high in WebKit and Firefox, retaining the edge-to-edge width and 16px hit
area. CSS-only sizing; format and diff checks pass with no loading impact.

## Preview shadow removal

Removed the `.nle-canvas` box shadow so the preview has no surrounding glow.
CSS paint only, with no loading or layout cost. Format and diff checks pass.

## Restore marker silhouette

Restored the screenshot-inspired red top tab tapering into a narrow stem via
matching WebKit/Firefox thumb clip paths. Track and marker remain 12px tall,
with full-width transport and no preview glow. Formatting and diff checks pass;
this paint-only correction adds no loading or initialization work.
