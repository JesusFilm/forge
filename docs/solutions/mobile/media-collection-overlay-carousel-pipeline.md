---
title: "Media Collection Overlay Carousel — Full Field Pipeline"
category: mobile
date: 2026-03-27
tags:
  [
    graphql,
    carousel,
    overlay-card,
    linearGradient,
    hexToRgba,
    pipeline,
    strapi,
    imageUrl,
    labelOverride,
  ]
module: apps/mobile
severity: high
symptom: "New CMS fields (labelOverride, imageUrl) return null in the mobile app despite being populated in Strapi admin"
root_cause: "GraphQL query has 4 duplicate media-collection-item fragments at different nesting levels with different indentation — field was only added to the first fragment"
---

# Media Collection Overlay Carousel — Full Field Pipeline

## Problem

After adding `labelOverride` and `imageUrl` fields to the `MediaCollectionItem` GraphQL query, the fields returned `null` in the mobile app even though they were populated in the Strapi CMS admin UI. The overlay carousel cards showed no label text and no background images.

## Root Cause

The mobile app's `GET_WATCH_EXPERIENCE` query in `apps/mobile/src/lib/graphql/queries.ts` contains **4 duplicate media-collection-item fragments** at different nesting depths (top-level, inside Container, inside SectionWrapper, and inside nested Container). Each fragment has different indentation levels:

```graphql
# Fragment 1 (top-level) — 12 spaces
            titleOverride
            subtitleOverride
            labelOverride        # ← added here
            collectionSize

# Fragment 2 (inside Container) — 18 spaces
                  titleOverride
                  subtitleOverride
                  collectionSize   # ← labelOverride MISSING

# Fragment 3 (inside SectionWrapper) — 16 spaces
                titleOverride
                subtitleOverride
                collectionSize     # ← labelOverride MISSING

# Fragment 4 (deeply nested) — 22 spaces
                      titleOverride
                      subtitleOverride
                      collectionSize # ← labelOverride MISSING
```

When using an editor's `replace_all` on the pattern `subtitleOverride\n            collectionSize`, only the first fragment matched because the others have different whitespace. The actual data was being served from a nested container fragment (Fragment 2 or 3), so the field came through as `undefined` → mapped to `null`.

## Solution

### 1. Add fields to ALL 4 fragments manually

Search for all occurrences of `subtitleOverride` in the query file and add the new field after each one, respecting the local indentation:

```bash
grep -n "subtitleOverride" apps/mobile/src/lib/graphql/queries.ts
# Returns 4 line numbers — add labelOverride after EACH one
```

### 2. Full pipeline for new CMS fields

When adding a CMS field to the mobile app, update all 4 layers:

| Layer                | File                                     | Change                                                 |
| -------------------- | ---------------------------------------- | ------------------------------------------------------ |
| **GraphQL query**    | `apps/mobile/src/lib/graphql/queries.ts` | Add field to **all 4** media-collection-item fragments |
| **TypeScript model** | `apps/mobile/src/lib/sectionModels.ts`   | Add field to `MediaCollectionItem` interface           |
| **Mapper**           | `apps/mobile/src/lib/sectionMapper.ts`   | Add `fieldName: item.fieldName ?? null`                |
| **Component**        | `*Renderer.tsx`                          | Use the new field                                      |

### 3. Image URL resolution for relative paths

CMS seed data uses relative paths (e.g., `/images/thumbnails/1_jf-0-0-vertical.png`) that are served by the Next.js web app at `basePath: "/watch"`. The mobile app needs a `resolveImageUrl` helper:

```typescript
const WEB_BASE_URL =
  process.env.EXPO_PUBLIC_WEB_BASE_URL ??
  (Platform.OS === "android"
    ? "http://10.0.2.2:3000/watch"
    : "http://localhost:3000/watch")

function resolveImageUrl(url: string | null | undefined): string | null {
  if (url == null) return null
  if (url.startsWith("http://") || url.startsWith("https://")) return url
  if (url.startsWith("/")) return `${WEB_BASE_URL}${url}`
  return null
}
```

Production CMS content should use absolute CDN URLs. Set `EXPO_PUBLIC_WEB_BASE_URL=https://www.jesusfilm.org/watch` in EAS production build profiles.

## Gotchas

1. **`replace_all` is indentation-sensitive.** The 4 query fragments have 12, 18, 16, and 22 spaces of indentation. A bulk find-and-replace will only match fragments with identical whitespace. Always verify with `grep -c` that the expected number of replacements occurred.

2. **Requesting a nonexistent GraphQL field breaks the entire query.** Before adding a field, verify it exists in `apps/cms/schema.graphql` or via GraphiQL introspection. A bad field name causes a blank screen on both iOS and Android.

3. **`imageUrl` vs `imageOverride`:** The CMS item has both — `imageOverride` is a Strapi media relation (with `url` and `alternativeText`), while `imageUrl` is a plain string field. Seed data typically populates `imageUrl` with relative paths; production content uses `imageOverride` with absolute CDN URLs. The resolution chain should be: `imageOverride?.url ?? video?.image?.url ?? imageUrl`.

4. **Shared `hexToRgba` utility at `apps/mobile/src/lib/color.ts`:** Extracted from `BibleQuotesCarouselRenderer`. All carousel renderers that use `LinearGradient` should import from here. Never use the CSS keyword `"transparent"` — it causes dark banding (see `docs/solutions/mobile/linear-gradient-dark-banding-transparent-keyword.md`).

## Prevention

- After adding fields to the GraphQL query, run `grep -c "fieldName" queries.ts` and verify the count matches the number of fragments (currently 4 for media collection items).
- Consider extracting the media-collection-item fields into a GraphQL fragment to avoid duplication. This is blocked by the mobile app using raw `parse()` instead of `gql.tada`, but worth pursuing during a future migration.

## Files

- `apps/mobile/src/lib/graphql/queries.ts` — 4 media-collection-item fragments
- `apps/mobile/src/lib/sectionModels.ts` — `MediaCollectionItem` interface
- `apps/mobile/src/lib/sectionMapper.ts` — `mapMediaCollection` function
- `apps/mobile/src/components/sections/MediaCollectionRenderer.tsx` — `OverlayMediaCard` + `resolveImageUrl`
- `apps/mobile/src/lib/color.ts` — shared `hexToRgba` utility
