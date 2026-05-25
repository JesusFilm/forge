---
title: "feat: cut mobile data layer over from Strapi to admin"
type: feat
status: active
date: 2026-05-25
origin: docs/brainstorms/2026-05-25-mobile-admin-data-layer-cutover-requirements.md
---

# feat: cut mobile data layer over from Strapi to admin

## Summary

Rewire mobile's entire data layer from Strapi (`@forge/graphql`) to admin (`@forge/admin-graphql`). Mobile adopts the same typed fragment package web uses, drops the normalizer abstraction, and has renderers consume admin fragment types directly. Admin's block fragments use a flat-video posture (`videoId` only, no nested video join) and a flat container model (`ContainerSlotBlock` markers instead of nested slots), so the migration goes beyond a type swap — four video-bearing renderers and the container renderer need architectural adaptation.

---

## Problem Frame

Mobile reads all content from Strapi, which is being sunset. Web already completed its cutover to admin. Two content sources means duplicate content management and mobile can't access admin-only capabilities (hybrid search, AI metadata, scene recommendations). See origin for the full motivation.

---

## Requirements

- R1. All mobile content fetching reads from admin's GraphQL endpoint. Zero Strapi queries remain.
- R2. Mobile consumes `@forge/admin-graphql` for all typed operations — same package and fragments web uses.
- R3. Mobile calls admin's public queries directly from the device with no authentication header.
- R4. The normalizer layer (`normalizer.ts` and its `kind` discriminant) is removed. Renderers receive admin fragment types directly; the section dispatcher switches on admin `__typename` values.
- R5. Renderers that display video playback navigate admin's `Video` → `VideoLocale` → `VideoDub` → `MuxVideo` hierarchy directly.
- R6. Mobile search switches from Strapi's `SEMANTIC_SEARCH` to admin's public `search` GraphQL query.
- R7. Apollo client reconfigured to point at admin's GraphQL endpoint.
- R8. No special cache migration for existing users. Apollo cache misses on the new schema and re-fetches naturally.
- R9. Mobile's dependency on `@forge/graphql` is removed. The package continues to exist for TV.
- R10. No admin schema, Pothos type, or `schema.graphql` changes.

**Origin actors:** A1 (mobile user), A2 (content author), A3 (mobile developer)
**Origin flows:** F1 (experience load), F2 (video playback), F3 (search)
**Origin acceptance examples:** AE1 (covers R1, R4 — VideoHero \_\_typename dispatch), AE2 (covers R5 — VideoDub hierarchy navigation), AE3 (covers R3, R8 — cache miss on schema change)

---

## Scope Boundaries

- TV app migration — stays on Strapi via `@forge/graphql` until a separate effort.
- Admin schema or Pothos type modifications — mobile conforms to admin's existing shape.
- `@forge/graphql` package deletion or restructuring — still serves TV.
- New mobile features or UI changes — this is a data source swap only.
- Offline-first or cache-warming enhancements.

---

## Context & Research

### Relevant Code and Patterns

- `apps/web/src/lib/content.ts` — web's admin data layer; normalizer functions (`normalizeAdminVideo`, `pickLocalizedName`) that flatten admin's `VideoLocale`/`VideoDub` hierarchy
- `apps/web/src/components/sections/Container.tsx` — `groupAdminContentBySlot()` function that converts admin's flat `content[]` with `ContainerSlotBlock` markers into grouped slots; mobile's container renderer should follow this pattern
- `apps/web/src/components/sections/index.tsx` — web's block dispatcher using admin `__typename` values; documents the flat-video posture and `imageUrl`/`titleOverride` fallback strategy
- `packages/admin-graphql/src/fragments/` — all 19 block fragments + root `AdminWatchExperienceFragment` composition
- `apps/mobile/src/lib/apolloClient.ts` — lazy singleton Apollo client with platform-specific URLs and 15s timeout
- `apps/mobile/src/contexts/ExperienceProvider.tsx` + `ExperienceShell.tsx` — SDUI data flow: query → normalize → dispatch
- `apps/mobile/src/lib/normalizer.ts` — the `__typename` → `kind` mapper being deleted
- `apps/mobile/src/components/sections/SectionDispatcher.tsx` — switches on `kind`; will switch on `__typename`
- `apps/mobile/app/video/[sectionKey].tsx` — video detail route uses `sectionKey` for navigation (not video slug)

