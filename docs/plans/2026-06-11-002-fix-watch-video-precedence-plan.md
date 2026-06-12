---
title: "fix: Prefer Watch video content over slug-colliding experiences"
type: "fix"
status: complete
date: 2026-06-11
roadmap: docs/roadmap/media-generation/feat-054-video-pages-2-0.md
---

# fix: Prefer Watch Video Content Over Slug-Colliding Experiences

## Summary

Two-segment Watch URLs such as `/watch/jesus.html/english.html` should render the video or playlist/series content when a published video-side record exists for the slug. A curated Experience with the same slug must no longer override the video content page.

## Problem Frame

The current catch-all Watch route intentionally gives curated Experiences precedence on two-segment URL shapes. That older rule made topic pages win over generic video fallback, but it now conflicts with the Watch app's video-page contract: when users open a concrete video-language URL, the video or playlist is the primary content.

This plan implements the new precedence rule under `feat-054`, which already tracks the Video/Experience slug-collision audit as outstanding work.

## Requirements

- R1. `/watch/{slug}.html/{language}.html` resolves a playable video before a same-slug Experience.
- R2. `/watch/{slug}.html/{language}.html` resolves a playlist/series before a same-slug Experience, including trailerless series that use the `resolveSeriesBySlug` fallback.
- R3. Same-slug Experiences remain usable only when no video or series/playlist content can render for the two-segment URL.
- R4. One-segment curated Experience/collection pages remain unchanged.
- R5. Metadata generation follows the same video-first precedence as page rendering so HTML, OG, Twitter, and JSON-LD surfaces do not describe a different entity from the rendered page.

## Key Technical Decisions

- KTD1. Keep two-segment route precedence in the catch-all page branch and the shared slug resolver. The page branch owns the distinction between video, trailerless series, and experience fallback after the `.html` URL restructuring; `resolveWatchPage` must still reflect the same video-before-experience rule for template fallback and metadata callers.
- KTD2. Do not change Admin GraphQL or the route manifest shape. The manifest already admits published video, parent/playlist, and root-level experience slugs; the route/resolver layer can decide final precedence.
- KTD3. Keep homepage and one-segment experience behavior separate. `resolveWatchExperiencePage` remains the one-segment curated Experience path, while two-segment slug resolution treats video-side content as authoritative.

## Scope Boundaries

In scope:

- Update `apps/web/src/app/[locale]/[htmlLang]/[...rest]/page.tsx` two-segment rendering and metadata precedence.
- Update focused route tests in `apps/web/src/app/[locale]/[htmlLang]/[...rest]/__tests__/page-routing.test.tsx`.
- Update any directly contradicted docs/comments near the changed behavior.

Out of scope:

- Admin data migration or slug de-duplication.
- Changing one-segment `/watch/{slug}.html` experience routing.
- Changing route manifest generation or GraphQL schema contracts.
- Broad Watch page redesign.

## Implementation Units

### U1. Make two-segment render video-first

- **Goal:** Ensure same-slug videos and series render before curated Experiences.
- **Files:**
  - Modify `apps/web/src/app/[locale]/[htmlLang]/[...rest]/page.tsx`
  - Modify `apps/web/src/lib/content.ts`
  - Modify `apps/web/src/app/[locale]/[htmlLang]/[...rest]/__tests__/page-routing.test.tsx`
  - Modify `apps/web/src/lib/content.test.ts`
- **Approach:** In `renderVideo`, call `resolveWatchVideoBySlug` first, keep the existing locale canonicalization and series/single-video render paths, then call `resolveSeriesBySlug`, and only after both fail call `resolveWatchPage` for experience/template fallback. In `resolveSlugPage`, check the route video record before the Experience lookup; if a route video record exists but cannot render, return the no-content path rather than falling through to a same-slug Experience.
- **Test scenarios:**
  - Same-slug Experience plus playable video renders `WatchPageClient` and does not render Experience blocks.
  - Same-slug Experience plus series renders `SeriesPageClient` and does not render Experience blocks.
  - Same-slug Experience plus trailerless series fallback renders `SeriesPageClient`.
  - When no video/series resolves, the existing Experience fallback still renders.

### U2. Align metadata precedence

- **Goal:** Metadata describes the video or series when the page renders video content.
- **Files:**
  - Modify `apps/web/src/app/[locale]/[htmlLang]/[...rest]/page.tsx`
  - Modify `apps/web/src/lib/content.ts`
  - Modify `apps/web/src/app/[locale]/[htmlLang]/[...rest]/__tests__/page-routing.test.tsx`
  - Modify `apps/web/src/lib/content.test.ts`
- **Approach:** In `generateMetadata` for `shape.kind === "video"`, resolve `resolveWatchVideoBySlug` and `resolveSeriesBySlug` before falling back to `getWatchPageMetadata`.
- **Test scenarios:**
  - Same-slug Experience plus video uses `generateWatchVideoMetadata`.
  - Same-slug Experience plus series uses `generateSeriesMetadata`.
  - Missing video/series still falls back to experience metadata.

## Verification

- `pnpm --filter @forge/web test -- src/app/[locale]/[htmlLang]/[...rest]/__tests__/page-routing.test.tsx`
- Optional browser smoke if local Watch dev server is running: `/watch/jesus.html/english.html`

## Completion Notes

- Updated the two-segment Watch route so playable videos and series/playlist content resolve before same-slug Experiences.
- Updated `resolveWatchPage` so route-video slugs are checked before `experienceBySlug`, including the no-playable-video no-content path.
- Added focused regression coverage for single-video, series, trailerless-series, Experience fallback, and matching metadata precedence.
- Verified with focused route/resolver tests, `@forge/web` typecheck, and `@forge/web` lint.
