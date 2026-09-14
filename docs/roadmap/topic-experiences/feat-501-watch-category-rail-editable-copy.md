---
id: "feat-501"
title: "Editable copy in the Watch category rail block"
owner: "vlad"
priority: "P1"
status: "in-progress"
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

## Entry Points

1. `docs/plans/2026-08-26-1827-feat-watch-category-rail-block-plan.md`
2. `apps/admin/src/domain/blocks.ts`
3. `apps/admin/src/app/dashboard/experiences/experience-editor/watch-home-category-rail-editor.tsx`
4. `packages/admin-graphql/src/fragments/blocks/watch-home-category-rail.ts`
5. `apps/web/src/components/home/WatchHomeCategoryRail.tsx`

## Verification

- Focused Admin schema, helper, component, and editor integration tests.
- Generated Admin SDL and gql.tada introspection are stable on rerun.
- Focused Web rendering and mixed-schema fallback tests.
- Admin and Web browser checks at 1440px and 390px in English and one
  non-English locale.
- Touched-package test, lint, typecheck, formatting, and Web build gates.