### Institutional Learnings

- **JSON locale-keyed name trap** (`docs/solutions/integration-issues/admin-jsonb-locale-map-vs-strapi-string-silent-drop-20260515.md`): Admin's `name: JSON` columns are `Record<string, string>` locale maps, not flat strings. gql.tada types `JSON` as `unknown`, so TypeScript won't catch this. Mobile must adopt a `pickLocalizedName` helper with deterministic locale fallback (en first). The five known `name: JSON` fields are on lines 32, 140, 167, 414 of `apps/admin/schema.graphql`.
- **Dual-pattern callsite sweep** (`docs/solutions/best-practices/graphql-callsite-inventory-dual-pattern-sweep-20260507.md`): Explicitly names `apps/mobile` as affected. Before starting, inventory all GraphQL callsites using BOTH `rg "graphql\(" apps/mobile/src` AND `rg "= gql\`" apps/mobile/src`. Web's migration nearly missed `SCENE_RECOMMENDATIONS`authored as raw`gql` tag.
- **Fragment type anchoring** (`docs/solutions/logic-errors/gql-tada-fragment-anchor-cast-drift-same-fragment-multi-query-20260514.md`): Use `AdminFragmentOf<typeof fragment>` for consumer types, not `AdminResultOf<typeof Query>["path"]`. Prevents cast drift when the same fragment spreads across multiple queries.
- **Env var optionality** (`docs/solutions/runtime-errors/required-env-var-without-default-broke-railway-deploy-20260511.md`): New admin env vars must be `.optional()` in Zod schema. The web migration bricked Railway deploys by making `ADMIN_GRAPHQL_URL` required before provisioning.
- **Metro env var inlining** (`docs/solutions/runtime-errors/metro-env-inlining-eas-update-white-screen-20260410.md`): `process.env.EXPO_PUBLIC_*` references nested in `createEnv()` aren't consistently replaced during EAS Update bundling. Must add module-scope references to force Metro tracking.
- **Consumer bearer not needed for mobile** (`docs/solutions/architecture-patterns/consumer-bearer-rate-limit-identity-pattern-20260513.md`): Each device hits admin from its own IP, so anonymous-IP rate-limit bucket distributes naturally. No bearer token needed.
- **Pothos PUBLIC resolver list** (`docs/solutions/graphql/pothos-public-widening-multi-layer-coordination-20260511.md`): Mobile's available query surface without auth: `experienceBySlug`, `search`, `sceneRecommendations`, `video`, `videoBySlug`, `videos`, `languages`, `countries`, `keywords`, `watchSetting`. Editorial fields return `null` for anonymous callers — not errors.

---

## Key Technical Decisions

- **Flat-video posture — use block-level fields, resolve on demand:** Admin blocks carry `videoId`, `streamingUrl`, and (on carousel/collection items) `imageUrl` — but no nested `video { slug, images }` join. Mobile's navigation already uses `sectionKey` (not video slug), so navigation is unaffected. For poster images (VideoHero), the renderer should derive a Mux thumbnail URL from the `streamingUrl` playback ID or resolve `videoId` → Video at experience load time. Carousel and collection items use the block-level `imageUrl` directly.
- **Container grouping follows web's pattern:** Admin's flat `content[]` with `ContainerSlotBlock` markers is converted to slot groups using the same `groupAdminContentBySlot` approach web uses in `apps/web/src/components/sections/Container.tsx`.
- **React keys without nested item IDs:** Admin fragments lack `id` fields on nested items (carousel items, questions, quotes). Use content-derived keys (e.g., `${item.__typename}-${item.videoId}-${index}`) or index-based keys with stable ordering.
- **Bearer token removed entirely:** Admin's PUBLIC queries need no auth. Drop `EXPO_PUBLIC_STRAPI_TOKEN` from env schema and remove the `Authorization` header from Apollo client config.
- **Shared `pickLocalizedName` helper:** Admin's `name: JSON` fields need locale-map resolution. Share or replicate web's `pickLocalizedName` pattern with deterministic fallback order (en → high-traffic locales).

---

## Open Questions

### Resolved During Planning

