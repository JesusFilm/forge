---
id: "feat-872"
title: "Align Studio media navigation with the app sidebar"
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

`apps/manager/src/features/video-studio/library.tsx`: share section labels between
navigation and headings: Source library, Shared assets, Content packs, Custom
component. Use current-section semantics instead of toggle semantics.
`studio.css`: borderless sidebar rows matching the main sidebar's spacing,
muted labels, selected background and selected icon color. Accommodate full names.
Preserve keyboard focus and the existing small-screen wrapping behavior.

## Verification

Existing workspace tests, formatting/lint, browser style check. Presentation-only:
no request, hydration or media initialization changes.

## Result

One shared section definition supplies navigation labels and headings. Borderless
36px rows use main-sidebar spacing, muted text, hover/selected background and red
selected icon. The rail is 200px wide so names fit on one line; `aria-current`
identifies the current section, and visible keyboard focus remains.

Six existing workspace tests pass, plus lint/format/diff checks. Browser smoke of
actual Library component with fixture transport confirms all four rows fit at
183px by 36px with no text overflow and switching Shared assets shows its matching
heading. Temporary fixture removed. No media/request/startup paths changed.
