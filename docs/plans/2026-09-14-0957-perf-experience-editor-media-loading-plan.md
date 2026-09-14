---
title: "Experience Editor Media Loading Performance - Plan"
type: "perf"
date: "2026-09-14"
artifact_contract: "ce-unified-plan/v1"
product_contract_source: "ce-plan-bootstrap"
execution: "code"
---

# Experience Editor Media Loading Performance - Plan

## Goal Capsule

- **Objective:** Experience authors can open and edit large Experience pages without media-library growth making the editor unresponsive.
- **Means:** Bound initial image loading to assets referenced by the active document, load the browse catalog on demand, and index preview lookup in the client (KTD1, KTD2).
- **Authority:** The user report and `docs/roadmap/platform/feat-501-admin-experience-editor-performance.md` define the outcome; repository conventions and this plan define implementation constraints.
- **Execution profile:** Bounded Admin frontend and server-rendering performance fix.
- **Stop conditions:** Stop if preserving referenced-image previews requires changing the Experience block schema or if media-library access needs a new authorization model.
- **Ownership:** The implementing workflow finishes validation and ships the change through the normal PR-to-main path.

## Product Contract

### Summary

Reduce initial route work and interaction cost in the Admin Experience editor while preserving the existing image picker and authored-image previews.

### Problem Frame

The editor route currently queries and serializes every ready image before the picker is opened. Canvas rendering also resolves managed image previews with repeated linear scans through that catalog. As the media library grows, both route latency and unrelated editing interactions become progressively more expensive.

### Requirements

**Initial loading**

- R1. Opening an Experience editor loads only ready image assets referenced by the active block document.
- R2. Every referenced managed image that is still available retains its canvas preview on initial render.

**Picker behavior**

- R3. Opening the image picker loads the complete ready-image catalog and folder hierarchy on demand.
- R4. The picker exposes loading and retryable failure feedback without blocking other editor functions.

**Editing performance and compatibility**

- R5. Canvas preview resolution does not repeatedly scan the full media catalog during editor renders.
- R6. Existing image selection, clearing, folder browsing, upload, save, and publish behavior remains compatible.

### Acceptance Examples

- AE1. Covers R1 and R2. Given a document that references two managed image IDs and a larger media library, opening the editor queries the two referenced ready assets and renders their available previews without fetching the browse catalog.
- AE2. Covers R3 and R4. Given an editor whose full image catalog has not loaded, opening the picker shows a loading state, then renders the returned catalog; a failed request exposes a retry action.
- AE3. Covers R5. Given a loaded catalog and a canvas with multiple image-bearing blocks, preview lookup is keyed by asset ID rather than a full-array scan per lookup.

### Scope Boundaries

- Keep changes within `apps/admin` and supporting roadmap/plan documentation.
- Do not change Experience block schemas, generated GraphQL artifacts, database schema, deployment configuration, or production infrastructure.
- Preserve the normal PR-to-main deployment flow; no direct Railway deployment is part of this work.
- Treat the independently observed production-origin timeout as an operational follow-up unless repository evidence ties it to this route.

## Planning Contract

### Key Technical Decisions

- KTD1. **Split preview data from browse data.** The initial server render queries referenced image IDs only; a server action returns the complete folder and image catalog when the picker opens. This satisfies R1-R4 without removing existing previews.
- KTD2. **Index client preview lookup.** Build a memoized asset-ID map from the current media data and use it for canvas and picker selection lookup, satisfying R5 while keeping the existing editor state model.
- KTD3. **Discover referenced IDs recursively.** Traverse the JSON-derived block document for the canonical managed-media ID fields so nested sections, containers, carousels, and quote items remain covered without duplicating the block schema.

### Assumptions

- Existing session enforcement is the correct authorization boundary for loading the same image library data that the route previously loaded eagerly.
- Media folders are needed only for browsing, not for rendering already-authored canvas previews.
- The complete media catalog may remain large; moving it behind explicit picker use is preferable to changing picker search or pagination behavior in this scoped fix.

### Sequencing

U1 establishes the bounded server data contract and recursive reference discovery. U2 consumes that contract in the editor and picker. U3 verifies integration behavior and performance-sensitive boundaries.

## Implementation Units

### U1. Bound initial Experience media loading

- **Goal:** Remove the full media-library query and serialization from initial editor rendering while retaining referenced previews.
- **Requirements:** R1, R2, R3; AE1.
- **Dependencies:** None.
- **Files:**
  - `apps/admin/src/app/dashboard/experiences/[id]/page.tsx`
  - `apps/admin/src/app/dashboard/experiences/experience-editor/block-helpers.ts`
  - `apps/admin/src/app/dashboard/experiences/experience-editor/block-helpers.test.ts`
- **Approach:**
  1. Add recursive managed-media ID discovery for JSON-derived block documents following KTD3.
  2. Parameterize media loading so initial rendering can select referenced IDs without loading folders.
  3. Expose the existing complete-library query through an authenticated server action for picker use.
- **Patterns to follow:** Existing `videoIdsFromExperienceBlocks` bounded hydration in `apps/admin/src/app/dashboard/live-data.ts` and route-local server actions in the Experience editor page.
- **Test scenarios:**
  - Covers AE1. Nested blocks containing duplicate, empty, and distinct managed image fields return unique non-empty IDs in document order.
  - An active document with no managed image references produces an empty bounded asset selection rather than a full-catalog query.
  - The complete-library action requires the existing Admin session before returning picker data.
