---
id: "feat-891"
title: "Recover Manager mobile shell and Agents modal polish"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-10-28"
duration: 1
depends_on: []
blocks: []
tags: [manager, mobile, ui]
---

## Problem

PR #916 (`pr-827`) carries stale shell and modal polish mixed with superseded migrations. Recover remaining intent on current main without restoring old backend or design-system code.

## Entry Points — Read These First

1. `apps/manager/src/features/shell/manager-shell.tsx` — current shell and profile menu.
2. `apps/manager/src/features/agents/agents-page.tsx` — portaled modal and request handling.
3. `apps/manager/src/features/agents/automation-form.tsx` — three-step creation flow.
4. `apps/manager/src/app/globals.css` — existing palette, responsive rules and scoped design system.
5. Root recovery plan: `docs/plans/2026-10-28-manager-automation-pr-recovery.md` (integration checkout).

## Grep These

- `agents-modal|agents-wizard|studio-shell-topbar|design-system-shell-nav`
- `key="advance"|key="create"|requestAutomation`

## What To Build

Port remaining mobile overlay bounds, shell navigation, modal typography and separator cleanup. Preserve root's JSON response helper and explicit final-create click fix.

## Constraints

- Existing palette only; preserve current main improvements.
- No backend, schema, generated-client or page server-loader changes.
- No pushes, merges, production deploys or paid provider calls. Root owns integration.

## Verification

- Browser at desktop and mobile widths, including short viewport overlay scrolling.
- Review launch sends zero create POSTs; explicit Create sends one.
- Compare warmed page-load timing, request count and bytes before/after.
- Focused tests, Manager typecheck/lint, Prettier and diff checks.

## Resolution

Recovered current-shell mobile navigation, overlay bounds, modal token scope and
typography without restoring stale migrations. Preserved root response handling
and explicit final-create click fixes; added behavioral confirmation coverage.
Verification and local screenshot paths:
`docs/validation/manager-pr916-2026-10-28/README.md`.
Root owns independent review and integration into PR #916.
Round-1 P3 focus loss is resolved: step transitions focus the new heading while
preserving initial/editing focus, distinct navigation/creation keys and the
submit guard. Added failing-then-passing focus coverage; verified real browser
keyboard navigation and paired warm-load measurements in `focus-review.json`
beside the validation README. Root owns the fresh independent review round.
