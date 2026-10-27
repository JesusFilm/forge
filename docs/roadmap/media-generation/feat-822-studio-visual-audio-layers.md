---
id: "feat-822"
title: "Use a shared visual stack and separate audio group in Studio"
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

Change `apps/manager/src/features/video-studio/timeline-layout.ts` from
Video/Audio/Text groups to Visual/Audio. Text, video, images and components share
visual tracks, including legacy caption tracks. Reflect the compositor's stored
track/item painter order in visual row order (foreground first), without rewriting
existing documents. Preserve overlap lanes and audio isolation. Update timeline,
library insertion and inspector track targets together. Component category remains
metadata rather than a timeline section.

## Verification

Regression tests cover mixed visual content, legacy caption tracks, empty targets,
foreground row order, overlapping layers, non-mutation and audio separation.
Browser-check the actual timeline and inspector using disposable session data.
Scoped lint, format, TypeScript and editor tests. No preview/render implementation
changes; verify grouping cost and request behavior.

## Result and verification evidence

Visual and Audio replace the three media-type groups. All non-audio items share
visual track targets, including empty legacy caption tracks. Visual rows follow
reverse track/item painter order; overlapping lower items remain below every
intersecting foreground item. Stored document ordering is unchanged on load.
New visual inserts use the foreground visual track, and component type metadata
no longer determines timeline grouping.

Regression tests failed against the previous grouping, then passed after the
change. All 15 tests in timeline-layout, item-presentation and editor-session
pass. Scoped ESLint, TypeScript, Prettier and whitespace checks pass.

Browser verification used the actual Timeline and Inspector components with a
disposable EditorSession. It confirmed exactly Visual/Audio headers, text drag
from a legacy caption track to a visual track below an image, inspector selection
back to the foreground track, and rejection of a text drag into an audio row.
No live project writes were made by the verification harness. The real preview
server rebuilt the changed editor successfully.

Performance: group items by track once per layout rather than repeatedly scanning
the whole document for every track/group. A local benchmark of 500 items across
20 tracks (100 measured layouts after warmup) measured median 0.255ms versus
1.206ms before; isolated minified layout bundle including its helpers was 833
bytes gzip versus 841 before. This is a synthetic grouping-cost check, not an
end-to-end page-load timing. No dependencies, requests, media initialization,
rendering or hydration effects were added.

## Durable layout rule

Visual type describes editing controls, not stacking eligibility. Keep all
visible content in the same compositing stack, derive presentation order from
the renderer's existing painter order, and preserve authored document ordering
until an explicit operator edit moves an item. Index items by track once when
building rows; repeated document scans make legacy mixed tracks unnecessarily
expensive.
