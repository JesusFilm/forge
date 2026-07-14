---
id: "feat-242"
title: "Uploaded media raster LQIPs"
owner: "tataihono"
priority: "P1"
status: "complete"
start_date: "2026-07-09"
duration: 1
depends_on:
  - "feat-115"
blocks: []
tags:
  - "platform"
  - "admin"
  - "media"
---

## Problem

Uploaded Admin image assets persist `blurDataUrl`, but production inspection
shows every value is the same hardcoded 8x8 SVG swatch. That satisfies the
field shape but not the intent of `feat-115`: a `next/image`-compatible blur
placeholder derived from the uploaded image bytes.

## Entry Points — Read These First

1. `docs/roadmap/platform/feat-115-admin-image-enrichment-workflow.md`
2. `docs/plans/2026-05-04-001-feat-admin-image-enrichment-workflow-plan.md`
3. `apps/admin/src/services/image-metadata.service.ts`
4. `apps/admin/src/services/image-metadata.service.test.ts`
5. `apps/admin/src/workflows/mediaImageEnrichment.ts`
6. `apps/admin/src/app/dashboard/media/upload-media-asset-action.ts`

## Grep These

- `generateImageMetadata`
- `blurDataUrl`
- `dominantColor`
- `imageEnrichmentStatus`

## What To Build

- Replace the hardcoded SVG placeholder in
  `apps/admin/src/services/image-metadata.service.ts` with a real raster LQIP
  generated from uploaded image bytes.
- Keep the output directly compatible with Next Image `blurDataURL`.
- Preserve width/height extraction and a useful dominant-color fallback for UI
  metadata.
- Keep enrichment asynchronous and do not block upload completion.

## Constraints

- Do not change public media URLs or storage object shape.
- Do not make AI localized text generation required for blur generation.
- Do not erase valid blur metadata just because later localized text generation
  fails.

## Verification

- `pnpm --filter @forge/admin test image-metadata.service`
- `pnpm --filter @forge/admin typecheck`
