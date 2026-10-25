---
date: 2026-05-25
topic: mobile-admin-data-layer-cutover
---

# Mobile Admin Data Layer Cutover

## Summary

Cut the mobile app over from Strapi to admin as its sole content source. Mobile consumes `@forge/admin-graphql` — the same typed fragment package web already uses — drops the normalizer layer, and has renderers work directly with admin's fragment types. No admin schema changes, no fallback path to Strapi.

---

## Problem Frame

The mobile app currently reads all content from Strapi via `@forge/graphql`. Strapi is being sunset. Web already completed its cutover to admin, and now web and mobile read from different content systems — content authors manage two sources, and mobile can't access admin-only capabilities (hybrid search, AI metadata, scene recommendations).

The admin GraphQL surface already exposes every content type mobile needs: all 16 block types have admin equivalents with typed fragments in `@forge/admin-graphql`, and the public queries (`experienceBySlug`, `videoBySlug`, `watchSetting`, `search`) require no authentication. The gap is on the mobile side — queries, types, and rendering code are wired to Strapi's shape.

---

## Actors

- A1. Mobile user: watches content, browses experiences, searches videos
- A2. Content author: manages experiences and video content in admin's editorial UI
- A3. Mobile developer: maintains the mobile app codebase

---

## Key Flows

- F1. Experience load (home + slug pages)
  - **Trigger:** User opens the app or navigates to an experience
  - **Actors:** A1, A2
  - **Steps:** App calls admin's `experienceBySlug` or `watchSetting` query → receives `ExperienceLocale` with typed blocks → section dispatcher routes each block by `__typename` to its renderer → renderer reads admin fragment types directly
  - **Outcome:** Experience renders identically to current Strapi-backed behavior
  - **Covered by:** R1, R2, R3, R4

- F2. Video playback
  - **Trigger:** User taps a video card or hero
  - **Actors:** A1
  - **Steps:** App resolves video via admin's `videoBySlug` query → navigates `Video` → `VideoDub[]` → `MuxVideo` for playback URL → hands to expo-video player
  - **Outcome:** Video plays with correct language variant and HLS stream
  - **Covered by:** R2, R5

- F3. Search
  - **Trigger:** User enters a search query
  - **Actors:** A1
  - **Steps:** App calls admin's public `search` GraphQL query → receives typed results → renders search result list
  - **Outcome:** Search results display with title, image, snippet
  - **Covered by:** R6

---

## Requirements

**Content fetching**

- R1. All mobile content fetching reads from admin's GraphQL endpoint. Zero Strapi queries remain in the mobile app.
- R2. Mobile consumes `@forge/admin-graphql` for all typed operations — the same package and fragments web uses. No mobile-specific GraphQL client package.
- R3. Mobile calls admin's public queries directly from the device with no authentication header. No bearer token, no BFF proxy.

**Rendering**

- R4. The normalizer layer (`normalizer.ts` and its `kind` discriminant pattern) is removed. Renderers receive admin fragment types directly and the section dispatcher switches on admin's `__typename` values.
- R5. Renderers that display video playback navigate admin's `Video` → `VideoLocale` → `VideoDub` → `MuxVideo` hierarchy directly, without an intermediate flattening step.

**Search**

- R6. Mobile search switches from Strapi's `SEMANTIC_SEARCH` query to admin's public `search` GraphQL query.

**Apollo client**

- R7. The Apollo client is reconfigured to point at admin's GraphQL endpoint.
- R8. No special cache migration for existing users. Apollo cache misses on the new schema and re-fetches naturally.

**Package hygiene**

- R9. Mobile's dependency on `@forge/graphql` is removed. The `@forge/graphql` package continues to exist for TV.
- R10. No admin schema, Pothos type, or `schema.graphql` changes. Mobile conforms to admin's existing shape.

---

## Acceptance Examples

- AE1. **Covers R1, R4.** Given a published experience with a VideoHero block, when the app loads the experience, admin returns an `ExperienceLocale` with a `VideoHeroBlock` in its blocks array, and the section dispatcher matches `__typename === "VideoHeroBlock"` to render the hero — no normalizer, no `kind` mapping.
- AE2. **Covers R5.** Given a video with multiple language dubs, when the user views a video detail, the renderer reads `video.dubs` to find the matching `VideoDub` by language, then accesses `dub.hls` for the playback URL and `dub.muxVideo.playbackId` for Mux integration.
- AE3. **Covers R3, R8.** Given a user who updates the app from the Strapi-backed version to the admin-backed version, when the app launches, Apollo's persisted cache misses on the new type names and fetches fresh data from admin without errors or explicit cache clearing.

---

## Success Criteria

- Mobile app renders all existing experience types identically to the current Strapi-backed version, sourced entirely from admin.
- A content author editing an experience in admin sees the change reflected in both web and mobile without touching Strapi.
- No `@forge/graphql` imports remain in `apps/mobile/`.
- The `normalizer.ts` file and `kind` discriminant pattern no longer exist in the mobile codebase.

---

## Scope Boundaries

- TV app migration — stays on Strapi via `@forge/graphql` until a separate effort.
- Admin schema or Pothos type modifications — mobile conforms to admin's existing surface.
- `@forge/graphql` package deletion or restructuring — still serves TV.
- New mobile features or UI changes — this is a data source swap only.
- Apollo cache migration strategy — cache misses and re-fetches naturally.
- Offline-first or cache-warming enhancements — out of scope for this effort.

---

## Key Decisions

- **Reuse `@forge/admin-graphql` over creating a mobile-specific package:** Admin already exposes every block type mobile needs, and the fragment package was designed for multi-consumer use. One package, one set of fragments, two consumers (web + mobile).
- **Drop normalizer over preserving it:** The normalizer exists only because Strapi's `ComponentSections*` type names needed a friendlier discriminant. Admin's type names (`VideoHeroBlock`, `TextBlock`, etc.) are already clean discriminants. Removing the layer means fewer abstractions, fully typed end-to-end, and no mapping to maintain.
- **No authentication required:** Admin's content queries (`experienceBySlug`, `videoBySlug`, `watchSetting`, `search`) are marked `authScopes: { public: true }` in Pothos. Mobile calls them anonymously. Rate limiting uses the shared anonymous IP bucket, which is sufficient for a mobile app's request pattern.
- **No fallback to Strapi:** Strapi is being sunset. No dual-source bridges, no canary reads, no migration harness. Full cutover.

---

## Dependencies / Assumptions

- Admin's public queries (`experienceBySlug`, `videoBySlug`, `watchSetting`, `search`, `sceneRecommendations`) remain publicly accessible without authentication changes during and after this migration.
- The `@forge/admin-graphql` package's `AdminWatchExperienceFragment` and all 19 block fragments cover every field mobile renderers need. If a mobile-specific field is missing from a fragment, the fragment must be extended in the shared package (not forked).
- Admin's production database contains the same experience and video content that Strapi currently serves to mobile. Content parity between Strapi and admin is assumed to already exist or be handled outside this effort.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R2][Needs research] Do any mobile renderers access Strapi-specific fields that have no admin equivalent? A field-by-field audit of each renderer's data access against admin's schema should confirm coverage.
- [Affects R7][Technical] Should mobile's Apollo client use the same `ADMIN_GRAPHQL_URL` env var pattern as web, or hardcode the production URL since mobile is a client-side app with no server environment?
- [Affects R6][Needs research] Does admin's `search` query response shape match what mobile's search UI expects, or does the search results renderer need updating beyond the query swap?
