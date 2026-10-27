---
id: "feat-884"
title: "Add Upload inside empty media states"
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

Add an Upload button inside editable media empty states, sharing the toolbar’s
existing hidden file chooser. Preserve busy gating and Clear search. No new
network calls or initialization work.

## Verification

Existing workspace/loading tests, including empty-state chooser activation;
formatting, lint and diff checks.

## Result

Editable media empty states include a primary Upload action with an icon. It
opens the same multiple-file chooser as the toolbar and is disabled while busy.
Clear search remains available. All thirteen workspace/loading tests pass,
including chooser activation from the empty state. Lint, format and diff checks
pass. Initial loading and media requests are unchanged.
