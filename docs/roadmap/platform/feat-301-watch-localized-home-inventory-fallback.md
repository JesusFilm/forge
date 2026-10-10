---
id: "feat-301"
title: "Watch localized home inventory fallback"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-07-23"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "localization"
  - "routing"
---

## Problem

Public one-segment language routes such as `/watch/russian.html` are valid
localized Watch homes even when Admin has no published Homepage Experience for
that locale. The route currently renders its empty or partial home composition
instead of sending viewers to the language's available video catalog.

## Entry Points - Read These First

1. `apps/web/src/app/[locale]/[htmlLang]/[...rest]/page.tsx` - localized-home
   classification and render boundary.
2. `apps/web/src/app/[locale]/[htmlLang]/[...rest]/__tests__/page-routing.test.tsx`
   - one-segment language-home route coverage.
3. `apps/web/src/lib/content.ts` - strict missing-Experience classification.
4. `apps/web/src/lib/routes.ts` - public language-scoped videos route builder.
5. `apps/admin/src/services/watch-setting.service.ts` - strict-null
   per-locale Homepage Experience contract.

## Grep These

- `isLanguageHome`
- `isWatchPageMissingError`
- `resolveWatchPage`
- `languageVideosIndexPath`
- `NEXT_REDIRECT`

## What To Build

1. Redirect a valid custom-language Watch home to
   `/{language}.html/videos` when its locale has no published Homepage
   Experience.
2. Preserve the normal localized home when its published Homepage Experience
   exists.
3. Apply the rule to every admitted public Watch home language slug without
   adding locale-specific branches.
4. Keep operational resolver failures on the existing render/error path rather
   than treating them as missing content.
5. Add focused route regressions for missing, present, and operational-error
   outcomes.

## Constraints

- Use the public language slug from the route and the shared route builder.
- Do not change the canonical `/watch` root.
- Do not change Admin schema or resolver behavior.
- Do not change proxy admission, metadata, sitemap, or revalidation behavior.
- Do not redirect non-language Experiences or valid video and episode routes.
- Do not hand-edit generated GraphQL or locale artifacts.

## Verification

- Focused catch-all route tests cover Russian missing, localized Experience
  present, and non-missing resolver failure.
- Existing one-segment Experience routing remains green.
- Web typecheck, lint, and formatting pass for the touched scope.
- Browser smoke proves `/watch/russian.html` reaches
  `/watch/russian.html/videos` when Russian has no Homepage Experience and that
  a language with a published Homepage Experience still renders normally.
- Browser proof includes final URLs, response status, console errors, and page
  loading state.

## Plan

Implementation plan:
`docs/plans/2026-07-23-003-fix-watch-localized-home-fallback-plan.md`

## Completion Evidence

- The localized-home route redirects only the standard missing-Experience
  result through `languageVideosIndexPath`; published localized Experiences
  and operational-error paths retain their existing behavior.
- The missing sentinel is serialized as a plain `ErrorLike` under a versioned
  Next data-cache key, preserving redirect behavior on cold and warm requests.
- Focused route and resolver coverage proves Russian missing, Spanish present,
  operational failure, and cache serialization.
- Production-backed local smoke returned the Russian redirect on three
  consecutive requests and a non-redirecting Spanish `200` on two consecutive
  requests.
- Browser smoke reached `/watch/russian.html/videos` with Russian localized
  inventory, kept `/watch/spanish.html` on its localized home, and reported no
  console warnings or errors.
- `pnpm --filter @forge/web test` passed 2,311 tests with two existing todos;
  Web typecheck, lint, Prettier, and `git diff --check` passed.
