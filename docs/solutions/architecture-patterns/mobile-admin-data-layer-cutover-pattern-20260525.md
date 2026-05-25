---
title: "Mobile data layer migration: Strapi to admin GraphQL (schema adaptation pattern)"
date: "2026-05-25"
category: "architecture-patterns"
module: "apps/mobile, packages/admin-graphql"
problem_type: "architecture_pattern"
component: "data-layer"
severity: "high"
applies_when:
  - "Migrating a React Native/Expo consumer from Strapi to admin's GraphQL surface"
  - "The target schema uses flat-video posture (videoId only, no nested video join)"
  - "Container blocks use flat content[] with ContainerSlotBlock markers instead of nested slots"
  - "Admin stores localized names as JSON locale maps, not flat strings"
  - "Batch resolution is needed for video thumbnails not nested in block fragments"
tags:
  - graphql
  - gql-tada
  - admin
  - migration
  - react-native
  - expo
  - strapi
  - apollo
  - data-layer
  - mobile
related_components:
  - apps/mobile
  - packages/admin-graphql
---

# Mobile data layer migration: Strapi to admin GraphQL (schema adaptation pattern)

## Context

The mobile app (React Native/Expo) migrated its entire data layer from Strapi (`@forge/graphql`) to admin (`@forge/admin-graphql`), mirroring web's earlier cutover. Admin's block fragments use a flat-video posture and a flat container model that differ structurally from Strapi's nested shapes, so the migration goes beyond a package swap -- renderers, the type system, thumbnail resolution, and container rendering all need adaptation.

The web migration (completed 2026-05-14) established the foundational infrastructure (`@forge/admin-graphql` package, typed fragments, CI drift checks). Mobile consumes the same package but faces different runtime constraints: client-side Apollo (no SSR), no bearer token, Expo/Metro bundling, and React Native rendering.

## Guidance

### 1. Flat-video posture: batch-resolve thumbnails

Admin blocks carry `videoId` and `streamingUrl` but no nested `video { images }` join. Renderers that need curated thumbnails must resolve them separately.

Implement a `useVideoThumbnails` hook that:

- Scans the experience tree recursively (top-level blocks, section content, container content, carousel items)
- Collects unique `videoId` values
- Batch-fetches `Video.images` via aliased `video(id:)` queries in a single request
- Returns a `Map<videoId, thumbnailUrl>` for O(1) lookup

Sanitize videoIds with `/^[a-zA-Z0-9_-]+$/` before interpolating into the query string to prevent GraphQL injection. Use `AbortController` with a timeout matching the main Apollo client (15s).

Renderers prefer the curated thumbnail, falling back to `deriveMuxThumbnailUrl(streamingUrl)` while the batch fetch is in flight.

### 2. Container structure: group flat content by slot markers

Strapi used nested `slots[].slotContent[]`. Admin uses flat `content[]` with `ContainerSlotBlock` markers as dividers.

Implement `groupBySlotMarker(content)` that walks the flat array, starts a new slot group on each `ContainerSlotBlock`, and collects subsequent blocks into that group's items. Items before the first marker are dropped with a dev warning (per web's `groupAdminContentBySlot` pattern).

### 3. JSON locale-keyed name fields

Admin's `name: JSON` columns are `Record<string, string>` locale maps, not flat strings. gql.tada types JSON as `unknown`, so TypeScript won't catch misuse.

Implement `pickLocalizedName(value, preferredLocale?)` with deterministic fallback: preferred locale first, then `en`, then high-traffic locales (`es, fr, pt, de, id, ja, ko, ru, th, tr, zh`), then first available value. Handle null, undefined, and plain string inputs defensively.

### 4. Type system: loose AdminBlock for multi-level unions

Admin's block types form different GraphQL unions at each nesting level (top-level `ExperienceBlock`, `SectionContentBlock`, `ContainerContentBlock`). Define a single loose type that works everywhere:

```typescript
export type AdminBlock = { readonly __typename: string } & Record<
  string,
  unknown
>
```

Renderers narrow via `__typename` switch and cast to `Record<string, unknown>` for field access. This matches the existing pattern where every renderer already used `as` casts on the old `NormalizedBlock` type.

### 5. Normalizer deletion: dispatch on \_\_typename directly

