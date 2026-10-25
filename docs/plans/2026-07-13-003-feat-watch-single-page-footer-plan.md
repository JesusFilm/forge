---
title: "feat: Add the Watch footer to single-video pages"
type: feat
status: completed
date: 2026-07-13
---

# feat: Add the Watch footer to single-video pages

## Summary

Reuse the existing Watch footer on playable single-video pages while keeping it server-rendered and preserving the current homepage, series, and authored-experience behavior.

## Problem Frame

Watch Home ends with the ministry footer, but standalone video and contextual episode routes stop after their player content. Viewers reaching an individual video therefore lose the navigation, social, giving, contact, legal, and newsletter links available on the homepage.

## Requirements

- R1. A playable two-segment single-video route renders the existing Watch footer after its video page content.
- R2. A playable three-segment contextual episode route renders the same footer after its video page content.
- R3. The footer remains outside the client-side player component so this change does not add static footer code to the player bundle or alter player hydration.
- R4. Series landing pages, one-segment pages, builder-authored experience fallbacks, and Watch Home keep their current footer behavior.

## Assumptions

- “Single pages” means routes that render `WatchPageClient`, covering both standalone videos and contextual episodes.
- Series landing pages are collection surfaces rather than single-video pages and remain unchanged.
- The existing `WatchHomeFooter` content and styling are the intended footer; this work does not redesign, localize, or rename it.

## Key Technical Decisions

- **Compose the footer in the catch-all server route:** Place `WatchHomeFooter` beside `WatchPageClient` in the playable video and episode branches so the footer remains a Server Component instead of entering the client bundle.
- **Limit the integration to resolved playable videos:** Add the footer only where route resolution selects `WatchPageClient`; this avoids changing series and authored-experience layouts that have distinct page composition.
- **Cover route shapes at the dispatcher boundary:** Extend the catch-all page routing tests because that boundary owns the decision between video, episode, series, and experience surfaces.

## Implementation Units

### U1. Characterize single-video footer scope

- **Goal:** Add route-level regression expectations for the footer on both playable single-video shapes and its absence on series pages.
- **Requirements:** R1, R2, R4.
- **Dependencies:** None.
- **Files:**
  - `apps/web/src/app/[locale]/[htmlLang]/[...rest]/__tests__/page-routing.test.tsx`
- **Approach:** Give the existing `WatchPageClient` test mock a lightweight DOM marker, then extend the two-segment video, two-segment series, and three-segment episode cases with footer presence and ordering assertions so the route taxonomy is explicit.
- **Execution note:** Start with failing assertions before changing route composition.
- **Patterns to follow:** Reuse the existing `render2Seg` and `render3Seg` helpers and the route-branch regression tests in the same file.
- **Test scenarios:**
  - Resolve a non-series two-segment video, render the page, and expect one `watch-home-footer` element after the mocked player surface.
  - Resolve a three-segment episode with its parent series, render the page, and expect one `watch-home-footer` element.
  - Resolve a two-segment series landing page and expect no `watch-home-footer` element.
- **Verification:** The focused catch-all routing suite fails before U2 and passes after U2 without changing existing route-selection assertions.

### U2. Compose the existing footer after playable video pages

- **Goal:** Render the existing Watch footer after standalone and contextual video page content without changing `WatchPageClient`.
- **Requirements:** R1, R2, R3, R4.
- **Dependencies:** U1.
- **Files:**
  - `apps/web/src/app/[locale]/[htmlLang]/[...rest]/page.tsx`
  - `apps/web/src/app/[locale]/[htmlLang]/[...rest]/__tests__/page-routing.test.tsx`
- **Approach:** Import the existing footer into the server route and append it only to the JSX returned by the resolved video and episode branches. Do not import it into `WatchPageClient` or `SeriesPageClient`.
- **Patterns to follow:** Follow the static footer composition already used by `WatchHomePage` and `WatchHomeExperiencePage`.
- **Test scenarios:**
  - The two-segment video branch renders structured data, the player client, then the footer without duplicating the footer.
  - The three-segment episode branch renders structured data, the player client, then the footer without duplicating the footer.
  - Series and authored-experience branches preserve their current output.
- **Verification:** The focused route tests pass, Web type checking succeeds, and browser smoke confirms the footer follows the content on representative standalone and contextual episode URLs at desktop and mobile widths without shifting initial player rendering.

## Scope Boundaries

- Keep the footer's current copy, links, images, styling, and test identifier.
- Do not add the footer to series landing pages, one-segment pages, language inventory pages, history, embeds, or authored-experience fallbacks.
- Do not move static footer code into the client-side player bundle.

## Sources & Research

- `apps/web/src/components/home/WatchHomeFooter.tsx` — existing static footer and its stable test identifier.
- `apps/web/src/components/home/WatchHomePage.tsx` — current fallback homepage composition.
- `apps/web/src/components/home/WatchHomeExperiencePage.tsx` — current builder-authored homepage composition.
- `apps/web/src/app/[locale]/[htmlLang]/[...rest]/page.tsx` — route dispatcher where both single-video shapes converge on `WatchPageClient`.
- `docs/solutions/best-practices/watch-single-video-template-pages-strapi-nextjs-2026-04-11.md` — established Watch route-resolution and reusable single-video-page pattern.
