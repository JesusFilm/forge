---
id: "feat-860"
title: "Increase numeric scrub steps while holding Shift"
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

Multiply NumberField label/unit drag steps by ten while Shift is held. Switching
the modifier during a gesture continues from the current value rather than
rescaling the distance already travelled. Preserve bounds, live preview,
precision and a single release commit.

## Verification

Numeric gesture and inspector preview regressions, scoped lint/format and Manager
typecheck. This adds only pointer-event arithmetic, with no loading changes.

## Result

Shift multiplies the existing step by ten for label and unit scrubbing. Rebase
the pointer origin and starting value when the modifier changes, preserving
the value already reached rather than magnifying previous movement. Bounds,
live previews and the one-edit release path remain intact. All 22 numeric and
inspector preview tests pass, along with Manager typecheck and scoped ESLint,
Prettier and diff checks. No new loading, layout or network work.
