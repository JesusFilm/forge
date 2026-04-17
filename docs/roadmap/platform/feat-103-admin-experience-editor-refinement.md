---
id: "feat-103"
title: "Admin Experience Editor Refinement"
owner: "tataihono"
priority: "P1"
status: "in-progress"
start_date: "2026-04-16"
duration: 5
depends_on:
  - "feat-101"
blocks: []
tags:
  - "platform"
  - "admin"
  - "cms"
  - "editor"
  - "experience"
---

## Problem

The admin experience editor now has the major CMS parity pieces: record editing,
block add flow, inspector settings, video attachment, publish actions, and
revision visibility. The remaining work is to make the editor feel trustworthy
for real operators: easier to maintain, harder to save invalid block payloads,
clearer about unsaved changes, and more resilient across common editing paths.

## Entry Points - Read These First

1. `apps/admin/AGENTS.md`
2. `apps/admin/CLAUDE.md`
3. `apps/admin/src/app/dashboard/experiences/experience-editor.tsx`
4. `apps/admin/src/app/dashboard/experiences/experience-editor/README.md`
5. `apps/admin/src/domain/blocks.ts`
6. `apps/admin/src/domain/blocks.test.ts`
7. `docs/roadmap/platform/feat-101-admin-experience-block-editor-parity.md`

## Grep These

- `normalizeOptionalUrlFields|createTemplateBlock|summarizeBlock` in `apps/admin/src/app/dashboard/experiences/experience-editor.tsx`
- `renderInspectorFields|renderCanvasCard|renderVideoCarouselItemCard` in `apps/admin/src/app/dashboard/experiences/experience-editor.tsx`
- `BlockSchema|BlocksSchema|ContainerSlotContentBlockSchema|SectionContentBlockSchema` in `apps/admin/src/domain/blocks.ts`
- `ExperienceEditor` in `apps/admin/src/app/dashboard`

## What To Build

1. Extract editor block metadata and payload helpers out of the monolithic
   client component where doing so reduces risk and makes future block work
   easier.
2. Harden the save path so generated editor payloads match
   `apps/admin/src/domain/blocks.ts` without relying on accidental empty-string
   cleanup.
3. Improve operator confidence in the right rail and action bar:
   - visible unsaved-change posture
   - save/publish disabled states that explain themselves
   - selected-block inspector affordances that do not require raw JSON for
     common first-class settings
4. Add focused tests for extracted helpers and any behavior-bearing UI changes.
5. Keep the existing canvas, video picker, publish flow, and revision restore
   path operational.

## Constraints

- Keep scope inside `apps/admin` plus supporting docs.
- Preserve the service-layer write path and server actions in
  `apps/admin/src/app/dashboard/experiences/[id]/page.tsx`.
- Do not change the canonical block schema unless the editor exposes a proven
  mismatch with the product model.
- Do not touch generated Prisma, Next, or GraphQL outputs.
- Do not modify unrelated login-copy work already present in the worktree.

## Verification

- `pnpm --filter @forge/admin lint`
- `pnpm --filter @forge/admin typecheck`
- `pnpm --filter @forge/admin test`
- Browser check of `/dashboard/experiences/[id]` when a local admin session and
  seed data are available.
