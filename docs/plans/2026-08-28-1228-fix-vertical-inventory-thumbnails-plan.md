---
title: "Vertical Inventory Thumbnails - Plan"
type: "fix"
date: "2026-08-28"
artifact_contract: "ce-unified-plan/v1"
artifact_readiness: "implementation-ready"
product_contract_source: "ce-plan-bootstrap"
execution: "code"
---

# Vertical Inventory Thumbnails - Plan

## Goal Capsule

- **Objective:** Viewers can recognize portrait video episodes by their portrait thumbnails in collection lists on the Watch language inventory page.
- **Means:** Select the compact thumbnail frame shape from the catalog's stable vertical naming signal and reuse the existing 2:3 Watch card treatment (KTD1, KTD2).
- **Authority:** The user's screenshot and request define the visible outcome. Existing Watch thumbnail and accessibility conventions govern the implementation.
- **Execution profile:** Lightweight, localized frontend fix with focused component tests and browser proof.
- **Stop conditions:** Stop if catalog data does not provide a reliable vertical marker or if the change requires a new GraphQL field or image derivative contract.
- **Tail ownership:** The implementation run owns code, tests, browser validation, roadmap completion, and shipping.

## Product Contract

### Summary

Portrait episodes in a collection list will use a portrait thumbnail frame while ordinary episodes retain the current landscape frame.

### Problem Frame

The Watch language inventory collection list renders every episode preview in a fixed landscape box. Vertical series therefore appear as small landscape crops even when each title is explicitly identified as vertical, which makes the thumbnail shape contradict the media format.

### Requirements

- R1. Compact collection rows for vertical videos render their thumbnail frame at the existing Watch 2:3 portrait ratio.
- R2. Compact collection rows for non-vertical videos retain their current landscape dimensions and image alignment.
- R3. Portrait thumbnails preserve the existing play affordance, white hover and focus frame, links, metadata, numbering, and fallback artwork behavior.
- R4. The fix adds no query fields, client effects, media requests, eager loading, or new image derivative recipes.

### Scope Boundaries

- In scope: episode thumbnails rendered by the compact collection rows on `/watch/{language}.html/videos`.
- Out of scope: collection overview artwork, full grid cards, home and Experience media collections, player posters, and editorial artwork selection.

## Planning Contract

### Key Technical Decisions

- KTD1. **Detect portrait episodes from stable catalog naming.** Treat `vertical` and `9x16` as portrait markers. Check the Core ID and video slug first, then the selected parent slug, localized title, and parent title. This matches both the vertical inventory fixture and the existing Core-ID aspect suffix vocabulary. Governs R1 and R2.
- KTD2. **Reuse the existing 2:3 Watch portrait treatment without reducing row density.** Preserve the current compact heights at both responsive tiers, use `aspect-[2/3]` to derive the narrower width, and center portrait imagery. Keep the current landscape classes unchanged in the opposite branch. Governs R1 through R3.
- KTD3. **Keep the change render-only.** Compute orientation from fields already present in `WatchLanguageInventoryCard`; do not extend Admin GraphQL or request a second thumbnail asset. Governs R4.

### Assumptions

- Current portrait catalog entries expose either a `vertical` marker or a `9x16` Core-ID suffix, as shown by the inventory service fixture, the production screenshot, and the existing search identifier normalizer.
- The requested correction targets the compact episode thumbnails visible in the supplied collection-list screenshot, not every image on the inventory page.

## Implementation Units

### U1. Track the inventory thumbnail correction

- **Goal:** Create the next sequential content-discovery roadmap ticket and mark it in progress before production changes.
- **Requirements:** R1 through R4.
- **Dependencies:** None.
- **Files:**
  - `docs/roadmap/content-discovery/feat-441-watch-vertical-inventory-thumbnails.md`
