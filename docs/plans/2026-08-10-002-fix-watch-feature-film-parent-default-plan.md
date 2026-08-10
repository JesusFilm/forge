---
title: "Watch Feature Film Parent Default - Plan"
type: "fix"
date: "2026-08-10"
artifact_contract: "ce-unified-plan/v1"
artifact_readiness: "implementation-ready"
product_contract_source: "ce-plan-bootstrap"
execution: "code"
---

# Watch Feature Film Parent Default - Plan

## Goal Capsule

- **Objective:** Make a standalone Watch clip default its episodes dropdown to its eligible feature-film parent while keeping every eligible collection available.
- **Authority:** The Product Contract and roadmap ticket `docs/roadmap/platform/feat-344-watch-feature-film-collection-default.md` define behavior. Existing Watch route admission and relation ordering remain authoritative.
- **Execution profile:** A bounded Web render-model change with route, merge-model, component, structured-data, and page-loading verification.
- **Stop conditions:** Stop if parent label metadata is absent from the resolved Watch snapshot, or if the change would require rewriting an explicit contextual URL.
- **Tail ownership:** LFG owns review, browser QA, commit, push, PR creation, and CI follow-through.

## Product Contract

### Summary

Standalone video routes will show every eligible parent collection and its admitted episodes, but the initial collection will be the related feature film when one exists. Contextual routes with a collection slug will continue to use the URL-selected collection.

### Problem Frame

The standalone episodes selector introduced by feat-287 uses the first eligible Admin parent as both its default rail and its first selector option. A feature-film clip can also belong to auxiliary collections, so relation order can make a broad collection such as `JFM Collection` appear selected instead of the related film such as `JESUS`.

Admin already exposes normalized video-label metadata on every resolved parent. The current standalone projection filters parents by route admission and then drops that label before the sibling-carousel model chooses its default.

### Requirements

#### Standalone selection

- R1. A standalone video route without a collection slug must prefer the first eligible parent classified as `featureFilm` as the initial episodes collection.
- R2. The dropdown must retain every eligible parent in Admin relation order and preserve each parent's admitted child order.
- R3. When no eligible feature-film parent exists, the first eligible Admin-ordered parent remains the default.
- R4. When several eligible feature-film parents exist, the first one in Admin relation order is the default.
- R5. A feature-film parent remains subject to existing eligibility rules for public slug, exact selected-language route admission, current-video membership, and at least two admitted children.

#### Route and page parity

- R6. A contextual video route with an explicit collection slug must stay fixed to that URL-selected parent and expose no standalone selector default.
- R7. Changing the initial episodes collection must not change the standalone URL, playback, hero progression, Share identity, language behavior, or contextual episode href construction.
- R8. Related-item structured data for a standalone route must describe the same initial parent and admitted children shown by the episodes rail.
- R9. The change must add no GraphQL field, browser request, client-side label scan, or title/slug special case.

### Key Decisions

- **Feature-film default on standalone routes.** (session-settled: user-directed — chosen over raw first-parent default: the collection that owns the feature-film narrative is the relevant initial episode rail.) Governs R1, R3, R4, R6, and R7.
- **Retain all eligible collection choices.** (session-settled: user-directed — chosen over replacing the selector with only the feature-film collection: viewers still need the other related collections and their episodes.) Governs R2, R5, and R9.

### Scope Boundaries

- No Admin schema, sync, relation-order, or route-manifest change.
- No URL parameter or redirect to persist the inferred default.
- No change to the minimum two-child selector eligibility contract.
- No title, translated copy, or slug matching for `JESUS` or any other film.

### Acceptance Examples

- AE1. Given eligible parents ordered `[JFM Collection, JESUS featureFilm, Language Stack]`, when a viewer opens the clip's standalone URL, then the dropdown still lists that order while `JESUS` and its admitted episodes are selected.
- AE2. Given the same clip at an explicit `JFM Collection` contextual URL, when the page renders, then the fixed `JFM Collection` rail remains and no standalone collection selector appears.
- AE3. Given no eligible `featureFilm` parent, when a standalone clip renders, then the first eligible parent remains selected.

