---
title: "fix: Position media collection copy above thumbnails"
type: "fix"
status: "complete"
date: "2026-07-21"
---

# fix: Position media collection copy above thumbnails

## Summary

Restore the authored `MediaCollection` content order so the supporting title
and collection description render above the carousel or grid. Preserve the
category label, title, CTA, cards, interaction behavior, and trailing footer
copy.

## Problem Frame

The Experience editor exposes separate category label, title, supporting title
(`subtitle`), description, and footer fields. Web currently collapses
`categoryLabel` and `subtitle` into one eyebrow, so a category label hides the
supporting title. It also groups the description with `footerText` below the
media row, producing the inverted layout visible on `/watch/english.html`.

Git history before the Watch Home Experience Builder composition shows grid
variants placing supporting copy before cards, while the historical carousel
omitted some of those fields. The user's request establishes one shared order
for Experience sections now. The current Admin and shared GraphQL contracts
already expose every field independently, so the defect is localized to the Web
renderer.

## Requirements

- R1. When at least one media item resolves, an authored media collection
  renders `categoryLabel`, `title`, `subtitle`, and `description` independently
  when each field is present.
- R2. When media renders, the supporting title and description appear before
  the first thumbnail in both carousel and grid variants.
- R3. When media renders, `footerText` remains after the media row and is not
  merged into the pre-media description.
- R4. Existing CTA inference, localized links, card order, card markup, hover
  previews, backdrops, progress, and carousel behavior remain unchanged.
- R5. Focused automated coverage proves field visibility and DOM order for the
  carousel and grid branches.
- R6. Browser proof on the reported Watch surface confirms the authored copy is
  above thumbnails at compact and wide viewports without new requests,
  horizontal document overflow, console errors, or page-load work.

## Key Technical Decisions

- **Keep the existing content contract:** The Admin editor, Pothos schema, and
  shared fragment already carry the required fields, so this fix changes only
  Web presentation.
- **Model authored fields independently:** Pass `categoryLabel`, `subtitle`,
  and `description` separately into the shared media-collection shell instead
  of treating category label and subtitle as alternatives.
- **Use one shared header before variant dispatch:** Apply the requested field
  order to every Web media-collection variant by rendering supporting copy in
  the header that precedes both carousel and grid branches.
- **Preserve the responsive CTA hierarchy:** On compact viewports, render
  category label, title, supporting title, description, then CTA as one vertical
  reading order. At the `lg` breakpoint and above, keep the complete text stack
  in the left column and the CTA in the existing centered right column; authored
  copy wraps naturally without truncation.
- **Keep footer semantics trailing:** `footerText` remains the only copy below
  the media row because it is authored as a separate closing field.
- **Preserve empty-collection behavior:** If no item resolves, keep the current
  full-section early return rather than introducing a new empty state.

## Assumptions

- The user phrase “short supporting title” refers to the existing
  `MediaCollection.subtitle` field labeled “Add a short supporting line” in the
  Experience editor.
- The request applies to every Web `MediaCollection` variant that uses the
  shared renderer, not only the single production section shown in the
  screenshot.
- Existing typography can be reused; this is an ordering and field-visibility
  correction rather than a visual redesign.

## Scope Boundaries

- In scope: the Web `MediaCollection` renderer, its focused component tests,
  browser/performance proof, roadmap tracking, and durable solution notes.
- Out of scope: Admin editor changes, schema or GraphQL changes, generated type
  updates, production content edits, card redesign, CTA changes, and media
  loading changes.

## Implementation Units

### U1. Track the rendering-order regression

- **Goal:** Create the required roadmap artifact before implementation and keep
  the defect linked to its code and verification surface.
- **Requirements:** R1-R6
- **Dependencies:** None
- **Files:**
  - Create
    `docs/roadmap/platform/feat-277-watch-media-collection-header-copy-order.md`
  - Modify `docs/roadmap/README.md` if repository generation updates it
- **Approach:** Record the current field mapping, requested order, preserved
  behavior, and focused validation. Set the ticket to `in-progress` before code
  edits and `complete` after verification.
- **Patterns to follow:**
  `docs/roadmap/platform/feat-252-watch-home-portrait-card-sizing.md`.
- **Test scenarios:** Test expectation: none -- this unit is roadmap metadata.
- **Verification:** The ticket uses the next global feature ID, follows roadmap
  frontmatter rules, and appears in generated roadmap indexes when applicable.

### U2. Restore the authored header-copy contract

- **Goal:** Render every header field above the media row without changing card
  or carousel behavior.
