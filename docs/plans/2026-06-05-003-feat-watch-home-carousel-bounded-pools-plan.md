---
title: Bounded watch home carousel pool endpoint
type: feat
status: active
date: "2026-06-05"
roadmap: docs/roadmap/platform/feat-160-watch-home-carousel-data-parity.md
source_plan: docs/plans/2026-06-05-002-feat-watch-home-carousel-sequence-parity-plan.md
---

# Bounded Watch Home Carousel Pool Endpoint

## Summary

Add a narrow admin GraphQL contract for the watch home TV carousel playlist pools so Forge can load full upstream playlist-only sources without adding every pool source, child relation, and dub to the broad home query. The current `watchHomeVideos` query remains the compact home-section/hero fetch; the new pool query returns parent metadata, playable candidate counts, and bounded playable candidates for the carousel sequence engine.

## Problem Frame

The source-parity carousel sequence now models Core's browser storage, pool cycling, and Mux insert behavior, but its server seed data is limited to videos already needed by the existing home page. Adding the full upstream playlist Core IDs to `watchHomeVideos` can exceed the SSR timeout because that broad query also projects relation and dub fields. `feat-160` tracks this follow-up: preserve upstream playlist-only source parity through a bounded admin pool/count endpoint.

## Requirements

- R1. Keep the existing `/watch` hero, sections, promo, and footer composition unchanged.
- R2. Keep `watchHomeVideos(coreIds)` available for home hero/section rows and do not widen its payload.
- R3. Add an admin-owned public GraphQL read model for carousel pools that accepts ordered Core source IDs and returns one row per requested source in caller order when available.
- R4. Include a playable candidate count per source so the carousel can tell the difference between an empty source, a bounded window, and a missing source.
- R5. Return only a bounded candidate window per source, with a hard max on both requested source count and per-source limit.
- R6. Filter candidates to non-deleted, public-visible, playable videos: published locale for anonymous/consumer callers, published streamable dub, non-deleted language with slug, and optional requested language preference when available.
- R7. Support both collection/series sources with playable children and leaf video sources that are playable themselves.
- R8. Preserve parent slug/coreId metadata for child episodes so public watch links still use `watchEpisodePath(parent, child, audioSlug)`.
- R9. Keep web data access through `@forge/admin-graphql`; regenerate admin SDL and admin-graphql introspection if the schema changes.
- R10. Update web normalization/tests so carousel pools use the bounded pool query while hero/sections still use the broad home query.
- R11. Document remaining admin parity gaps in `feat-160` without claiming playlist/Mux editorial management is finished.

## Scope Boundaries

- This plan does not build admin editor UI for playlist order, Mux inserts, local thumbnail overrides, or per-language fallback rules.
- This plan does not remove the temporary Forge static playlist/Mux config.
- This plan does not re-port Core's below-the-fold `CollectionsRail`.
- This plan does not move Core/Arclight/Algolia runtime dependencies into `apps/web`.
- This plan does not change the client carousel sequence semantics from the previous PR except where richer pool seed data unlocks upstream playlist sources.

## Proposed Contract

Add a public admin query:

```graphql
watchHomeCarouselPools(coreIds: [String!]!, languageSlug: String, limit: Int = 12): [WatchHomeCarouselPoolSource!]!
```

Add object type:

```graphql
type WatchHomeCarouselPoolSource {
  coreId: String!
  source: Video
  playableCount: Int!
  videos: [Video!]!
}
```

Behavior:

- `coreIds` is ordered and capped at the existing `VIDEOS_BY_CORE_IDS_MAX`.
- `limit` is clamped server-side, likely `1...20`, so a caller cannot recreate the original broad overfetch.
- `source` is the parent/leaf admin `Video` when the Core ID exists and is not soft-deleted; null for unknown Core IDs.
- `playableCount` counts playable candidates in the same visibility/playability scope as `videos`.
- `videos` is a bounded ordered window of playable children for collection/series parents; when a source has no playable children and the source itself is playable, it contains the source video.
- Child candidates include enough projected fields through the normal `Video` type for web to normalize cards: id/coreId/slug/label/duration, primary language, images, localized title/snippet, dubs, and parent metadata from the enclosing `source`.

## Implementation Units

### U1. Admin Service Contract

**Goal:** Add `VideoService.getWatchHomeCarouselPools` with bounded count/window semantics.

**Files:**

- `apps/admin/src/services/video.service.ts`
- `apps/admin/src/services/video.service.test.ts`

**Approach:**

- Define a small exported row type, `WatchHomeCarouselPoolSource`, with `coreId`, `source`, `playableCount`, and `videos`.
- Reuse the visibility posture from `videoChildrenFilter`/`getChildDubLanguages`: editor/admin can see every non-deleted child; public/consumer callers require a published child locale.
- Build a reusable playable-video where clause:
  - `deletedAt: null`
  - `dubs.some.deletedAt: null`
  - `dubs.some.published: true`
  - `dubs.some.hls.not: null`
  - `dubs.some.language.deletedAt: null`
  - `dubs.some.language.slug.not: null`
  - If `languageSlug` is present, prefer exact language slug candidates in ordering, while keeping fallback playable candidates available.
- Resolve source records by unique Core ID first, then for each source count/fetch children ordered by relation order and child update/id fallback.
- If a source has no playable child candidates, count/fetch the source itself when it is playable.
- Clamp source count and limit; throw `VideoLookupValidationError` for too many `coreIds`.

