---
id: "feat-101"
title: "Admin Experience Block Editor Parity"
owner: "tataihono"
priority: "P1"
status: "complete"
start_date: "2026-04-15"
duration: 7
depends_on:
  - "feat-098"
blocks: []
tags:
  - "platform"
  - "admin"
  - "cms"
  - "editor"
  - "experience"
---

## Problem

The new experience editor route in `apps/admin` established a real edit path,
but its block canvas only modeled a subset of the experience blocks used by
the product. Operators could not yet add or inspect the full set of supported
blocks from the editor itself, which left the right rail and add flow short of
true CMS parity.

## Entry Points — Read These First

1. `apps/admin/AGENTS.md`
2. `apps/admin/CLAUDE.md`
3. `apps/admin/src/app/dashboard/experiences/experience-editor.tsx`
4. `apps/admin/src/domain/blocks.ts`
5. `apps/cms/src/api/experience/content-types/experience/schema.json`
6. `apps/cms/src/components/sections/`
7. `docs/roadmap/platform/feat-098-admin-cms-expansion-loop.md`

## What To Build

1. Expand the experience editor add-block flow to cover every top-level block
   supported by the admin/domain schema and product experience model.
2. Make the center canvas render a meaningful summary for every supported
   block type so operators can identify structure without opening raw JSON.
3. Convert the right rail into a selected-block inspector that shows editable
   settings for the clicked block while preserving the existing publish flow.
4. Keep the JSON payload path operational for complex nested values and for
   any block details that are not yet expressed as first-class form controls.

## Constraints

- Keep scope inside `apps/admin` plus supporting docs unless a narrowly scoped
  adjacent change is required.
- Preserve the service-layer write path and existing locale save/publish flow.
- Do not regress the full-canvas Stitch-aligned workspace layout for the
  experience editor.

## Verification

- `pnpm --filter @forge/admin lint`
- `pnpm --filter @forge/admin typecheck`
- `pnpm --filter @forge/admin test`
