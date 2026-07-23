---
id: "feat-262"
title: "Watch home collection CTA destination"
owner: "vlad"
priority: "P2"
status: "complete"
start_date: "2026-07-15"
duration: 1
depends_on: []
blocks:
  - "feat-304"
tags:
  - "platform"
  - "admin"
  - "web"
  - "watch-page"
  - "navigation"
---

## Problem

Media collection sections on the Watch home page default their `Watch` CTA to
the general videos inventory even when every rendered video belongs to one
collection. A Lumo-only section should navigate to the localized Lumo
collection listing unless an editor supplied an explicit CTA destination.

## Entry Points - Read These First

1. `apps/admin/src/graphql/types/blocks.ts` - published block item GraphQL fields.
2. `packages/admin-graphql/src/fragments/blocks/media-collection.ts` - shared
   media collection fragment consumed by Watch.
3. `apps/web/src/components/sections/MediaCollection.tsx` - section CTA and card
   rendering.
4. `apps/web/src/lib/routes.ts` - canonical two-segment Watch URL helpers.

## Grep These

- `MediaCollectionItem`
- `mediaCtaLink`
- `watchHref`
- `WatchHomeExperiencePage`

## What To Build

1. Expose the visible parent collection slug shared by every manual item through
   the Admin GraphQL contract and regenerate the committed schema artifacts.
2. Preserve an explicit Admin `mediaCtaLink` as the highest-priority destination.
3. Otherwise, link to the route collection for route-child sections or to the
   parent collection shared by all rendered manual items.
4. Construct the destination with the active public Watch language slug.
5. Keep the existing inventory fallback for empty, mixed-parent, or unresolved
   sections.

## Constraints

- Do not infer a collection destination when the rendered items do not share a
  single parent.
- Preserve editor-authored CTA labels and links.
- Use DataLoader-backed Admin reads and canonical route helpers; do not add
  per-item database queries or hand-build public URLs.
- Do not hand-edit generated GraphQL environment files.

## Verification

- `pnpm --filter @forge/admin exec vitest run src/graphql/types/blocks.test.ts`
- `pnpm --filter @forge/admin schema:print`
- `pnpm --filter @forge/admin-graphql generate`
- `pnpm --filter @forge/web exec vitest run src/components/sections/MediaCollection.test.tsx`
- Scoped Admin, shared GraphQL, and Web typechecks/lint.
- Confirm the added parent resolution remains DataLoader-batched and does not
  add client hydration or initialization work.

## Completion Notes

- Added block-level `defaultCollectionSlug` inference for manual collections,
  with visible parent relations and parent records resolved through batched
  DataLoaders. Route-child blocks skip the resolver work.
- Watch CTAs now prefer an explicit Admin link, then the current route
  collection or inferred shared parent, and finally `/watch/languages`.
- Collection links use the canonical two-segment URL and active public audio
  language slug.
- Regenerated the Admin schema and shared gql.tada environment.
- Focused Admin tests pass (69), focused Web suites pass (82), shared GraphQL
  typecheck passes, touched Web/shared lint passes, formatting and diff checks
  pass. Full package checks remain affected by unrelated existing diagnostics;
  Admin ESLint also has a pre-existing duplicate plugin configuration error.
