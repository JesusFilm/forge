---
id: "feat-153"
title: "Admin interaction affordance polish"
owner: "tataihono"
priority: "P1"
status: "in-progress"
start_date: "2026-06-01"
duration: 1
tags:
  - "platform"
  - "admin"
  - "ui"
  - "ux"
  - "accessibility"
depends_on:
  - "feat-091"
  - "feat-097"
blocks: []
---

## Problem

The admin dashboard contains a mix of live controls, read-only operational data,
and future workflow placeholders. Some controls look enabled even when they do
nothing, while some read-only rows show hover or action affordances. Operators
need the panel to make clickability, disabled state, and unfinished workflows
obvious.

## Entry Points — Read These First

- `docs/plans/2026-06-01-001-fix-admin-interaction-affordances-plan.md`
- `apps/admin/src/components/admin-ui.tsx`
- `apps/admin/src/components/admin-shell.tsx`
- `apps/admin/src/app/dashboard/page.tsx`
- `apps/admin/src/app/dashboard/videos/page.tsx`
- `apps/admin/src/app/dashboard/experiences/experiences-actions.tsx`
- `apps/admin/src/app/dashboard/dashboard-ui.test.tsx`

## Grep These

- `PrimaryButton|SecondaryButton|SearchPillButton|DataTable` in
  `apps/admin/src/components/admin-ui.tsx`
- `Open command palette|Help is not available yet|searchPalettePrompt` in
  `apps/admin/src/components/admin-shell.tsx` and
  `apps/admin/src/i18n/messages.ts`
- `Run Manual Sync|Add manual video|Quick Actions|Filter` in
  `apps/admin/src/app/dashboard/`
- `hover:bg-[var(--color-surface-raised)]` in
  `apps/admin/src/app/dashboard/`

## What To Build

1. Give enabled clickable controls explicit pointer, hover, and focus-visible
   affordances.
2. Render unimplemented or permission-blocked controls as disabled,
   semi-transparent, non-clickable controls.
3. Remove hover/action affordances from static read-only table rows.
4. Add accessible labels and disabled state to top-bar icon controls.
5. Preserve existing implemented workflows such as Core Sync, semantic search,
   workflow filtering, and permitted experience creation.

## Constraints

- Keep scope inside `apps/admin` and admin roadmap/plan docs.
- Do not change Prisma schema, Pothos schema, service-layer mutations, or
  generated GraphQL outputs.
- Do not implement deferred video filter/manual-video/row-action workflows in
  this pass.
- Use existing Forge Editorial tokens and component grammar.
- Use Helium browser for smoke verification.

## Verification

- `pnpm --filter @forge/admin test -- src/app/dashboard/dashboard-ui.test.tsx src/components/admin-shell.test.tsx`
- `pnpm --filter @forge/admin typecheck`
- Helium browser smoke for `/dashboard`, `/dashboard/videos`,
  `/dashboard/system-status`, `/dashboard/embeddings`, and
  `/dashboard/experiences`.
