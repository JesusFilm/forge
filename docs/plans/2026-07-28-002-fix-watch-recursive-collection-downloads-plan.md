---
title: Recursive Watch Collection Downloads - Plan
type: fix
date: 2026-07-28
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
roadmap: docs/roadmap/topic-experiences/feat-322-watch-recursive-collection-downloads.md
---

# Recursive Watch Collection Downloads - Plan

## Goal Capsule

Make the Watch collection download action download every eligible leaf video
inside nested series and collections (for example, Shine Films and nested LUMO
collections), while retaining intent-only metadata loading, opaque download
URLs, and one browser-triggered download at a time.

## Product Contract

### Summary

The existing feature treats the direct children displayed on a series page as
downloadable episodes. That works for a flat series but produces a zero-item
batch when those children are themselves `SERIES` or `COLLECTION` containers.
The button remains visible, so the flow promises a collection download it
cannot perform. The requested behavior is to keep the control and expand
nested containers to their downloadable leaf videos.

### Requirements

- R1. Opening Download collection lazily discovers the languages with at least
  one eligible visible descendant and, for a selected language, every visible,
  reachable leaf video in that language, including leaves beneath nested
  `SERIES` and `COLLECTION` records. It must work when direct children are
  containers with no Dubs of their own.
- R2. The download batch preserves deterministic depth-first editorial order:
  each parent relation's `order` (null last), then relation creation and id;
  the first reachable path wins if a leaf is linked more than once.
- R3. Only published, non-deleted, downloadable Dubs with a usable rendition
  in the selected exact language become candidates. Every intermediate
  traversal hop and leaf uses the caller's existing visibility rule, so a
  public/viewer caller cannot traverse a hidden container to reach a leaf;
  editor/admin visibility remains broader where the current rule permits it.
- R4. Recursive discovery is safe for malformed content graphs: it detects
  cycles, uses a maximum of 8 relation hops, 2,000 generated traversal rows,
  and 1,000 unique leaves (each probed with one additional row), with a
  2-second database statement timeout. A breached guard fails closed with a
  user-actionable unavailable result rather than returning a partial batch
  advertised as complete.
- R5. The Web server action returns only safe metadata needed to construct
  existing opaque download URLs: identifiers, localized/fallback display
  metadata, rendition metadata, server-defined order, skipped-leaf metadata,
  and available languages. Raw download URLs remain server-only and are not
  present in the public GraphQL type, fragment, action result, or logs.
- R6. The existing collection modal selects one language and relative quality,
  displays leaf-neutral localized downloadable/skipped counts and a bounded
  disclosure of up to 100 skipped titles, and triggers downloads sequentially
  through the current redirect/anchor contract. Languages are available when
  at least one leaf can download; the displayed skipped count describes the
  remainder for that language.
- R7. Flat collections retain their existing behavior; the new traversal and
  modal metadata load only after explicit viewer intent.

### Scope Boundaries

- Do not change the single-video download flow, public Watch URLs, auth-gate
  rollout, upstream target validation, or download event behavior.
- Do not add a route-load child/Dub fan-out, browser-side graph traversal,
  ZIP packaging, background downloads, or mobile/TV changes.
- Do not silently truncate a collection when traversal safeguards trigger.

## Planning Contract

### Key Technical Decisions

- KTD-1. Replace the direct-child-only Admin field with a dedicated ordered
  descendant-download result, rather than recursively calling GraphQL from
  Web. A single Admin-owned traversal preserves visibility and ordering and
  keeps bearer use and graph expansion server-side. (session-settled:
  user-approved - chosen over hiding the button for nested collections: the
  requested feature is to download their leaf videos.)
- KTD-2. Traverse `VideoRelation` with a cycle-aware recursive Postgres query,
  enforcing the stated depth and generated-row bounds inside the query and a
  scoped statement timeout. The query carries the relation-order path (order
  null-last, createdAt, id), applies visibility at every hop, probes one row
  past each bound, and identifies leaf rows. Hydrate eligible rows through a
  narrow Prisma `select`, never a GraphQL selection passthrough.
