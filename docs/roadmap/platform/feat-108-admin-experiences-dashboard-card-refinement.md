---
id: "feat-108"
title: "Admin Experiences Dashboard Card Refinement"
owner: "tataihono"
priority: "P2"
status: "complete"
start_date: "2026-04-23"
duration: 1
depends_on:
  - "feat-091"
blocks: []
tags:
  - "platform"
  - "admin"
  - "ui"
  - "experience"
---

## Problem

The admin experiences index overweights internal operational concepts for the
first editorial pass. Operator notes, editorial signals, and embedding status
make the page feel busier than the work requires. Editors need a more direct
way to scan each experience row and open the record.

## Entry Points - Read These First

1. `apps/admin/AGENTS.md`
2. `apps/admin/CLAUDE.md`
3. `apps/admin/src/app/dashboard/experiences/page.tsx`
4. `apps/admin/src/app/dashboard/live-data.ts`
5. `apps/admin/src/i18n/messages.ts`

## Grep These

- `Editorial Signals` in `apps/admin/src/app/dashboard/experiences/page.tsx`
- `OperatorRail` in `apps/admin/src/app/dashboard/experiences/page.tsx`
- `embedding` in `apps/admin/src/app/dashboard/live-data.ts`
- `pages.experiences` in `apps/admin/src/i18n/messages.ts`

## What To Build

1. Replace the experiences table with a card-style list where each experience
   row is a single clickable card.
2. Add visual previews derived from `ExperienceLocale.ogImageUrl` and block
   media fields, with a graceful fallback when no image exists.
3. Keep each card visually led: title, status, and root-level route only.
4. Let the card grid sit directly under the page header without an extra
   section heading.
5. Remove the operator notes rail from the experiences index.
6. Remove the editorial signals section from the experiences index.
7. Remove embedding status from the experiences index read model and UI.
8. Keep the create-experience action and existing route targets unchanged.

## Constraints

- Keep scope inside `apps/admin` and this roadmap ticket.
- Do not change Prisma schema, GraphQL schema, or service-layer write behavior.
- Reuse existing Forge admin tokens and components; do not introduce new colors.
- Preserve the authenticated page requirements and permissions for creation.

## Verification

- `pnpm --filter @forge/admin test -- src/app/dashboard/dashboard-ui.test.tsx`
- `pnpm --filter @forge/admin typecheck`
