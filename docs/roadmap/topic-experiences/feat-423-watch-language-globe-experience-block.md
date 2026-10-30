---
id: "feat-423"
title: "Author the Watch language globe in Experience Editor"
owner: "urim"
priority: "P1"
status: "complete"
start_date: "2026-08-25"
duration: 1
depends_on:
  - "feat-400"
blocks: []
tags:
  - "admin"
  - "web"
  - "watch"
  - "experiences"
  - "i18n"
---

## Problem

The Watch homepage appends the language globe after every authored Experience
block in Web code. Editors cannot place, remove, reorder, or localize that
section. The reusable animation needs a first-class Experience block contract
that preserves the existing optimized renderer while moving homepage
composition and promo copy into Admin.

## Entry Points — Read These First

1. `apps/admin/src/domain/blocks.ts` — persistence-bound Zod block union.
2. `apps/admin/src/app/dashboard/experiences/experience-editor.tsx` — block
   library, homepage availability, and authored field controls.
3. `apps/admin/src/graphql/types/blocks.ts` — typed GraphQL block projection.
4. `packages/admin-graphql/src/fragments/watch-experience.ts` — shared consumer
   block selection.
5. `apps/web/src/components/sections/index.tsx` — Experience block dispatch.
6. `apps/web/src/components/home/WatchHomeExperiencePage.tsx` — remove the
   fixed globe insertion after authored content.

## What To Build

1. Add a top-level `languageGlobe` block with editable eyebrow, title,
   description, CTA label, CTA link, and section key.
2. Make the block available to any Experience in the Admin block library with
   an inline editing preview and valid defaults.
3. Expose the block through Pothos, the committed Admin SDL, and the shared
   `@forge/admin-graphql` Watch Experience fragment.
4. Render the authored block through the existing `LanguageGlobeSection` and
   optimized deferred canvas at its editor-selected position.
5. Remove the fixed Web homepage insertion and include the block in the local
   Watch homepage seed fixture.

## Constraints

- Reuse the existing canvas renderer and adaptive performance profiles.
- Keep the language globe top-level-only; do not allow it inside sections or
  containers.
- Do not add a Prisma migration: Experience blocks are validated JSON.
- Keep the not-found composition independent from authored homepage content.
- Do not add a second page-level `h1` on the Watch homepage.

## Verification

- Admin domain, GraphQL drift, block-helper, and editor tests cover the new
  block contract and authoring controls.
- Regenerate and commit `apps/admin/schema.graphql` and
  `packages/admin-graphql/src/admin-graphql-env.d.ts`.
- Web fragment, dispatch, homepage placement, and section tests pass.
- Admin, Admin GraphQL, and Web focused lint/typecheck/format checks pass.
- Browser QA confirms authored order, desktop/mobile layout, no horizontal
  overflow, and no eager globe canvas before the deferred viewport threshold.

## Completion Notes

- Added the top-level-only Admin block contract, Experience Editor library
  entry, editable preview, GraphQL object, and shared typed fragment.
- Replaced the homepage's fixed globe insertion with normal Experience block
  dispatch so editor order is preserved.
- Kept the shared 404 composition independent and added immediate/deferred
  renderer loading modes.
- Regenerated the Admin SDL and gql.tada introspection.
- Covered schema, editor, GraphQL, fragment, dispatch, ordering, and deferred
  loading behavior with focused tests.
- Verified the standalone authored preview at desktop and mobile sizes with no
  horizontal overflow or application console errors.
