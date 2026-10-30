---
id: "feat-865"
title: "Simplify Studio title and move history and manual save"
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

In `editor-header.tsx`, make the project title plain text, expose Version history
as an icon beside the settings cog and put Save now in the Render and publish
split-button dropdown. Keep passive save status and visible failure recovery.
Preserve the existing callbacks, disabled states and data-free loading shell.

## Verification

Manager typecheck, scoped lint/format and loading/session/autosave tests. Verify
menu structure and action wiring. No new effects, dependencies or requests.

## Result

The title is now a plain heading. History is an icon immediately before the
settings cog. Render and publish remains the primary action, with an attached
chevron dropdown containing manual save. Save status is passive; failed saves
retain the direct Retry save action. Existing menu blur/Escape/action dismissal
and loading-state gating are preserved.

Manager typecheck, scoped ESLint, format/diff checks and all 17 existing
loading/session/autosave tests pass. No effects, dependencies, network calls,
media paths or initialization work were added. Font and hot-reload checks on
the existing remote preview pass.
