---
id: "feat-858"
title: "Limit inspector transform display to two decimal places"
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

Add optional display precision to `apps/manager/src/features/video-studio/number-field.tsx`
and enable two decimal places for X, Y, scale, rotation and opacity in `inspector.tsx`.
Preserve stored precision on untouched blur and label scrubbing. Other numeric
fields retain their current behavior.

## Verification

NumberField and project settings regressions, Manager typecheck, scoped lint and
format checks. Formatting adds no initialization, layout reads or media requests.

## Result

All five transform controls display at most two decimals without trailing zeros.
Untouched blur and label clicks preserve the original stored value; scrubbing
starts from that precise value, and typed edits retain their entered precision.
Keep this distinction when reusing NumberField display precision: formatted text
must not become the starting value for a gesture or an implicit document edit.
Ten numeric-field/settings tests, Manager typecheck, scoped ESLint, Prettier and
diff checks pass. Loading-impact review confirms only local number formatting:
no dependencies, effects, layout measurements or additional network requests.
