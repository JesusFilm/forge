---
id: "feat-886"
title: "Accept media uploads across the editor viewport"
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

Accept operating-system file drops anywhere in the loaded Studio editor, including
Preview, timeline and navigation. Display a fixed blue drop-to-upload overlay.
Open Media on drop and defer uploads through the existing Library handler, queuing
files until the lazy library is ready and existing uploads finish. Preserve
internal timeline clip dragging and read-only gating. Reuse existing accent blue.

## Verification

Workspace integration tests for window-level drops before Media opens, automatic
workspace selection, file upload and unchanged internal drops. Overlay lifecycle,
read-only and cleanup tests. Existing deferred-loading/request-count guarantees,
lint, formatting and diff checks.

## Outcome

Window capture accepts file drops across the viewport, with a dark blue solid
message panel over a translucent blue backdrop. Hover does not load the library;
drop opens Media and queues uploads, including additional drops while busy.

17 workspace/loading tests pass. ESLint and formatting checks pass. Browser QA
confirmed the overlay fills the viewport, Escape dismisses it, and hovering keeps
library chunk requests at zero with zero layout shift (QA fixture load 1.15 s).
