---
id: "feat-107"
title: "Admin Media Asset Library"
owner: "tataihono"
priority: "P1"
status: "complete"
start_date: "2026-04-23"
duration: 10
depends_on: []
blocks:
  - "feat-115"
  - "feat-236"
tags:
  - "platform"
  - "admin"
  - "media"
  - "editor"
---

## Problem

`apps/admin` is replacing Strapi as the editorial source of truth, but media is
still scattered across URL fields in experience metadata and block JSON. Editors
need a real media library for images and generic files, and agents need a
structured way to inspect assets, manage references, and answer where an image
or file is used before replacing it.

## Entry Points — Read These First

1. `docs/brainstorms/2026-04-23-admin-media-asset-library-requirements.md` — product and architecture requirements.
2. `apps/admin/AGENTS.md` — admin architecture rules.
3. `apps/admin/CLAUDE.md` — service, GraphQL, Prisma, storage, and permission conventions.
4. `apps/admin/docs/cms-operational-vs-deferred.md` — current media workflow gap.
5. `apps/admin/src/storage/s3.ts` — existing Railway S3/local fallback storage pattern.
6. `apps/admin/src/domain/blocks.ts` — current media URL fields in experience blocks.
7. `apps/admin/src/app/dashboard/media/page.tsx` — current media route.
8. `apps/admin/src/app/dashboard/experiences/experience-editor.tsx` — block editor selection UX.
9. `apps/admin/prisma/schema.prisma` — ExperienceLocale blocks and existing VideoImage model.

## Grep These

- `MediaAsset|media asset|asset library` in `apps/admin docs`
- `imageUrl|mediaUrl|backgroundImageUrl|imageOverrideUrl|ogImageUrl` in `apps/admin/src`
- `writeArtifact|readArtifact|writeObject|readObject` in `apps/admin/src/storage`
- `S3Client|RAILWAY_S3_BUCKET|LOCAL_OBJECT_DIR|local fallback` in `apps/admin/src`
- `dashboard/media|Choose .* image from asset library|media library` in `apps/admin/src/app/dashboard`
- `VideoImage|ExperienceLocale|blocks Json` in `apps/admin/prisma/schema.prisma`
- `read:|write:|canEdit|hasPermission` in `apps/admin/src/auth apps/admin/src/services`

## What To Build

1. Define admin-native media asset requirements from the brainstorm as a
   concrete implementation plan covering data model, GraphQL/service API,
   storage, UI, usage detection, permissions, and tests.
2. Add first-class media asset support in `apps/admin` for images, videos,
   PDFs, and generic files, with the first editor UX optimized for image
   selection in experience blocks.
3. Keep storage backend-aware: Railway S3/object storage for production
   images/files, local filesystem fallback for development/tests, and a
   Mux-ready video backend design that does not upload to Mux in local dev.
   During planning, evaluate whether an S3-compatible local emulator from npm
   or containerized tooling should supplement or replace plain filesystem
   fallback for production-like integration tests.
4. Upgrade `/dashboard/media` from read-heavy status surface to an asset
   library workflow: browse, filter, upload/register, preview, inspect metadata,
   and open usage.
5. Integrate asset selection into the experience editor for existing
   image-bearing fields: locale OG image, block image fields, card media,
   background images, Bible quote images, navigation carousel items, media
   collection item overrides, video carousel item images, and video/video hero
   media fields.
6. Provide a structured "where used" view that can locate asset references
   inside `ExperienceLocale` metadata and nested block JSON, with direct links
   back to the relevant editor context.
7. Expose agent-friendly service/API operations for listing assets, inspecting
   metadata, inspecting usage, registering/uploading local assets, attaching
   assets to known fields, and safely replacing references.

## Constraints

- Keep Strapi out of the source-of-truth path for this work.
- Preserve admin's architecture: UI -> GraphQL/services -> Prisma/storage.
- Do not make Mux upload/transcoding part of the first milestone; only design
  the video backend boundary and local development behavior.
- Do not require web/mobile/TV consumer migration in this ticket.
- Do not allow silent deletion or replacement of assets with known usage.
- Do not build direct storage URL concatenation into callers; centralize URL or
  preview generation behind admin-owned logic.
- Do not require a real Railway S3 bucket for local development or normal test
  runs.

## Verification

- `pnpm --filter @forge/admin lint`
- `pnpm --filter @forge/admin typecheck`
- `pnpm --filter @forge/admin test`
- `pnpm --filter @forge/admin build`
- Local dev can register/upload image, PDF, and video-placeholder assets without
  Railway S3 or Mux credentials.
- Plan explicitly decides filesystem fallback vs S3-compatible local emulator
  vs both, including which test tier uses each backend.
- Experience editor can select a managed image asset for at least one block
  image field and persist the reference through the existing save flow.
- Asset detail shows usage for an asset referenced by an `ExperienceLocale`
  field and by a nested block field.
- Replacement/deletion flow blocks or warns when usage exists.
