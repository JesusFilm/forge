---
id: "feat-158"
title: "Admin language library visual redesign"
owner: "tataihono"
priority: "P1"
status: "complete"
start_date: "2026-06-04"
duration: 1
tags:
  - "platform"
  - "admin"
  - "ui"
  - "ux"
  - "i18n"
depends_on:
  - "feat-091"
  - "feat-153"
  - "feat-155"
blocks: []
---

## Problem

The `/dashboard/languages` page now has the right diagnostic data, but the
surface still reads like an internal diagnostics panel: nested cards, grouped
filter chips, and a compact table. Operators need the language browser to feel
closer to the redesigned `/dashboard/videos` page: a clear search-first index,
compact filters, scannable row hierarchy, flag/country signals, and the same
Forge Editorial visual polish.

## Entry Points - Read These First

1. `docs/plans/2026-06-04-001-feat-admin-language-library-redesign-plan.md`
2. `apps/admin/src/app/dashboard/languages/page.tsx`
3. `apps/admin/src/app/dashboard/languages/language-diagnostics.tsx`
4. `apps/admin/src/app/dashboard/videos/page.tsx`
5. `apps/admin/src/app/dashboard/videos/video-library-toolbar.tsx`
6. `apps/admin/src/app/dashboard/ops-data.ts`

## Grep These

- `LanguageDiagnostics` in `apps/admin/src/app/dashboard/languages/language-diagnostics.tsx`
- `VideoLibraryToolbar` in `apps/admin/src/app/dashboard/videos/video-library-toolbar.tsx`
- `VideoRow` in `apps/admin/src/app/dashboard/videos/page.tsx`
- `buildLanguageDiagnosticRow` in `apps/admin/src/app/dashboard/ops-data.ts`
- `countryPreviews` in `apps/admin/src/app/dashboard/ops-data.ts`

## What To Build

1. Recompose `/dashboard/languages` into a Videos-style browser page with a
   search-first header, compact filter row, and one primary list surface.
2. Replace the nested diagnostic filter panel with compact select controls that
   preserve the same operational, geo/content, and sync predicates.
3. Redesign rows around a stronger language hierarchy: title, code identity,
   status/provenance chips, coverage counts, country/flag preview chips, and
   updated time.
4. Keep row clickability tied to the existing read-only detail modal.
5. Preserve all current diagnostics behavior, filter predicates, and read-only
   Core ownership boundaries.

## Constraints

- Keep scope inside `apps/admin` plus roadmap/plan docs.
- Do not change Prisma schema, Pothos schema, GraphQL SDL, generated clients,
  or Core sync data shape.
- Do not add language editing, bulk actions, saved views, or server-side
  language search in this visual slice.
- Reuse existing Forge Editorial tokens and the Videos page component grammar.
- Use Helium browser for smoke verification when callable, with `agent-browser`
  fallback if Helium is unavailable.

## Verification

- `pnpm --filter @forge/admin test -- src/app/dashboard/languages/language-diagnostics.test.tsx src/app/dashboard/dashboard-ui.test.tsx`
- `pnpm --filter @forge/admin typecheck`
- Browser smoke for `/dashboard/languages` covering search, filters, row modal,
  and responsive layout.
