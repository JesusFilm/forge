---
id: "feat-837"
title: "Add full extent, detail and custom timeline zoom modes"
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

Add icon controls for full extent (fit the project), detail (roughly ten seconds
around the current position), and custom (remembered slider zoom). Slider,
plus/minus and Cmd/Ctrl-wheel choose custom. Keep full-width grid, existing scale
cap and keyboard accessibility. Zoom changes only presentation, not project data.

## Verification

Test preset calculations, bounds and wheel behavior. Browser-check mode buttons,
fit without overflow, detail centering, custom slider and resource counts.
Scoped lint, typecheck, formatting and timeline tests.

## Outcome

Three icon buttons select full extent, detail and custom. Full extent is the
default and recalculates on viewport/project changes. Detail targets ten seconds
around the current position within the existing 20,000px canvas cap. Custom
remembers its value; slider, plus/minus and modifier-wheel select it automatically.
The logarithmic slider spans quarter-fit through the cap, avoiding jumps when
leaving presets on long edits. Its accessible value reports percent of full
extent. Re-clicking detail/custom recenters without changing the zoom.

Actual-component browser: 100-second project fits a 1109px area with total
scrollWidth/clientWidth both 1263px. Detail expands area to 11090px and brings
the current end position into view (scrollLeft 9981). Slider Home chooses custom
at quarter-fit; grid still fills the viewport, time ruler continues across it.
Switching fit/custom restores the exact prior slider value. One metadata and
two waveform requests total; initial fit needs only one thumbnail. Mode/slider
changes do not refetch metadata or waveforms. Lazy additional thumbnails remain
allowed when zoom exposes larger clips.

18 zoom/scale/wheel/layout tests, scoped lint, manager typecheck, format and diff
checks passed. Component DOM/load measured 551/556ms (previous cold fixture
640/648ms, cache variation rather than a speedup claim). No new initialization
or network work; calculations are synchronous presentation state only.

The old remote preview had stopped. Restarted the real Manager dev app and
replacement Cloudflare tunnel, preserving approved preview-client authentication.
Current remote preview: https://sunny-italic-items-textiles.trycloudflare.com.

Durable rule: derive fit/detail from measured viewport and project duration;
keep remembered custom zoom separate. Grid extent still fills unused width, and
only an explicit zoom action recenters the view (playback ticks must not).
