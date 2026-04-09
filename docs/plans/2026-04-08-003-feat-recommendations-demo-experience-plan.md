---
title: "feat: Recommendations Demo Experience"
type: feat
status: completed
date: 2026-04-08
origin: docs/roadmap/content-discovery/feat-046-recommendations-demo-experience.md
---

# feat: Recommendations Demo Experience

## Overview

Build a frontend demo that proves the recommendation engine (feat-044) works. A custom demo route enables browsable recommendation chains (click a card → navigate to that video's recommendations). The core `VideoRecommendations` component is also wired into the Experience SectionRenderer for future CMS-authored pages.

## Problem Frame

We need a demo frontend to present recommendation results for Phase 2 funding decisions. The recommendation API (sceneRecommendations) is deployed and returning high-quality results (45ms, 1,965 scenes), but there is no UI to showcase it. The demo must let stakeholders browse through recommendations interactively — click a recommended video, see its recommendations, and continue the chain.

## Requirements Trace

- R1. Demo route at `/demo-recommendations/[slug]/[locale]` shows a video's recommendations
- R2. Each recommendation card shows: thumbnail, video title, similarity score, top themes, description preview, start timestamp
- R3. Clicking a card navigates to `/demo-recommendations/[recommended-slug]/[locale]` (browsable chain)
- R4. Locale toggle (en/es/fr) re-fetches recommendations for the selected locale
- R5. No locale bleed — `/demo-recommendations/jesus/es` only shows videos with Spanish variants
- R6. Recommendations exclude parent-child videos (existing API behavior)
- R7. Page loads in <3s with recommendations visible
- R8. VideoRecommendations component is reusable and registered in SectionRenderer for CMS block integration

## Scope Boundaries

- Demo-quality UI — optimize for clarity and showcasing results, not production polish
- No video player on the demo page — thumbnail hero with metadata only
- No authentication required (public access, same as the API)
- CMS block type creation in Strapi admin is deferred — document how to create it but don't require Strapi admin access during implementation
- No client-side state management beyond locale toggle — each navigation is a full page load (RSC)

## Context & Research

### Relevant Code and Patterns

- `apps/web/src/app/[slug]/[locale]/page.tsx` — existing experience route pattern (RSC, ISR with revalidate=60)
- `apps/web/src/components/sections/index.tsx` — `ExperienceSectionRenderer` maps `__typename` → component
- `apps/web/src/lib/content.ts` — `getWatchExperience()` pattern for GraphQL data fetching with `unstable_cache`
- `apps/web/src/lib/fragments/video-carousel.ts` — fragment pattern for gql.tada typed operations
- `apps/web/src/components/sections/CarouselVideo.tsx` — example section component with thumbnail cards
- `apps/web/src/lib/client.ts` — Apollo client with server-side auth headers
- `apps/web/src/lib/locale.ts` — `SUPPORTED_LOCALES`, `isLocale()`, `DEFAULT_LOCALE`
- `apps/cms/src/graphql/recommendations.ts` — GraphQL extension registration pattern
- `apps/cms/src/api/scene-embedding/services/recommender.ts` — recommendation query service

### Institutional Learnings

- **Server-side RSC fetch**: Use `fetchPolicy: "no-cache"` with Apollo on the server. Use `graphql()` from `@forge/graphql` for typed operations (`docs/solutions/graphql/server-side-strapi-queries-nextjs.md`)
- **ISR caching**: Use route-level `revalidate` + `revalidatePath()` webhook. Never call `headers()` or `cookies()` in page routes — it defeats the Full Route Cache (`docs/solutions/web/nextjs16-cachecomponents-isr.md`)
- **Codegen variable stripping**: `@graphql-codegen/client-preset` strips optional variable definitions from the AST. Verify that gql.tada codegen output includes optional variables after schema changes (`docs/solutions/cms/codegen-strips-optional-graphql-variables.md`)
- **Strapi v5 raw SQL**: Field names are snake-cased in DB. Always verify with `\d tablename` against prod before writing raw SQL
- **Mux data model**: `mux_videos.duration` is always 0 — duration lives on `video_variants.duration`

### External References

- Mux thumbnail URL pattern: `https://image.mux.com/{PLAYBACK_ID}/thumbnail.png?time={SECONDS}&width=480`
- gql.tada documentation for fragment definition and typed query patterns

## Key Technical Decisions

- **Extend sceneRecommendations API to accept slug and return video metadata**: The current API takes `videoId: Int!` (Strapi internal numeric ID) which is not accessible from the web app's GraphQL layer (only documentId/slug are exposed). The API also doesn't return the recommended video's slug or title, which are needed for card display and navigation. Enriching the API is cleaner than N+1 secondary queries from the web layer.
- **Custom demo route alongside SectionRenderer integration**: The demo route enables the browsable chain (each card links to a new recommendations page). The SectionRenderer registration enables future CMS-authored Experience pages. Both share the same `VideoRecommendations` component.
- **Server Component for the demo page**: Full RSC — no client interactivity needed beyond locale navigation (which is just link-based). Thumbnails via Mux URL pattern, not video.js player.
- **Mux thumbnails for cards, Video images for hero**: Recommendation cards use Mux thumbnail URLs (playbackId + startSeconds from the API). The hero/parent video section uses Strapi Video images (the authoritative thumbnail source for the parent).

## Open Questions

### Resolved During Planning

- **How to resolve video slug → numeric videoId?** Resolution: Modify the CMS GraphQL extension to accept `slug: String` as an alternative to `videoId: Int!`. The resolver looks up the numeric ID internally. This avoids exposing Strapi internal IDs to the web layer.
- **How to get video title/slug for recommendation cards?** Resolution: Enrich the `SceneRecommendation` response type with `videoSlug: String!` and `videoTitle: String!`, populated via a JOIN to the `videos` table in the recommender SQL.
- **Locale toggle approach?** Resolution: Simple navigation links — `<a>` tags to the same slug with a different locale segment. No client-side state needed; each locale is a separate RSC render.

### Deferred to Implementation

- **Exact SQL JOIN syntax for enriching recommendations with video slug/title**: The videos table schema needs verification at implementation time (`\d videos`). The slug and title column names may be snake-cased differently than expected.
- **Whether gql.tada codegen handles the schema changes correctly**: Run codegen after CMS changes and verify the generated types include the new optional `slug` variable and enriched response fields.
- **Parent video data fetching strategy**: The demo page hero needs the parent video's title, image, and metadata. This may require a separate `videos(filters: { slug: { eq: $slug } })` query or can be derived from the first recommendation's context.

## High-Level Technical Design

> _This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce._

```
User visits /demo-recommendations/jesus/en
        │
        ▼
[RSC Page Component]
        │
        ├─── Query 1: videos(slug: "jesus") → { title, images, documentId }
        │    (parent video metadata for hero section)
        │
        ├─── Query 2: sceneRecommendations(slug: "jesus", locale: "en", limit: 10)
        │    → [{ videoSlug, videoTitle, description, similarity, themes,
        │        playbackId, startSeconds, ... }]
        │
        ▼
[Page Layout]
  ┌─────────────────────────────────────┐
  │  Locale Toggle: [en] [es] [fr]      │
  ├─────────────────────────────────────┤
  │  Hero: Parent Video                  │
  │  Title + Thumbnail from Strapi       │
  ├─────────────────────────────────────┤
  │  "Similar Scenes" Grid               │
  │  ┌────────┐ ┌────────┐ ┌────────┐  │
  │  │ Card 1 │ │ Card 2 │ │ Card 3 │  │
  │  │ Mux    │ │ Mux    │ │ Mux    │  │
  │  │ thumb  │ │ thumb  │ │ thumb  │  │
  │  │ 92.3%  │ │ 89.1%  │ │ 87.5%  │  │
  │  │ themes │ │ themes │ │ themes │  │
  │  └────────┘ └────────┘ └────────┘  │
  │  Each card links to:                 │
  │  /demo-recommendations/{slug}/{loc}  │
  └─────────────────────────────────────┘
```

## Implementation Units

- [x] **Unit 1: CMS — Extend sceneRecommendations API**

**Goal:** Accept `slug` as input alternative and return video metadata in results, so the web layer can work purely with slugs.

**Requirements:** R1, R2, R3

**Dependencies:** None (builds on existing feat-044 code)

**Files:**

- Modify: `apps/cms/src/graphql/recommendations.ts`
- Modify: `apps/cms/src/api/scene-embedding/services/recommender.ts`
- Modify: `apps/cms/schema.graphql` (auto-generated, but verify after restart)

**Approach:**

- Add `slug: String` parameter to the GraphQL typeDefs (make `videoId` optional: `videoId: Int`)
- Add resolver logic: if slug is provided, look up numeric ID via `SELECT id FROM videos WHERE slug = ? AND published_at IS NOT NULL LIMIT 1`
- Validate that at least one of `videoId` or `slug` is provided
- Add `videoSlug: String!` and `videoTitle: String!` fields to `SceneRecommendation` type
- Enrich the RECOMMENDATIONS_SQL to JOIN against the `videos` table to get slug and title for each recommended video
- Update the `mapRow` function to include the new fields

**Patterns to follow:**

- Existing `recommender.ts` SQL pattern with knex.raw()
- Existing `recommendations.ts` extensionService.use() pattern

**Test scenarios:**

- `sceneRecommendations(slug: "jesus", locale: "en")` returns results with videoSlug and videoTitle populated
- `sceneRecommendations(videoId: 1, locale: "en")` still works (backwards compatible)
- Providing neither slug nor videoId returns an error
- Non-existent slug returns empty results (same as non-existent videoId)

**Verification:**

- GraphQL playground query with slug returns enriched results
- Existing REST and GraphQL consumers are unaffected

---

- [x] **Unit 2: Web — GraphQL query and data fetching**

**Goal:** Define typed GraphQL operations for the demo page: parent video lookup and sceneRecommendations query.

**Requirements:** R1, R5

**Dependencies:** Unit 1 (schema must be updated first, then codegen run)

**Files:**

- Modify: `packages/graphql/` (run codegen to regenerate types from updated schema)
- Create: `apps/web/src/lib/recommendations.ts`

**Approach:**

- Run codegen in `packages/graphql/` to pick up the updated SceneRecommendation type and slug parameter
- Define two typed queries in `apps/web/src/lib/recommendations.ts`:
  1. A video lookup query: `videos(filters: { slug: { eq: $slug } }, locale: $locale)` → title, images, slug
  2. The sceneRecommendations query using the `slug` parameter
- Export typed result types for use in components
- Follow the `getWatchExperience` caching pattern: `unstable_cache` wrapping Apollo queries

**Patterns to follow:**

- `apps/web/src/lib/content.ts` — query definition and caching pattern
- `apps/web/src/lib/fragments/video-section.ts` — fragment definition pattern
- `apps/web/src/lib/client.ts` — Apollo client usage

**Test scenarios:**

- TypeScript compiles cleanly with the new query types
- Query returns expected shape matching SceneRecommendation with videoSlug and videoTitle

**Verification:**

- `pnpm --filter @forge/graphql build` passes
- `pnpm --filter @forge/web typecheck` passes

---

- [x] **Unit 3: Web — VideoRecommendations component**

**Goal:** Build a reusable, server-renderable recommendation card grid component.

**Requirements:** R2, R3, R7

**Dependencies:** Unit 2 (typed query results needed for props)

**Files:**

- Create: `apps/web/src/components/sections/VideoRecommendations.tsx`

**Approach:**

- Server Component (no `'use client'`)
- Accept props: array of recommendation results + current locale
- Render a responsive grid of cards (CSS grid, 1 col mobile → 2 col tablet → 3 col desktop)
- Each card renders:
  - Mux thumbnail via `https://image.mux.com/{playbackId}/thumbnail.png?time={startSeconds}&width=480`
  - Video title (from enriched API response)
  - Similarity score as percentage badge
  - Top 2-3 themes as pills/tags
  - Scene description (truncated to ~2 lines)
  - Start timestamp formatted as MM:SS
- Each card is an `<a>` link to `/demo-recommendations/{videoSlug}/{locale}`
- Use `next/image` for thumbnails with Mux domain in next.config
- Follow existing Tailwind styling conventions (stone-900 backgrounds, white text)

**Patterns to follow:**

- `apps/web/src/components/sections/CarouselVideo.tsx` — card layout and thumbnail rendering pattern
- Tailwind utility classes used throughout existing sections

**Test scenarios:**

- Empty recommendations array renders a "No recommendations found" message
- Cards render with all expected data fields
- Thumbnail URLs are well-formed Mux URLs
- Links point to correct demo-recommendations paths with locale preserved

**Verification:**

- Component renders without hydration errors (it's an RSC)
- Visual inspection: cards display thumbnails, titles, similarity, themes

---

- [x] **Unit 4: Web — Demo route page**

**Goal:** Create the `/demo-recommendations/[slug]/[locale]` route that wires together the parent video hero, recommendations grid, and locale toggle.

**Requirements:** R1, R3, R4, R5, R7

**Dependencies:** Unit 2, Unit 3

**Files:**

- Create: `apps/web/src/app/demo-recommendations/[slug]/[locale]/page.tsx`
- Create: `apps/web/src/app/demo-recommendations/[slug]/[locale]/loading.tsx`

**Approach:**

- Server Component page (async RSC)
- Extract slug and locale from params; validate locale with `isLocale()`, default to `DEFAULT_LOCALE`
- Fetch parent video data via the video lookup query (slug filter)
- Fetch recommendations via `sceneRecommendations(slug, locale, limit: 10)`
- Layout: locale toggle bar → parent video hero section (thumbnail + title, not a video player) → VideoRecommendations grid
- Locale toggle: render links for en/es/fr pointing to `/demo-recommendations/{slug}/{locale}`; highlight current locale
- Export `generateMetadata` for SEO (title: "Recommendations: {video title}")
- Set `revalidate = 60` for ISR
- Add `loading.tsx` with skeleton cards

**Patterns to follow:**

- `apps/web/src/app/[slug]/[locale]/page.tsx` — route structure, params handling, metadata generation
- `apps/web/src/lib/locale.ts` — locale validation

**Test scenarios:**

- `/demo-recommendations/jesus/en` renders JESUS film hero + English recommendations
- `/demo-recommendations/jesus/es` renders Spanish recommendations only
- `/demo-recommendations/nonexistent/en` shows error state
- Clicking a recommendation card navigates to that video's recommendations page
- Locale toggle links correctly change the locale segment

**Verification:**

- Page renders as RSC without client JS for the main content
- Different locales produce different recommendation sets
- The browsable chain works: click card → new page → new recommendations

---

- [x] **Unit 5: Web — Register in SectionRenderer + next.config**

**Goal:** Wire the VideoRecommendations component into the Experience SectionRenderer for future CMS block usage, and configure next/image for Mux domain.

**Requirements:** R8

**Dependencies:** Unit 3

**Files:**

- Modify: `apps/web/src/components/sections/index.tsx`
- Modify: `apps/web/next.config.ts` (or `.mjs`)
- Create: `apps/web/src/lib/fragments/video-recommendations.ts`

**Approach:**

- Add `image.mux.com` to `next.config` images remotePatterns (needed for `next/image` with Mux thumbnails)
- Create a fragment for the VideoRecommendations block type (placeholder — the actual Strapi component doesn't exist yet, but the fragment structure documents the expected shape)
- Add `ComponentBlocksVideoRecommendations` case to the `ExperienceSectionRenderer` switch
- The SectionRenderer version will need to call `sceneRecommendations` at render time using the block's `sourceVideo` relation — this is an async Server Component pattern

**Patterns to follow:**

- Existing switch cases in `apps/web/src/components/sections/index.tsx`
- Fragment files in `apps/web/src/lib/fragments/`

**Test scenarios:**

- SectionRenderer handles `ComponentBlocksVideoRecommendations` without errors
- Unknown block types still fall through to the default console.warn

**Verification:**

- `ExperienceSectionRenderer` compiles with the new case
- Mux thumbnail images load via next/image without domain errors

## System-Wide Impact

- **API surface**: sceneRecommendations GraphQL query gains an optional `slug` parameter and two new response fields (`videoSlug`, `videoTitle`). This is additive and backwards-compatible — existing `videoId` parameter still works.
- **Schema change cascade**: CMS schema.graphql changes → packages/graphql codegen → apps/web types. Standard GraphQL Change Flow (see CLAUDE.md).
- **next/image configuration**: Adding `image.mux.com` to remote patterns affects all `next/image` usage but is purely additive.
- **New route**: `/demo-recommendations/[slug]/[locale]` is independent of existing routes and does not affect the `[slug]/[locale]` experience route.

## Risks & Dependencies

- **Strapi DB column names**: The recommender SQL enrichment JOINs against the `videos` table. Column names may be snake-cased differently than expected in Strapi v5. Mitigate: verify with `\d videos` before writing SQL.
- **Codegen compatibility**: gql.tada must correctly pick up the custom `SceneRecommendation` type (defined in the extension, not in Strapi's auto-generated schema). If codegen doesn't see it, the web app may need to define the type manually. Mitigate: test codegen output after CMS changes.
- **Mux thumbnail availability**: Not all videos may have a Mux playbackId. The recommendation API already filters for this (playbackId is required in the response), but the parent video hero needs a fallback to Strapi images if no Mux data exists.
- **Production data dependency**: The demo requires scene_embeddings to be populated. Currently 1,965 scenes indexed across 467 videos. Phase 1 languages: en, es, fr.

## Sources & References

- **Origin document:** [docs/roadmap/content-discovery/feat-046-recommendations-demo-experience.md](/workspace/docs/roadmap/content-discovery/feat-046-recommendations-demo-experience.md)
- Related feature: feat-044 (Recommendation Query API) — complete on current branch
- Related code: `apps/cms/src/api/scene-embedding/services/recommender.ts`, `apps/cms/src/graphql/recommendations.ts`
- Learnings: `docs/solutions/graphql/server-side-strapi-queries-nextjs.md`, `docs/solutions/web/nextjs16-cachecomponents-isr.md`
- Mux thumbnail docs: `https://image.mux.com/{PLAYBACK_ID}/thumbnail.png?time={SECONDS}&width=480`
