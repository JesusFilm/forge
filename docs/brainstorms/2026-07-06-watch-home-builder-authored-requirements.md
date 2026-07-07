---
date: 2026-07-06
topic: watch-home-builder-authored
---

# Watch Home Builder-Authored Requirements

## Problem Frame

The modern `/watch` home is currently a purpose-built catalog surface driven by
Forge-owned static configuration plus Admin video data. That delivered the new
homepage experience, but below-the-hero editorial programming still requires
code changes. The top hero behavior can remain static/Web-owned, but the
homepage Experience can include a lightweight block that renders that existing
Watch Home hero component.

The goal is to make the homepage genuinely created through the Experience
Builder while preserving the modern watch-home experience. The emerging shape is
not to model the top hero's complex data/rotation behavior in the builder, but
to add a simple "Watch Home Hero" block that delegates to the existing Web hero
component, then let Admin-authored Experience blocks own the rest of the
homepage content/programming.

Related context:

- `docs/roadmap/platform/feat-159-watch-home-modernization.md`
- `docs/roadmap/platform/feat-160-watch-home-carousel-data-parity.md`
- `docs/follow-ups/watch-home-modernization-missing-data.md`
- `docs/plans/2026-06-04-003-feat-watch-home-modernization-plan.md`
- `apps/web/src/lib/watch-home-config.ts`
- `apps/web/src/lib/watch-home.ts`
- `apps/web/src/components/home/WatchHomePage.tsx`
- `apps/admin/src/domain/blocks.ts`
- `apps/admin/src/app/dashboard/experiences/experience-editor/block-helpers.ts`

## Requirements

**Builder Ownership**

- R1. The `/watch` homepage should be sourced from an Admin homepage
  Experience, so editors can change homepage programming without code changes.
- R2. The homepage Experience should remain compatible with the existing
  Experience Builder authoring model wherever possible instead of inventing a
  parallel homepage CMS.
- R3. The current hardcoded Core-id below-hero homepage body programming should
  be migrated into builder-authored block data by resolving synced Core videos
  to Admin `Video` records and storing ordered manual video references.
- R3a. The first migration should create one canonical homepage Experience that
  matches the current production home before broadening to multiple
  locale-specific homepage Experiences.

**Watch Home Hero Placeholder**

- R4. The homepage Experience should be able to include a lightweight Watch Home
  Hero block/component that renders the existing Web-owned watch-home top hero.
- R5. The Watch Home Hero block should not expose or model the existing hero's
  carousel data, rotation behavior, uploaded-video behavior, or player behavior
  in Experience Builder. It is a placement/delegation block for the existing
  component.
- R5a. The Watch Home Hero block should be homepage-only in the editor. It is
  not intended as a general-purpose hero block for arbitrary Experiences.
- R6. Existing single-video `videoHero` behavior should remain unchanged for
  normal Experience pages.

**Below-Hero Sections**

- R7. Below the top hero, the existing `mediaCollection` block should be the
  default authoring primitive for homepage rails, grids, numbered sections, and
  manually curated video collections.
- R8. Below-hero sections should use `itemsSource: "manual"` with ordered
  Admin video references for the migrated homepage content, since the relevant
  Core videos are already synced into Admin.
- R9. Sections currently represented by `limitChildren` or
  `primaryCollectionId` in static config should be migrated to explicit manual
  item lists, so the homepage Experience records the exact cards viewers see
  and their order.
- R10. The existing `promoBanner`, `section`, and container-style blocks should
  be reused for promotional or grouped content unless they fail a concrete
  homepage requirement.
- R10a. The builder-authored homepage should cover nearly all content above the
  bottom site footer, including promo/banner-like content. The bottom footer
  with social links, navigation columns, giving/about/resources/partners/contact
  links, address, and phone details should remain static.
- R10b. The builder-authored body may use any existing Experience block that
  makes sense for the homepage body. The scope is not limited to
  `mediaCollection`, though `mediaCollection` remains the primary block for
  video rails/grids.
- R11. New below-hero block definitions should be avoided unless the existing
  blocks cannot represent a required editorial behavior after reasonable
  extension.
