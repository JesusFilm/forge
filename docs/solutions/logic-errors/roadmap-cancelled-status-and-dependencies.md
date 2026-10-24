---
title: "Roadmap cancellation must survive dependency evaluation"
date: "2026-10-02"
category: "logic-errors"
module: "apps/roadmap"
problem_type: "status-normalization"
component: "roadmap-viewer"
tags: [roadmap, status, dependencies]
---

# Roadmap cancellation and dependencies

The roadmap parser once mapped `cancelled` and `canceled` to `blocked`. That
turned explicit product cancellations into open blockers. A terminal status
must survive dependency evaluation for the cancelled ticket itself, while a
dependent remains blocked because cancellation does not implement the required
work. Historical IDs collide across lanes, so an ID is considered satisfied
only when every matching ticket is complete; selecting the last matching
status can silently treat a cancelled dependency as implemented.

Keep fixture coverage for both cancelled spellings, cancelled and duplicate-ID
dependencies, counts, overdue exclusion and Markdown output. A duplicate ID
can still make legacy `/ticket/<id>` links ambiguous; this status repair does
not change ticket routing.
