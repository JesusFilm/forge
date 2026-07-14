---
id: "feat-252"
title: "Experience promotional Markdown sections"
owner: "urim"
priority: "P1"
status: "in-progress"
start_date: "2026-07-14"
duration: 1
depends_on: []
blocks: []
tags:
  - "cms"
  - "web"
  - "graphql"
  - "watch"
  - "seo"
  - "ui"
---

## Problem

Experience-authored Watch pages can assemble visually rich media rails, but the
existing Text block only exposes short paragraph treatments. Editors need a
discoverable, design-rich long-form section that emits substantial semantic
HTML for people and search crawlers without introducing arbitrary HTML, custom
scripts, or another Experience block discriminator.

## Entry Points — Read These First

1. `apps/admin/src/domain/blocks.ts` — `TextBlockSchema` persistence contract
   and current Text variants.
2. `apps/admin/src/app/dashboard/experiences/experience-editor.tsx` — block
   library, Text variant control, and inline paragraph editor.
3. `apps/admin/src/app/dashboard/experiences/experience-editor/block-helpers.ts`
   — starter templates and editor serialization helpers.
4. `apps/admin/src/graphql/types/blocks.ts` — Pothos `TextVariant` enum and
   `TextBlock` GraphQL type.
5. `apps/web/src/components/sections/Text.tsx` — server-rendered Experience Text
   component.
6. `apps/web/src/components/home/WatchHomePromo.tsx` — visual reference for the
   mission-toned editorial treatment.
7. `docs/plans/2026-07-14-001-feat-experience-promotional-markdown-plan.md` —
   complete requirements, implementation units, and verification contract.

## Grep These

- `TextBlockSchema` and `TextVariantEnum` — persistence and GraphQL contracts.
- `BLOCK_LIBRARY` and `createTemplateBlock` — Experience editor discovery
  and starter composition.
- `contentParagraphs` — existing cross-consumer text storage shape.
- `ReactMarkdown` and `react-markdown` — established safe Markdown renderer.
- `WatchHomePromo` and `staticOverlay` — current Watch mission-promo design
  language.

## What To Build

1. Add `promotional` to the existing Text variant in Zod and Pothos, then
   regenerate `apps/admin/schema.graphql` and
   `packages/admin-graphql/src/admin-graphql-env.d.ts` through their owners.
2. Add a Content-library starter that creates an ordinary mission-toned
   `SectionBlock` containing a promotional `TextBlock`.
3. Let promotional Text preserve blank-line-separated Markdown blocks in the
   existing `contentParagraphs: string[]` field while leaving legacy Text
   editing unchanged.
4. Render promotional Markdown on Web as server-side semantic headings,
   paragraphs, lists, blockquotes, emphasis, and safe links using the existing
   `react-markdown` dependency.
5. Give the promotional variant a responsive editorial split, strong
   typography, and mission-color treatment compatible with the current Watch
   home design.
6. Add schema, editor, renderer, raw-HTML, unsafe-link, compatibility, and
   server-rendering tests.

## Constraints

- Do not add raw HTML rendering, `dangerouslySetInnerHTML`, `rehype-raw`, custom
  CSS, scripts, embeds, or CMS-authored JavaScript.
- Do not add a new Experience block discriminator or replace
  `contentParagraphs` with a new persisted field.
- Do not change existing default, lead, or small Text rendering.
- Keep the Web branch a Server Component with no effects, state, or client-only
  initialization.
- Do not author or publish final search copy, remove the existing static
  mission promo, or deploy directly to production.

## Verification

- `pnpm --filter @forge/admin schema:print`
- `pnpm --filter @forge/admin-graphql generate`
- Focused Admin schema and Experience editor tests.
- Focused Web Text renderer tests, including raw HTML and unsafe protocols.
- `pnpm --filter @forge/admin typecheck`
- `pnpm --filter @forge/web typecheck`
- Desktop and mobile local `/watch` smoke with a DOM assertion that promotional
  copy is present in the initial server-rendered document.
- Browser loading inspection confirms no new client boundary, fetch, or media
  request is added by the section.