- R11a. Small `mediaCollection` extensions are allowed when needed for concrete
  homepage body-section behavior, such as orientation, card treatment, or
  comparable presentation choices. This should not become a broad
  `mediaCollection` redesign.

**Rendering And Parity**

- R12. Web should preserve the modern homepage body presentation by mapping
  homepage Experience body blocks into the existing watch-home/media collection
  presentation where appropriate, rather than rendering the entire page as a
  generic Experience page.
- R13. The builder-authored homepage should preserve public `/watch` URL
  behavior, localized video data, card images, duration/episode labels, and
  language-aware route generation.
- R14. The transition should allow the current static homepage config to serve
  as migration input while the builder version is validated, but the final
  homepage body should not silently fall back to static body programming when
  the builder homepage body is missing, broken, or unpublished.
- R14a. If the homepage Experience body is missing or broken, public users may
  still see the Watch Home Hero block/component, while editors/admins should
  see a clear configuration warning or diagnostic state.
- R14b. The hardcoded below-hero static homepage body configuration should be
  removed in v1 once the builder-authored body is in place. It may be used as
  migration input during implementation, but it should not remain as a runtime
  fallback or parallel body source.

**Editor Experience**

- R15. Editors should be able to add, reorder, and configure homepage body
  sections with existing builder controls for `mediaCollection` wherever
  possible.
- R16. Editors should not have to know Core ids for normal homepage body
  programming after migration; they should work with Admin video selections.
- R20. V1 should use the normal Experience editor quality bar: native picker,
  add/remove/reorder controls, and clear block summaries where the existing
  editor patterns already support them. High-polish bespoke homepage workflow
  is not required for v1.
- R21. The normal Experience editor preview/canvas is sufficient for v1. A real
  `/watch` shell preview before publish is not required.
- R18. Below-hero rendering should use a hybrid approach: preserve homepage
  polish where it matters, but port reusable watch-home section behavior into
  the existing `mediaCollection` component/rendering path where practical so
  other Experience pages can benefit from the same richer collection behavior.

## Success Criteria

- The current below-hero homepage sections can be represented as builder blocks
  without introducing dedicated `WatchHomeRail`, `WatchHomeGrid`, or
  `WatchHomeCollection` block types.
- The top hero is represented in the homepage Experience by a lightweight block
  that renders the existing Web-owned Watch Home hero component.
- Nearly all content between the Watch Home Hero block and the static bottom
  footer is authored through Experience blocks.
- The existing hardcoded below-hero section arrays in
  `apps/web/src/lib/watch-home-config.ts` are removed from the runtime body
  rendering path.
- Missing, broken, or unpublished builder homepage body data does not silently
  render stale static body programming; editors/admins receive a clear warning.
- Editors can change below-hero homepage ordering and selected videos in Admin
  without a deploy.
- Editors can author the homepage through the normal Experience editor without
  editing raw JSON or relying on developer-only tools.
- `/watch` continues to look and behave like the modern homepage, not like a
  generic Experience route.

## Scope Boundaries

- Do not redesign the homepage visual language as part of this brainstorm.
- Do not replace normal Experience `videoHero` behavior.
- Do not add a configurable multi-video hero block in this scope.
- Do not move the current watch-home top hero data/rotation/player behavior into
  Experience Builder in this scope.
- Do not expose the Watch Home Hero placeholder block as a general-purpose block
  for arbitrary Experiences.
- Do not introduce new below-hero block types merely to rename existing
  `mediaCollection` behavior.
- Do not require editors to author Core ids by hand for migrated below-hero
  sections.
- Do not preserve dynamic "children of this collection" homepage sections in
  this scope; migrated below-hero sections should specify exact videos.
- Do not solve mobile or TV homepage parity in this first scope, except to keep
  the resulting content model from making that work harder.
- Do not move the bottom site footer into Experience Builder.
- Do not create an artificial homepage-only allowlist that prevents useful
  existing Experience blocks from being used in the homepage body.
- Do not require first-pass migration of every locale-specific homepage
  Experience.
