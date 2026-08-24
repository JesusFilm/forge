---
id: "feat-405"
title: "Watch infinite collection feed"
owner: "codex"
priority: "P1"
status: "complete"
start_date: "2026-08-21"
duration: 2
depends_on: []
blocks: []
tags:
  - "web"
  - "admin"
  - "graphql"
---

## Problem

The Watch homepage ends after its manually authored Experience blocks. Viewers
cannot continue discovering database-backed collections without leaving the
page, and editors cannot add a feed that avoids collections already promoted
by earlier homepage sections.

## Entry Points — Read These First

1. `apps/admin/src/domain/blocks.ts` - persisted Experience block schemas and
   the shared media collection item-source contract.
2. `apps/admin/src/graphql/types/video.ts` and
   `apps/admin/src/services/video.service.ts` - public Watch video queries and
   visibility filtering.
3. `apps/admin/src/app/dashboard/experiences/experience-editor/block-helpers.ts`
   and `experience-editor.tsx` - block templates and editor canvas behavior.
4. `apps/web/src/components/home/WatchHomeExperiencePage.tsx` - homepage block
   composition and footer ordering.
5. `apps/web/src/components/sections/index.tsx` and `MediaCollection.tsx` -
   Experience dispatch and the existing carousel presentation.

## Grep These

- `MediaCollectionBlockSchema`
- `ItemsSourceEnum`
- `watchHomeVideos`
- `ExperienceSectionRenderer`
- `mediaDefaultCollectionSlug`
- `IntersectionObserver`

## What To Build

1. Add a `dynamicCollections` media collection item source and an explicit
   editor library template for the homepage infinite feed.
2. Expose a bounded, cursor-paginated public Admin GraphQL feed of visible
   collection parents that have at least three distinct visible playable
   children.
3. Add a read-only Web route under `/watch/api/*` that validates client paging
   input, calls Admin with the server-only consumer bearer, and maps collection
   children into the existing media collection carousel shape.
4. Render the special block as a client-side infinite feed without a separate
   introductory header. Fetch when a sentinel nears the viewport, append
   collection carousels, stop at the end, offer a retry on failure, and prevent
   duplicate in-flight requests.
5. Exclude parent collections and collection cards already featured by authored
   homepage blocks, then continue deduplicating every loaded page client-side.
6. Let editors blacklist collections or individual media through the existing
   media picker. Persist those video IDs on the dynamic block and apply them to
   both parent eligibility and child-card selection on every feed page.

## Constraints

- Keep the Admin bearer server-only; the browser must call the admitted
  same-origin Watch API route and must never receive the bearer.
- Reuse the existing Watch media collection carousel and public route builders.
- Keep batches bounded and deterministic; do not fetch the full catalog on the
  initial homepage request.
- Respect published/deleted/restricted Watch visibility rules for parents and
  children.
- Do not hand-edit generated GraphQL SDL or gql.tada environment artifacts.
- The canonical footer renders after the dynamic feed and remains the final
  homepage element. It becomes reachable when the finite collection catalog is
  exhausted.

## Verification

- Admin domain, service, GraphQL schema, and editor focused tests.
- Web GET transport, exclusion helper, renderer, and homepage focused tests.
- Regenerate `apps/admin/schema.graphql` and
  `packages/admin-graphql/src/admin-graphql-env.d.ts`.
- Run scoped lint, typecheck, formatting, and page-load/bundle evidence for the
  Watch homepage.

## Release prerequisites

- Confirm Cloudflare applies the existing per-client and global admission
  policy to `/watch/api/dynamic-collections` before production release.

The production-like snapshot did not justify a new feed index. PostgreSQL used
the `video` primary-key cursor scan for eligible parents in 1.96 ms and the
existing `video_relation_watch_children_order_idx` for bounded child lookup in
0.11 ms. No migration ships with this feature.
