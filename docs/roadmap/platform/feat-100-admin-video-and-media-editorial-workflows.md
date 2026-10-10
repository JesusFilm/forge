---
id: "feat-100"
title: "Admin Video And Media Editorial Workflows"
owner: "tataihono"
priority: "P1"
status: "in-progress"
start_date: "2026-04-15"
duration: 10
depends_on:
  - "feat-098"
blocks: []
tags:
  - "platform"
  - "admin"
  - "cms"
  - "video"
  - "media"
---

## Problem

`feat-098` established a real experience editing flow in `apps/admin`, but the
admin app still falls short of CMS parity for the adjacent editorial workflows
operators expect every day. Video and media surfaces remain mostly read-heavy,
and there is still no clean authoring path from discovery to edit for those
records.

## Entry Points — Read These First

1. `apps/admin/AGENTS.md`
2. `apps/admin/CLAUDE.md`
3. `apps/admin/docs/v1-operational-surfaces.md`
4. `apps/admin/docs/cms-operational-vs-deferred.md`
5. `docs/roadmap/platform/feat-098-admin-cms-expansion-loop.md`
6. `apps/admin/src/app/dashboard/videos/page.tsx`
7. `apps/admin/src/app/dashboard/media/page.tsx`
8. `apps/admin/src/services/video.service.ts`
9. `apps/admin/prisma/schema.prisma`

## Grep These

- `dashboard/videos|dashboard/media` in `apps/admin/src/app/dashboard`
- `VideoService|write:videos|canEditVideo` in `apps/admin/src`
- `VideoLocale|VideoDub|VideoDubDownload` in `apps/admin/prisma/schema.prisma`
- `READ_ONLY_CATALOG|CATALOG_HEALTH|MEDIA_OPERATIONS` in `apps/admin/src`

## What To Build

1. Add a bounded video editor flow in `apps/admin` that lets operators open a
   specific record, inspect locale data, and perform the highest-value allowed
   editorial updates through the service layer.
2. Turn `/dashboard/media` from a pure catalog page into an operator workflow
   surface with clear next actions, even if upload/curation remains phased.
3. Improve the handoff between search/discovery surfaces and the relevant edit
   target so operators can move from a found record to an editing route without
   context switching.
4. Leave behind docs that clearly mark which video/media actions are
   operational, which remain admin-only, and which are still deferred.

## Constraints

- Keep scope inside `apps/admin` plus supporting docs unless a narrowly scoped
  adjacent change is required.
- Preserve the architectural boundary: UI -> GraphQL/services -> Prisma.
- Do not regress the new experience editor and role-shaped navigation from
  `feat-098`.
- Keep Core-sourced video authority rules intact unless the service-layer
  contract is intentionally expanded in the same ticket.

## Verification

- `pnpm --filter @forge/admin typecheck`
- `pnpm --filter @forge/admin test`
- `pnpm --filter @forge/admin lint`
- `pnpm --filter @forge/admin build`
