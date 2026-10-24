---
title: "Expo Mobile: GraphQL Schema Drift — Stale Video.image Field, Invalid EasterDates Fragment, and React Key Collision"
category: integration-issues
date: 2026-03-24
severity: high
tags:
  - graphql-validation
  - schema-drift
  - mobile-expo
  - strapi-v5
  - dynamic-zone
  - react-key-collision
  - mapper-adapter-pattern
affected_components:
  - apps/mobile/src/lib/graphql/queries.ts
  - apps/mobile/src/lib/sectionMapper.ts
  - apps/mobile/src/lib/sectionModels.ts
  - apps/mobile/src/components/sections/SectionDispatcher.tsx
related_docs:
  - docs/solutions/integration-issues/strapi-v5-manytone-relation-clearing.md
  - docs/solutions/platform/restoring-upstream-ui-verbatim.md
pr: https://github.com/JesusFilm/forge/pull/518
commit: c1994e6
---

# Expo Mobile: GraphQL Schema Drift — Stale Video.image Field, Invalid EasterDates Fragment, and React Key Collision

## Problem

The mobile Expo app failed to load on startup, showing a blank screen with red error text. Strapi CMS rejected the entire `GET_WATCH_EXPERIENCE` GraphQL query at validation time (before execution), so no content rendered at all.

Three distinct errors surfaced:

1. `Cannot query field "image" on type "Video". Did you mean "images" or "imageAlt"?` (repeated 9 times)
2. `Fragment cannot be spread here as objects of type "SectionContentDynamicZone" can never be of type "ComponentSectionsEasterDates"`
3. `Encountered two children with the same key, 12` (React key collision)

## Root Cause

### Bug 1: Stale Video Field Name (Schema Drift)

The CMS `Video` content type was migrated from a singular `image` field (UploadFile) to a plural `images` field (repeatable `ComponentVideoCloudflareImage` array). The web app (`apps/web/`) was updated via the shared `@forge/graphql` package with gql.tada codegen, but the mobile app defines queries **locally** in `apps/mobile/src/lib/graphql/queries.ts` — bypassing codegen entirely. The stale field name caused all 9 Video query locations to fail.

**Why mobile was missed:** The mobile app's local queries have no compile-time connection to the CMS schema. When the CMS schema changed, `packages/graphql` codegen caught it for `apps/web`, but `apps/mobile` continued using the old field name until it crashed at runtime.

### Bug 2: Invalid Dynamic Zone Fragment Spread

`ComponentSectionsEasterDates` is NOT a member of the `SectionContentDynamicZone` union per the CMS schema. It was originally added in a feature branch but reverted in commit `361b67d` as a "bounded context violation." The mobile query still spread it there, causing a GraphQL validation error.

EasterDates IS valid in:

- `ExperienceBlocksDynamicZone` (top-level blocks)
- `ContainerSlotContentDynamicZone` (container slot content)

### Bug 3: Non-Unique React Keys

Strapi component IDs are scoped per component type, not globally unique. Two different component types (e.g., `TextSection` id="12" and `CardSection` id="12") can share the same ID. Using only `item.id` as the React key in `ContentDispatcher` caused collisions.

## Solution

### Fix 1: Update 9 Query Locations

Replace `image { url, alternativeText }` with `images { url }` + `imageAlt`:

```graphql
# Before
heroVideo: video {
  documentId
  slug
  title
  image { url, alternativeText }
}

# After
heroVideo: video {
  documentId
  slug
  title
  imageAlt
  images { url }
}
```

### Fix 2: Mapper Absorbs Shape Transformation

Update `mapVideoModel` to transform `images[]` array back to `UploadFileModel` shape so downstream renderers don't change:

```typescript
function mapVideoModel(video: {
  documentId: string
  slug: string
  title: string
  imageAlt?: string | null
  images?: { url: string }[] | null
}): VideoModel {
  const firstImage = video.images?.[0]
  return {
    documentId: video.documentId,
    slug: video.slug,
    title: video.title,
    image: firstImage
      ? { url: firstImage.url, alternativeText: video.imageAlt ?? null }
      : null,
  }
}
```

