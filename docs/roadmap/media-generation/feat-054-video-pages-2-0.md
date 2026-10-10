---
id: "feat-054"
title: "Video Pages 2.0"
owner: "vlad"
priority: "P1"
status: "in-progress"
start_date: "2026-04-21"
duration: 14
depends_on: []
blocks:
  - "feat-061"
tags:
  - "web"
  - "cms"
  - "video"
---

> **Status note (2026-04-30):** in-progress. PR #860 (`feat/watch-page-mux-parity`, contributor: urim) ships the dedicated `/watch/[video]/[locale]` page with Mux Player + Experience-vocabulary parity, video-by-slug resolver with 4-tier locale-aware variant selection, and the synthetic-block / Experience-override merge layer. Verification criteria 1 ("single video page can render from CMS-backed data end to end") and partial 3 ("consistent across default and localized routes") are met. Outstanding for `complete`:
>
> - Subtitle data on the page contract — the new `WatchVideo` fragment doesn't project `Video.subtitles[]` yet (verification criterion 2 partial)
> - Migration plan for any production 3-segment `/watch/[collection]/[video]/[locale]` URLs that may have indexed/inbound traffic (constraint: "Preserve existing watch-page URLs or add a clear migration plan")
> - Body-zone wrapper extraction from `Section.tsx` (extensibility — verification criterion 4)
> - Hardcoded English strings in `WatchStudyQuestions` / `BibleQuotesSection` (CMS-driven copy)
> - Video/Experience slug-collision precedence audit — addressed in the route layer by `docs/plans/2026-06-11-002-fix-watch-video-precedence-plan.md`: two-segment Watch video/playlist URLs now win over same-slug Experiences.
> - Resolver / route-level test coverage
>
> Ownership: ticket carries `vlad`; the PR contributor is urim. Coordinate before flipping `status: complete`.

## Problem

The watch experience still centers on route-specific page logic instead of a single CMS-driven video page model. We need a next-generation single-video page that pulls its content from CMS so layout, metadata, subtitles, related modules, and future upgrades can evolve through one consistent contract.

## Entry Points — Read These First

1. `apps/web/src/app/[slug]/page.tsx` — current watch route implementation
2. `apps/web/src/app/[slug]/[locale]/page.tsx` — localized watch route variant
3. `apps/web/src/lib/content.ts` — GraphQL queries and watch-page mapping
4. `apps/web/src/lib/fragments/video-section.ts` — video section data contract
5. `apps/web/src/components/sections/Video.tsx` — main player implementation
6. `apps/cms/src/api/video/content-types/video/schema.json` — CMS source for single-video content

## Grep These

- `GetWatchExperience|experienceToMetadata` in `apps/web/src/lib/content.ts`
- `videoRef|streamingUrl` in `apps/web/src/lib/fragments/`
- `VideoHero|Video` in `apps/web/src/components/sections/`
- `video` in `apps/cms/src/api/video/content-types/`

## What To Build

1. Define a single-video page contract that can be driven from CMS instead of route-specific hardcoding.
2. Pull the core video record, subtitles, related content, and structured supporting modules through one data path.
3. Keep the player, metadata, and supplemental sections consistent across default and localized routes.
4. Make the page extensible enough to support later watch-platform upgrades without another route rewrite.

## Constraints

- Do NOT fork the video player implementation unnecessarily.
- Prefer extending the existing CMS and GraphQL contract over introducing a parallel source of truth.
- Preserve existing watch-page URLs or add a clear migration plan if route changes are unavoidable.

## Verification

- A single video page can render from CMS-backed data end to end
- Related content and subtitle data are available on the same page contract
- Existing watch URLs still resolve or redirect cleanly to the new page model
