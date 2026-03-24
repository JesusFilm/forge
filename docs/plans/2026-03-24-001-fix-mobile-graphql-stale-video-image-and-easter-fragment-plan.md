---
title: "fix: Mobile app GraphQL errors — stale Video.image field and invalid EasterDates fragment spread"
type: fix
status: active
date: 2026-03-24
---

# fix: Mobile app GraphQL errors — stale Video.image field and invalid EasterDates fragment spread

## Overview

The mobile Expo app fails to load on startup due to two GraphQL validation errors returned by the Strapi CMS:

1. **`Cannot query field "image" on type "Video". Did you mean "images" or "imageAlt"?`** — The CMS `Video` content type was migrated from a singular `image` (UploadFile) field to a plural `images` field (repeatable `ComponentVideoCloudflareImage` component). The mobile queries were never updated.

2. **`Fragment cannot be spread here as objects of type "SectionContentDynamicZone" can never be of type "ComponentSectionsEasterDates"`** — The `EasterDates` component is not registered in the `SectionContentDynamicZone` union, but the mobile query spreads it there.

Both errors cause the entire `GET_WATCH_EXPERIENCE` query to be rejected server-side, rendering the app completely blank on startup.

## Problem Statement / Motivation

This is a P0 — the mobile app is non-functional. Every user who opens the app sees a blank screen with red error text. No content loads because Strapi rejects the entire query at validation time (before execution).

The root cause is schema drift: the CMS content types evolved but the mobile app's locally-defined GraphQL queries were not updated to match. The web app (`apps/web/`) was updated correctly and works fine.

## Proposed Solution

### Bug 1: Video `image` → `images`

