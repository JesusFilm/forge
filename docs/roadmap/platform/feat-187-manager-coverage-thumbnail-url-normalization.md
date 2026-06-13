---
id: "feat-187"
title: "Manager coverage thumbnail URL normalization"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-06-13"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "admin"
  - "manager"
  - "coverage"
  - "images"
---

## Problem

The Manager Studio Coverage page shows broken episode thumbnails in the
hover/detail panel. The Admin-backed Manager coverage read model passes the
latest `VideoImage.url` through directly, so bare Cloudflare Image Delivery
URLs that omit a variant suffix reach Manager unchanged and fail in browser
image elements and CSS background images.

## Entry Points - Read These First

1. `apps/admin/src/services/manager-read-model.service.ts` - Admin-owned
   Manager coverage read model and current `imageUrl` mapping.
2. `apps/admin/src/services/manager-read-model.service.test.ts` - focused
   service regression tests for coverage payloads.
3. `apps/admin/src/app/dashboard/video-library-utils.ts` - existing
   `normalizeVideoThumbnailUrl` behavior used by Admin dashboard surfaces.
4. `apps/manager/src/features/coverage/coverage-report-client.tsx` - hover
   panel and selected thumbnail stack consumers of `imageUrl`.

## Grep These

- `imageUrl: video.images[0]?.url`
- `normalizeVideoThumbnailUrl`
- `detail-thumb`
- `selected-video-stack-thumb`
- `--detail-bg-image`

## What To Build

1. Normalize Manager coverage image URLs before returning
   `ManagerVideoCoverage.imageUrl`.
2. Preserve existing absolute non-Cloudflare URLs unchanged.
3. Preserve missing/blank image URLs as `null`.
4. Add a regression test that proves a bare Cloudflare Image Delivery URL gets
   a public variant suffix before Manager receives it.

## Constraints

- Do not change the GraphQL payload shape.
- Do not hand-edit generated GraphQL artifacts; this is field behavior only.
- Do not add Manager-side URL guessing when Admin already owns the read model.
- Do not change coverage count aggregation, language filtering, title
  selection, or selection behavior.

## Verification

- `pnpm --filter @forge/admin test -- --run src/services/manager-read-model.service.test.ts`
- `pnpm --filter @forge/admin typecheck`
- Helium/browser smoke on Manager Coverage hover details to confirm episode
  thumbnails render inside the preview panel.
