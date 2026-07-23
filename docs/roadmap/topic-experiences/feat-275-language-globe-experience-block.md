---
id: "feat-275"
title: "Language Globe Experience Block"
owner: "tataihono"
priority: "P1"
status: "complete"
start_date: "2026-07-21"
duration: 5
depends_on: []
blocks:
  - "feat-276"
tags:
  - "web"
  - "admin"
  - "cms"
  - "graphql"
  - "i18n"
  - "experience"
---

## Problem

Experience authors cannot currently add an interactive view of the languages available in the Watch library. Viewers need a visually engaging way to discover languages by place and continue directly to each language's video inventory.

## Entry Points — Read These First

1. `apps/admin/src/domain/blocks.ts` — Zod contracts for persisted experience blocks.
2. `apps/admin/src/graphql/types/blocks.ts` — Pothos projections and union dispatch for block output.
3. `apps/admin/src/app/dashboard/experiences/experience-editor/block-helpers.ts` — block templates and editor summaries.
4. `packages/admin-graphql/src/fragments/watch-experience.ts` — shared Watch experience block composition.
5. `apps/web/src/components/sections/index.tsx` — Web experience block dispatch and dynamic loading.
6. `apps/web/src/lib/language-index.ts` — native/English language names, country associations, and canonical language video URLs.
7. `apps/web/src/app/[locale]/[htmlLang]/videos/[languageSlug]/page.tsx` — destination page for a selected language.

## Grep These

- `BlockSchema|ExperienceBlock|resolveBlockType` in `apps/admin/src/`
- `BLOCK_LIBRARY|createTemplateBlock|summarizeBlock` in `apps/admin/src/app/dashboard/experiences/`
- `ADMIN_BLOCK_TYPENAMES_LIST|ExperienceSectionRenderer` in `apps/web/src/components/sections/`
- `WatchLanguageIndexLanguage|languageVideosIndexPath` in `apps/web/src/`

## What To Build

1. Add a top-level `languageGlobe` experience block with authorable heading, description, background color, and bounded language count.
2. Expose the block through Admin GraphQL, regenerate `apps/admin/schema.graphql` and `packages/admin-graphql/src/admin-graphql-env.d.ts`, and include it in the shared Watch experience fragment.
3. Add the block to the Admin experience editor with a useful default, canvas summary, and editable settings.
4. Render a responsive, continuously rotating 3D Earth with a bundled realistic texture and animated language labels positioned from language-country coordinates.
5. Display the native language name first and the English name second; make every label a keyboard-accessible link to the existing language video inventory page.
6. Pause expensive animation when offscreen or hidden and honor reduced-motion preferences.

## Constraints

- Read language names, coordinates, and public slugs from the existing Admin-backed language library; do not maintain a second language catalog.
- Build public links through `languageVideosIndexPath` and language slugs, never BCP-47 catalog keys.
- Keep the 3D implementation code-split and avoid adding a large general-purpose 3D runtime.
- Keep the texture local to `apps/web/public/` and provide a non-WebGL fallback.
- Do not hand-edit generated GraphQL outputs; regenerate them from the Admin schema.

## Verification

- Admin block schema and GraphQL union tests cover the new discriminator and fields.
- Admin editor tests cover insertion, defaults, summary, and settings serialization.
- Web component tests cover native/English label order, canonical hrefs, bounded entries, and non-WebGL fallback.
- `pnpm --filter @forge/admin lint`, `pnpm --filter @forge/admin typecheck`, and focused Admin tests pass.
- `pnpm --filter @forge/admin schema:print` and `pnpm --filter @forge/admin-graphql generate` leave generated contracts clean.
- `pnpm --filter @forge/web lint`, `pnpm --filter @forge/web typecheck`, focused Web tests, and a production build pass.
- Desktop and mobile browser smoke confirms the globe, animation, keyboard links, reduced motion, and language navigation without a page-loading regression.

## Superseded visual engine decision

`feat-276` replaces only this ticket's raw-WebGL/geographic-marker presentation
with the approved 3D Earth Language Orbit. The completed Admin block, GraphQL
contract, Admin-backed language selection, semantic links, and canonical Watch
routes remain authoritative.