**Tests:**

- Ordered sources preserve requested order and unknown sources return an empty/null-source row rather than throwing.
- Collection source returns `playableCount` larger than `videos.length` when the bounded limit is smaller than the candidate set.
- Public callers require child published locales; editor callers do not.
- Candidate filters require published streamable dubs and language slug.
- Leaf playable video falls back into `videos` when there are no playable children.
- `limit` is clamped and too many source IDs raises `VideoLookupValidationError`.

### U2. Admin GraphQL Surface

**Goal:** Expose the service through a public Pothos query and regenerate consumer artifacts.

**Files:**

- `apps/admin/src/graphql/types/video.ts`
- `apps/admin/src/graphql/public-resolvers.regression.test.ts`
- `apps/admin/src/graphql/schema.test.ts`
- `apps/admin/schema.graphql`
- `packages/admin-graphql/src/admin-graphql-env.d.ts`

**Approach:**

- Add an objectRef for `WatchHomeCarouselPoolSource` instead of a Prisma object because it is a service-mediated projection.
- Expose `source` as nullable `Video`, `videos` as non-null list of `Video`, `playableCount` as non-null int, and `coreId` as non-null string.
- Add `watchHomeCarouselPools` with `authScopes: { public: true }`.
- Regenerate SDL via `pnpm --filter @forge/admin schema:print`.
- Regenerate `@forge/admin-graphql` via `pnpm --filter @forge/admin-graphql generate`.

**Tests:**

- Schema root exposes `watchHomeCarouselPools`.
- Public resolver regression includes the new field.
- Generated web operation compiles through gql.tada without hand edits.

### U3. Web Query And Model Wiring

**Goal:** Keep hero/sections on `watchHomeVideos`, but source carousel pools from the new bounded pool query.

**Files:**

- `apps/web/src/lib/fragments/watch-home.ts`
- `apps/web/src/lib/watch-home.ts`
- `apps/web/src/lib/watch-home-config.ts`
- `apps/web/src/lib/__tests__/watch-home.test.ts`

**Approach:**

- Add a `WatchHomeCarouselPoolVideo` fragment reusing the same card fields as `WatchHomeVideo`.
- Add `GetWatchHomeCarouselPools` operation with `coreIds`, `locale`, `languageSlug`, and `limit`.
- Add `getWatchHomeCarouselCoreIds()` that includes every source from `WATCH_HOME_PLAYLIST_SEQUENCE` plus the `shortFilms` seed sources needed for the injected short-film pool.
- Fetch both admin operations server-side in `fetchWatchHomeModel`.
- Refactor `buildWatchHomeModelFromVideos` to accept optional `carouselPoolSources`; build hero/sections from the home videos map and build carousel pools from pool sources when present.
- Keep the previous home-video fallback path for tests and partial admin rollout.
- Include source-level missing-data entries for unknown sources, empty playable counts, and bounded windows when useful for follow-up diagnostics.

**Tests:**

- `resolveWatchHome` calls both GraphQL operations with public language slug and bounded limit.
- Playlist-only source that is absent from `watchHomeVideos` still appears in a carousel pool when returned by `watchHomeCarouselPools`.
- Parent-scoped episode links still use the source slug for child videos.
- Fallback path still builds carousel pools from `watchHomeVideos` when pool data is omitted.
- Blacklisted source/child IDs are filtered from carousel pools.

### U4. Validation And Browser Proof

**Goal:** Prove the endpoint stays bounded, tests pass, and local `/watch` works on desktop and mobile.

**Commands:**

- `pnpm --filter @forge/admin test -- src/services/video.service.test.ts src/graphql/schema.test.ts src/graphql/public-resolvers.regression.test.ts`
- `pnpm --filter @forge/admin schema:print`
- `pnpm --filter @forge/admin-graphql generate`
- `pnpm --filter @forge/admin-graphql typecheck`
- `pnpm --filter @forge/web test -- src/lib/__tests__/watch-home.test.ts src/lib/watch-home-carousel-sequence.test.ts src/components/home/__tests__/useWatchHomeTvCarousel.test.ts`
- `pnpm --filter @forge/web typecheck`
- Local visual smoke against `/watch` desktop and mobile, using Helium if available per repo instructions and an in-app/agent-browser fallback only if Helium is unavailable.

## Risks And Mitigations

- **SSR timeout still occurs if web projects too many fields.** Mitigation: keep `watchHomeVideos` narrow, make the pool query bounded, and project only the same fields needed to normalize carousel video slides.
- **Language-specific filtering could make pools look empty in smaller languages.** Mitigation: prefer requested language in ordering but allow fallback playable dubs; stronger fallback rules stay in `feat-160`.
- **Service query becomes N+1 for many source IDs.** Mitigation: source IDs are capped, per-source windows are bounded, and this intentionally trades a few small queries for avoiding one huge relation/dub payload.
- **Schema changes break consumers if artifacts drift.** Mitigation: regenerate admin SDL and `packages/admin-graphql` in the same PR and run typecheck.

## Done Criteria

- Admin exposes `watchHomeCarouselPools` as a public, bounded query.
- Web `/watch` carousel pools include upstream playlist-only sources without broad `watchHomeVideos` overfetch.
- Hero and below-the-fold sections still render from the existing home data path.
- Targeted admin/web tests and typechecks pass.
- Desktop and mobile `/watch` smoke confirms the carousel and vertical scrolling still work.
