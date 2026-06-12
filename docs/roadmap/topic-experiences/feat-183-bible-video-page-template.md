---
id: "feat-183"
title: "Bible Video Page Template"
owner: "urim"
priority: "P1"
status: "complete"
start_date: "2026-06-12"
duration: 1
depends_on:
  - "feat-054"
blocks: []
tags:
  - "web"
  - "watch"
  - "video"
---

## Problem

The Watch single-video page is the right visual and data baseline for upcoming Bible Video work, but Bible Video changes need their own route/template surface so future layout and content experiments do not modify the existing single-video page.

## Entry Points - Read These First

1. `apps/web/src/app/[locale]/[htmlLang]/[...rest]/page.tsx` - existing single-video Watch route behavior
2. `apps/web/src/proxy.ts` - public Watch URL classification and internal locale rewrite
3. `apps/web/src/lib/url-canonicalize.ts` - Watch URL normalization rules
4. `apps/web/src/lib/routes.ts` - in-app Watch route builders
5. `apps/web/src/components/watch/WatchPageClient.tsx` - current single-video client shell

## Grep These

- `renderVideo` in `apps/web/src/app/[locale]/[htmlLang]/[...rest]/page.tsx`
- `watchVideoPath` in `apps/web/src/`
- `classifyRewrite` in `apps/web/src/proxy.ts`
- `canonicalizeWatchPath` in `apps/web/src/lib/url-canonicalize.ts`

## What To Build

1. Add a `/bible-video/{slug}.html/{language}.html` app-relative route, visible under the Watch base path as `/watch/bible-video/{slug}.html/{language}.html`.
2. Render the same initial page experience as the existing single-video Watch page.
3. Keep the Bible Video page entrypoint separate from the existing catch-all single-video page so future Bible Video edits can diverge without changing the single-video route.
4. Preserve existing Watch URL safety, language-slug validation, route-manifest admission, metadata, and locale-canonical redirect behavior.

## Constraints

- Do not change the current `/watch/{slug}.html/{language}.html` single-video behavior.
- Do not introduce new GraphQL operations or schema changes.
- Keep public language URL segments in slug form, not message-catalog keys.
- Do not hand-edit generated GraphQL outputs.

## Verification

- `pnpm --filter @forge/web test -- src/proxy.test.ts src/lib/url-canonicalize.test.ts src/lib/routes.test.ts src/app/[locale]/[htmlLang]/bible-video/[slugSegment]/[localeSegment]/__tests__/page.test.tsx`
- `pnpm --filter @forge/web typecheck`
- Browser smoke `/watch/bible-video/annas-questions-jesus-authority.html/english.html` locally when the Watch dev server and required admin env are available.

## Completion Notes

- Added the app-relative `/bible-video/{slug}.html/{language}.html` route, visible as `/watch/bible-video/{slug}.html/{language}.html` because `apps/web` uses `basePath: "/watch"`.
- Kept the existing `/watch/{slug}.html/{language}.html` single-video route on its current path builder while adding a Bible Video wrapper that uses the prefixed path for language switches, chapter cards, share links, metadata, and structured data.
- Updated URL canonicalization and proxy route admission so `bible-video` stays a bare prefix rather than being interpreted as an episode series slug.
- Verified with focused route/proxy/canonicalizer tests, `@forge/web` typecheck, `@forge/web` lint, and local Helium-style browser screenshots against the Bible Video and original single-video URLs.