- **Does mobile navigate by video slug?** No — mobile routes to `/video/[sectionKey]` using the block's `sectionKey` field, then resolves the full section from `ExperienceProvider.getSectionByKey()`. Admin blocks have `sectionKey`, so navigation is unaffected.
- **Is Apollo cache persisted?** No — mobile uses `InMemoryCache()` only. The CLAUDE.md mention of `apollo3-cache-persist` is stale. Cache clears on app restart; no migration concern.
- **Does mobile search UI need updating beyond the query swap?** No — admin's `search` query returns the same response shape (type, id, slug, title, imageUrl, snippet, startSeconds, playbackId, score). Admin adds optional `label`, `durationSeconds`, `childCount` fields that mobile's `SearchResultCard` ignores.
- **Do any renderers access Strapi-specific fields with no admin equivalent?** Yes — four video-bearing renderers access `video.images` and `video.title` from nested video objects. Admin blocks use flat `videoId` + block-level `imageUrl`/`titleOverride` fallbacks. See U4 for the adaptation strategy.

### Deferred to Implementation

- Exact Mux poster frame URL derivation from `streamingUrl` — depends on the actual URL format at runtime.
- Whether `pickLocalizedName` should be shared from web's `content.ts` or reimplemented locally — depends on package structure preferences.

---

## Implementation Units

### U1. Package dependencies + Apollo client + env configuration

**Goal:** Swap mobile's GraphQL package dependency and reconfigure Apollo to point at admin.

**Requirements:** R2, R3, R7, R9

**Dependencies:** None

**Files:**

- Modify: `apps/mobile/package.json`
- Modify: `apps/mobile/src/env.ts`
- Modify: `apps/mobile/src/lib/apolloClient.ts`
- Modify: `apps/mobile/.env.example`
- Modify: `apps/mobile/.env.production`
- Modify: `apps/mobile/.env.ci`

**Approach:**

