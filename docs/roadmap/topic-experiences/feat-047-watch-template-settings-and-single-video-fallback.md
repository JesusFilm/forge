---
id: "feat-047"
title: "Watch Template Settings and Single Video Fallback Hardening"
owner: "urim"
priority: "P1"
status: "complete"
start_date: "2026-04-04"
duration: 3
depends_on:
  - "feat-022"
  - "feat-023"
  - "feat-026"
blocks: []
tags:
  - "web"
  - "cms"
  - "graphql"
---

## Problem

The new watch-template settings flow adds a generic single-video fallback, but the first implementation has a few operational gaps: template/settings changes do not invalidate all dependent pages, CMS settings can point at invalid experiences, generic video fallback can surface a hard error when no playable variant exists, and authored video blocks lost strong validation when route-bound template mode was added.

## Entry Points — Read These First

1. `apps/web/src/lib/content.ts` — shared watch-page resolver, template fallback, route-video normalization
2. `apps/web/src/app/api/revalidate/route.ts` — webhook-driven invalidation for experience, video, and watch-setting updates
3. `apps/cms/src/api/watch-setting/content-types/watch-setting/schema.json` — watch settings singleton contract
4. `apps/cms/src/components/sections/video.json` — authored vs route-bound video block schema
5. `apps/cms/src/components/sections/video-hero.json` — authored vs route-bound video-hero schema
6. `apps/web/src/components/sections/Video.tsx` — authored and route-bound playback rendering
7. `apps/web/src/components/sections/VideoHero.tsx` — authored and route-bound hero playback rendering

## Grep These

- `resolveWatchPage|resolveSlugPage|normalizeRouteVideo` in `apps/web/src/`
- `watch-setting|defaultTemplateExperience|homepageExperience` in `apps/cms/src/` and `apps/web/src/`
- `revalidatePath` in `apps/web/src/`
- `useRouteVideo|streamingUrl` in `apps/cms/src/components/sections/` and `apps/web/src/components/sections/`
- `ExperienceError|ExperienceEmpty` in `apps/web/src/`

## What To Build

1. Revalidation hardening:
   - Ensure updates to `watch-setting` and template `experience` entries invalidate dependent generic `/watch/[video-slug]` pages, not just homepage aliases or the template slug itself.
   - Keep the existing homepage and locale-path invalidation behavior intact.

2. Template-selection safety:
   - Prevent `WatchSetting.defaultTemplateExperience` from accepting a non-template `Experience`, either through CMS-side validation, a filtered selector, or an equivalent contract-enforcing mechanism.
   - Preserve the runtime guard in `apps/web/src/lib/content.ts` as a defensive backstop.

3. Graceful route-video fallback:
   - If a `Video` exists for the route slug but has no playable published HLS variant, return the existing no-content path instead of surfacing a hard error page.
   - Keep explicit `Experience.slug` resolution precedence unchanged.

4. Authored block validation:
   - Preserve `useRouteVideo` support for template experiences while restoring validation or an explicit failure mode for ordinary authored `video` and `video-hero` blocks that lack a playable URL.

## Constraints

- Do not remove the `WatchSetting` singleton or the `Experience.isTemplate` model introduced by the plan.
- Do not break the GraphQL contract flow: if CMS schema changes, regenerate `apps/cms/schema.graphql` and `packages/graphql` outputs in the same work.
- Do not introduce inline GraphQL operations in random web files; keep operations in the existing data layer and fragments.
- Historical precedence note: this ticket originally kept explicit `Experience.slug` ahead of generic `Video.slug` fallback. That rule was superseded for two-segment Watch video/playlist URLs by `docs/plans/2026-06-11-002-fix-watch-video-precedence-plan.md`; video-side content now wins before same-slug Experiences at `/watch/{slug}.html/{language}.html`.

## Verification

- `pnpm --filter @forge/graphql generate`
- `pnpm --filter @forge/cms build`
- `pnpm --filter @forge/cms typecheck`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web build`
- Manual smoke:
  - change `Watch Settings.defaultTemplateExperience` and confirm dependent generic `/watch/[slug]` pages update without waiting for the 60s ISR fallback
  - choose a non-template experience in the settings flow and confirm the CMS or runtime rejects it clearly
  - visit a route whose `Video` lacks a playable variant and confirm it degrades to the normal no-content path
  - save an authored `video` / `video-hero` block without a playable URL and confirm the CMS or UI no longer fails silently
