---
title: "Watch Collection Feed End-Of-List Notice Removal - Plan"
type: fix
date: "2026-08-31"
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
---

# Watch Collection Feed End-Of-List Notice Removal - Plan

## Goal Capsule

- **Objective:** A visitor who scrolls to the bottom of the `/watch` collection feed sees the feed end quietly — no end-of-library notice, and no empty band where it used to sit.
- **Means:** Render the exhausted-feed sentence screen-reader-only and collapse the sentinel's reserved height (KTD1, KTD2).
- **Authority:** Requirements win on behavior. KTDs win on mechanism inside those requirements. Units override neither.
- **Execution profile:** Small, localized UI removal in one client component plus its colocated test. Two units, U2 depending on U1.
- **Stop conditions:** Stop and report if collapsing the sentinel changes paging behavior while pages remain, or if the browser smoke's page-scroll-height predicate in the Verification Contract fails.
- **Tail ownership:** `ce-work` implements and verifies locally. Shipping belongs to the calling pipeline.

## Product Contract

### Summary

Stop showing the "You've reached the end of the collection library." notice at the bottom of the `/watch` infinite-scroll collection feed, and remove the vertical band it reserved. Keep the polite announcement for screen-reader users.

### Problem Frame

When the collection feed runs out of pages, `apps/web/src/components/sections/DynamicMediaCollection.tsx` swaps its sentinel's contents for a visible paragraph reading "You've reached the end of the collection library." On the dark Watch page that renders as a stray line of grey text under the last rail. The user pointed at that rendered line and asked for it not to be shown.

### Requirements

- R1. The end-of-collection-library notice is never visible to a sighted visitor.
- R2. A screen-reader user still receives a polite announcement when the feed exhausts.
- R3. Once the feed is exhausted and no retry button is showing, the sentinel reserves no vertical space.
- R4. Behavior while pages remain is unchanged: the error/retry branch, the visible "Loading more collections…" line, and the `IntersectionObserver` paging trigger all work as they do today.

### Key Decisions

- **Hide the notice rather than restyle it.** (session-settled: user-directed — chosen over keeping it visible with softer styling: the user pointed at the rendered string and said not to show it.) Governs R1.

## Planning Contract

### Key Technical Decisions

- KTD1. **Keep the exhausted-feed branch and change only its styling to screen-reader-only.** Do not fold the sentence into the `liveMessage` paragraph. The loader sets `liveMessage` to the end-of-library sentence only when the final page appended nothing — its `appendedCount > 0` arm wins first — so on the common path, where the last page appends collections and reports no next page, `liveMessage` reads "Loaded N more collections." and the end-of-library announcement disappears. Hold the sentence in one exported module constant that the loader, the render, and the tests all reference. Deleting the string outright would satisfy R1 and drop R2. Governs R1, R2.
- KTD2. **Collapse the reserved space with a conditional className, not by unmounting the sentinel div.** The observer effect reads `sentinelRef.current` and re-arms whenever `hasNextPage` flips back to true on a feed-identity change, so the div and its ref must survive every state. Governs R3, R4.
- KTD3. **Leave the has-more idle state's reserved band alone.** That state already renders its paragraph sr-only today; changing its height is outside the ask and would shift the sentinel relative to the viewport while paging is live.

### Assumptions

- Keeping the polite announcement is the right resolution of R2. The invoking brief left it open and no user was available to ask; dropping a live-region announcement is the more destructive default, so the plan keeps it.

### Risks

- Tailwind's `.sr-only` is `position: absolute`. Per `docs/solutions/ui-bugs/sr-only-absolute-overflow-escapes-unpositioned-scroll-container.md`, an sr-only box whose containing block sits outside its scroller can extend the page's scrollable overflow. This change introduces no new absolutely-positioned shape — the same paragraph already renders sr-only in the has-more idle state — but jsdom performs no layout and cannot see this class of regression, so the browser smoke in the Verification Contract carries it.

## Implementation Units

### U1. Render the exhausted-feed notice screen-reader-only

- **Goal:** The end-of-library sentence stops rendering visibly and still reaches screen readers through the sentinel's live region.
- **Requirements:** R1, R2, R4 (KTD1)
- **Dependencies:** none
- **Files:**
  - `apps/web/src/components/sections/DynamicMediaCollection.tsx`
  - `apps/web/src/components/sections/DynamicMediaCollection.test.tsx`
- **Approach:**
  1. Extract the end-of-library sentence into an exported module constant and point the loader's existing `setLiveMessage` call at it.
  2. Leave the `status === "error"` retry branch of the sentinel unchanged.
  3. Change the exhausted branch's paragraph from its visible text classes to `sr-only`, rendering the constant. Leave the has-more paragraph's visible-while-loading / `sr-only`-otherwise switch alone, per KTD3.
