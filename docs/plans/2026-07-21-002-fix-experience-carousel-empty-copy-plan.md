---
title: "fix: Hide unauthored Experience carousel copy"
type: "fix"
status: "completed"
date: "2026-07-21"
roadmap: "docs/roadmap/topic-experiences/feat-279-experience-carousel-empty-copy.md"
---

# fix: Hide unauthored Experience carousel copy

## Summary

New Experience video carousels currently persist public-facing starter copy,
so Web receives apparently authored strings and renders a heading/description
block even when the editor supplied no text. Make new manual and route-video
carousel copy absent by default, while preserving authored values and Admin-only
editor guidance.

## Problem Frame

`CarouselVideo` already renders its copy wrapper only when at least one of
`title`, `subtitle`, or `description` exists. The regression originates earlier:
`createTemplateBlock` seeds values such as `Video carousel` and
`Carousel description`, which survive serialization and become public content.
The fix belongs at this authoring boundary; adding display-layer string matching
would confuse placeholders with legitimate authored text.

## Requirements

- R1. A newly added manual video carousel has no persisted title, subtitle, or
  description until an editor authors those values.
- R2. A newly added route-video carousel follows the same absent-by-default copy
  contract.
- R3. Authored title, subtitle, and description values continue to render
  unchanged.
- R4. Admin-only summaries, field placeholders, item behavior, and route-video
  resolution remain unchanged.

## Key Technical Decisions

- **Fix the source payload, not the renderer:** Web already distinguishes absent
  strings correctly. Removing starter copy prevents placeholder text from
  becoming persisted content without introducing brittle sentinel checks.
- **Apply the rule to both video-carousel starters:** manual and route-video
  variants share one public copy contract, so both should require deliberate
  authoring.
- **Keep editor affordances separate from content:** block summaries and input
  placeholders may continue to describe the block in Admin because they are not
  serialized as public Experience strings.

## Scope Boundaries

### In Scope

- Manual and route-video carousel starter payloads.
- Focused Admin serialization tests and Web rendering regression coverage.
- Browser proof that blank carousel copy produces no visible copy block.

### Out of Scope

- Existing saved Experiences that already contain starter text.
- Other Experience block families and their starter content.
- Schema, GraphQL, item selection, media playback, or carousel interaction
  changes.

## Implementation Units

### U1. Remove public copy from video-carousel starters

**Goal:** Ensure newly inserted video carousels serialize without unauthored
title, subtitle, or description fields.

**Requirements:** R1, R2, R4.

**Dependencies:** None.

**Files:**

- `apps/admin/src/app/dashboard/experiences/experience-editor/block-helpers.ts`
- `apps/admin/src/app/dashboard/experiences/experience-editor/block-helpers.test.ts`

**Approach:** Remove the public copy keys from both video-carousel starter
objects. Keep required discriminator, section key, item source, and item array
fields intact so each starter remains `BlockSchema` valid. Add explicit tests
for both variants rather than relying only on the all-template schema loop.

**Patterns to follow:** `createTemplateBlock`, `normalizeEditorBlockPayload`,
and the existing schema-valid starter tests in the same test file.

**Test scenarios:**

1. Creating a manual video-carousel starter returns no title, subtitle, or
   description keys and remains schema-valid.
2. Creating a route-video carousel starter returns no title, subtitle, or
   description keys while retaining `itemsSource: "routeVideoChildren"` and
   remains schema-valid.
3. An explicitly authored copy field survives normal editor serialization.

**Verification:** Run the focused Admin block-helper test file and inspect the
serialized starter objects.

### U2. Lock the blank-copy Web rendering contract

**Goal:** Prove that absent carousel strings create no copy wrapper while
authored copy remains visible.

**Requirements:** R3, R4.

**Dependencies:** U1.

**Files:**

- `apps/web/src/components/sections/CarouselVideo.tsx`
- `apps/web/src/components/sections/__tests__/CarouselVideo.test.tsx`

**Approach:** Add a render assertion using a valid carousel item with all three
copy fields absent. Give the optional copy wrapper a focused test identifier,
then verify the media remains rendered while that wrapper is absent. Retain the
existing authored-title test as positive coverage.

**Patterns to follow:** The existing lightweight carousel/Next Image mocks and
React `act` setup in the same test file.

**Test scenarios:**

1. A carousel with one valid media item and absent copy renders the media but no
   carousel-copy wrapper; item-card headings remain unaffected.
2. A carousel with an authored title continues to display that title.

**Verification:** Run the focused Web `CarouselVideo` test file.

## System-Wide Impact

The persisted Experience shape remains unchanged because these copy fields are
already optional. Existing Experiences and authored copy are unaffected. New
blocks simply stop converting editor scaffolding into public content, and Web
does no additional work during rendering or hydration.

## Risks and Mitigations

- **Editor cards could become hard to identify:** preserve the existing Admin
  summary fallbacks, which remain editor-only.
- **Route-video carousels could lose useful default prose:** treat the prose as
  authored content; editors may still enter it deliberately when appropriate.
- **A future renderer could reintroduce fallback copy:** keep focused Web
  coverage asserting the current absent-copy contract.

## Verification Strategy

Run focused Admin and Web tests first, then browser-smoke a Watch Experience
containing a blank-copy carousel. Confirm the carousel media remains usable,
the placeholder phrases are absent from the DOM, and no title/subtitle/
description wrapper appears. Because no rendering, hydration, or media code is
changed, page-loading verification is limited to confirming no new client
boundary or requests appear in the smoke surface.

## Acceptance Criteria

- New manual and route-video carousels do not persist starter copy.
- Blank-copy carousels render media without a copy block.
- Authored carousel copy still renders.
- Focused Admin and Web tests pass.
- Browser/DOM evidence shows the placeholder text is absent.

## References

- `docs/roadmap/topic-experiences/feat-279-experience-carousel-empty-copy.md`
- `docs/brainstorms/2026-07-06-watch-home-builder-authored-requirements.md`
- `docs/plans/2026-07-14-001-feat-experience-promotional-markdown-plan.md`
- `apps/admin/src/app/dashboard/experiences/experience-editor/block-helpers.ts`
- `apps/web/src/components/sections/CarouselVideo.tsx`
