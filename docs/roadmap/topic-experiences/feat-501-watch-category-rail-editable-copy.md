---
id: "feat-501"
title: "Editable copy in the Watch category rail block"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-09-14"
duration: 1
depends_on:
  - "feat-439"
blocks: []
tags:
  - "admin"
  - "web"
  - "watch"
  - "experiences"
  - "content-discovery"
---

## Problem

The Watch homepage category rail is editable as a block, including its tiles,
but the eyebrow, heading, description, and CTA label are still supplied only
by Web's translated UI catalog. Editors cannot change the visible header copy
for a locale from the block editing experience.

## Entry Points — Read These First

1. `docs/plans/2026-08-26-1827-feat-watch-category-rail-block-plan.md`
2. `apps/admin/src/domain/blocks.ts`
3. `apps/admin/src/app/dashboard/experiences/experience-editor/watch-home-category-rail-editor.tsx`
4. `packages/admin-graphql/src/fragments/blocks/watch-home-category-rail.ts`
5. `apps/web/src/components/home/WatchHomeCategoryRail.tsx`

## Grep These

- `WatchHomeCategoryRailBlockSchema`
- `WatchHomeCategoryRailEditor`
- `AdminPreCopyWatchHomeCategoryRail`
- `classifyCategoryRailSchemaLag`
- `classifyPreviewSchemaLag`
- `WATCH_HOME_CATEGORY_RAIL_MCP_GUIDANCE`

## What To Build

- Add optional, locale-owned `eyebrow`, `title`, `description`, and `ctaLabel`
  overrides to `watchHomeCategoryRail`.
- Expose all four fields in the existing Admin block editor with persistent
  labels, matching length limits, and translated-default guidance.
- Treat blank or whitespace-only values as absent so each field independently
  returns to Web's translated default.
- Preserve the existing tile list, compatibility mirror, ordering, and fixed
  locale-aware CTA destination.
- Propagate the fields through GraphQL, Web rendering, preview, AI, and MCP
  editing without weakening schema-lag fallbacks.

## Constraints

- Keep copy overrides optional and owned by the individual Experience locale.
- Treat empty and whitespace-only values as absent independently per field.
- Do not expose or change the CTA destination; it remains the locale-aware
  Watch language inventory route.
- Preserve authored tiles, `categoryIds`, tile order, and surrounding block
  order through manual, AI, and MCP edits.
- Keep mixed-schema retries limited to complete recognized validation-error
  sets; unrelated GraphQL failures must remain fatal.
- Regenerate Admin SDL and gql.tada introspection from their owning schemas;
  never hand-edit generated outputs.

## Verification

- Focused Admin schema, helper, component, and editor integration tests.
- Generated Admin SDL and gql.tada introspection are stable on rerun.
- Focused Web rendering and mixed-schema fallback tests.
- Admin and Web browser checks at 1440px and 390px in English and one
  non-English locale.
- Touched-package test, lint, typecheck, formatting, and Web build gates.

## Completion Notes

- Added optional, independently defaulted eyebrow, title, description, and CTA
  label fields throughout Admin authoring, GraphQL, Web rendering, preview, AI,
  and MCP contracts.
- Preserved authored tiles across both copy-field-only and older combined schema
  lag, with unrelated GraphQL failures remaining fatal.
- Passed focused and package-level validation, generated-contract stability,
  Admin/Web production builds, and local shell performance checks. Exact
  browser authoring/rendering flows were environment-blocked by unavailable
  local auth and content-database services; the public shell still hydrated
  with zero CLS in the local browser run.