- **Requirements:** R1-R5
- **Dependencies:** U1
- **Files:**
  - Modify `apps/web/src/components/sections/MediaCollection.tsx`
  - Modify `apps/web/src/components/sections/MediaCollection.test.tsx`
- **Approach:** Replace the `categoryLabel ?? subtitle` collapse with separate
  props. Add supporting-title and description markup to the shared header
  before the carousel/grid conditional. Remove description from the trailing
  footer block while leaving `footerText` after media.
- **Execution note:** Add failing DOM-order coverage before changing the
  renderer.
- **Patterns to follow:** Preserve the fixed-width Embla branch documented in
  `docs/solutions/ui-bugs/watch-authored-media-collection-responsive-card-density.md`.
- **Test scenarios:**
  - With category label, title, subtitle, description, and footer authored, all
    values render and the category label does not suppress the subtitle.
  - Category-only, subtitle-only, category-plus-subtitle,
    description-without-subtitle, footer-only, and null/empty optional-field
    states preserve order without empty spacing wrappers.
  - In the carousel variant, subtitle and description precede the carousel
    region while footer text follows it.
  - In a grid variant, subtitle and description precede the grid and first
    video card.
  - With no resolved media items, the whole section remains hidden.
  - Existing link, CTA, preview, tint, scrim, and carousel assertions remain
    green.
- **Verification:** Focused Vitest coverage, Web typecheck, and Web lint pass;
  the diff introduces no new component boundary, effect, timer, observer,
  dependency, or request.

### U3. Prove the reported experience and record the learning

- **Goal:** Verify the production-shaped layout at real viewports and preserve
  the regression lesson for future Experience renderer changes.
- **Requirements:** R6
- **Dependencies:** U2
- **Files:**
  - Create
    `docs/solutions/ui-bugs/watch-media-collection-authored-copy-order.md`
  - Modify
    `docs/roadmap/platform/feat-277-watch-media-collection-header-copy-order.md`
- **Approach:** Run the Watch route locally with production-shaped Experience
  content. Use the local Experience editor to ensure one real collection has a
  category label, supporting title, description, footer, and long CTA/copy
  values when seeded content lacks that combination. Capture screenshots at
  390x844 and 1440x900, compare hydrated geometry or DOM order for both copy
  fields against the first media row, exercise the carousel, and record console,
  overflow, request, payload-delta, and load-impact evidence.
- **Patterns to follow:**
  `docs/solutions/developer-experience/measurement-driven-layout-iteration-chrome-mcp-20260505.md`
  and
  `docs/solutions/conventions/frontend-change-page-load-performance-verification.md`.
- **Test scenarios:**
  - At 390x844, long authored title, supporting title, description, and CTA copy
    wrap without overlap; both supporting fields remain above thumbnails and
    the page has no horizontal document overflow.
  - At 1440x900, the same ordering holds and the carousel remains a single
    movable rail with its existing end gutter.
  - CTA focus and activation, keyboard tab order into the first card, card
    navigation, and horizontal carousel movement work after hydration; the
    section heading and carousel accessible name remain coherent.
  - Resource evidence shows no new request or client initialization work and
    records the expected document-payload delta from newly visible authored
    text rather than requiring a zero-byte change.
- **Verification:** The screenshot and measured DOM/geometry evidence match the
  reported desired layout, the browser console is healthy, the roadmap ticket
  is complete, and the solution document links the plan and ticket.

## Risks & Dependencies

- A category label and subtitle may have been visually treated as alternatives
  since the Watch Home builder rollout. Focused coverage must prove both can
  coexist without disturbing the CTA layout at narrow widths.
- Local Experience data may not match the reported production section. Browser
  proof may use an existing seeded collection or a scoped local fixture, but it
  must exercise the real `MediaCollection` renderer rather than static mock
  HTML.

## Sources & Research

- `apps/admin/src/app/dashboard/experiences/experience-editor.tsx` defines the
  existing supporting-line and collection-description authoring fields.
- `packages/admin-graphql/src/fragments/blocks/media-collection.ts` carries the
  fields independently into Web.
- `apps/web/src/components/sections/MediaCollection.tsx` contains the field
  collapse and post-media description placement.
- `apps/web/src/components/sections/MediaCollection.test.tsx` is the focused
  regression suite and currently checks presence without order.
- `docs/solutions/ui-bugs/watch-authored-media-collection-responsive-card-density.md`
  establishes the renderer-local, structural-test, and browser-interaction
  precedent for authored collection layout fixes.
