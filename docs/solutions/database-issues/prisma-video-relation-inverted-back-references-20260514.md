---
title: Prisma `Video.parents` and `Video.children` back-references are semantically inverted
date: 2026-05-14
last_updated: 2026-05-14
category: database-issues
module: apps/admin
problem_type: database_issue
component: prisma_schema
root_cause: wrong_relation_name
resolution_type: deferred
severity: high
applies_when:
  - Adding a feature that surfaces a Video's actual parent collection or child episodes via GraphQL.
  - Reviewing why the apps/web SiblingCarousel renders empty (or, before the defensive dedupe in `apps/web/src/lib/content.ts`, rendered the current video as its own children).
  - Debugging an admin Experience Builder `routeVideoChildren` block that surfaces a video's parents instead of its children.
tags:
  - prisma
  - schema
  - relation
  - back-reference
  - video
  - VideoRelation
  - Pothos
  - sibling-carousel
  - experience-builder
---

## Symptom

The Pothos GraphQL field `Video.children` returns `VideoRelation` rows where the queried video's id is the **child** of the relation (parent of someone else's catalogue page), not its parent. Traversing `.child` on those rows yields the queried video itself.

Concrete probe against local dev (`/watch/jesus/english`):

```graphql
{
  videoBySlug(slug: "jesus") {
    id
    children {
      child {
        id
        slug
      }
    }
  }
}
```

Returns 4 rows, all with `child.id === jesus.id` and `child.slug === "jesus"`. The actual catalogue parents of the JESUS film (`jf-language-stack-collection`, `jfm-collection`, `classic`, `women-resources`) are hidden behind the inverted back-reference and inaccessible via `Video.parents` either.

Symmetric inversion on `Video.parents`.

## Root cause

`apps/admin/prisma/schema.prisma`:

```prisma
model Video {
  ...
  parents        VideoRelation[]      @relation("VideoChildren")  // ← mis-labeled
  children       VideoRelation[]      @relation("VideoParents")   // ← mis-labeled
}

model VideoRelation {
  parent  Video @relation("VideoChildren", fields: [parentId], references: [id], onDelete: Cascade)
  child   Video @relation("VideoParents",  fields: [childId],  references: [id], onDelete: Cascade)
}
```

Prisma pairs the two halves of a relation by the `@relation("name")` label. `Video.parents @relation("VideoChildren")` pairs with `VideoRelation.parent @relation("VideoChildren", fields: [parentId])`, which means `Video.parents` returns `VideoRelation` rows where this video's id equals the row's `parentId` — i.e. relations where **this video is the parent**, not its parents.

Correct pairing would be:

```prisma
parents        VideoRelation[]      @relation("VideoParents")    // rows where childId = this.id
children       VideoRelation[]      @relation("VideoChildren")   // rows where parentId = this.id
```

Then `.parent` / `.child` on each row yields the actual related video.

## Why this is deferred

The one-line schema swap was applied and reverted in branch `feat/web-admin-polish` (commits `ba7c5545` then `2393eff5` on 2026-05-14). Risk concern: even though the swap requires no DB migration (Prisma relation names are client-side pairing labels), changing the runtime semantics of `Video.parents` / `Video.children` affects any consumer of those fields, including:

- apps/admin's `routeVideoChildren` block setting in Experience Builder (`apps/admin/src/app/dashboard/experiences/experience-editor.tsx`, `block-helpers.ts`)
- Any in-flight admin work that may rely on the inverted shape (intentionally or not)

The repo's full admin test suite (2266 tests) passes after the swap, but coverage gaps over Experience Builder runtime behavior are a possibility. A clean fix wants its own branch with explicit Experience Builder regression sweep.

## Workaround currently in place

`apps/web/src/lib/content.ts` (commit `d6b1eb7d`):

- `dedupeByDocumentId<T>(items: T[]): T[]` collapses duplicate `documentId`s after the relation walk.
- The `normalizeAdminVideo` parents/children pipelines additionally filter out any entry whose `documentId` equals the parent video's `documentId` (self-reference).

Effect: the SiblingCarousel block-builder's `siblings.length < 2` guard suppresses the carousel entirely when admin returns only self-refs (every video probed locally — `1-jesus-our-loving-pursuer`, `jesus`, `easter-explained`, `darkroom-faith` — exhibits this). Better than rendering the video as its own three siblings (which the previous behaviour did, plus a React duplicate-key warning).

The carousel still renders correctly for videos that genuinely have no parent and a populated own-children list, because the synthesized-virtual-parent branch in `buildSiblingCarouselBlock` short-circuits on `ownChildren.length >= 2`. With the inversion in place, `ownChildren` is currently never populated for any Video, so that branch never fires for real catalogue data.

## How to fully fix

1. Open `apps/admin/prisma/schema.prisma`, swap the relation labels:

   ```prisma
   parents        VideoRelation[]      @relation("VideoParents")
   children       VideoRelation[]      @relation("VideoChildren")
   ```

2. Run `pnpm --filter @forge/admin db:generate` — Prisma client only; no migration file.

3. Restart admin. The GraphQL `Video.children` field then returns real children. Verified end-to-end: `videoBySlug(slug:"magdalena").children` jumps from 0 to 46.

4. Sweep admin's Experience Builder + dashboard usages of `routeVideoChildren` to confirm they now render the intended direction. (They were buggy in the same direction; the swap fixes them too. But confirm visually.)

5. The defensive web-side filter in `dedupeByDocumentId` + self-ref check should stay in place as belt-and-braces against future relation-row anomalies.

## Pointers

- The unwanted-symptom defensive fix: commit `d6b1eb7d` in `feat/web-admin-polish`.
- The attempted-and-reverted schema swap: commits `ba7c5545` and `2393eff5` in `feat/web-admin-polish`.
- Affected consumers: `apps/web/src/components/watch/SiblingCarousel.tsx`, `apps/admin/src/app/dashboard/experiences/experience-editor.tsx` (`routeVideoChildren` branch).
