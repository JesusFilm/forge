---
title: "feat: Watch Home Builder-Authored Composition"
type: "feat"
status: "active"
date: "2026-07-06"
origin: "docs/brainstorms/2026-07-06-watch-home-builder-authored-requirements.md"
roadmap: "docs/roadmap/platform/feat-160-watch-home-carousel-data-parity.md"
---

# feat: Watch Home Builder-Authored Composition

## Problem Frame

The current `/watch` home is rendered from Web-owned static configuration in
`apps/web/src/lib/watch-home-config.ts` plus Admin video data. The requirements
now narrow the target: keep the complex Watch Home top hero Web-owned, represent
it in the homepage Experience with a lightweight homepage-only placeholder
block, and move the content between that hero and the static footer into normal
Experience Builder blocks.

## Scope

- Add a homepage-only `watchHomeHero` placeholder block to the Admin block
  schema, GraphQL block union, editor templates, and Web renderer dispatch.
- Make Web `/watch` resolve `watchSetting.homepageExperience` as the homepage
  composition source, render the Watch Home hero placeholder with the existing
  home hero component, and render the remaining body blocks with the existing
  Experience section renderer plus focused `mediaCollection` improvements.
- Keep the bottom site footer static.
- Keep current hero behavior Web-owned; do not model hero rotation, pools, Mux
  inserts, uploads, or player behavior in block data.
- Remove static below-hero config from the runtime body rendering path.

## Key Decisions

- **Placeholder, not hero model.** `watchHomeHero` is a block with minimal data:
  a discriminator and optional `sectionKey`. It exists so the homepage
  composition can be authored in the Experience editor without exposing the
  current hero internals.
- **Homepage-only editor exposure.** The block may exist in the schema/renderer,
  but the editor should only expose it when editing a homepage Experience.
- **Reuse blocks broadly.** The homepage body can use existing Experience
  blocks; `mediaCollection` remains the primary video-section block.
- **Manual video items.** Migrated body sections should store explicit Admin
  video references, not dynamic collection-child sources.
- **Static footer.** Footer chrome stays in Web.

## Implementation Units

### Unit 1: Admin Block Contract

**Goal:** Add `watchHomeHero` as a valid Experience block and expose it through
Admin GraphQL output.

**Files:**

- `apps/admin/src/domain/blocks.ts`
- `apps/admin/src/domain/blocks.test.ts`
- `apps/admin/src/graphql/types/blocks.ts`
- `apps/admin/src/graphql/types/blocks.drift.test.ts`
- `apps/admin/schema.graphql`
- `packages/admin-graphql/src/admin-graphql-env.d.ts`

**Approach:**

- Add `WatchHomeHeroBlockSchema` with `t: "watchHomeHero"` and optional
  `sectionKey`.
- Add it to the top-level `BlockSchema` only.
- Add the Pothos object type, `T_TO_TYPENAME` mapping, and union membership.
- Regenerate Admin SDL and admin-graphql introspection.

**Test Scenarios:**

- `BlockSchema.safeParse({ t: "watchHomeHero" })` succeeds.
- `BlocksSchema` accepts a mixed page including `watchHomeHero` and existing
  blocks.
- Drift test confirms the new Pothos type is mapped into `ExperienceBlock`.

### Unit 2: Admin Editor Support

**Goal:** Let editors place the Watch Home Hero block in the normal Experience
editor, but only for homepage Experiences.

**Files:**

- `apps/admin/src/app/dashboard/experiences/experience-editor/block-helpers.ts`
- `apps/admin/src/app/dashboard/experiences/experience-editor/block-helpers.test.ts`
- `apps/admin/src/app/dashboard/experiences/experience-editor.tsx`
- `apps/admin/src/app/dashboard/experiences/experience-editor.test.tsx`

**Approach:**

- Add a `watchHomeHero` template, summary, and starter payload.
- Gate the block library entry to homepage Experience locales only. If the
  existing editor props do not expose enough homepage/template metadata, add the
  minimal prop needed from the page loader.
- Keep editing controls simple: the block is informational/placement-only.

**Test Scenarios:**