- **Verification:** Initial page data is limited to referenced ready image IDs, and the full query is reachable only through the picker action.

### U2. Load picker data on demand and index previews

- **Goal:** Keep normal editing responsive while preserving full image browsing when requested.
- **Requirements:** R2-R6; AE2, AE3.
- **Dependencies:** U1.
- **Files:**
  - `apps/admin/src/app/dashboard/experiences/experience-editor.tsx`
  - `apps/admin/src/app/dashboard/experiences/experience-editor/image-picker-browser.tsx`
  - `apps/admin/src/app/dashboard/experiences/experience-editor/image-picker-browser.test.tsx`
- **Approach:**
  1. Seed editor media state with referenced preview assets and load the complete catalog once when the picker first opens.
  2. Deduplicate concurrent requests and retain the loaded catalog for the editor session.
  3. Refresh the retained catalog after a successful picker upload so the new asset is immediately selectable without closing or manually reloading the editor; preserve the open picker and selected folder.
  4. Resolve previews and selected assets through a memoized ID map per KTD2.
  5. Present explicit loading and retryable error states inside the existing picker shell, with a polite live status for loading/completion and an alert announcement for failures.
- **Patterns to follow:** Existing controlled picker state and modal accessibility behavior in `image-picker-browser.tsx`.
- **Test scenarios:**
  - Covers AE2. The picker displays loading feedback while the action is pending and displays returned assets after resolution.
  - Covers AE2. A rejected load displays failure copy and invokes the retry callback when the user selects Retry.
  - Covers AE3. Opening the editor without opening the picker does not call the complete-library action.
  - Opening the picker more than once after a successful load reuses the catalog rather than requesting it again.
  - An authored image in the initial bounded data continues to render before the browse catalog loads.
  - A successful picker upload refreshes the catalog and exposes the uploaded asset without a full page reload.
  - Loading/completion and failure feedback use appropriate live-region and alert semantics.
- **Verification:** The picker retains its selection, clear, folder, and accessibility behavior, while unrelated editor renders use indexed preview lookup.

### U3. Regression and performance-boundary verification

- **Goal:** Prove the optimization preserves editor behavior and passes Admin quality gates.
- **Requirements:** R1-R6; AE1-AE3.
- **Dependencies:** U1, U2.
- **Files:**
  - `apps/admin/src/app/dashboard/experiences/experience-editor.test.tsx`
  - `apps/admin/src/app/dashboard/experiences/experience-editor/image-picker-browser.test.tsx`
  - `apps/admin/src/app/dashboard/experiences/experience-editor/block-helpers.test.ts`
  - `docs/roadmap/platform/feat-501-admin-experience-editor-performance.md`
- **Approach:** Add focused integration coverage for deferred loading, run the full affected editor suite, confirm the initial media query is cardinality-bounded in code review, and capture before/after editor-readiness and first-picker-readiness timings against a representative large Experience when an authenticated responsive runtime is available.
- **Test scenarios:**
  - The complete image library is not requested before the picker opens and is visible after the deferred request resolves.
  - Existing editor image-selection tests remain green across section, carousel, collection, quote, and card image fields.
  - Type checking and linting accept the server-action return type and client state transitions.
  - Representative before/after timings show that initial editor readiness improves without an unacceptable first-picker regression; if the runtime is unavailable, record the exact external blocker and retain the benchmark as a required follow-up.
- **Verification:** Focused tests, Admin type checking, scoped linting, formatting, and diff-integrity checks pass.

## Verification Contract

| Gate                | Scope                                                                                                                                                                                                                                             | Done signal                                                                                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Focused behavior    | `pnpm --filter @forge/admin test -- src/app/dashboard/experiences/experience-editor.test.tsx src/app/dashboard/experiences/experience-editor/image-picker-browser.test.tsx src/app/dashboard/experiences/experience-editor/block-helpers.test.ts` | Deferred loading, retry feedback, recursive ID discovery, and existing editor behavior pass.                                                                                             |
| Type safety         | `pnpm --filter @forge/admin typecheck`                                                                                                                                                                                                            | No TypeScript errors.                                                                                                                                                                    |
| Static quality      | Scoped Admin ESLint over all touched TypeScript and TSX files                                                                                                                                                                                     | No lint errors.                                                                                                                                                                          |
| Formatting          | Prettier check over touched source and documentation files                                                                                                                                                                                        | All files match repository formatting.                                                                                                                                                   |
| Diff integrity      | `git diff --check`                                                                                                                                                                                                                                | No whitespace errors.                                                                                                                                                                    |
| Runtime observation | Authenticated before/after timing and smoke of the linked Experience route using a representative large document and media catalog when a usable browser and responsive production or isolated preview are available                              | Initial editor readiness improves, first-picker readiness remains usable, and image operations are preserved; otherwise the exact external blocker and benchmark follow-up are recorded. |

## Definition of Done

- U1-U3 satisfy their requirements and test scenarios.
- Initial media loading is bounded to referenced IDs, and the full library is deferred until picker use.
- Canvas preview resolution uses an indexed lookup.
- Existing Experience image workflows remain covered and green.
- All applicable Verification Contract gates pass; any unavailable runtime smoke is recorded with the exact environmental blocker.
- The roadmap ticket is complete, no abandoned implementation attempts remain, and the final diff is committed and shipped through an open PR.
