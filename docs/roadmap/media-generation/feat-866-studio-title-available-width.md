---
id: "feat-866"
title: "Let the Studio title use available header width"
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

Remove fixed desktop/compact title width caps from `studio.css`. Let the title
flex into the remaining project row width while preserving the action controls.
Use ellipsis only for actual overflow. CSS-only; no loading/runtime changes.

## Verification

Review flex sizing, format and diff checks. No application behavior changes.

## Result

Removed the 360px/40vw desktop cap and 200px compact cap. The title now grows
into the remaining row width (`flex: 1; min-width: 0`), while project actions
retain their width. Existing overflow ellipsis applies only when needed.
Format and diff checks pass. This changes CSS sizing only and adds no network,
hydration, media or client initialization work.