- KTD-3. Return a purpose-built public result envelope: `availableLanguages`,
  `eligibleLeaves`, `skippedLeaves`, and a typed `READY` or
  `TRAVERSAL_LIMIT` outcome. Each eligible leaf has only video/Dub/download
  identifiers, localized-or-fallback display data, rendition metadata, and a
  stable ordinal; each skipped leaf has safe display data and an explicit
  ineligible reason. This prevents raw `VideoDubDownload.url` exposure and
  lets Web build candidates from actual descendants rather than incorrectly
  merging Dub ids onto the root page's direct children.
- KTD-4. The intent-time language projection and selected-language projection
  share exact visibility/deleted/published/downloadable/usable-rendition
  eligibility. Choose one Dub per eligible leaf by duration descending then
  id ascending. Deduplicate by leaf video id using the first depth-first path;
  mirror that video-id dedupe rule defensively at the Web merge boundary.
- KTD-5. Make traversal limits explicit and return a non-success result when
  either guard fires. This favors an honest unavailable state over a partial
  "collection downloaded" claim for unexpected cycles or pathological trees.
- KTD-6. Keep modal discovery intent-only. Its initial server action supplies
  an optional route language, resolves the lazy descendant language list, and
  returns that language's result when possible. If the route language is not
  available, the client selects the first available language and performs one
  follow-up action request. The page-level `childDubLanguages` remains for
  page navigation only and is never the modal's authority.

## Implementation Units

### U1. Add the bounded recursive Admin download projection

- **Requirements:** R1-R5, R7.
- **Files:**
  - `apps/admin/src/services/video.service.ts`
  - `apps/admin/src/services/video.service.test.ts`
  - `apps/admin/src/graphql/types/video.ts`
  - `apps/admin/schema.graphql`
  - `packages/admin-graphql/src/admin-graphql-env.d.ts`
- **Approach:** Introduce a dedicated public `Video` descendant-download
  envelope and explicit safe leaf DTOs, not `VideoDub` fields. On modal intent
  it returns the eligible descendant-language list and, for an optional exact
  language, eligible and skipped leaf rows or `TRAVERSAL_LIMIT`. Use a
  cycle-aware `video_relation` recursive query carrying depth, visited path,
  and relation-order path. Enforce depth/generation/leaf probes and the scoped
  timeout before hydration; apply the direct-child visibility predicate at
  every intermediate and leaf hop. Narrowly select and map display/Dub/
  rendition data after the graph phase; URL columns never enter the DTO.
- **Test scenarios:** flat direct children retain editorial order and the
  duration-desc/id-asc Dub tie break; nested collection -> series -> episode
  paths return leaves in depth-first order; a Shine fixture with container-only
  direct children exposes English and another descendant language; duplicate
  diamond leaves emit once by first path; cycles never recurse indefinitely;
  depth/generated-row/leaf guards and database timeout map to `TRAVERSAL_LIMIT`
  with no partial list; high fan-out is bounded; hidden/deleted/unpublished
  intermediate containers cannot be traversed by a viewer but retain existing
  editor behavior; hidden, wrong-language, non-downloadable, and URL-less
  leaf rows are excluded; public schema tests cannot query a raw URL.

### U2. Consume descendant metadata safely in the lazy Web action and model

- **Requirements:** R2-R7.
- **Files:**
  - `apps/web/src/lib/fragments/watch-video.ts`
  - `apps/web/src/lib/fragments/__tests__/watch-video.test.ts`
  - `apps/web/src/lib/watch-collection-download-actions.ts`
  - `apps/web/src/lib/watch-collection-download-actions.test.ts`
  - `apps/web/src/components/watch/collection-download-options.ts`
  - `apps/web/src/components/watch/collection-download-options.test.ts`
- **Approach:** Query the new ordered descendant projection only from the
  server action after modal intent. Accept an optional selected language to
  make the first request useful, return descendant-derived languages even when
  direct children have no Dubs, and normalize its safe envelope into the
  action model. Reject a guard-limited result distinctly and build candidates
  directly from eligible leaves. Preserve the first server ordinal and mirror
  the video-id dedupe rule defensively before filename/proxy URL construction.
