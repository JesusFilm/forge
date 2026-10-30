---
title: Represent cancelled roadmap work as terminal
type: feat
status: complete
date: 2026-10-02
---

# Cancelled roadmap status

## Scope

Add `cancelled` to the roadmap viewer's parsed status model, status counts, kanban,
timeline, badges and Markdown outputs. Accept historical `canceled` spelling as
`cancelled`. Keep a cancelled ticket terminal even when it lists dependencies;
keep a dependent blocked while a cancelled dependency remains listed.

## Verification

Use fixture tickets to prove parsing, dependency behavior, counts, overdue
exclusion and Markdown output. Run roadmap lint, typecheck, production build and
format checks. Measure page load timing and transferred resources on affected
routes, and inspect any client resource or initialization changes. Leave the
root roadmap README generation to the closeout owner.

## Boundary

Keep this change in `apps/roadmap/**`, `docs/roadmap/platform/feat-599-*` and
this scoped plan/solution. Existing duplicate IDs must fail closed for
dependency satisfaction. Legacy ticket route ambiguity is a separate routing
issue; report it without broadening this PR.
