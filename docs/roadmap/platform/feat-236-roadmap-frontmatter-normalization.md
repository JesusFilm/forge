---
id: "feat-236"
title: "Roadmap frontmatter normalization for deploy builds"
owner: "nisal"
priority: "P0"
status: "complete"
start_date: "2026-07-07"
duration: 1
depends_on: []
blocks: []
tags:
  - platform
  - roadmap
  - railway
  - nextjs
---

## Problem

Railway deploys for `apps/roadmap` failed during `next build` while collecting
page data for `/person/[person]`. The roadmap viewer reads markdown
frontmatter from `docs/roadmap/` as production input, and unquoted YAML dates
can be parsed into JavaScript `Date` objects instead of strings.

## Entry Points - Read These First

1. `apps/roadmap/lib/features.ts` - filesystem-backed roadmap parser,
   frontmatter normalization, computed blocked status, and feature sorting.
2. `docs/solutions/deployment/nextjs-pnpm-monorepo-railway-standalone.md` -
   existing Railway deployment model for the roadmap app.
3. `docs/plans/2026-07-07-003-fix-roadmap-frontmatter-normalization-plan.md` -
   implementation plan for this deploy hotfix.

## Grep These

- `parseFeatureFile`
- `formatTimeline`
- `PRIORITY_ORDER`
- `start_date`
- `Failed to collect page data`

## What To Build

- Normalize `gray-matter` frontmatter at the `parseFeatureFile` boundary so
  `Feature` values keep stable runtime types before sort and render paths.
- Support YAML date scalars by converting `Date` objects to `YYYY-MM-DD`
  strings.
- Convert legacy or malformed roadmap values to safe viewer defaults instead
  of crashing static generation.
- Clean the known malformed platform tickets so the source data matches the
  documented roadmap schema.
- Capture the deploy-failure learning in `docs/solutions/`.

## Constraints

- Do not register the `ai-chat` lane in the roadmap viewer.
- Do not change Railway builder settings unless parser normalization still
  fails to restore the build.
- Do not replace the filesystem-backed roadmap data model.

## Verification

1. `pnpm --filter roadmap build`
2. `pnpm --filter roadmap lint`
3. Frontmatter scan confirms known malformed tickets use quoted dates, valid
   priorities, valid statuses, and numeric durations.
