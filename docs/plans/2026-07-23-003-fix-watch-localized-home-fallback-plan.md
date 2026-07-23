---
title: "fix: Redirect missing localized Watch homes to language videos"
type: fix
status: complete
date: 2026-07-23
---

# fix: Redirect missing localized Watch homes to language videos

## Summary

Redirect a custom-language Watch home such as `/watch/russian.html` to that
language's All Videos page when no published Homepage Experience exists for the
resolved locale. Preserve the normal localized home when its Homepage
Experience exists.

## Problem Frame

One-segment public language URLs are admitted as localized Watch homes even
when Admin has no published Homepage Experience for the requested locale. The
route currently combines the Web-owned hero with any builder-authored blocks
and renders an empty or partial home when that locale-specific Experience is
missing. Viewers should instead land on the already localized, content-rich
`/{language}.html/videos` inventory.

Admin's public `watchSetting(locale)` contract returns strict null for a missing
or unpublished locale row. The existing Web resolver preserves that distinction
as the standard missing-Experience error, so the route can make this fallback
without changing Admin, the proxy, or language admission.

## Requirements

- R1. A valid one-segment custom-language home with no published Homepage
  Experience for its resolved locale redirects to the same public language
  slug's All Videos page.
- R2. A valid one-segment custom-language home with a published Homepage
  Experience renders through the current localized home composition without a
  redirect.
- R3. The fallback applies to every admitted public Watch home language slug,
  with Russian as the regression example rather than a locale-specific
  exception.
- R4. Redirect destinations use the established public audio-language URL
  builder and retain the `/{language}.html/videos` route shape.
- R5. Non-language one-segment Experiences, two-segment videos, three-segment
  episodes, and the canonical `/watch` root keep their current routing behavior.

## Assumptions

- A non-missing resolver failure means localized Experience availability is
  unknown, so it should retain the existing error/hero behavior rather than
  redirecting viewers as though the Experience were absent.
- An existing localized Homepage Experience remains sufficient to serve the
  language home even when its authored block list is empty, because the
  Web-owned hero is part of the normal composition.
- The redirect remains a render-time decision in the catch-all route; proxy
  admission, canonical metadata, sitemap output, and revalidation paths do not
  need to change.

## Key Technical Decisions

- **Use the resolver's strict missing-Experience signal:** Admin already
  distinguishes an absent published locale row from operational failures, so
  the route should not add another availability query or infer absence from an
  empty block list.
- **Redirect at the localized-home render boundary:** This is the first layer
  that has both the admitted public language slug and the locale-specific
  Homepage Experience result.
- **Build the target through `languageVideosIndexPath`:** The shared route
  builder preserves the public language slug contract and the bare `videos`
  terminal segment.
- **Keep success coverage at the route level:** The catch-all route test can
  prove the missing/present/error branches and the exact redirect target without
  changing lower-level resolver contracts.
- **Keep the missing signal serializable across cache hits:** Cached
  `WatchPageResult` values use a plain `ErrorLike` for the missing-Experience
  sentinel, and the cache key is versioned so older `Error` instances that
  serialized to `{}` cannot suppress the redirect on warm requests.

## Scope Boundaries

- Do not create or publish localized Homepage Experiences as part of this fix.
- Do not add Russian-specific routing or data.
- Do not redirect transient Admin or GraphQL failures to inventory.
- Do not change the All Videos page, language admission maps, proxy rewrites,
  route metadata, or generated GraphQL artifacts.
- Do not alter the canonical `/watch` root's current homepage behavior.

## Acceptance Examples

- AE1. Given `/watch/russian.html` resolves to locale `ru` and Admin returns the
  standard missing-Experience result, requesting the page redirects to
  `/watch/russian.html/videos`.
- AE2. Given `/watch/spanish-castilian.html` resolves to locale `es` and Admin
  returns a published Homepage Experience, requesting the page renders the
  existing localized home with `spanish-castilian` retained as its public
  language slug.
- AE3. Given a localized Homepage Experience lookup fails with a non-missing
  operational error, requesting the language home does not redirect to All
  Videos.

## Implementation Units

### U1. Track the localized-home fallback

- **Goal:** Record the work in the platform roadmap and keep its lifecycle
  aligned with implementation.
- **Requirements:** R1-R5
- **Dependencies:** None
- **Files:**
  - `docs/roadmap/platform/feat-301-watch-localized-home-inventory-fallback.md`
- **Approach:** Create the next platform roadmap ticket with the exact route
  behavior, entry points, constraints, and verification surface. Mark it
  in-progress before route edits and complete only after implementation and
  browser proof.
