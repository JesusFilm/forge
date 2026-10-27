---
id: "feat-878"
title: "Upload media through the browser drop area"
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

Replace inline image/audio file fields in the Studio media browser with a single
Upload button beside search, and a file drop target across the content area.
Support multiple image, audio and video files through the existing authenticated
upload route and its 16 MiB limit. Uploads belong in the library; timeline
placement remains a separate drag. Preserve internal clip dragging. Show active
drop feedback, upload status and actionable errors. Upload on user intent only.

## Verification

Workspace/loading integration tests cover native file drops, manual selection,
video categorization, library-only insertion, validation and existing timeline
drag behavior. Check request counts, lint, formatting and diff cleanliness.

## Result

The media content area accepts file drops, with an overlay while files hover.
Upload beside search opens a hidden multiple-file chooser for image, video and
audio. Both paths validate types and the existing 16 MiB limit before sequential
uploads. Successful assets remain visible through refreshes and are categorized
automatically. Uploading creates no timeline edits. Internal clip drags remain
separate from external file drops. Busy/read-only gating prevents duplicate
uploads; failed uploads show filenames and leave the control usable.

All thirteen workspace/loading tests pass, including mixed video/audio drops,
manual selection, validation without a request, failures and unchanged timeline
history. Lint, formatting and diff checks pass. Browser component smoke confirms
search/Upload alignment, no inline fields and correct image empty state. The
library chunk starts after Media intent (9089.9 ms versus page load 1129.1 ms),
with CLS 0. No uploads occur without file selection/drop. Public QA fixture removed.