## Planning Contract

### Key Technical Decisions

- KTD1. Classify parents with `videoLabelMessageKey(label) === "featureFilm"`. The existing idempotent normalizer accepts Admin enum, camelCase, spaced, and hyphenated forms without duplicating enum rules. Governs R1, R4, R5, and R9.
- KTD2. Carry a server-resolved default parent identity separately from the ordered selectable-parent array. This preserves relation order while allowing `canonicalParent` and the client selector to initialize from the preferred parent. Governs R1-R4 and R8.
- KTD3. Resolve the default only after the existing manifest eligibility filter. An unavailable or undersized feature-film parent must not bypass route admission or suppress the current fallback. Governs R3-R5.
- KTD4. Keep `canonicalParent` as the shared initial-rail contract for `SiblingCarousel` and related-item JSON-LD. The client consumes the server decision and does not classify labels during hydration. Governs R7-R9.

### Assumptions

- The compact block can express the preferred default through existing parent identity plus one server-derived identifier without serializing label metadata to the browser.
- Existing contextual-route tests remain the authoritative regression proof for explicit collection precedence.
- The reported JESUS clip resolves a parent relation whose normalized Admin label is `featureFilm`; U3 must verify and record that real catalog evidence rather than relying only on fixtures.

### Sources and Research

- `docs/roadmap/platform/feat-287-watch-standalone-collection-episodes.md` — existing eligibility, ordering, and standalone-only selector contract.
- `docs/solutions/logic-errors/tv-childcount-not-a-series-container-signal.md` — label, not child count, classifies a feature film with chapters.
- `docs/solutions/database-issues/prisma-raw-sql-enum-mapping-seam-20260504.md` — mapped enum and camelCase normalization seam.
- `docs/solutions/integration-issues/watch-legacy-context-standalone-redirect.md` — explicit contextual route precedence.
- `docs/solutions/design-patterns/relation-specific-order-in-aggregated-read-models-20260616.md` — preserve relation order separately from default state.
- `docs/solutions/conventions/frontend-change-page-load-performance-verification.md` — frontend page-loading verification expectations.

## Implementation Units

### U1. Resolve the standalone default parent

- **Goal:** Select an eligible feature-film parent as the standalone rail default without reordering collection choices.
- **Requirements:** R1-R5, R8-R9; AE1 and AE3.
- **Dependencies:** None.
- **Files:**
  - `apps/web/src/app/[locale]/[htmlLang]/[...rest]/page.tsx`
  - `apps/web/src/lib/content.ts`
  - `apps/web/src/lib/video-labels.ts`
  - `apps/web/src/app/[locale]/[htmlLang]/[...rest]/__tests__/page-routing.test.tsx`
  - `apps/web/src/lib/__tests__/content-watch-merge.test.ts`
- **Approach:** Reuse KTD1 after the existing standalone parent filter. Pass the chosen identity through the merge boundary per KTD2, then let the sibling block use it as `canonicalParent` while retaining the original selectable-parent order.
- **Execution note:** Strengthen the existing standalone route test first and observe the current first-parent behavior before changing production code.
- **Patterns to follow:** `selectableParentsForStandaloneVideo`, `buildSiblingCarouselBlock`, `mergeWatchExperience`, and the existing multi-parent standalone route fixture.
- **Test scenarios:**
  - Covers AE1. A later `FEATURE_FILM` parent becomes `canonicalParent` while the selector array and admitted child arrays retain Admin order.
  - A camelCase `featureFilm` label produces the same default classification.
  - Covers AE3. No eligible feature-film parent preserves the first-parent default.
  - An ineligible feature-film parent does not displace the first remaining eligible parent.
  - Multiple eligible feature-film parents choose the first in Admin order.
  - Standalone hero progression, Share identity, breadcrumbs, and related-item JSON-LD retain their established contracts except that the item list follows the preferred rail.
- **Verification:** Focused page-routing and content-merge tests prove the server model, eligibility fallback, preserved ordering, and structured-data alignment.

