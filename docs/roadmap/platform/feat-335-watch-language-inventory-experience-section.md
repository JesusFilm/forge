---
id: "feat-335"
title: "Watch language inventory Experience section"
owner: "codex"
priority: "P1"
status: "cancelled"
start_date: "2026-08-05"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "watch"
  - "experiences"
  - "language-inventory"
---

## Problem

Language inventory pages reuse code-owned Watch homepage rails and only read a
small subset of homepage Experience media overrides. Editors cannot add a
genuine authored Experience section to `/watch/{language}.html/videos`.

## Entry Points

1. `apps/web/src/app/[locale]/[htmlLang]/videos/[languageSlug]/page.tsx` -
   language inventory route composition.
2. `apps/web/src/components/watch-language-inventory/LanguageInventoryPage.tsx`
   - inventory layout and section placement.
3. `apps/web/src/lib/content.ts` - published Watch Experience resolution and
   block normalization.
4. `apps/web/src/components/sections/index.tsx` - canonical Experience block
   renderer.

## Grep These

- `resolveWatchPage`
- `watchExperienceBlocks`
- `__typename: "SectionBlock"`
- `ExperienceSectionRenderer`

## What To Build

1. Resolve the published homepage Experience for the route's UI locale.
2. Select its authored top-level `SectionBlock` entries as the inventory's
   Experience section content.
3. Render those blocks through the canonical Experience renderer using the
   selected public audio-language slug for media links.
4. Preserve the generated language inventory when no authored section is
   available or Experience resolution fails.

## Constraints

- Do not replace the inventory hero, counts, or Admin-backed video catalog.
- Do not render the homepage hero or top-level homepage media rails a second
  time on the inventory page.
- Do not add a second Experience model or an inventory-specific database flag.
- Do not expose server-only Admin credentials to the client bundle.

## Verification

- Focused route and component tests prove authored `SectionBlock` rendering and
  the missing-Experience fallback.
- `@forge/web` lint/typecheck passes for the touched surface.
- Local browser QA on `/watch/malagasy.html/videos` shows the authored section
  followed by the generated inventory without duplicate homepage hero/media
  rails.
