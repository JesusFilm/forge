---
id: "feat-155"
title: "Admin language diagnostics browser"
owner: "tataihono"
priority: "P1"
status: "complete"
start_date: "2026-06-02"
duration: 2
tags:
  - "platform"
  - "admin"
  - "ui"
  - "i18n"
  - "core-sync"
depends_on:
  - "feat-091"
  - "feat-153"
blocks: []
---

## Problem

The `/dashboard/languages` page shows live Core language rows, but the current
surface only exposes a small recent slice. Operators cannot search the full
language corpus, diagnose why a language is or is not linked to content, or
inspect Core sync/provenance details without leaving the admin UI.

## Entry Points - Read These First

1. `docs/plans/2026-06-02-003-feat-admin-language-diagnostics-plan.md` - implementation plan.
2. `apps/admin/src/app/dashboard/languages/page.tsx` - current route.
3. `apps/admin/src/app/dashboard/ops-data.ts` - current language page loader.
4. `apps/admin/src/components/admin-ui.tsx` - shared static table and affordance rules.
5. `docs/plans/2026-06-01-001-fix-admin-interaction-affordances-plan.md` - recent clickable/static row decisions.
6. `apps/admin/prisma/schema.prisma` - language, localization, geo, content, and sync fields.

## Grep These

- `loadLanguagesData` in `apps/admin/src/app/dashboard/ops-data.ts`
- `LanguagesPage` in `apps/admin/src/app/dashboard/languages/page.tsx`
- `model Language`, `model LanguageLocale`, `model CountryLanguage`, `model VideoDub`, and `model VideoSubtitle` in `apps/admin/prisma/schema.prisma`
- `DataTable` in `apps/admin/src/components/admin-ui.tsx`
- `role="dialog"` in `apps/admin/src/app/dashboard/`

## What To Build

1. Load a full diagnostic language dataset for the admin languages page rather
   than only the current small recent slice.
2. Add search across Core identity, slug, BCP-47, ISO3, localized names, and
   available diagnostic labels.
3. Add full diagnostic filters covering operational state, geo/content signals,
   and sync/provenance signals.
4. Make each language row intentionally clickable and keyboard reachable.
5. Open a read-only language detail modal that exposes all useful language
   details available from the admin data model, including Core identity,
   localized names, audio preview metadata, country-language metadata,
   content linkage counts, and sync/provenance timestamps.
6. Preserve the recent affordance rule: static tables stay non-clickable unless
   the row opens a real interaction.

## Constraints

- Do not add mutations or editing workflows for Core-sourced language data.
- Do not change Prisma schema, Pothos schema, or generated GraphQL outputs.
- Do not change public web/mobile/tv language behavior.
- Keep scope inside `apps/admin` and roadmap/plan docs.
- Use existing Forge Editorial visual grammar and lucide icons.
- Use Helium browser for smoke verification.

## Verification

- Admin unit/render tests cover language diagnostics data, filters, and route
  rendering.
- Admin typecheck passes.
- Helium smoke for `/dashboard/languages` proves search/filter behavior, row
  clickability, modal open/close, and read-only detail rendering.
