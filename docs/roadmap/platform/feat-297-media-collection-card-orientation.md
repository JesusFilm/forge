---
id: "feat-297"
title: "Media collection card orientation"
owner: "unassigned"
priority: "P2"
status: "complete"
start_date: "2026-07-22"
duration: 1
depends_on: []
blocks: []
tags:
  - "admin"
  - "graphql"
  - "mobile"
  - "tv"
  - "web"
  - "watch-page"
  - "ui"
---

## Problem

The Experience editor presents a horizontal media-card choice, but the persisted
MediaCollection contract only stores its grid/carousel variant. Watch therefore
renders every carousel card as portrait, even when an editor expects horizontal
landscape cards.

## Entry Points — Read These First

1. `apps/admin/src/domain/blocks.ts` — persisted MediaCollection Zod contract.
2. `apps/admin/src/graphql/types/blocks.ts` — public Pothos block fields.
3. `packages/admin-graphql/src/fragments/blocks/media-collection.ts` — shared consumer fragment.
4. `apps/admin/src/app/dashboard/experiences/experience-editor.tsx` — authored orientation control.
5. `apps/web/src/components/sections/MediaCollection.tsx` — Web card renderer.
6. `apps/mobile/src/components/sections/MediaCollectionRenderer.tsx` — mobile SDUI card renderer.
7. `apps/tv/src/components/sections/MediaCollectionRenderer.tsx` — TV SDUI card renderer.

## Grep These

- `MediaCollectionBlockSchema`
- `MediaCollectionVariantEnum`
- `mediaCollectionVariant`
- `orientation="vertical"`
- `renderCanvasStringOptionControl`

## What To Build

1. Add `cardOrientation: "horizontal" | "vertical"` to the persisted and generated-draft MediaCollection contracts.
2. Preserve the legacy variant-derived orientation when the new field is omitted so every existing published experience retains its current card shape.
3. Expose the field through Admin GraphQL and the shared Admin media-collection fragment.
4. Add an explicit Admin editor control for the card orientation.
5. Render landscape Web, mobile, and TV cards when the authored value is `"horizontal"`; retain portrait cards for `"vertical"` and each consumer's legacy behavior when the field is omitted.

## Constraints

- Do not overload or rename the existing carousel/grid `variant` contract.
- Do not change card order, links, hover previews, progress, or carousel interaction.
- Card orientation changes the frame, not authored item-image precedence; editors remain responsible for pairing art with the selected shape.
- Regenerate `apps/admin/schema.graphql` and `packages/admin-graphql/src/admin-graphql-env.d.ts`.
- Preserve the existing variant-derived rendering for blocks that omit the new field.

## Rollout

Deploy and live-verify the nullable Admin GraphQL field before deploying Web,
mobile, or TV builds that select it. An older Admin schema rejects the updated
consumer operation as an unknown field.

## Verification

- Focused Admin domain, GraphQL, editor, and experience-normalization tests.
- `pnpm --filter @forge/admin schema:print`.
- `pnpm --filter @forge/admin-graphql generate`.
- Focused Web `MediaCollection.test.tsx` coverage for horizontal and vertical cards.
- Focused mobile and TV adapter/orientation tests for explicit values and legacy fallbacks.
- Admin and Web typecheck/lint for the touched surfaces.
- Browser smoke the authored landscape collection at desktop width and confirm carousel drag remains available.
