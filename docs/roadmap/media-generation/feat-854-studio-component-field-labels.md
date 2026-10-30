---
id: "feat-854"
title: "Format component property names for inspector labels"
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

Format dynamic component control labels in the Inspector: capitalise the first
letter, split camelCase/acronym boundaries and underscore/hyphen separators.
Use the same formatting for every property with no fade-specific aliases. Keep original
property keys for reads/writes. No schema, saved-document or input-type changes.

## Verification

Label examples and unchanged control edit keys, Manager typecheck, scoped lint,
format/diff checks. Pure string formatting adds no media or initialization calls.

## Result

A display-only helper formats component field labels, preserving all original
read/write property keys. Nine examples cover lowercase property names, camelCase,
acronyms, snake_case and kebab-case. All 13 label/settings tests pass and Manager
typecheck passes. Scoped lint, formatting and diff checks pass. This replaces
raw text interpolation with a small deterministic formatter for selected
component controls only; no effects, dependencies, media requests or initial
client work are added.

User clarification: removed the fade-specific alias. `fadeOutSec` uses the
generic camelCase rule; all-lowercase `fadeoutsec` is simply capitalised.
