---
id: "feat-280"
title: "Watch Media Collection Linked Titles"
owner: "codex"
priority: "P1"
status: "complete"
start_date: "2026-07-21"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "admin"
  - "web"
  - "watch"
  - "experiences"
---

## Problem

Watch Experience media collection cards render blank title overlays when an
item links to a Video but has no authored `titleOverride`. The item GraphQL
shape exposes the link, image metadata, and playback metadata, but not the
linked Video's localized title, so Web has no title fallback to render.

## Entry Points

1. `apps/admin/src/graphql/types/blocks.ts` — computed fields on the flat `MediaCollectionItem` GraphQL type.
2. `apps/admin/src/graphql/loaders.ts` — request-scoped Video and VideoLocale batching.
3. `apps/web/src/lib/fragments/watch-media-collection-titles.ts` — Web-only resolved-title projection through supported collection nesting paths.
4. `apps/web/src/lib/enrichment.ts` — Web item title precedence and normalization.
5. `apps/web/src/components/sections/MediaCollection.tsx` — title overlay rendering.

## What To Build

1. Expose a nullable, locale-aware resolved title for linked media collection items through Admin GraphQL.
2. Resolve a nonblank authored override first, then the linked Video's published title for the requested locale.
3. Return no title when neither source exists; never synthesize `Untitled`, a slug, or another placeholder.
4. Make Web omit the card title heading when the resolved title is absent while preserving the thumbnail and navigation.
5. Cover the shared contract and visible rendering behavior with focused tests and browser proof.

## Constraints

- Keep the stored Experience block JSON shape unchanged.
- Use request-scoped batching; do not add per-card database queries or a second Web hydration request.
- Do not expose unpublished localized Video copy to public callers.
- Keep image, playback, link, and collection layout behavior unchanged.
- Regenerate the committed Admin SDL and admin-graphql introspection after the schema change.

## Verification

- Focused Admin resolver and Web enrichment/rendering tests.
- Admin schema print plus admin-graphql generation with no residual drift.
- Admin and Web typecheck/lint for the touched surface.
- Browser/DOM proof on Watch for linked titles and a titleless item, including page-load request/performance inspection.
