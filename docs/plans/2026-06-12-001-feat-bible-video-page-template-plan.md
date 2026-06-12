---
title: "feat: Add isolated Bible Video page template"
type: "feature"
status: complete
date: 2026-06-12
roadmap: docs/roadmap/topic-experiences/feat-183-bible-video-page-template.md
---

# feat: Add Isolated Bible Video Page Template

## Summary

Add a new app-relative `/bible-video/{slug}.html/{language}.html` route that renders the same initial experience as the existing single-video Watch page. The public URL includes the app base path, so local and production users see `/watch/bible-video/{slug}.html/{language}.html`.

## Problem Frame

Bible Video needs its own route/template surface before design and content changes begin. Today, the only concrete single-video page surface is the generic Watch catch-all route. Editing that route for Bible Video would risk changing all existing single-video pages, so the first slice should establish routing isolation while deliberately preserving the current visual output.

## Requirements

- R1. `/watch/bible-video/{slug}.html/{language}.html` resolves the same video, selected variant, synthetic blocks, transcript, YouVersion passages, feature-flagged CTA copy, Bible Quotes visibility, and question panel state as `/watch/{slug}.html/{language}.html`.
- R2. The existing `/watch/{slug}.html/{language}.html` route keeps its current behavior.
- R3. The Bible Video route owns its own page module and client entrypoint so future Bible Video changes have a local file to modify.
- R4. URL canonicalization preserves the bare `bible-video` prefix and does not reinterpret the route as a three-segment episode URL.
- R5. The proxy admits Bible Video routes only when the underlying video/audio route is valid by the existing Watch route manifest and language slug rules.
- R6. Metadata and locale mismatch redirects stay under the Bible Video route prefix.

## Key Technical Decisions

- KTD1. Model Bible Video as an app-relative route prefix under the existing Watch app base path. This keeps the visible URL at `/watch/bible-video/...` without introducing another deployed app or basePath.
- KTD2. Add a dedicated `bible-video` page module instead of modifying the existing catch-all `renderVideo` branch. The first implementation may reuse shared Watch components, but the route entrypoint is separate.
- KTD3. Add a route builder for Bible Video paths and pass it through the current client shell from a Bible-specific wrapper. This keeps language switches, chapter cards, and share fallbacks on the Bible Video URL shape without changing the default single-video route.
- KTD4. Reuse the existing route manifest's video admission rules. Bible Video is a template variant for the same content, not a new content source.

## Scope Boundaries

In scope:

- Add Bible Video URL parsing/canonicalization/proxy routing.
- Add Bible Video route helpers and focused unit tests.
- Add a dedicated Bible Video page and client wrapper that initially render the existing Watch single-video UI.
- Add route-level metadata and variant canonicalization for the new URL shape.

Out of scope:

- Any visual redesign of the Bible Video page.
- CMS schema, GraphQL operation, or admin changes.
- Migration of existing Watch links to Bible Video links.
- Series episode URL support under the Bible Video prefix unless it naturally falls out of shared single-video behavior.

## Implementation Units

### U1. Add Bible Video URL policy and route builders

- **Goal:** Teach the Watch URL layer that `bible-video` is a first-class prefix, not a series slug.
- **Files:**
  - Modify `apps/web/src/lib/url-shape.ts`
  - Modify `apps/web/src/lib/url-canonicalize.ts`
  - Modify `apps/web/src/proxy.ts`
  - Modify `apps/web/src/lib/routes.ts`
  - Modify `apps/web/src/lib/url-canonicalize.test.ts`
  - Modify `apps/web/src/proxy.test.ts`
  - Modify `apps/web/src/lib/routes.test.ts`
- **Approach:** Introduce a shared `BIBLE_VIDEO_PATH_PREFIX` constant, add `bibleVideoPath`, classify `/bible-video/{slug}.html/{language}.html` as a video-backed route, and special-case canonicalization so the first segment stays bare while content and language segments receive `.html`.
- **Test scenarios:**
  - `/bible-video/jesus/english` redirects to `/bible-video/jesus.html/english.html`.
  - `/bible-video/jesus.html/english.html` rewrites to `/{locale}/{htmlLang}/bible-video/jesus.html/english.html`.
  - Invalid public audio slugs and missing manifest content still 404.
  - `bibleVideoPath` emits the app-relative prefixed route and round-trips through `parseWatchPath`.

### U2. Add isolated Bible Video page entrypoint

- **Goal:** Render the same single-video experience through a separate route module and client wrapper.
- **Files:**
  - Add `apps/web/src/app/[locale]/[htmlLang]/bible-video/[slugSegment]/[localeSegment]/page.tsx`
  - Add `apps/web/src/app/[locale]/[htmlLang]/bible-video/[slugSegment]/[localeSegment]/loading.tsx`
  - Add `apps/web/src/app/[locale]/[htmlLang]/bible-video/[slugSegment]/[localeSegment]/error.tsx`
  - Add `apps/web/src/app/[locale]/[htmlLang]/bible-video/[slugSegment]/[localeSegment]/__tests__/page.test.tsx`
  - Add `apps/web/src/components/watch/BibleVideoPageClient.tsx`
  - Modify `apps/web/src/components/watch/WatchPageClient.tsx`
  - Modify `apps/web/src/components/watch/WatchSectionRenderer.tsx`
  - Modify `apps/web/src/components/watch/SiblingCarousel.tsx`
  - Modify `apps/web/src/components/watch/LanguagePickerModal.tsx`
  - Modify `apps/web/src/components/watch/ShareModal.tsx`
- **Approach:** Copy the current two-segment Watch video rendering behavior into the Bible Video page, with route-local metadata and redirects. Add optional path-builder props to the current client path, defaulting to `watchVideoPath`, and let `BibleVideoPageClient` pass `bibleVideoPath`.
- **Test scenarios:**
  - The Bible Video route resolves a video, merges blocks, and renders `BibleVideoPageClient` with the selected variant and language slug.
  - The Bible Video route redirects language mismatches to `/bible-video/{slug}.html/{actualLanguage}.html`.
  - Metadata uses the video metadata path for a resolved video and falls back safely when the resolver misses.
  - Default single-video client behavior still uses `watchVideoPath` when no custom builder is supplied.

## Verification

- `pnpm --filter @forge/web test -- src/proxy.test.ts src/lib/url-canonicalize.test.ts src/lib/routes.test.ts src/app/[locale]/[htmlLang]/bible-video/[slugSegment]/[localeSegment]/__tests__/page.test.tsx`
- `pnpm --filter @forge/web typecheck`
- Browser smoke with the local Watch dev server:
  - `/watch/bible-video/annas-questions-jesus-authority.html/english.html`
  - Confirm the page visually matches `/watch/annas-questions-jesus-authority.html/english.html`.

## Implementation-Time Unknowns

- Local browser smoke depends on the worktree having the required Watch env (`ADMIN_GRAPHQL_URL`, `WEB_ADMIN_API_KEYS`) or an already-running dev server with those values.

## Completion Notes

- Implemented the Bible Video prefix in route builders, parser tests, canonicalization, and proxy rewrite/admission.
- Added `apps/web/src/app/[locale]/[htmlLang]/bible-video/[slugSegment]/[localeSegment]/page.tsx` plus loading/error boundaries and route tests.
- Added `BibleVideoPageClient` as the Bible-specific client entrypoint and threaded an optional video path builder through Watch client links while preserving the default single-video route builder.
- Verified with focused tests, typecheck, lint, HTTP probes, and `agent-browser` screenshots for both the Bible Video URL and the original single-video URL.