- **Patterns to follow:** `docs/roadmap/platform/feat-297-watch-home-page-title.md`
  and current Watch platform tickets.
- **Test scenarios:** Test expectation: none -- this unit adds roadmap
  coordination only.
- **Verification:** The ticket describes the all-language rule, links the plan,
  and records completion evidence when the behavior is proven.

### U2. Redirect only missing localized Homepage Experiences

- **Goal:** Add the language-preserving fallback at the localized-home route
  boundary and lock its conditional behavior with regression coverage.
- **Requirements:** R1-R5
- **Dependencies:** U1
- **Files:**
  - `apps/web/src/app/[locale]/[htmlLang]/[...rest]/page.tsx`
  - `apps/web/src/app/[locale]/[htmlLang]/[...rest]/__tests__/page-routing.test.tsx`
  - `apps/web/src/lib/content.ts`
  - `apps/web/src/lib/content.test.ts`
- **Approach:** In the existing one-segment language-home branch, inspect the
  locale-specific Homepage Experience result before composing blocks. Redirect
  only the standard missing-Experience result to the established
  language-scoped videos route. Keep the existing render and error paths for
  present Experiences and non-missing failures. Store the missing sentinel as a
  serializable `ErrorLike` so repeated Next data-cache hits preserve the same
  classification as a cold request.
- **Patterns to follow:** `isWatchPageMissingError` in the same route, public
  language route construction in `apps/web/src/lib/routes.ts`, and the existing
  localized-home dispatch tests beside the route.
- **Test scenarios:**
  1. Covers AE1. Russian with a missing localized Homepage Experience redirects
     to `/russian.html/videos`, even when hero data is otherwise available.
  2. Covers AE2. Spanish with a published localized Homepage Experience renders
     the existing home composition and never calls the redirect boundary.
  3. Covers AE3. A non-missing Homepage Experience resolver failure does not
     redirect to inventory.
  4. Existing one-segment collection coverage continues to resolve as an
     Experience rather than entering localized-home fallback logic.
- **Verification:** Focused route tests pass, Web type checking and linting
  accept the change, and a browser smoke proves both the missing Russian
  redirect and an available localized home without page-loading regression.

## Risks & Dependencies

- The redirect depends on Admin preserving the documented strict-null
  `watchSetting(locale)` contract and Web preserving the standard
  missing-Experience classification.
- A test-only fixture can prove the present/missing split deterministically,
  while browser proof depends on production-backed local Admin data containing
  one language in each state.
- Next.js applies the configured `/watch` base path to app-relative redirects;
  browser verification must confirm the public `Location` and final URL rather
  than relying only on the unit-test target.

## Completion Evidence

- Production-backed Admin reads on 2026-07-23 confirmed `ru` has no Homepage
  Experience while `es` resolves the published `ver-inicio` Experience.
- Three consecutive local requests to `/watch/russian.html` returned `307` with
  `Location: /watch/russian.html/videos`; two consecutive Spanish requests
  returned `200` without redirecting.
- Browser verification reached
  `http://127.0.0.1:3120/watch/russian.html/videos`, rendered
  `lang="ru"` and the localized heading
  `Бесплатные христианские видео. Язык: русский`, and produced no browser
  warnings or errors.
- Browser verification of `/watch/spanish.html` remained on that URL, rendered
  `lang="es"`, and retained the localized Watch home carousel.
- `pnpm --filter @forge/web test` passed 2,311 tests with two existing todos;
  Web typecheck, lint, Prettier, and `git diff --check` also passed.

## Sources & Research

- `apps/web/src/app/[locale]/[htmlLang]/[...rest]/page.tsx` owns one-segment
  localized-home dispatch and already loads the exact public language slug.
- `apps/admin/src/services/watch-setting.service.ts` documents and implements
  strict-null per-locale Homepage Experience resolution.
- `apps/admin/src/graphql/types/watch-setting.ts` exposes the strict-null public
  contract to consumer apps.
- `apps/web/src/lib/routes.ts` provides the canonical
  `languageVideosIndexPath` builder.
- `docs/brainstorms/2026-07-06-watch-home-builder-authored-requirements.md`
  establishes the builder-authored Homepage Experience and the Web-owned hero
  as distinct parts of the home composition.
- `docs/solutions/performance-issues/watch-static-locale-rewrite-route-manifest-admission-20260529.md`
  records the separation between public language slugs, UI locales, and static
  HTML language identities.