- **Patterns to follow:** the `sr-only` className already applied to the has-more paragraph in the idle state.
- **Test scenarios:**
  - Final page returns two new collections with `hasNextPage: false`: the sr-only paragraph reads the end-of-library sentence, not "Loaded 2 more collections." This is the discriminating case — an implementation that reused `liveMessage` would fail here and pass every other scenario — so it is what pins KTD1.
  - Feed returns `hasNextPage: false` and no collections on the first page: the paragraph carrying the end-of-library sentence has the `sr-only` class. Assert on the element's class, not on `container.textContent` — jsdom applies no CSS, so the sentence stays in `textContent` either way and a text assertion cannot tell the two renders apart.
  - Same state: the `aria-live` sentinel still contains the end-of-library sentence, proving the announcement survived.
  - Repeated duplicate-only pages (the suite's existing stop-after-duplicates case): the same sr-only class assertion, since that path also lands on the exhausted state.
  - Pages remain and a request is in flight: the paragraph carries no `sr-only` class and reads "Loading more collections…".
  - Feed request fails: the retry button renders and no end-of-library paragraph is present.
- **Verification:** the web unit suite passes, and neither of the two pre-existing `container.textContent` assertions on the sentence remains — each is replaced by a class-level assertion.

### U2. Collapse the sentinel's reserved band once the feed is exhausted

- **Goal:** The feed's last rail is the last thing on the page; no empty band follows it.
- **Requirements:** R3, R4 (KTD2, KTD3)
- **Dependencies:** U1
- **Files:**
  - `apps/web/src/components/sections/DynamicMediaCollection.tsx`
  - `apps/web/src/components/sections/DynamicMediaCollection.test.tsx`
- **Approach:**
  1. Make the sentinel div's spacing classes conditional: keep the minimum height and vertical padding while the retry button shows or pages remain, and drop them once the feed is exhausted and not in error.
  2. Keep `ref={sentinelRef}`, `aria-live="polite"`, and `WATCH_PAGE_CONTENT_CLASSES` on the div in every state, per KTD2.
- **Test scenarios:**
  - Exhausted feed: the sentinel element carries neither the minimum-height nor the vertical-padding class.
  - Pages remain: the sentinel still carries both.
  - Error state: the sentinel still carries both, so the retry button is not cramped.
  - Feed props change after exhaustion (locale switch): `hasNextPage` resets, the sentinel regains its spacing, and a new `IntersectionObserver` observes the same element — this is the assertion that would fail if the div were unmounted instead of restyled.
- **Verification:** the web unit suite passes, and in a real browser the bottom of the `/watch` collection feed ends with the last rail, no grey text and no empty band below it.

## Verification Contract

| Gate          | Command                                                                                                                   | Applies to |
| ------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Unit tests    | `pnpm --filter @forge/web test`                                                                                           | U1, U2     |
| Typecheck     | `pnpm --filter @forge/web typecheck`                                                                                      | U1, U2     |
| Lint          | `pnpm --filter @forge/web lint`                                                                                           | U1, U2     |
| Browser smoke | `pnpm --filter @forge/web build` then `pnpm --filter @forge/web start`, scroll `/watch` to the end of the collection feed | U1, U2     |

- The browser smoke covers the sr-only overflow risk that jsdom cannot see, with an explicit pass predicate: at the exhausted state, take the last visible rail's document-coordinate bottom, and fail if `document.scrollingElement.scrollHeight` exceeds the greater of that value and the viewport height by more than one CSS pixel. Record both measured numbers.
- The browser smoke also proves R2 rather than inferring it from the DOM: exhaust the feed with a screen reader running and confirm the end-of-library sentence is announced once while staying visually hidden. U1's assertions check the final DOM's content and class, which a live region that never mutated would also satisfy.
- Page-load performance evidence is required by `CLAUDE.md` for frontend changes (`docs/solutions/conventions/frontend-change-page-load-performance-verification.md`). This change only removes DOM and CSS classes from an existing client component and adds no render or hydration work; record that reasoning together with a Web Vitals or LCP reading taken during the browser smoke.

## Definition of Done

- R1 through R4 hold.
- Every gate in the Verification Contract is green.
- The end-of-library sentence is written once in production, as an exported module constant the loader and the render both reference. No visible-render occurrence remains. At least one test spells the sentence out instead of importing that constant — an oracle that shares the value under test cannot catch the value being wrong.
- No abandoned-attempt code is left in the diff.

## Sources / Research

- `apps/web/src/components/sections/DynamicMediaCollection.tsx` — the sentinel's three-way render branch, the `setLiveMessage` calls, and the observer effect that returns early when `hasNextPage` is false.
- `apps/web/src/components/sections/DynamicMediaCollection.test.tsx` — the two existing assertions that match the sentence through `container.textContent`.
- `docs/solutions/ui-bugs/sr-only-absolute-overflow-escapes-unpositioned-scroll-container.md` — why an sr-only box needs browser-level overflow verification.
- `docs/solutions/conventions/frontend-change-page-load-performance-verification.md` — the repo's load-impact evidence rule for frontend changes.
