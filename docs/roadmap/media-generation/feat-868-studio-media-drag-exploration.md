---
id: "feat-868"
title: "Explore media dragging into the timeline"
owner: "tataihono"
priority: "P1"
status: "complete"
start_date: "2026-10-21"
duration: 1
depends_on: []
blocks: []
tags: [manager, studio, ui, design]
---

## Scope

Refine the feat-867 inline Media workspace study. Remove asset counts. Dragging
an asset should show its eventual timeline representation and insert at the
previewed location, including linked source audio for footage. Preserve local
undo/redo and keyboard Add. No production editor changes or project writes.

## Verification

Browser smoke: footage and audio drops, outside cancellation, undo/redo, and
responsive overflow. Check local-only initialization without new network calls.

## Result

Updated the durable `studio-media-workspace.html` inline study. Removed browser
asset counts and timeline clip counts. Asset dragging uses the same filmstrip,
name and blue/green clip rendering as committed insertion. Footage previews and
inserts linked video/audio at matching times; music inserts audio only. Placement
snaps to half seconds and skips occupied ranges. Long sources expand the visible
time range. Outside drops cancel and restore the prior range; Add and undo/redo
remain available. State remains local to each layout.

Chrome pointer drags verified footage pairs, audio-only insertion, cancellation,
and undo/redo. Desktop and 360px viewport checks found no horizontal overflow;
no warning/error logs. JavaScript syntax check passed. The fragment introduces
no fetch, XHR, WebSocket or media requests. Production loading is unchanged.
Removed the temporary hosted verification copy after checking.

Durable learning: reuse clip markup for the floating drag, timeline placement
preview and committed insertion so their linked tracks and dimensions agree.
