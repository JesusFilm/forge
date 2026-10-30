---
id: "feat-881"
title: "Present empty media as a drop zone"
owner: "tataihono"
priority: "P2"
status: "complete"
start_date: "2026-10-21"
duration: 1
depends_on: []
blocks: []
tags: [manager, studio, ui]
---

## Scope

Style the editable empty media state as a spacious dashed drop zone, with an
Upload icon and file-drop guidance. Preserve search-specific no-results text and
Clear search. Keep content packs and read-only empty states accurate. Reuse the
existing media content-area file-drop handler and toolbar Upload button.

## Verification

Existing workspace/loading tests, lint, formatting and diff checks. Presentation
only: no new requests, effects or thumbnail loading; existing lazy-load and
request-count assertions cover unchanged startup behavior.

## Result

Editable empty media now shows a large dashed outline, Upload icon and Drop files
here heading, with a reminder that the toolbar Upload button also works. Search
empties retain the query-specific heading and Clear search alongside drop guidance.
Read-only and content-pack empty states retain their existing presentation.

All thirteen workspace/loading tests pass, including empty/search transitions,
file drops, timeline placement and deferred requests. Lint, format and diff checks
pass. No new startup or network work was introduced.