- Starter block is schema-valid.
- Summary identifies it as the Watch Home Hero.
- Block library shows the template for homepage editing and hides it for normal
  Experiences.

### Unit 3: Web Fragment And Renderer

**Goal:** Web can fetch and render the placeholder block in an Experience.

**Files:**

- `packages/admin-graphql/src/fragments/watch-experience.ts`
- `apps/web/src/components/sections/index.tsx`
- `apps/web/src/components/home/WatchHomePage.tsx`
- `apps/web/src/components/home/WatchHomeTvCarousel.tsx`
- `apps/web/src/lib/watch-home.ts`
- `apps/web/src/lib/__tests__/watch-home.test.ts`
- `apps/web/src/components/home/__tests__/WatchHomePage.test.tsx`

**Approach:**

- Add `WatchHomeHeroBlock` to the shared Admin watch-experience fragment.
- Add a Web dispatch case for `WatchHomeHeroBlock`.
- Reuse the existing top hero component path. If needed, extract the hero portion
  from `WatchHomePage` into a component that can render from a hero model while
  the surrounding body comes from Experience blocks.

**Test Scenarios:**

- A `WatchHomeHeroBlock` renders the existing hero component path.
- Unknown/unsupported homepage block behavior remains unchanged.
- Existing Watch Home component tests still cover hero playback behavior.

### Unit 4: Builder-Authored Home Route

**Goal:** `/watch` uses `watchSetting.homepageExperience` as the composition
source and no longer renders body sections from static Web config.

**Files:**

- `apps/web/src/app/[locale]/[htmlLang]/page.tsx`
- `apps/web/src/app/[locale]/[htmlLang]/__tests__/page-routing.test.tsx` if present
- `apps/web/src/lib/content.ts`
- `apps/web/src/lib/watch-home.ts`
- `apps/web/src/lib/watch-home-config.ts`
- `apps/web/src/app/api/revalidate/route.test.ts`

**Approach:**

- Add/adjust a resolver that loads the homepage Experience from `watchSetting`.
- Render blocks from the homepage Experience in order. The `watchHomeHero`
  placeholder renders the static hero; other blocks go through the existing
  renderer.
- Keep footer static.
- Remove static body section runtime usage. Leave hero config only if the
  existing hero still needs it.
- Preserve cache tags for both `watch:home` and `watch:experience`.

**Test Scenarios:**

- Homepage Experience containing `watchHomeHero` and a body block renders both.
- Missing/broken body does not fall back to static body sections.
- Revalidation for Experience/watch-setting updates invalidates homepage data.

### Unit 5: Canonical Home Migration/Seed

**Goal:** Provide a repeatable way to create the first canonical homepage
Experience from the current static body config.

**Files:**

- `apps/admin/src/scripts` or existing local-dev script location
- `apps/admin/package.json`
- `docs/follow-ups/watch-home-modernization-missing-data.md`

**Approach:**

- Add a local/admin script that maps the existing below-hero Core IDs to Admin
  `Video.id` values and writes a homepage Experience body with:
  `watchHomeHero`, migrated `mediaCollection` blocks, promo/banner blocks where
  appropriate.
- Treat dynamic config (`limitChildren`, `primaryCollectionId`) as migration
  input only; write explicit item lists.

**Test Scenarios:**

- Dry-run reports missing Core IDs without writing.
- Execute path creates/updates one canonical homepage Experience.
- Generated blocks pass `BlocksSchema`.

## Verification

- `pnpm --filter @forge/admin test -- src/domain/blocks.test.ts src/graphql/types/blocks.drift.test.ts`
- `pnpm --filter @forge/admin test -- src/app/dashboard/experiences/experience-editor`
- `pnpm --filter @forge/admin schema:print`
- `pnpm --filter @forge/admin-graphql generate`
- `pnpm --filter @forge/web test -- watch-home`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/admin typecheck`

## Deferred Questions For Implementation

- Whether the editor already has `isHomepage` / homepage locale metadata at the
  component boundary or needs a minimal prop.
- Whether Web can reuse `WatchHomePage` as-is or should extract a smaller hero
  component before switching the body to Experience blocks.
- Whether migration belongs as an Admin script or a one-off documented command
  in the existing script conventions.