Admin's type names (`VideoHeroBlock`, `TextBlock`, `SectionBlock`) are clean discriminants. Delete the normalizer layer entirely -- no more `kind` mapping, no `NormalizedBlock` type. The section dispatcher switches on `block.__typename` directly.

### 6. Authentication: anonymous public queries

Admin's content queries (`experienceBySlug`, `videoBySlug`, `watchSetting`, `search`) are marked `authScopes: { public: true }`. Mobile calls anonymously with no bearer token (unlike web SSR which uses a consumer bearer for rate-limit identity). Each device has its own IP, so the anonymous rate-limit bucket distributes naturally.

### 7. Env var handling for Expo/Metro

New `EXPO_PUBLIC_ADMIN_GRAPHQL_URL` must be `.optional()` in the Zod env schema with a production default fallback. Add a module-scope `process.env.EXPO_PUBLIC_*` read at the top of `env.ts` to force Metro inlining during EAS Update bundling.

## Why This Matters

- **Flat-video batch fetch prevents N+1**: without the hook, each video block triggers its own query. Batching into one request saves round-trips on mobile networks.
- **Slot grouping preserves responsive grid layout**: admin's flat structure is harder to parse but equally expressive. The grouping logic is localizable and testable.
- **Locale picking enables international deployment**: JSON locale maps let content teams maintain translations in one schema. The fallback order ensures no nil renders.
- **Loose AdminBlock reduces type boilerplate**: avoids union explosion and casting gymnastics across three nesting levels.
- **Normalizer deletion simplifies the pipeline**: one fewer transformation layer = one fewer place bugs hide.

## When to Apply

- Migrating a mobile or client-side app from Strapi to admin CMS
- Working with admin's flat container model (slot markers instead of nested arrays)
- Dealing with admin's JSON locale maps instead of flat strings
- Building batch GraphQL queries from CMS-sourced video IDs
- Implementing anonymous access against admin's ABAC-gated public queries

Do NOT apply if still on Strapi (type names differ, no JSON locale maps), or for web apps (SSR context, bearer tokens, different rendering constraints).

## Examples

### Video thumbnail resolution (before/after)

**Before (Strapi):** nested video join provides images inline

```typescript
const thumbnailUrl = pickThumbnailUrl(item.video?.images)
```

**After (Admin):** batch-resolved from ExperienceProvider context

```typescript
const { getVideoThumbnail } = useExperienceContext()
const thumbnailUrl =
  getVideoThumbnail(item.videoId) ?? deriveMuxThumbnailUrl(item.streamingUrl)
```

### Container rendering (before/after)

**Before (Strapi):** iterate nested slots

```typescript
{container.slots.map((slot) => <ContentDispatcher content={slot.slotContent} />)}
```

**After (Admin):** group flat content by slot markers

```typescript
const groups = useMemo(() => groupBySlotMarker(content), [content])
{groups.map((group) => <ContentDispatcher content={group.items} />)}
```

### Section dispatcher (before/after)

**Before (Strapi):** normalize then switch on kind

```typescript
switch (block.kind) {
  case "videoHero": return <VideoHeroRenderer />
  case "sectionWrapper": return <SectionWrapperRenderer />
}
```

**After (Admin):** switch directly on \_\_typename

```typescript
switch (block.__typename) {
  case "VideoHeroBlock": return <VideoHeroRenderer />
  case "SectionBlock": return <SectionWrapperRenderer />
}
```

## Related

- `docs/solutions/architecture-patterns/dual-client-gql-tada-multi-schema-codegen-pattern-20260507.md` -- foundational infrastructure this migration consumes
- `docs/solutions/best-practices/graphql-callsite-inventory-dual-pattern-sweep-20260507.md` -- required pre-migration inventory step
- `docs/solutions/integration-issues/admin-jsonb-locale-map-vs-strapi-string-silent-drop-20260515.md` -- the JSON locale trap this pattern addresses
- `docs/solutions/logic-errors/gql-tada-fragment-anchor-cast-drift-same-fragment-multi-query-20260514.md` -- type anchoring pattern for multi-query fragment consumers
- `docs/plans/2026-05-25-001-feat-mobile-admin-data-layer-cutover-plan.md` -- implementation plan with 6 units
- `docs/brainstorms/2026-05-25-mobile-admin-data-layer-cutover-requirements.md` -- origin requirements