- **Approach:** Record the screenshot-backed problem, exact entry points, catalog marker constraint, focused verification, and the boundary against collection overview artwork.
- **Patterns to follow:** `docs/roadmap/content-discovery/feat-192-watch-language-inventory-page.md` and the roadmap contract in `CLAUDE.md`.
- **Test expectation:** None — this unit adds project tracking metadata only.
- **Verification:** The new feature ID is globally unique, its frontmatter is valid, and its status is `in-progress` before U2 begins.

### U2. Render portrait compact thumbnails

- **Goal:** Give vertical episodes portrait frames without changing ordinary episode rows.
- **Requirements:** R1 through R4.
- **Dependencies:** U1.
- **Files:**
  - `apps/web/src/components/watch-language-inventory/LanguageInventoryPage.tsx`
  - `apps/web/src/components/watch-language-inventory/__tests__/LanguageInventoryPage.thumbnails.test.tsx`
- **Approach:**
  1. Add a small pure orientation predicate near the inventory image helpers, with Core-ID and slug checks before title fallbacks per KTD1.
  2. Branch only the compact thumbnail wrapper, image `sizes`, and object position per KTD2.
  3. Preserve the existing row root, interaction frame, play icon, fallback gradient, and metadata markup.
- **Execution note:** Add focused behavior coverage before changing the row classes, then implement the smallest render-only branch.
- **Patterns to follow:** The vertical `VideoCard` frame in `apps/web/src/components/sections/MediaCollection.tsx`, the aspect suffix vocabulary in `apps/admin/src/services/typesense-watch-search-identifiers.ts`, existing `cn` class branching, and `docs/solutions/design-patterns/web-video-thumbnail-white-interaction-frame.md`.
- **Test scenarios:**
  - A compact item whose Core ID ends in `9x16` renders `aspect-[2/3]`, preserves `h-12 sm:h-14`, centers the image, and omits landscape width classes.
  - A compact item whose own slug ends in `vertical` renders the same portrait frame.
  - A compact item whose parent slug ends in `vertical` renders portrait even when the localized child title omits the marker.
  - A normal compact item retains the current `h-12 w-20 sm:h-14 sm:w-24` frame, left-top image alignment, interaction frame, and link behavior.
- **Verification:** The focused language inventory component suite passes and the diff contains no data-fetching or initialization changes.

### U3. Prove the visible result and close tracking

- **Goal:** Validate portrait and landscape rows in a real browser, record page-load safety, and complete the roadmap ticket.
- **Requirements:** R1 through R4.
- **Dependencies:** U2.
- **Files:**
  - `docs/roadmap/content-discovery/feat-441-watch-vertical-inventory-thumbnails.md`
- **Approach:** Exercise a language inventory collection that contains vertical episodes and compare it with a normal collection. Confirm the fix changes only CSS geometry and responsive image hints, so the initial request set and client initialization remain unchanged.
- **Patterns to follow:** `docs/solutions/conventions/frontend-change-page-load-performance-verification.md`.
- **Test expectation:** None — browser evidence and the U2 component tests cover the behavior.
- **Verification:** Browser proof shows portrait thumbnails for vertical episodes, unchanged landscape thumbnails elsewhere, no console errors, and no additional resource or client-work regression. The roadmap ticket records the evidence and moves to `complete`.

## Verification Contract

- Run the focused `LanguageInventoryPage` Vitest file.
- Run the Web TypeScript check and scoped formatting or lint checks for touched files.
- Run `git diff --check`.
- In a browser, inspect `/watch/english.html/videos` at desktop and narrow widths. Confirm the vertical collection uses portrait episode thumbnails and a non-vertical collection remains landscape.
- Compare resource requests and rendered client behavior before and after. The render-only change must not add requests, eager media, effects, or JavaScript initialization.

## Definition of Done

- R1 through R4 are covered by the focused tests and browser evidence.
- U1 through U3 are complete with no abandoned experiment code in the diff.
- The vertical portrait frame retains the shared white interaction frame and accessible link behavior.
- Landscape compact rows remain visually and structurally unchanged.
- The roadmap ticket is complete and the branch is ready for review.
