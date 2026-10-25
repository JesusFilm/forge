---
title: "fix(web): Contain Watch home standalone media blocks"
type: "fix"
status: "completed"
date: "2026-07-21"
---

# fix(web): Contain Watch home standalone media blocks

## Summary

Restore the standard Watch content rail around the top-level “New Believer Course” carousel and the final standalone invitation video on `/watch`. Keep the hero full-bleed and preserve the existing containment and carousel-bleed behavior of nested experience sections.

## Problem Frame

The Watch home composition delegates top-level non-hero blocks directly to `ExperienceSectionRenderer`. `SectionBlock` contains its own content with `WATCH_PAGE_CONTENT_CLASSES`, but standalone `VideoCarouselBlock` and `VideoBlock` render width-agnostic roots and therefore span the viewport. Live inspection at a 1280px viewport measured normal Watch content at `x=96`, `width=1073`, while both affected blocks measured `x=0`, `width=1265`.

The safest ownership boundary is `WatchHomeExperiencePage`: the same shared renderer is also used by generic experience routes, while `WatchSectionRenderer` already supplies a parent content rail. Applying containment globally would broaden the change and can double-pad existing layouts.

## Requirements

- **R1 — Course containment:** A top-level `VideoCarouselBlock` on `/watch`, including the “New Believer Course” heading and carousel player content, aligns with the standard Watch content rail.
- **R2 — Final video containment:** A top-level `VideoBlock` on `/watch`, including the final “Invitation to Know Jesus Personally” video section, aligns with that same rail.
- **R3 — Preserve other layout ownership:** `VideoHeroBlock` remains full-bleed. `SectionBlock`, `MediaCollectionBlock`, and other self-contained blocks do not receive a second homepage rail. Generic experience routes and Watch detail-page body zones remain unchanged.
- **R4 — Preserve carousel behavior:** `CarouselVideo` keeps its existing internal bleed, first-card alignment, horizontal movement, focus behavior, and terminal spacer. No shared carousel or content-width token is changed.
- **R5 — Regression proof:** Focused composition tests cover selective wrapping, and browser verification covers compact and wide viewports, geometry alignment, document overflow, carousel interaction, and visual screenshots.
- **R6 — Performance neutrality:** The fix adds only inert layout markup/classes. It must not add client state, hydration work, network requests, dependencies, observers, or replace the renderer’s dynamic import boundaries.

## Key Technical Decisions

1. **Let the Watch homepage composition own selective containment.** Add a small, explicit predicate/helper in `WatchHomeExperiencePage.tsx` for top-level `VideoBlock` and `VideoCarouselBlock`. This is the narrowest boundary that satisfies R1–R3 without changing every `ExperienceSectionRenderer` consumer.
2. **Reuse the established rail unchanged.** Apply `WATCH_PAGE_CONTENT_CLASSES` from `apps/web/src/lib/content-width.ts`; do not introduce a parallel spacing ladder or modify the shared token.
3. **Keep media renderers width-agnostic.** Do not change `Video.tsx`, `CarouselVideo.tsx`, `Section.tsx`, or the shared renderer registry. Their current behavior is correct in nested and already-contained contexts.
4. **Test ownership at the composition boundary.** A focused `WatchHomeExperiencePage` test should prove exactly which block types receive the homepage wrapper and that block order/delegation are preserved. Browser geometry then proves the CSS contract after hydration.

## Scope Boundaries

### In scope

- The `/watch` homepage’s top-level `VideoBlock` and `VideoCarouselBlock` layout.
- A focused composition regression test.
- Responsive browser/DOM verification and screenshots.
- A roadmap ticket that tracks the implementation and validation.

### Out of scope

- Generic experience routes rendered from `apps/web/src/app/[locale]/[htmlLang]/[...rest]/page.tsx`.
- Nested media inside `SectionBlock` or other already-contained blocks.
- `VideoHeroBlock` and other intentionally full-bleed surfaces.
- CMS content, GraphQL schema, or authored block ordering changes.
- Redesigning video/carousel components or changing shared width/bleed tokens.

## Implementation Units

### U1 — Track and implement selective Watch home containment

**Requirements:** R1, R2, R3, R4, R6

**Files:**

- Create `docs/roadmap/platform/feat-286-watch-home-standalone-media-containment.md`.
- Modify `apps/web/src/components/home/WatchHomeExperiencePage.tsx`.
- Create `apps/web/src/components/home/WatchHomeExperiencePage.test.tsx`.

**Approach:**

1. Create the roadmap item using the next available global feature ID and set it to `in-progress` before production code changes.
2. In `WatchHomeExperiencePage.tsx`, identify only top-level `VideoBlock` and `VideoCarouselBlock` as needing a homepage-owned rail.
3. Wrap the rendered output for those block types in a lightweight element using `WATCH_PAGE_CONTENT_CLASSES`. Preserve the existing block key, ordering, hero handling, footer placement, and `languageSlug` delegation.
4. Leave `ExperienceSectionRenderer`, `Section`, `Video`, `CarouselVideo`, `VideoHero`, and the shared content-width/carousel tokens unchanged.
5. Add a composition test with lightweight child mocks so it exercises the homepage ownership decision rather than video-provider behavior.

**Regression scenarios:**

- A top-level `VideoBlock` receives exactly one wrapper containing every class token from `WATCH_PAGE_CONTENT_CLASSES`.
- A top-level `VideoCarouselBlock` receives exactly one equivalent wrapper.
- `VideoHeroBlock`, `SectionBlock`, and a self-contained block such as `MediaCollectionBlock` are not wrapped by the homepage helper.
- Mixed blocks retain their authored sequence and continue receiving the expected `languageSlug`.
- The test does not duplicate the existing player and carousel behavior coverage in `apps/web/src/components/sections/__tests__/Video.test.tsx` and `apps/web/src/components/sections/__tests__/CarouselVideo.test.tsx`.

