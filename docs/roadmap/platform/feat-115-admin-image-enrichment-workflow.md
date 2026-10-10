---
id: "feat-115"
title: "Admin Image Enrichment Workflow"
owner: "tataihono"
priority: "P1"
status: "complete"
start_date: "2026-05-04"
duration: 7
depends_on:
  - "feat-107"
blocks: []
tags:
  - "platform"
  - "admin"
  - "media"
  - "workflows"
  - "ai-pipeline"
---

## Problem

`feat-107` gives `apps/admin` a media asset library, but uploaded images still
need derived metadata before they work well in editorial and `next/image`
consumer paths. Editors should be able to use uploaded images immediately while
admin backfills a blur data URL and localized title/alt text in the background.

## Entry Points — Read These First

1. `docs/brainstorms/2026-05-04-admin-image-enrichment-workflow-requirements.md`
2. `docs/brainstorms/2026-04-23-admin-media-asset-library-requirements.md`
3. `apps/admin/AGENTS.md`
4. `apps/admin/CLAUDE.md`
5. `apps/admin/prisma/schema.prisma`
6. `apps/admin/src/services/media-asset.service.ts`
7. `apps/admin/src/services/media-asset.schemas.ts`
8. `apps/admin/src/graphql/types/mediaAsset.ts`
9. `apps/admin/src/graphql/mutations/media-asset.ts`
10. `apps/admin/src/app/dashboard/media/page.tsx`
11. `apps/admin/src/app/dashboard/media/media-asset-inspector.tsx`
12. `apps/admin/src/app/dashboard/experiences/experience-editor.tsx`
13. `apps/admin/src/workflows/experienceEmbedding.ts`
14. `apps/admin/src/services/workflow-run-log.service.ts`

## Grep These

- `MediaAsset|MediaAssetStatus|MediaAssetKind` in `apps/admin/prisma/schema.prisma`
- `altText|displayName|status: "UPLOADING"|status: "READY"` in `apps/admin/src/app/dashboard/media/page.tsx`
- `mediaAssetPreviewUrl|mediaAssetDownloadUrl|scanMediaAssetUsage` in `apps/admin/src/services`
- `"use workflow"|"use step"|start(` in `apps/admin/src`
- `WorkflowRun|workflowKey|subjectType|subjectId` in `apps/admin/src`
- `LocaleStatus|model .*Locale|locale` in `apps/admin/prisma/schema.prisma`
- `MediaAssetInspector|Metadata|altText|Where used` in `apps/admin/src/app/dashboard/media/media-asset-inspector.tsx`
- `localeDrawerOpen|Locales|localeEntries` in `apps/admin/src/app/dashboard/experiences/experience-editor.tsx`

## What To Build

1. Keep image upload immediately usable after storage succeeds; do not block
   picker/editor workflows on AI enrichment.
2. Add an admin image enrichment workflow that runs after upload and records
   waiting/processing/failure/completion state for operator-visible media
   surfaces.
3. Generate and persist one asset-global blur data URL compatible with
   `next/image` `placeholder="blur"`.
4. Add first-class localized image metadata for title and alt text, seeded for
   the configured top 12 global languages at upload enrichment time.
5. Auto-apply AI-generated localized title/alt values with provenance.
6. Allow human overrides per locale/value and permanently protect overridden
   values from future regeneration or retry.
7. Expose enrichment state, blur metadata, localized values, provenance, and
   retry-safe inspection through admin service/GraphQL paths.
8. Update media UI listing/detail/picker surfaces so waiting and processing
   enrichment states are visible without making the image appear unavailable.
9. Add a first-class image localization management surface launched from the
   media asset inspector. This can be a modal when that gives the workflow
   better room than embedding everything in the inspector.
10. Cover locale list, active locale editor, provenance/AI state, human override
    state, failed/missing filters, and retry affordances in that surface.
11. Keep the inspector/status entry point polished and operationally clear,
    while avoiding a generic localization framework until planning proves it is
    needed.

## Constraints

- Keep scope in `apps/admin` plus supporting docs unless a narrow generated type
  or consumer contract change is explicitly required by planning.
- Preserve `apps/admin` architecture: UI -> GraphQL/services -> Prisma/storage.
- Do not make enrichment synchronous with upload.
- Do not overwrite human-authored localized title or alt text during backfill,
  retry, or regeneration.
- Do not use blurhash alone as the required output; the required output is a
  `next/image`-compatible blur data URL.
- Do not enrich every system locale on upload; start with the top 12 global
  languages.
- Do not hide localized image title/alt management behind raw JSON or a single
  overloaded canonical metadata field.
- Do not build a universal localization management platform in this ticket.

## Verification

- `pnpm --filter @forge/admin lint`
- `pnpm --filter @forge/admin typecheck`
- `pnpm --filter @forge/admin test`
- `pnpm --filter @forge/admin build`
- Upload an image and confirm it is immediately selectable before enrichment
  finishes.
- Confirm media UI shows waiting/processing enrichment state for an uploaded
  image.
- Confirm enrichment writes a `next/image`-compatible blur data URL.
- Confirm localized title/alt records exist for the configured top 12 global
  languages after enrichment.
- Override one localized alt text value, rerun enrichment, and confirm the human
  override is preserved.
- Open localization management from the media inspector, scan top-12 locale
  rows, edit a localized title or alt text, see the value become
  human-protected, filter or identify failed rows, and retry AI-owned failures.