**Key design decision:** The mapper absorbs the CMS schema change so `VideoModel.image: UploadFileModel | null` remains unchanged. Renderers (`VideoRenderer`, `VideoHeroRenderer`, `MediaCollectionRenderer`) need zero modifications. This matches the web app's existing pattern.

### Fix 3: Remove Invalid Fragment, Wire Up Valid Path

- Removed `... on ComponentSectionsEasterDates` from SectionContent dynamic zone (invalid per schema)
- Added `EasterDatesSection` to `SectionContent` union type (valid for Container slots)
- Added `ComponentSectionsEasterDates` case to `mapContentItem` function
- Added `easterDates` case to `renderContent` in `SectionDispatcher.tsx`

### Fix 4: Composite React Key

```typescript
// Before — collides when different types share an ID
<View key={item.id}>

// After — globally unique
<View key={`${item.kind}-${item.id}-${index}`}>
```

## Prevention

### 1. Migrate Mobile Queries to Shared Package (Root Cause Fix)

The mobile app previously defined queries locally, bypassing gql.tada codegen. This was the root cause of schema drift. As of 2026-05-25, the mobile data layer cutover (PR #1011) completed this migration — mobile now consumes `@forge/admin-graphql` with typed fragments, making field renames a compile-time error. See `docs/solutions/architecture-patterns/mobile-admin-data-layer-cutover-pattern-20260525.md` for the full migration pattern.

### 2. Validate Dynamic Zone Fragments Against Schema

Before spreading a fragment on a dynamic zone, verify the target type is actually a member of that union. Check the generated schema or `graphql-env.d.ts` introspection types. Strapi's GraphQL plugin silently ignores invalid spreads in some cases but outright rejects them in others.

### 3. Use Composite Keys for Dynamic Zone Content

Strapi component IDs are per-type, not globally unique. Always use composite keys that include the component type discriminant:

```typescript
key={`${item.kind}-${item.id}-${index}`}
```

### 4. Follow the GraphQL Change Flow

> **Superseded (2026-07-23):** Strapi has been removed and replaced by the Admin
> CMS; `apps/cms/` no longer holds content types and the Strapi-bound
> `packages/graphql` client is gone, so the six steps below describe a toolchain
> that no longer exists. The current flow lives under "The GraphQL Change Flow"
> in the root `CLAUDE.md` (Pothos types -> `schema:print` -> `admin-graphql
generate` -> update consumers -> commit the generated artifacts together).
> Sections 2 and 3 above are likewise Strapi dynamic-zone mechanics with no
> Admin CMS equivalent. The incident record above stands as history.

Every CMS schema change requires (per `CLAUDE.md`):

1. Modify content type in `apps/cms/`
2. Run Strapi locally
3. Run codegen in `packages/graphql/`
4. Update queries/mutations/fragments
5. Update consuming code in `apps/web/` **and** `apps/mobile/`
6. Commit generated files alongside source changes

**Never skip step 3.** Stale types are the #1 source of runtime GraphQL errors.

## Files Changed

| File                                                        | Changes                                                                  |
| ----------------------------------------------------------- | ------------------------------------------------------------------------ |
| `apps/mobile/src/lib/graphql/queries.ts`                    | 9 `image` → `images` + `imageAlt`; remove invalid EasterDates spread     |
| `apps/mobile/src/lib/sectionMapper.ts`                      | `mapVideoModel` handles `images[]`; EasterDates case in `mapContentItem` |
| `apps/mobile/src/lib/sectionModels.ts`                      | `EasterDatesSection` added to `SectionContent` union                     |
| `apps/mobile/src/components/sections/SectionDispatcher.tsx` | Composite key; `easterDates` case in `renderContent`                     |
| `apps/mobile/src/lib/sectionMapper.test.ts`                 | Updated fixtures; added EasterDates test coverage                        |

## Related Patterns

- **API response adapter pattern:** See `docs/solutions/platform/restoring-upstream-ui-verbatim.md` — same principle of transforming at the client parse site, not propagating API shape changes to consumers.
- **Strapi v5 relation semantics:** See `docs/solutions/integration-issues/strapi-v5-manytone-relation-clearing.md` — another case of CMS behavior changes requiring careful downstream handling.