### U2. Consume the server default without client inference

- **Goal:** Initialize the collection selector from the server-selected canonical parent while preserving switching and navigation behavior.
- **Requirements:** R2, R6-R9; AE1 and AE2.
- **Dependencies:** U1.
- **Files:**
  - `apps/web/src/components/watch/SiblingCarousel.tsx`
  - `apps/web/src/components/watch/__tests__/SiblingCarousel.test.tsx`
  - `apps/web/src/components/watch/__tests__/WatchPageClient.navigation.test.tsx`
- **Approach:** Treat `canonicalParent` as the default even when selectable parents exist. Keep every selectable option and existing per-video local selection reset behavior. Add no label to the client model and no browser-side classification.
- **Patterns to follow:** Existing `parentSelection` scoping by `currentVideoDocumentId`, selector change handling, and contextual episode route builders.
- **Test scenarios:**
  - The selector initially chooses a canonical parent that is not the first option and renders that parent's episodes.
  - Manual switching still reaches every retained parent and builds contextual episode hrefs from the chosen parent.
  - A changed current video discards the prior local selection and uses the next server canonical parent.
  - Covers AE2. A fixed contextual block remains selector-free and uses its URL-selected canonical parent.
- **Verification:** Focused sibling-carousel and navigation tests prove initialization, switching, reset, and contextual parity without a new request or client label dependency.

### U3. Close verification and roadmap evidence

- **Goal:** Validate the touched Web surface and record completion evidence in feat-344.
- **Requirements:** R6-R9; AE1-AE3.
- **Dependencies:** U1 and U2.
- **Files:**
  - `docs/roadmap/platform/feat-344-watch-feature-film-collection-default.md`
  - `docs/roadmap/README.md`
- **Approach:** Run the focused Watch suite, Web static checks, and browser smoke. Verify that the reported JESUS clip's resolved Watch snapshot includes its expected feature-film parent with a normalized `featureFilm` label. Record the catalog evidence, exact test outcomes, and page-loading observation before marking the ticket complete; stop if the live relationship is absent or contradicts the assumption.
- **Test scenarios:** Test expectation: none — this unit records evidence for behavior covered by U1 and U2.
- **Verification:** The roadmap shows `complete`, focused tests and Web checks pass, and browser evidence confirms the default, retained options, explicit-route parity, and no additional data request.

## Verification Contract

| Gate                      | Scope                                                                      | Required result                                                                                                                |
| ------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Focused Watch tests       | Page routing, content merge, sibling carousel, navigation, structured data | All relevant tests pass, including feature-film default and contextual parity                                                  |
| Web typecheck             | `@forge/web`                                                               | Passes with the extended server/client model contract                                                                          |
| Web lint                  | `@forge/web`                                                               | Passes, including generated UI-locale drift checks                                                                             |
| Formatting and whitespace | Touched source, tests, plan, and roadmap files                             | Prettier and `git diff --check` pass                                                                                           |
| Catalog evidence          | Reported JESUS standalone clip and resolved Watch parent snapshot          | Expected feature-film parent relation is present and normalizes to `featureFilm`; contradiction blocks completion              |
| Browser QA                | Standalone and contextual Watch routes at desktop and compact widths       | Feature film selected on standalone, every eligible option retained, contextual parent fixed, no console or network regression |
| Page loading              | Initial HTML/RSC and request waterfall                                     | No browser-side data request, new client label payload, or hydration work                                                      |

## Definition of Done

- U1-U3 satisfy their requirements and verification outcomes.
- Every applicable acceptance example has automated or browser evidence.
- The feature-film preference uses normalized Admin label metadata after eligibility filtering.
- Selectable parent and child order remain relation-owned.
- Standalone and contextual route identity contracts remain unchanged.
- The roadmap ticket is complete with verification notes.
- Real catalog evidence for the reported JESUS parent relation is recorded; fixtures are not the sole proof of classification.
- Review findings are fixed or durably recorded through the LFG residual workflow.
- Dead-end or experimental code is absent from the final diff.
