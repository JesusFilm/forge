---
id: "feat-853"
title: "Separate project settings from the item inspector"
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

`apps/manager/src/features/video-studio/inspector.tsx`: show only Nothing to
inspect with no selection. Remove project details and cards list. Header Project
settings action opens a native modal with title, width and height. Stage edits
until Apply; Cancel/Escape leaves the document unchanged. Use EditorSession.edit
for existing validation/history/autosave and preserve read-only state. Lazy-load
the dialog to avoid adding initial editor work or media requests.

## Verification

Settings apply/cancel/read-only interaction checks, empty inspector regression,
Manager typecheck, scoped lint/format checks and loading impact assessment.

## Result

No-selection inspector shows only Nothing to inspect. Header gear opens a
lazy-loaded native modal with title and dimensions; Apply uses one validated
EditorSession edit, with undo/autosave preserved. Cancel/Escape discards staged
values, native focus trapping restores focus to the opener, and read-only
projects cannot apply. Four interaction tests pass, including empty inspector.
Browser component smoke verified a native modal, width/height/title fields,
560px dialog within the viewport, and empty inspector after Cancel. Manager
typecheck, scoped ESLint, formatting and diff checks pass.

Loading assessment: settings code is dynamically imported only when opened; no
new initial request or mount effect is introduced. Removing the unselected
inspector item-list mapping reduces idle DOM/render work. No media lifecycle,
preview signature or API behavior changes.
