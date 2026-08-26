---
id: "feat-436"
title: "Author the Watch category rail in Experience Editor"
owner: "vlad"
priority: "P1"
status: "in-progress"
start_date: "2026-08-26"
duration: 1
depends_on:
  - "feat-426"
blocks: []
tags:
  - "admin"
  - "web"
  - "watch"
  - "experiences"
  - "content-discovery"
---

## Problem

The Watch homepage category rail is inserted directly after the hero by Web code. Admins cannot remove it, move it among other homepage sections, or choose which category tiles appear. The visual, localization, destinations, and carousel behavior already work and should remain Web-owned.

## Entry Points - Read These First

1. `apps/admin/src/domain/blocks.ts` - persistence-bound Zod block union.
2. `apps/admin/src/app/dashboard/experiences/experience-editor.tsx` - block library, homepage availability, and block controls.
3. `apps/admin/src/graphql/types/blocks.ts` - typed GraphQL block projection.
4. `packages/admin-graphql/src/fragments/watch-experience.ts` - shared consumer block selection.
5. `apps/web/src/components/home/WatchHomeCategoryRail.tsx` - existing renderer and tile presentation.
6. `apps/web/src/components/home/WatchHomeExperiencePage.tsx` - fixed placement to remove.

## What To Build

1. Add a top-level, homepage-only `watchHomeCategoryRail` Experience block with an ordered selection of stable category IDs.
2. Add an Admin block-library entry whose valid starter selects every current category, and controls that add, remove, and reorder the selected tiles.
3. Expose the block through Pothos, the committed Admin SDL, and the shared `@forge/admin-graphql` Watch Experience fragment.
4. Render the selected tiles through the existing category rail at the block's authored position and remove the fixed Web insertion.
5. Preserve the existing homepage appearance with the local seed and an idempotent deployment migration that inserts the block for every homepage locale and active draft that lacks it.
6. Make either Admin/Web deployment order safe by retrying a legacy query and rendering the fixed rail only while Web is talking to an Admin schema that does not know the new typename.
7. Teach live Admin AI editing and MCP validation/documentation about the closed category-ID contract without enabling autonomous draft generation for this homepage-only block.

## Constraints

- Persist only stable category IDs and their authored order. Web continues to own labels, icons, gradients, links, responsive geometry, and carousel behavior.
- Keep the block top-level-only, homepage-only, and singleton across manual, AI, and MCP writes.
- Do not add a steady-state homepage data request or a Prisma schema migration; an idempotent JSON data migration is required for rollout safety.
- Do not retain an absent-block fallback when Admin supports the type because it would prevent admins from removing the section.
- Do not render the Web-only visual in the Mobile or TV homepage adapters; treat the typename as a known silent skip.
- Never hand-edit generated GraphQL SDL or gql.tada introspection outputs.

## Verification

- Admin schema, editor, AI/MCP, and GraphQL tests cover valid ordered selections, invalid or duplicate IDs, top-level-only placement, and block/tile reordering.
- Regenerate and commit `apps/admin/schema.graphql` and `packages/admin-graphql/src/admin-graphql-env.d.ts`.
- Web tests cover authored subset/order, defensive invalid-ID handling, exact Experience block order, absence when the block is not authored, and existing localized destinations and CTA behavior.
- Mobile and TV adapter tests confirm the new typename is ignored without warnings.
- Admin, Admin GraphQL, Watch URL Policy, Web, Mobile, and TV focused tests, lint, typecheck, formatting, and generated-artifact drift checks pass.
- Browser QA covers Admin add/select/keyboard-reorder/save/draft-preview and Web desktop/mobile rendering with no console errors or horizontal overflow.
- Page-load verification confirms the block uses the existing Experience request, adds no homepage fetch, and does not regress initial Watch-home JavaScript, request count, or loading behavior.
- Staging verifies Web-first and Admin-first rollout paths plus the Web-first rollback sequence; the compatibility path is removed in a follow-up after old Admin versions cannot serve traffic.

## Implementation Evidence

- The Watch homepage seed now assembles one schema-valid
  `watchHomeCategoryRail` block immediately after `watchHomeHero`, with its
  default `categoryIds` derived from the shared 13-entry catalog.
- `apps/admin/src/scripts/seed-watch-homepage-experience.test.ts` proves exact
  singleton placement and catalog order without requiring a database.
- `docs/runbooks/watch-home-category-rail-rollout.md` documents either-order
  forward deployment, migration checks, old-schema compatibility behavior, and
  the Web-first/data-cleanup/Admin-last rollback sequence.
- Focused seed verification passed locally. Full touched-package, browser,
  performance, staging, pull-request, and merge-readiness gates remain pending;
  keep this ticket `in-progress` until those gates complete.
