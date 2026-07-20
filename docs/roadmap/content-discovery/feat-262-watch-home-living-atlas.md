---
id: "feat-262"
title: "Watch home Living Atlas language feature"
owner: "codex"
priority: "P1"
status: "complete"
start_date: "2026-07-15"
duration: 1
depends_on:
  - "feat-196"
blocks: []
tags:
  - "web"
  - "admin"
  - "graphql"
  - "watch"
  - "languages"
  - "content-discovery"
---

## Problem

The Watch homepage does not promote the breadth of the language catalog or
provide an editorial path to `/watch/languages`. The completed language index
is discoverable from language controls, but it is not yet represented as a
visual Experience section in the homepage narrative.

## Entry Points - Read These First

1. `apps/admin/src/domain/blocks.ts` - Experience block discriminator schemas.
2. `apps/admin/src/graphql/types/blocks.ts` - Pothos block objects and union dispatch.
3. `apps/admin/src/app/dashboard/experiences/experience-editor/block-helpers.ts` - static block templates and editor summaries.
4. `packages/admin-graphql/src/fragments/watch-experience.ts` - shared consumer block selection.
5. `apps/web/src/components/sections/index.tsx` - Admin block renderer dispatch.
6. `apps/web/src/components/home/WatchHomeExperiencePage.tsx` - homepage Experience composition.
7. `apps/web/src/lib/routes.ts` - canonical language-index route builder.

## Grep These

- `WatchHomeHeroBlock`
- `watchHomeHero`
- `ExperienceBlock`
- `adminWatchExperienceFragment`
- `ExperienceSectionRenderer`
- `languagesIndexPath`

## What To Build

1. Add a placement-only `watchHomeLanguages` Experience block beside the
   existing `watchHomeHero` pattern.
2. Expose the block through admin's Pothos union and the shared
   `@forge/admin-graphql` Watch Experience fragment.
3. Add the block to the admin Experience editor template menu with a clear
   static-section summary.
4. Render a responsive Living Atlas section on Web with a bundled globe asset,
   native-script language labels, a canonical All Languages CTA, slow ambient
   motion, and a reduced-motion fallback.
5. Keep the section server-rendered and avoid new data requests, WebGL, canvas,
   timers, or client initialization.

## Constraints

- Preserve public audio language slugs and route through `languagesIndexPath()`.
- Do not hand-edit generated GraphQL environment output.
- If the Pothos schema changes, regenerate `apps/admin/schema.graphql` and
  `packages/admin-graphql/src/admin-graphql-env.d.ts` together.
- Reuse Web's existing black cinematic surface, content-width classes,
  Montserrat font, and bundled region-art visual language.
- Use semantic headings and links; decorative motion must honor
  `prefers-reduced-motion`.
- Do not add runtime network work or a heavy animation dependency.

## Verification

- `pnpm --filter @forge/admin exec vitest run src/domain/blocks.test.ts src/graphql/types/blocks.test.ts src/app/dashboard/experiences/experience-editor/block-helpers.test.ts`
- `pnpm --filter @forge/admin schema:print`
- `pnpm --filter @forge/admin-graphql generate`
- `pnpm --filter @forge/admin-graphql typecheck`
- `pnpm --filter @forge/web exec vitest run src/components/sections/WatchHomeLanguages.test.tsx`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- Browser smoke at desktop and mobile widths with keyboard focus and reduced motion.
- Confirm the section adds no request, timer, canvas, WebGL, or client bundle initialization path.