- **Test scenarios:** the GraphQL fragment/action cannot expose raw URLs;
  nested descendant metadata keeps server order; an initial no-language result
  offers nested descendant languages and reloads the selected one; malformed
  slugs avoid an Admin query; guard-limit and upstream failures map to distinct
  stable UI-safe results; flat direct-child fixtures continue to build the
  same candidates; duplicate leaf metadata creates one queue item; quality
  tiers and opaque URL/filename behavior remain unchanged.

### U3. Present recursive results in the collection modal

- **Requirements:** R1, R4, R6, R7.
- **Files:**
  - `apps/web/src/components/watch/CollectionDownloadModal.tsx`
  - `apps/web/src/components/watch/__tests__/CollectionDownloadModal.test.tsx`
  - `apps/web/src/components/watch/SeriesPageClient.tsx`
  - `apps/web/src/components/watch/__tests__/SeriesPageClient.test.tsx`
  - `apps/web/messages/en.json`
  - `apps/web/messages/*.json`
- **Approach:** Stop supplying direct page children as the authoritative
  candidate source; retain them only for the initial collection affordance.
  Seed modal discovery with the route language when valid, then use its lazy
  descendant result for language choices, availability, a bounded skipped-leaf
  disclosure, thumbnails, and queue construction. State contract: loading
  uses a polite live announcement; a transient action failure offers Retry;
  `TRAVERSAL_LIMIT` is an alert/focused unavailable state with Close/support
  recovery and neither Retry nor Start; zero eligible leaves has no Start.
  Use translated leaf-neutral wording ("videos") and announce selected-
  language availability changes politely. Preserve current account-return
  intent, dialog accessibility, and redirect/anchor sequential queue.
- **Test scenarios:** a Shine-shaped nested fixture with direct containers
  offers English and another leaf language and queues leaf videos rather than
  four container rows; zero eligible leaves stays non-startable; transient and
  limit errors have their distinct actions; limit state has no start/retry
  action; language changes reload descendants and announce availability; flat
  fixtures and sign-in return behavior remain unchanged; the skipped disclosure
  is capped at 100 while count remains exact; all catalog message parity checks
  pass.

### U4. Record the follow-up delivery

- **Requirements:** R1-R7.
- **Files:**
  - `docs/roadmap/topic-experiences/feat-322-watch-recursive-collection-downloads.md`
  - `docs/roadmap/README.md`
  - `docs/roadmap/topic-experiences/feat-251-watch-collection-sequential-downloads.md`
- **Approach:** Maintain the existing in-progress `feat-322` ticket, its
  bidirectional link to the direct-child feature, and the delivery reference.
  Mark it complete only after code and verification succeed.

## Verification Contract

| Unit  | Commands                                                                                                                                                                                                                                                                                                               | Done signal                                                                                       |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| U1    | `pnpm --filter @forge/admin test -- src/services/video.service.test.ts`                                                                                                                                                                                                                                                | Recursive ordering, visibility, cycle, and guard cases pass.                                      |
| U1    | `pnpm --filter @forge/admin schema:print` and `pnpm --filter @forge/admin-graphql generate`                                                                                                                                                                                                                            | Committed SDL and typed client match the new public contract.                                     |
| U2-U3 | `pnpm --filter @forge/web test -- src/lib/fragments/__tests__/watch-video.test.ts src/lib/watch-collection-download-actions.test.ts src/components/watch/collection-download-options.test.ts src/components/watch/__tests__/CollectionDownloadModal.test.tsx src/components/watch/__tests__/SeriesPageClient.test.tsx` | Recursive candidates, failures, and existing flat behavior pass.                                  |
| U1-U3 | `pnpm --filter @forge/web typecheck` and `pnpm --filter @forge/web lint`                                                                                                                                                                                                                                               | No Web type or lint regressions.                                                                  |
| U3    | Browser smoke of a nested collection with a client-side modal control                                                                                                                                                                                                                                                  | The dialog loads descendants only after click, offers eligible leaves, and has no browser errors. |

## Definition of Done

- Shine Films and comparable nested LUMO/NUA collections can batch-download
  their eligible leaf videos in deterministic order.
- Cyclic or over-limit graphs never produce a silently partial download.
- Direct collections, single-video downloads, account gating, and redirect
  downloads retain their existing behavior.
- The Admin schema/client artifacts and focused validation pass.
