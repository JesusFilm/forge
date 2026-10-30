---
id: "feat-883"
title: "Shorten and enlarge media empty captions"
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

Use one brief caption for each media category, remove the extra automatic-sorting
paragraph, and increase empty-state caption size and contrast using existing
design tokens. Keep upload/drop behavior unchanged.

## Verification

Existing workspace/loading tests, format/lint/diff checks. Text and CSS only;
no changes to initial loading, network or media preparation.

## Result

Each media category has one brief caption; the sorting explanation is removed.
Empty-state captions use 14px instead of 12px, existing ink color for contrast,
and a 400px text measure. All thirteen workspace/loading tests pass, along with
lint, formatting and diff checks. Upload and loading behavior are unchanged.
