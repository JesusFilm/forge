---
id: "feat-046"
title: "Video Vectorization — Recommendations Demo Experience"
owner: "nisal"
priority: "P1"
status: "not-started"
start_date: "2026-06-04"
duration: 7
depends_on:
  - "feat-044"
blocks: []
tags:
  - "web"
  - "cms"
  - "graphql"
---

## Problem

We need a demo frontend to prove the recommendation engine works and to present results for Phase 2 funding decisions. This renders as an Experience on the existing `[slug]/[locale]` route, showing a video with its scene-similar recommendations from other films.

## Entry Points — Read These First

1. `apps/web/src/app/[slug]/[locale]/page.tsx` — experience page route (slug + locale)
2. `apps/web/src/app/[slug]/page.tsx` — experience page route (slug only)
3. `apps/web/src/components/sections/index.tsx` — `SectionRenderer` maps block `__typename` to components
4. `apps/web/src/lib/content.ts` — `getWatchExperience()` fetches experience data via GraphQL
5. `apps/cms/src/api/scene-embedding/services/recommender.ts` — recommendation query API (feat-044)

## Grep These

- `SectionRenderer` in `apps/web/src/components/` — block type mapping
- `__typename` in `apps/web/src/components/sections/` — how block types are resolved
- `getWatchExperience` in `apps/web/src/lib/` — experience data fetching
- `ExperienceSectionRenderer` in `apps/web/src/` — section rendering pipeline

## What To Build

### 1. CMS: Recommendations Block Type

Add a new block type to the Experience content type in Strapi:

- **Block name**: `ComponentBlocksVideoRecommendations`
- **Fields**:
  - `sourceVideo` — relation to Video (the video to get recommendations for)
  - `title` — text (e.g., "Scenes like this")
  - `limit` — integer (default 10, max recommendations to show)

### 2. GraphQL: Expose Recommendations

Extend the Experience GraphQL query to include the new block type. The block fetches recommendations at render time via the recommendation API (feat-044).

### 3. Web: Recommendations Section Component

New component: `apps/web/src/components/sections/VideoRecommendations.tsx`

```typescript
// Renders a grid/carousel of recommended scenes from other videos
// Each card shows:
// - Mux thumbnail at the scene's start timestamp
// - Scene description (truncated)
// - Source video title
// - Similarity score (optional, for demo purposes)
// - Click → navigates to that video at the scene timestamp
```

### 4. Register in SectionRenderer

Add `ComponentBlocksVideoRecommendations` → `VideoRecommendations` mapping in `SectionRenderer`.

### 5. Create Demo Experience in CMS

Create an Experience with slug (e.g., `recommendations-demo`) containing:

- A VideoHero block with a source video
- A VideoRecommendations block for that video
- Accessible at `/recommendations-demo/en`

## Constraints

- Use existing Experience / SectionRenderer pattern — do not create custom routes
- Thumbnails via Mux: `https://image.mux.com/{PLAYBACK_ID}/thumbnail.jpg?time={START_SECONDS}`
- Demo purpose: optimize for clarity and showcasing results, not production polish
- Server Component by default (Next.js App Router convention)

## Verification

- Navigate to `/recommendations-demo/en` → see source video + grid of recommended scenes
- Recommendations are from different videos (not the same film)
- Each recommendation card shows thumbnail, description, and source video title
- Clicking a recommendation navigates to the video (or plays from scene timestamp)
- Page loads in <3s with recommendations visible