- Do not treat schema-only support as shippable v1; the normal editor workflow
  still needs to support the new/extended blocks.
- Do not require a dedicated real-`/watch` preview workflow for v1.
- Do not hide homepage body configuration failures from editors/admins merely
  because the Watch Home Hero block can still render for public users.
- Do not keep the static below-hero config as an emergency fallback or
  long-lived reference path after v1 ships.

## Key Decisions

- **Represent the top hero as a placeholder block.** The watch-home top hero is
  complex enough that its behavior should stay Web-owned, but the Experience can
  include a small block that renders the existing component so the whole
  homepage composition lives in the builder.
- **Keep the placeholder homepage-only.** The Watch Home Hero block is a
  homepage placement hook for a known component, not a reusable hero system.
- **Keep `videoHero` unchanged.** This effort should not turn the existing
  single-video hero into a polymorphic advanced carousel.
- **Reuse `mediaCollection` below the hero.** Existing body sections are close
  to `mediaCollection` with manual Admin video items; redefining rails/grids as
  separate block types would add authoring and rendering complexity without
  much product value.
- **Keep the bottom footer static.** The builder owns content sections above
  the site footer; social/navigation/address/contact footer chrome remains a
  Web component.
- **Allow broad existing block reuse.** The homepage body can use the existing
  Experience block library where appropriate, with `mediaCollection` as the main
  video-section primitive rather than the only allowed block.
- **Migrate body Core ids to Admin video references.** Since the Core videos are
  synced into Admin, static below-hero Core-id arrays can become ordered manual
  video items in the homepage Experience.
- **Start with one canonical homepage.** The first migration should prove the
  model and renderer against the current production home before expanding
  locale-specific homepage authoring.
- **Remove static body programming in v1.** Static config can guide migration,
  but the shipped body should come from the builder rather than keeping two
  runtime sources alive.
- **Use exact below-hero video lists.** The builder-authored homepage should
  specify exact videos for each body section. Current dynamic config patterns
  such as `limitChildren` and `primaryCollectionId` are migration inputs, not
  runtime authoring behavior to preserve.
- **Use normal editor affordances.** V1 should feel like the existing
  Experience editor, with native selection/reorder controls where expected, but
  does not need a bespoke homepage editing workflow.
- **Keep a homepage-specific Web mapper.** Builder ownership should control
  content and programming, while Web keeps the current modern homepage
  presentation by translating blocks into the watch-home model.
- **Use hybrid below-hero rendering.** The preferred direction is not a fully
  homepage-only renderer and not purely generic rendering. Port the useful
  watch-home section behaviors into `mediaCollection` where they fit, while
  keeping homepage-specific mapping for behavior that only belongs on `/watch`.
- **Allow focused `mediaCollection` extensions.** Existing fields should be
  reused first, but a small number of concrete presentation fields can be added
  when necessary to represent the migrated homepage sections cleanly.

## Dependencies / Assumptions

- The relevant Core videos from the current homepage config already exist as
  Admin `Video` records.
- Existing `mediaCollection` manual item authoring is adequate or close enough
  for homepage body sections once migrated to Admin video references.
- `watchSetting.homepageExperience` remains the right Admin-facing concept for
  selecting the homepage Experience.
- The first implementation can treat mobile/TV adoption as follow-up, provided
  the content model does not hard-code Web-only assumptions into the data.

## Outstanding Questions

### Resolve Before Planning

### Deferred to Planning

- [Affects R4-R5a][Technical] Define the minimal Watch Home Hero placeholder
  block shape, renderer dispatch, and homepage-only editor exposure rule.
- [Affects R7-R13][Technical] Determine the minimal `mediaCollection`
  presentation extensions needed for migrated below-hero sections.
- [Affects R3][Technical] Define the migration/seed path from static Core-id
  arrays to Admin video references.
- [Affects R13][Technical] Verify GraphQL fragment hydration for manual
  `mediaCollection.items[].videoId` can provide all localized card metadata
  needed by the current homepage.

## Next Steps

Proceed to `ce:plan` for structured implementation planning.