**Approach:** Update all 9 query locations from `image { url, alternativeText }` to `images { url }` (matching the web app's pattern). Have the `mapVideoModel` mapper absorb the shape transformation so renderers don't change their model contract.

**Why this approach:**

- The web app already uses `images?.[0]?.url` — proven pattern
- Keeping `VideoModel.image: UploadFileModel | null` unchanged minimizes blast radius (only mapper + queries change, not every renderer)
- `ComponentVideoCloudflareImage` has a `url` field that serves the same purpose as the old `UploadFile.url`

**alternativeText handling:** `ComponentVideoCloudflareImage` has no `alternativeText` field. The `Video` type has a top-level `imageAlt` field — query it and use it as the accessibility text. Fall back to `video.title` in renderers where `imageAlt` is null.

### Bug 2: EasterDates invalid fragment spread

**Approach:** Option B — Remove the invalid `... on ComponentSectionsEasterDates` fragment spread from `SectionContentDynamicZone` (lines 447-455 in `queries.ts`). Do NOT modify the CMS schema.

**Why Option B over Option A (adding to CMS dynamic zone):**

- The CMS change was explicitly reverted in commit `361b67d` as a "bounded context violation"
- EasterDates content is placed inside Container slots in the seed data, not directly in Section content
- The query already has valid EasterDates spreads in `ExperienceBlocksDynamicZone` (line 195) and `ContainerSlotContentDynamicZone` (lines 315, 567)
- Option B is a mobile-only change with zero cross-app risk

**Additional fix:** Ensure the `SectionContent` union type and `mapContentItem` function in `sectionMapper.ts` handle `EasterDatesSection`, since the query requests EasterDates inside Container slots (which IS valid per schema) but the mapper currently silently drops it.

## Technical Considerations

### Data Shape Transformation

The key structural change is:

```
# Old (UploadFile shape)
video {
  image { url, alternativeText }
}

# New (ComponentVideoCloudflareImage shape)
video {
  imageAlt           # ← top-level alt text
  images { url }     # ← array of CloudflareImage objects
}
```

The `mapVideoModel` function in `sectionMapper.ts` should transform `images[0]?.url` back into the existing `UploadFileModel` shape so renderers don't need changes:

```typescript
// sectionMapper.ts — mapVideoModel
const image = video.images?.[0]
  ? { url: video.images[0].url, alternativeText: video.imageAlt ?? null }
  : null
```

### Empty Images Array

If a Video has zero items in the `images` array, `images[0]` is undefined. The mapper must handle this gracefully — set `image: null` in the model. Renderers already handle `video?.image` being null (they show no thumbnail).

### No `packages/graphql` Regeneration Needed

The mobile app defines queries locally in `apps/mobile/src/lib/graphql/queries.ts` — it does NOT use gql.tada from `@forge/graphql`. No codegen step is needed for this fix.

> Note: This is a pre-existing deviation from the convention in `apps/mobile/CLAUDE.md` which says "Use packages/graphql for all GraphQL operations." Aligning mobile to use the shared package is out of scope for this bug fix.

## Acceptance Criteria

- [ ] Mobile app starts without GraphQL errors
- [ ] Video thumbnails render correctly in `VideoRenderer`, `VideoHeroRenderer`, and `MediaCollectionRenderer`
- [ ] EasterDates content renders when placed inside Container slots
- [ ] EasterDates content renders at the top-level experience blocks level
- [ ] No invalid fragment spread errors in GraphQL responses
- [ ] Accessibility: video thumbnail images have alt text (from `imageAlt` or `video.title` fallback)
- [ ] All existing tests pass with updated fixtures
- [ ] `pnpm test` passes in `apps/mobile/`

## Files to Modify

### Queries (9 `image` fixes + 1 EasterDates removal)

| File                                     | Changes                                                                                                                                                                                                                                               |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/mobile/src/lib/graphql/queries.ts` | Replace 9 occurrences of `image { url }` / `image { url, alternativeText }` with `images { url }`. Add `imageAlt` to each Video selection set. Remove `... on ComponentSectionsEasterDates` fragment at lines 447-455 (Section content dynamic zone). |

### Models & Mapper

| File                                   | Changes                                                                                                                                                                             |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/mobile/src/lib/sectionModels.ts` | Add `EasterDatesSection` to `SectionContent` union type (if not already present for Container slot rendering). No change to `VideoModel` — mapper absorbs the shape transformation. |
| `apps/mobile/src/lib/sectionMapper.ts` | Update `mapVideoModel` to read `video.images[0]?.url` and `video.imageAlt`. Add `ComponentSectionsEasterDates` case to `mapContentItem` for Container slot rendering.               |

### Renderers (alt text fallback only)

| File                                                              | Changes                                                                           |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `apps/mobile/src/components/sections/VideoRenderer.tsx`           | Ensure alt text falls back to `video.title` when `image.alternativeText` is null. |
| `apps/mobile/src/components/sections/VideoHeroRenderer.tsx`       | Same alt text fallback. Already partially does this at line 133.                  |
| `apps/mobile/src/components/sections/MediaCollectionRenderer.tsx` | Same alt text fallback.                                                           |

### Tests

| File                                                             | Changes                                                                                                 |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `apps/mobile/src/lib/sectionMapper.test.ts`                      | Update raw GraphQL fixtures from `image: { url, alternativeText }` to `images: [{ url }]` + `imageAlt`. |
| `apps/mobile/src/components/sections/VideoRenderer.test.tsx`     | Update test fixtures.                                                                                   |
| `apps/mobile/src/components/sections/VideoHeroRenderer.test.tsx` | Update test fixtures.                                                                                   |
| `apps/mobile/src/components/sections/SectionDispatcher.test.tsx` | Update test fixtures.                                                                                   |

## Dependencies & Risks

- **No CMS changes required** — this is a mobile-only fix
- **No cross-app impact** — web app already uses `images` correctly
- **Risk: accessibility regression** — mitigated by querying `imageAlt` from Video type and falling back to `video.title`
- **Risk: cached stale data** — if the mobile app persists GraphQL responses, old `image` shape data may crash the mapper. Consider clearing the cache on app update, or adding a defensive check in the mapper.

## Sources & References

- Web app reference for `images` usage: `apps/web/src/lib/fragments/video-hero.ts:16`
- CMS Video schema: `apps/cms/src/api/video/content-types/video/schema.json:188`
- CMS Section dynamic zone: `apps/cms/src/components/sections/section.json:41-55`
- Generated schema: `apps/cms/schema.graphql:2484` (SectionContentDynamicZone union)
- EasterDates revert commit: `361b67d` ("bounded context violation")
- gql.tada introspection: `packages/graphql/src/graphql-env.d.ts:229`