- Replace `@forge/graphql` dependency with `@forge/admin-graphql` in `package.json`
- Add `EXPO_PUBLIC_ADMIN_GRAPHQL_URL` as `.optional()` in env schema with module-scope Metro inlining reference at file top (per Metro inlining learning)
- Remove `EXPO_PUBLIC_STRAPI_TOKEN` from env schema — admin's PUBLIC queries need no auth
- Remove `EXPO_PUBLIC_GRAPHQL_URL_IOS` and `EXPO_PUBLIC_GRAPHQL_URL_ANDROID` — admin uses a single endpoint for both platforms
- Update `getApolloClient()` to use the new admin URL, remove the `Authorization` header, keep the 15s timeout and lazy init pattern
- Update `.env.*` files with admin endpoint URLs (dev: `http://127.0.0.1:4100/api/graphql`, prod: admin's production URL)

**Patterns to follow:**

- `apps/web/src/lib/admin-client.ts` for Apollo client setup against admin (minus the bearer — mobile doesn't need it)
- `apps/mobile/src/env.ts` existing `createEnv` pattern with module-scope `EXPO_PUBLIC_*` reads

**Test scenarios:**

- Happy path: Apollo client initializes with admin URL, no auth header present in outgoing requests
- Edge case: `EXPO_PUBLIC_ADMIN_GRAPHQL_URL` unset falls back gracefully (`.optional()` + runtime fallback)
- Edge case: CI builds skip validation when `process.env.CI` is set (existing pattern preserved)

**Verification:**

- `pnpm --filter @forge/mobile typecheck` passes
- Apollo client sends requests to admin endpoint with no `Authorization` header

---

### U2. Experience queries + normalizer removal + ExperienceProvider

**Goal:** Rewrite the experience data fetching pipeline: replace Strapi queries with admin operations, delete the normalizer, and update the ExperienceProvider to work with admin's `ExperienceLocale` shape.

**Requirements:** R1, R2, R4

**Dependencies:** U1

**Files:**

- Rewrite: `apps/mobile/src/lib/queries.ts`
- Delete: `apps/mobile/src/lib/normalizer.ts`
- Modify: `apps/mobile/src/contexts/ExperienceProvider.tsx`
- Modify: `apps/mobile/src/contexts/ExperienceShell.tsx`
- Modify: `apps/mobile/src/hooks/useExperience.ts`
- Create: `apps/mobile/src/lib/pickLocalizedName.ts`
- Test: `apps/mobile/src/lib/__tests__/pickLocalizedName.test.ts`

**Approach:**

- Rewrite `queries.ts` to use `adminGraphql()` from `@forge/admin-graphql` and import `adminWatchExperienceFragment` from `@forge/admin-graphql/fragments`
- Define a `GET_EXPERIENCE_BY_SLUG` operation using `experienceBySlug(locale, slug)` and a `GET_WATCH_SETTING` operation using `watchSetting(locale)` — both spreading the admin root fragment
- Define a `LIST_EXPERIENCES` operation for experience listing (slug, title, metaDescription)
- Delete `normalizer.ts` entirely — no more `kind` discriminant, no more `NormalizedBlock` type
- Update `ExperienceProvider` to store admin's `ExperienceLocale` directly: blocks as `ExperienceBlock[]`, section index keyed by `sectionKey`
- Update `ExperienceShell` to use `GET_WATCH_SETTING` for homepage resolution (replaces Strapi's `isHomepage` filter)
- Create `pickLocalizedName.ts` helper for admin's JSON locale-keyed name fields with deterministic fallback order (en first, then high-traffic locales)

**Execution note:** Start by running the dual-pattern callsite sweep (`rg "graphql\(" apps/mobile/src` AND `rg "= gql\`" apps/mobile/src`) to inventory every GraphQL operation before rewriting.

**Patterns to follow:**

- `packages/admin-graphql/src/fragments/watch-experience.ts` for the root fragment composition
- `apps/web/src/lib/content.ts` `pickLocalizedName()` for the locale helper
- `apps/mobile/src/contexts/ExperienceProvider.tsx` existing section-index `useMemo` pattern (preserved, just with admin types)

**Test scenarios:**

- Happy path: `pickLocalizedName({ en: "English", es: "Español" })` returns `"English"`
- Edge case: `pickLocalizedName({})` returns `undefined` or empty string (no matching locale)
- Edge case: `pickLocalizedName(null)` handles null/undefined gracefully (admin JSON fields may be null)
- Edge case: `pickLocalizedName("plain string")` returns the string as-is (defensive against non-object values)
- Integration: ExperienceProvider fetches from admin's `watchSetting` query and populates the section index from `ExperienceLocale.blocks`

**Verification:**

- `normalizer.ts` is deleted; zero imports of `NormalizedBlock` or `normalizeExperience` remain
- `queries.ts` imports only from `@forge/admin-graphql`, not `@forge/graphql`
- `pnpm --filter @forge/mobile typecheck` passes

---

### U3. Section dispatcher + simple renderers

**Goal:** Update the dispatcher to switch on admin `__typename` values and adapt renderers that need only type-name and field-name changes (no structural data shape differences).

**Requirements:** R4

**Dependencies:** U2

**Files:**

- Modify: `apps/mobile/src/components/sections/SectionDispatcher.tsx`
- Modify: `apps/mobile/src/components/sections/TextRenderer.tsx`
- Modify: `apps/mobile/src/components/sections/RelatedQuestionsRenderer.tsx`
- Modify: `apps/mobile/src/components/sections/BibleQuotesCarouselRenderer.tsx`
- Modify: `apps/mobile/src/components/sections/QuizButtonRenderer.tsx`
- Modify: `apps/mobile/src/components/sections/EasterDatesRenderer.tsx`
- Modify: `apps/mobile/src/components/sections/SectionWrapperRenderer.tsx`

**Approach:**

- Replace `SectionDispatcher`'s `switch (kind)` with `switch (__typename)`: `"VideoHeroBlock"`, `"TextBlock"`, `"SectionBlock"`, etc.
- Remove `classifySection()` helper that detected `sectionWrapper` with video child — admin's blocks make this classification unnecessary since the dispatcher routes on `__typename` directly
- Update renderer prop types from `NormalizedBlock` to the appropriate admin fragment type (e.g., `AdminFragmentOf<typeof adminTextFragment>`) — use `AdminFragmentOf` anchoring per the cast-drift learning
- Adapt field names where admin differs from Strapi (e.g., `SectionBlock.content` vs Strapi's `sectionContent`)
- Update React keys from `${item.kind}-${item.id}-${index}` to `${item.__typename}-${index}` or content-derived keys where item IDs are absent

**Patterns to follow:**

- `apps/web/src/components/sections/index.tsx` `renderAdminBlock()` for admin `__typename` dispatch
- Existing renderer patterns for prop destructuring

**Test scenarios:**

- Covers AE1: Given a `VideoHeroBlock` in the blocks array, the dispatcher matches `__typename === "VideoHeroBlock"` and routes to VideoHeroRenderer
- Happy path: TextRenderer receives `TextBlock` fragment and renders heading, subtitle, contentParagraphs
- Happy path: RelatedQuestionsRenderer renders questions without `id` field (uses index-based keys)
- Happy path: SectionWrapperRenderer processes `SectionBlock.content` (admin's field name) instead of `sectionContent`
- Edge case: Unknown `__typename` is silently skipped (no crash)

**Verification:**

- Zero references to `kind` remain in the dispatcher or renderers
- All simple renderers accept admin fragment types and typecheck

---

### U4. Video-bearing renderers + container renderer

**Goal:** Adapt the four renderers that access nested video objects (VideoHero, VideoCard, VideoCarousel, MediaCollection) to admin's flat-video posture, and rewrite the container renderer for admin's flat content model.

**Requirements:** R4, R5

**Dependencies:** U3

**Files:**

- Modify: `apps/mobile/src/components/sections/VideoHeroRenderer.tsx`
- Modify: `apps/mobile/src/components/sections/VideoCardRenderer.tsx`
- Modify: `apps/mobile/src/components/sections/VideoCarouselRenderer.tsx`
- Modify: `apps/mobile/src/components/sections/MediaCollectionRenderer.tsx`
- Modify: `apps/mobile/src/components/sections/ContainerRenderer.tsx`
- Modify: `apps/mobile/src/lib/types.ts` (update `pickThumbnailUrl` / `VideoRef` type)
- Modify: `apps/mobile/src/components/sections/NavigationCarouselRenderer.tsx`

**Approach:**

- **VideoHeroRenderer:** Remove the nested `video` object access. Use `streamingUrl` for playback (unchanged). For the poster image, derive a Mux thumbnail URL from the playback ID in `streamingUrl`, or resolve `videoId` → Video images. The `sectionKey` field handles CTA navigation (already works without `video.slug`).
- **VideoCardRenderer:** Replace `videoRef.slug`, `videoRef.images`, `videoRef.imageAlt` access with block-level fields: `mediaUrl` for thumbnail, `title`/`titleOverride` for display text. Navigation uses `sectionKey` (unchanged).
- **VideoCarouselRenderer:** Items use block-level `imageUrl` and `titleOverride` instead of nested `items[].video.images` and `items[].video.title`. Navigation uses `sectionKey`.
- **MediaCollectionRenderer:** Items use block-level `imageUrl` and `titleOverride` (already present on admin's `MediaCollectionBlock.items`). Drop `items[].video.*` access.
- **NavigationCarouselRenderer:** Straightforward field mapping. Admin has all needed fields. Use `contentId` + index for React keys (no `id` field on items).
- **ContainerRenderer:** Rewrite to process admin's flat `content[]` array. Implement a `groupBySlotMarker` utility (following web's `groupAdminContentBySlot` pattern) that splits the flat array into slot groups by `ContainerSlotBlock` markers, extracting `gridSpan` and `spans` from each marker. Dispatch each group's content items through the section dispatcher.
- **pickThumbnailUrl / VideoRef:** Update or simplify to work with admin's image fields. May derive from Mux playback ID when block-level `imageUrl` is not available.

**Patterns to follow:**

- `apps/web/src/components/sections/Container.tsx` `groupAdminContentBySlot()` for the slot grouping logic
- `apps/web/src/components/sections/index.tsx` flat-video posture: `titleOverride` and `imageUrl` as primary display fields

**Test scenarios:**

- Covers AE2: VideoCarouselRenderer reads `items[].imageUrl` for thumbnails and `items[].streamingUrl` for playback (flat fields, no nested video object)
- Happy path: VideoHeroRenderer displays poster from Mux thumbnail when `streamingUrl` is present
- Happy path: VideoHeroRenderer falls back to solid background when no image source available
- Happy path: ContainerRenderer groups `[SlotMarker, Text, Video, SlotMarker, Card]` into two slot groups correctly
- Edge case: ContainerRenderer handles content items before the first slot marker (dropped with dev warning, per web's pattern)
- Edge case: Two adjacent `ContainerSlotBlock` markers produce an empty slot group (skipped)
- Edge case: VideoCarousel item with no `imageUrl` shows placeholder
- Integration: MediaCollectionRenderer navigates via `linkToSectionKey` using `router.push`

**Verification:**

- Zero references to `video.slug`, `video.images`, `video.documentId`, `videoRef.*`, or `slotContent` remain
- ContainerRenderer processes admin's flat `content[]` array correctly
- All video-bearing renderers display content using block-level fields only

---

### U5. Search migration + video detail route

**Goal:** Switch mobile search from Strapi's `semanticSearch` to admin's `search` query, and update the video detail route to work with admin's data shape.

**Requirements:** R6, R4

**Dependencies:** U1, U4

**Files:**

- Modify: `apps/mobile/src/lib/queries.ts` (add admin search query — may already be done in U2)
- Modify: `apps/mobile/app/(tabs)/watch.tsx` (search implementation)
- Modify: `apps/mobile/src/components/search/SearchResultCard.tsx`
- Modify: `apps/mobile/app/video/[sectionKey].tsx`
- Modify: `apps/mobile/src/components/sections/ContentDispatcher.tsx`

**Approach:**

- Define admin `SEARCH` query using `adminGraphql()` — same response shape as Strapi's `semanticSearch` (type, id, slug, title, imageUrl, snippet, score, startSeconds, playbackId)
- Update `watch.tsx` to use the new search query — the debounce, pagination, and error handling patterns remain the same
- Update `SearchResultCard` if any field names differ (research shows they're compatible)
- Update `video/[sectionKey].tsx` to remove the `NormalizedBlock` type import and work with admin block types directly. The route's core pattern (read `sectionKey` → lookup via `useSectionByKey` → render) is unchanged
- Update `ContentDispatcher` to dispatch on admin `__typename` values (same pattern as `SectionDispatcher`)

**Patterns to follow:**

- Existing search implementation in `apps/mobile/app/(tabs)/watch.tsx` — preserve debounce, pagination, error handling
- Video detail route's `useSectionByKey` pattern — unchanged

**Test scenarios:**

- Happy path: Search returns results with title, image, snippet from admin's `search` query
- Happy path: Video detail route resolves section by key and renders video player
- Edge case: Search rate-limit error (`RATE_LIMITED` code) surfaces retry message (preserved behavior)
- Edge case: Video detail with invalid `sectionKey` shows "Video not found" error

**Verification:**

- Search queries hit admin's GraphQL endpoint, not Strapi
- Video detail route typechecks without `NormalizedBlock` import

---

### U6. Cleanup, CLAUDE.md update, and verification

**Goal:** Remove all remaining Strapi references, verify zero `@forge/graphql` imports, and update documentation.

**Requirements:** R1, R9

**Dependencies:** U2, U3, U4, U5

**Files:**

- Modify: `apps/mobile/CLAUDE.md`
- Delete (if not already): any remaining Strapi-specific utilities, types, or fragments
- Modify: `apps/mobile/src/lib/types.ts` (remove Strapi-specific type exports)
- Modify: `apps/mobile/src/lib/validateUrl.ts` (if Strapi-specific URL patterns exist)

**Approach:**

- Run comprehensive grep to verify zero Strapi references: `rg "@forge/graphql" apps/mobile/src`, `rg "strapi" apps/mobile/src --ignore-case`, `rg "ComponentSections" apps/mobile/src`
- Run the dual-pattern sweep to confirm all GraphQL callsites use `adminGraphql`: `rg "graphql\(" apps/mobile/src` (should all be `adminGraphql`), `rg "= gql\`" apps/mobile/src` (should return zero)
- Update `apps/mobile/CLAUDE.md`:
  - Stack: `@forge/admin-graphql with gql.tada` (replace `@forge/graphql`)
  - Remove `apollo3-cache-persist` mention (stale — mobile doesn't use it)
  - Architecture: SDUI pipeline reads `Admin GraphQL → gql.tada typed query → dispatcher → renderers` (no normalizer step)
  - Remove normalizer references
  - Update conventions: `Use @forge/admin-graphql for all GraphQL operations`
  - Update common pitfalls as needed

**Test scenarios:**
Test expectation: none — pure cleanup and documentation.

**Verification:**

- `rg "@forge/graphql" apps/mobile/` returns zero matches
- `rg "normalizer\|NormalizedBlock\|normalizeExperience" apps/mobile/src` returns zero matches
- `rg "ComponentSections" apps/mobile/src` returns zero matches
- `pnpm --filter @forge/mobile typecheck` passes
- `pnpm --filter @forge/mobile test` passes (if tests exist)

---

## System-Wide Impact

- **Interaction graph:** ExperienceProvider is the root data source — all renderers and the video detail route depend on it. Changing its data shape cascades to every consumer. The section dispatcher is the routing layer between provider and renderers.
- **Error propagation:** Apollo query errors surface through `useExperience().error` (unchanged pattern). Admin returns `null` for editorial fields on anonymous access — renderers must not treat null editorial fields as errors.
- **State lifecycle risks:** Apollo `InMemoryCache` is ephemeral (no persistence). Schema change causes cache misses, not corruption. The section-key index in ExperienceProvider rebuilds on every query response.
- **API surface parity:** TV app remains on Strapi and is unaffected. Web already reads from admin. After this migration, web and mobile both consume `@forge/admin-graphql`.
- **Integration coverage:** The critical cross-layer scenario is experience load → dispatcher → renderer: admin block `__typename` must match every dispatcher case, and each renderer must handle the admin field shape. Unit tests alone won't prove this end-to-end — run the app against admin's dev endpoint and navigate through an experience.
- **Unchanged invariants:** Admin's GraphQL schema and Pothos types are not modified. `packages/graphql` continues to serve TV unchanged. Web's data layer is not affected.

---

## Risks & Dependencies

| Risk                                                                 | Mitigation                                                                                                                                                                                  |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Admin blocks lack `imageUrl` on VideoHero — poster image unavailable | Derive Mux thumbnail from `streamingUrl` playback ID; fall back to solid background. Web already handles this posture.                                                                      |
| Admin prod database has incomplete experience content vs Strapi      | Content parity is assumed per origin. Verify by loading the homepage experience from admin's prod endpoint before shipping.                                                                 |
| Metro bundler fails to inline new `EXPO_PUBLIC_ADMIN_GRAPHQL_URL`    | Module-scope reference at top of `env.ts` forces Metro tracking (per institutional learning).                                                                                               |
| `@forge/admin-graphql` fragments missing fields mobile needs         | Fragment audit (U2 callsite sweep) catches this before renderer work begins. If gaps exist, extend the shared fragment in `packages/admin-graphql`.                                         |
| Rate limiting — mobile devices share anonymous IP bucket             | Admin's 30 req/min per-IP bucket is per-device on mobile (unlike SSR which shares Railway's NAT). Mobile's request pattern (one experience load + occasional search) is well within budget. |

---

## Documentation / Operational Notes

- Update `apps/mobile/CLAUDE.md` to reflect the new data layer (done in U6).
- No Railway env var changes needed for mobile — mobile is a client-side app, not a Railway service. Env vars are managed via Expo's `.env.*` files and EAS environment configuration.
- No admin-side changes needed — all PUBLIC resolvers mobile needs are already live.
- Root `CLAUDE.md`'s architecture diagram should be updated to show `apps/mobile` consuming `packages/admin-graphql` instead of `packages/graphql`. This can be a follow-up one-liner after the migration PR lands.

---

## Sources & References

- **Origin document:** [docs/brainstorms/2026-05-25-mobile-admin-data-layer-cutover-requirements.md](docs/brainstorms/2026-05-25-mobile-admin-data-layer-cutover-requirements.md)
- Web migration plan: `docs/plans/2026-05-14-001-feat-adapt-web-data-layer-to-admin-plan.md`
- Admin fragment package: `packages/admin-graphql/`
- JSON locale trap: `docs/solutions/integration-issues/admin-jsonb-locale-map-vs-strapi-string-silent-drop-20260515.md`
- Dual-pattern sweep: `docs/solutions/best-practices/graphql-callsite-inventory-dual-pattern-sweep-20260507.md`
- Fragment cast drift: `docs/solutions/logic-errors/gql-tada-fragment-anchor-cast-drift-same-fragment-multi-query-20260514.md`
- Env var optionality: `docs/solutions/runtime-errors/required-env-var-without-default-broke-railway-deploy-20260511.md`
- Metro inlining: `docs/solutions/runtime-errors/metro-env-inlining-eas-update-white-screen-20260410.md`