**Verification:**

- Run the focused `WatchHomeExperiencePage` test.
- Run the existing focused `Video` and `CarouselVideo` tests to guard the unchanged media contracts.
- Run the Web app’s relevant typecheck, formatting, and lint checks for the touched files.
- Inspect the diff to confirm no generated files, shared tokens, dynamic imports, or unrelated routes changed.

### U2 — Prove responsive geometry and close the roadmap item

**Requirements:** R1, R2, R3, R4, R5, R6

**Dependencies:** U1

**Files:**

- Update `docs/roadmap/platform/feat-286-watch-home-standalone-media-containment.md` to `complete` after all acceptance evidence passes.

**Approach:**

1. Run the local Watch app and inspect `/watch` at a compact mobile viewport and a wide viewport around 1280px.
2. Use `getBoundingClientRect()` after hydration to compare each rendered block root inside the new rail wrapper with the inner content box of a nearby correctly contained `SectionBlock`, rather than relying on screenshots or class names alone. The `WATCH_PAGE_CONTENT_CLASSES` wrapper itself is expected to remain full-width at `x=0`; its padding establishes the child content edge.
3. Confirm the hero remains full-bleed, the document has no horizontal overflow, and the carousel’s internal bleed remains usable.
4. Interact with the New Believer Course carousel: verify the track changes position and that the terminal gutter/spacer remains visible at the end.
5. Capture meaningful before/after or final screenshots at compact and wide viewports and check the browser console for new errors.
6. Confirm from the implementation and browser network/runtime behavior that no new request, client boundary, hydration work, observer, or dependency was introduced.

**Acceptance evidence:**

- At a 1280px viewport, each affected rendered block root inside its wrapper shares the known-good inner content geometry (expected left edge `x≈96px` and right edge near `viewportWidth-96px`). The rail wrapper itself may remain full-width at `x=0`.
- At a compact viewport, each affected rendered block root begins at the standard `20px` mobile content inset and `document.documentElement.scrollWidth <= clientWidth`.
- The hero remains viewport-width and self-contained/nested sections do not show doubled horizontal padding.
- Carousel interaction produces real horizontal movement and preserves the end gutter.
- Focused tests and Web validation pass, screenshots show the corrected alignment, and no new console errors appear.
- The roadmap item is marked `complete` only after the above evidence is recorded.

## Patterns and Research Applied

- `apps/web/src/components/sections/Section.tsx` demonstrates the established parent-owned Watch rail.
- `apps/web/src/lib/content-width.ts` is the single source for content-rail and carousel-bleed classes.
- `apps/web/src/components/watch/WatchSectionRenderer.tsx` demonstrates why a global renderer wrapper would create double containment.
- `docs/solutions/design-patterns/embla-carousel-bleed-alignment-port-pattern-20260508.md` preserves the parent/container and inner-carousel ownership split.
- `docs/solutions/conventions/grep-inline-tier-copies-before-bumping-shared-layout-tokens-2026-05-05.md` supports keeping shared spacing tokens unchanged for a local ownership bug.
- `docs/solutions/developer-experience/measurement-driven-layout-iteration-chrome-mcp-20260505.md` establishes absolute geometry comparison as the layout proof standard.
- `docs/solutions/ui-bugs/watch-authored-media-collection-responsive-card-density.md` establishes real carousel movement and terminal gutter checks as part of the interaction contract.
- `docs/solutions/performance-issues/web-watch-route-lighthouse-perf-campaign-lcp-bundle-fonts-20260527.md` supports preserving the existing per-renderer dynamic chunk boundaries.

## Done When

- R1–R6 are satisfied with focused automated tests and responsive browser evidence.
- Only the Watch homepage composition, its focused test, and the roadmap item are changed unless validation reveals a directly related required adjustment.
- The roadmap item is complete and the final handoff reports validation results and links the captured visual proof.

## Validation Evidence

- Focused tests: `WatchHomeExperiencePage`, `Video`, and `CarouselVideo` passed (10 tests total).
- Web validation: `typecheck` and `lint` passed; pre-commit formatting checks passed.
- Wide browser geometry: both affected block roots aligned at `x=96px` with right edge `1169px` in a `1265px` document content width. The hero and authored full-bleed sections remained `x=0`, width `1265px`.
- Compact browser geometry: both affected block roots aligned at `x=20px` with right edge `355px`; document `scrollWidth` equaled `clientWidth` (`375px`).
- Course carousel: the scoped next control moved the track from `matrix(..., 0, 0)` to `matrix(..., -240, 0)`, reached its disabled terminal state, and retained the terminal viewport edge without clipping.
- Invitation video: the final video reached ready state 4 and advanced from `42.17s` to `43.40s` while playing.
- Runtime: no new browser errors appeared. Two existing Next.js development warnings concerned the homepage hero image position/LCP and are outside this layout-only change.
- Warm local `/watch` response: HTTP 200, `0.445s` time to first byte, `0.470s` total. The implementation adds only server-rendered wrapper markup/classes and no client boundary, request, observer, dependency, or dynamic-import change.
- Screenshots: `output/playwright/watch-home-new-believer-wide.png`, `output/playwright/watch-home-new-believer-compact.png`, `output/playwright/watch-home-invitation-wide.png`, and `output/playwright/watch-home-invitation-compact.png`.
