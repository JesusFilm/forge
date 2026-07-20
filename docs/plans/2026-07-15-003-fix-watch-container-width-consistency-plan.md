---
title: "Watch Container Width Consistency - Plan"
type: "fix"
date: "2026-07-15"
artifact_contract: "ce-unified-plan/v1"
artifact_readiness: "implementation-ready"
product_contract_source: "ce-plan-bootstrap"
execution: "code"
roadmap_ticket: "docs/roadmap/platform/feat-263-watch-container-width-consistency.md"
---

# Watch Container Width Consistency - Plan

## Goal Capsule

Make every public Watch page use the same centered 1920px parent and section frame already used by the home page and single-video experience. Remove narrower route-local outer caps and cap currently unbounded series sections, while retaining intentional inner constraints for prose, cards, modals, overlays, and controls.

Success is observable at greater-than-1920px viewports: the language index, language inventory, history, and series sections all resolve to the same 1920px width and centered horizontal origin as the reference Watch surfaces. At smaller viewports they remain full-width with their existing responsive gutters and behavior.

---

## Product Contract

### Problem

Public Watch routes currently expose three incompatible page-frame behaviors. The home and single-video surfaces use the shared `max-w-[1920px]` contract; `/watch/languages`, language inventory, and history stop at smaller route-local caps; series metadata and episode sections remain uncapped. The mismatch is visible during navigation on wide displays and makes page composition feel inconsistent.

### Actors

- **A1 — Watch viewer:** navigates among home, videos, language discovery, history, and series pages on mobile through ultrawide displays.
- **A2 — Watch frontend maintainer:** needs one reusable layout contract that prevents route-local width drift.

### Requirements

- **R1:** Every public Watch parent or content section must use the shared 1920px maximum-width contract used by home and single-video pages.
- **R2:** The language index, language inventory, and history pages must replace their narrower route-local outer caps with the shared contract.
- **R3:** Series metadata and episode sections must be centered and capped by the shared contract instead of extending beyond 1920px.
- **R4:** Existing horizontal padding ladders, carousel bleed/spacer relationships, series grid behavior, and atmospheric backdrop layers/transitions must remain unchanged; the series episode backdrop's outer extent follows the newly capped section frame.
- **R5:** Intentional inner measures—including prose line lengths, cards, modals, player overlays, buttons, and error messages—must not be treated as page-frame drift.
- **R6:** The change must not add client initialization, hydration work, scripts, requests, dependencies, or data-flow changes.
- **R7:** Tests must fail if the shared width token changes unexpectedly or the migrated public Watch surfaces reintroduce divergent outer width classes.

### Acceptance Examples

- **AE1 (R1, R2):** Given a 2200px viewport, when a viewer opens `/watch/languages`, its outer content section is 1920px wide and centered, matching `/watch`.
- **AE2 (R1, R2):** Given a 2200px viewport, when a viewer opens a language inventory or history route, the principal section is 1920px wide rather than `max-w-7xl` or `max-w-5xl`.
- **AE3 (R1, R3):** Given a 2200px viewport, when a viewer opens a series route with either a playable trailer or a static hero, the hero overlay, metadata, and episode sections are each 1920px wide and share the same horizontal origin; the static hero media remains full-bleed.
- **AE4 (R4, R5):** Given mobile and desktop viewports, migrated pages retain their current responsive gutters, grid density, readable text measures, modal sizing, and carousel behavior.
- **AE5 (R6):** Comparing the implementation to the current render path shows class composition only: no new client component, effect, request, script, or dependency.

### Scope Boundaries

In scope:

- Public Watch page-frame and section-frame class composition.
- Language index, language inventory, history, series metadata, and series episode sections identified by the repository-wide width audit.
- Focused regression tests, browser geometry checks, and page-load performance evidence.

Out of scope:

- Changing the canonical 1920px value.
- Redesigning responsive gutters, carousel bleed, grid density, cards, modals, overlays, or content typography.
- GraphQL schema or generated type changes.
- Content, navigation, localization, playback, preference, or data-fetching behavior.
- Production deployment; shipping follows the normal PR-to-main flow.

### Key Decisions

- **KTD1 — One shared public Watch frame.** `session-settled: user-directed` — use the existing exported 1920px content-width contract for public Watch parents and sections, chosen over preserving route-specific outer caps.
- **KTD2 — Distinguish outer frames from inner measures.** Route and section wrappers that define page geometry migrate; intentional inner constraints remain local so readability and component behavior are preserved.
- **KTD3 — Preserve gutter semantics.** Compose the shared alignment/max-width classes with each surface's existing padding ladder instead of replacing the ladder with a different shared padding preset.
- **KTD4 — Keep the change render-only.** Implement through existing server/client JSX class composition without new state, effects, network work, or runtime measurement code.

### Assumptions

- The shared `CONTENT_MAX_WIDTH` value remains `max-w-[1920px]` because home, single-video, Experience sections, institutional documentation, and the live comparison all establish it as the canonical frame.
- A full-viewport page background or static hero media may remain on the route root; the visible content-bearing parent, overlay anchor, or section inside it must use the shared centered frame. The episode section's atmospheric layers remain structurally and behaviorally unchanged inside that capped section.
- Inner `max-w-*` classes are retained when they constrain a message, prose block, modal, card, image, or overlay rather than the page/section frame.

---

## Planning Contract

### Existing Contract and Evidence

- `apps/web/src/lib/content-width.ts` exports `CONTENT_MAX_WIDTH`, `CONTENT_WIDTH_ALIGN_CLASSES`, `CONTENT_WIDTH_CLASSES`, and `WATCH_PAGE_CONTENT_CLASSES`; the existing canonical maximum is 1920px.
- `apps/web/src/components/sections/Section.tsx` and `apps/web/src/components/home/WatchHomeExperiencePage.tsx` are the reference section and home implementations.
- Live geometry at a 2200px viewport measured `/watch` sections at 1920px and `/watch/languages` at 1792px (`112rem`), confirming the reported mismatch.
- Repository search found route-frame divergences in `WatchLanguageIndexBrowser.tsx`, `LanguageInventoryPage.tsx`, the history page, `SeriesPageClient.tsx`, and `SeriesEpisodesGrid.tsx`. Other smaller `max-w-*` uses are intentional inner measures.
- Relevant institutional learnings require a shared token, lockstep carousel padding/bleed/spacer changes, measurement-driven browser checks, and page-load evidence for frontend rendering changes.

### Implementation Strategy

Use `CONTENT_WIDTH_ALIGN_CLASSES` wherever a surface already owns its responsive padding, and keep those padding classes unchanged. Strengthen the shared contract test, then update each audited page/section callsite and its focused rendering assertions. Add a history route test because that surface currently lacks direct coverage. Finish with an explicit inventory of every public Watch route shape and its primary content-bearing wrappers; use `max-w-*` search as a secondary audit so wrappers with no maximum-width token cannot escape verification.

### Dependency Order

1. **U1** locks the shared token and reusable contract in tests.
2. **U2** migrates the narrower language/history page frames using U1.
3. **U3** caps the unbounded series sections using U1.
4. **U4** audits and verifies the integrated public Watch surface after U2 and U3.

### Risks and Mitigations

- **Wide-screen visual regression:** backgrounds or grid content could appear abruptly capped. Mitigate with centered geometry checks and screenshots above 1920px, plus representative desktop/mobile smoke.
- **Accidental inner-width expansion:** replacing every `max-w-*` mechanically could damage readability or modal/card behavior. Mitigate by changing only audited page/section wrappers and asserting intentional inner classes remain.
- **Existing dirty branch overlap:** the branch contains user-owned Watch work, including overlapping files. Record the baseline dirty paths and overlapping hunks before implementation, use narrow `apply_patch` edits with no reset/checkout, stage only ticket-owned hunks, and verify both the staged diff and PR diff against an explicit allowlist. If a ticket-owned hunk cannot be separated safely from pre-existing work, stop before commit/push and surface the scope conflict.
- **Carousel alignment regression:** shared width code is adjacent to bleed tokens. Mitigate by leaving padding/bleed/spacer exports untouched and running their lockstep tests.
- **Frontend performance regression:** class composition should be runtime-neutral, but the repository requires evidence. Mitigate by documenting that the diff adds no JS paths or requests and checking page-load/network behavior during browser QA.

---

## Implementation Units

### U1 — Lock the shared Watch frame contract

**Goal:** Make the canonical 1920px maximum and composed alignment classes explicit regression contracts before migrating consumers.

**Files:**

- Modify `apps/web/src/lib/__tests__/content-width.test.ts`.
- Read/reference `apps/web/src/lib/content-width.ts`; change it only if a small named composition improves reuse without altering existing public exports.

**Requirements:** R1, R4, R7.

**Approach:**

- Add a direct assertion for `CONTENT_MAX_WIDTH === "max-w-[1920px]"`.
- Assert `CONTENT_WIDTH_ALIGN_CLASSES` contains the centered full-width behavior and exactly the shared maximum token.
- Retain existing carousel padding, bleed, and spacer invariant coverage unchanged.

**Test scenarios:**

- The shared maximum-width token is exactly the canonical Tailwind arbitrary value.
- The alignment helper composes `mx-auto`, `w-full`, and the shared token.
- Existing rail and carousel lockstep tests remain green.

**Verification:**

- `pnpm --filter @forge/web exec vitest run src/lib/__tests__/content-width.test.ts`

### U2 — Migrate narrower language and history page frames

**Goal:** Replace all audited route-local outer caps that are narrower than the canonical Watch frame.

**Files:**

- Modify `apps/web/src/components/watch/WatchLanguageIndexBrowser.tsx`.
- Modify `apps/web/src/components/watch-language-inventory/LanguageInventoryPage.tsx`.
- Modify `apps/web/src/app/[locale]/[htmlLang]/history/page.tsx`.
- Modify `apps/web/src/components/watch/WatchLanguageIndexBrowser.test.tsx`.
- Modify `apps/web/src/app/[locale]/[htmlLang]/languages/page.test.tsx` if route-level coverage needs strengthening.
- Modify `apps/web/src/app/[locale]/[htmlLang]/videos/[languageSlug]/page.test.tsx`.
- Create `apps/web/src/app/[locale]/[htmlLang]/history/page.test.tsx`.

**Requirements:** R1, R2, R4, R5, R7.

**Approach:**

- Import and compose `CONTENT_WIDTH_ALIGN_CLASSES` on the language index section, all language inventory content-bearing outer wrappers, and the history parent.
- Preserve each surface's current background, spacing, responsive padding, grid, and inner text/card constraints.
- Replace assertions for `max-w-[112rem]`, `max-w-7xl`, or `max-w-5xl` with shared-token assertions and explicit negative checks for the retired outer caps.
- Assert that each migrated outer wrapper's complete `max-w-*` token set contains exactly the canonical shared token and no other maximum-width token; retain the named retired-class checks as readable regression context.
- Add a focused history render test that verifies the shared frame on both populated and empty/error-safe render states available from the page contract.

**Test scenarios:**

- Language index root includes `mx-auto w-full max-w-[1920px]` and excludes `max-w-[112rem]`.
- Language inventory hero, controls/results, empty/loading, and pagination-bearing wrappers use the shared frame and exclude `max-w-7xl`.
- History parent uses the shared frame and excludes `max-w-5xl`; its intentional inner content constraints remain unchanged.
- Every migrated language/history outer wrapper exposes exactly one `max-w-*` token: `max-w-[1920px]`.
- Existing language navigation, filtering, pagination, and empty-state behavior remains green.

**Verification:**

- `pnpm --filter @forge/web exec vitest run src/components/watch/WatchLanguageIndexBrowser.test.tsx src/app/[locale]/[htmlLang]/languages/page.test.tsx src/app/[locale]/[htmlLang]/videos/[languageSlug]/page.test.tsx src/app/[locale]/[htmlLang]/history/page.test.tsx`

### U3 — Cap series content sections at the shared frame

**Goal:** Prevent series metadata and episode sections from exceeding the canonical Watch width while preserving their current interaction and visual behavior.

**Files:**

- Modify `apps/web/src/components/watch/SeriesPageClient.tsx`.
- Modify `apps/web/src/components/watch/SeriesEpisodesGrid.tsx`.
- Modify `apps/web/src/components/watch/SeriesHero.tsx`.
- Modify `apps/web/src/components/watch/__tests__/SeriesPageClient.test.tsx`.
- Modify `apps/web/src/components/watch/__tests__/SeriesEpisodesGrid.test.tsx`.
- Modify `apps/web/src/components/watch/__tests__/SeriesHero.test.tsx`.

**Requirements:** R1, R3, R4, R5, R6, R7.

**Approach:**

- Compose `CONTENT_WIDTH_ALIGN_CLASSES` into the metadata section and episode wrapper while leaving their existing responsive padding intact.
- Compose the same alignment classes into the static hero overlay anchor so the no-playable-trailer path matches `HeroPlayer`; leave the static media wrapper full-bleed.
- Keep the full-page stone background on the route root and retain the episode section's backdrop stacks, overlay layers, transitions, reducer, delegated events, and grid columns unchanged inside the capped episode wrapper.
- Add DOM class assertions for the shared centered maximum and exact single-token `max-w-*` invariant while preserving existing interaction assertions.

**Test scenarios:**

- Series metadata uses `mx-auto w-full max-w-[1920px]` when rendered.
- Episode wrapper uses the same frame and retains its existing padding, backdrop, and grid classes.
- Static series hero overlay anchor uses the same frame while its media wrapper remains full-bleed.
- Each migrated series content/overlay wrapper exposes exactly one `max-w-*` token: `max-w-[1920px]`.
- Series without metadata still renders the capped episode section.
- Hover/focus backdrop crossfade, language controls, share modal, and episode grid behavior remain green.

**Verification:**

- `pnpm --filter @forge/web exec vitest run src/components/watch/__tests__/SeriesPageClient.test.tsx src/components/watch/__tests__/SeriesEpisodesGrid.test.tsx src/components/watch/__tests__/SeriesHero.test.tsx`

### U4 — Audit, browser-verify, and record performance evidence

**Goal:** Prove there are no remaining divergent public Watch page/section frames and that the class-only change preserves loading behavior.

**Files:**

- Modify `docs/roadmap/platform/feat-263-watch-container-width-consistency.md` with final verification and `status: "complete"` after all gates pass.
- Create or update a durable `docs/solutions/` note only if the implementation reveals a reusable nuance beyond the existing shared-token and measurement guidance.

**Requirements:** R1–R7.

**Approach:**

- Enumerate every public Watch route shape and trace each primary content-bearing wrapper or delegated component to `CONTENT_WIDTH_ALIGN_CLASSES`; include every inventory entry in an automated class assertion or ultrawide geometry check.
- Search public Watch routes/components for `max-w-*` as a secondary check, classify every remaining occurrence as shared outer frame or intentional inner measure, and ensure content-bearing uncapped sections are eliminated.
- Run focused tests, typecheck, lint, format/CI-sensitive checks for the touched scope.
- At mobile, desktop, and ultrawide viewports, compare home, single video, language index, language inventory, history, and a series route. Record `getBoundingClientRect()` width and horizontal origin for the primary sections.
- Inspect page-load/network evidence and the final diff to confirm no added request, script, hydration boundary, effect, or client initialization.

**Test scenarios:**

- At viewport widths below 1920px, representative sections remain full-width inside their existing gutters without horizontal overflow.
- At viewport widths above 1920px, every representative primary section is 1920px wide and centered at the same horizontal origin.
- Remaining non-1920 `max-w-*` occurrences are demonstrably inner measures, not public Watch parents or content sections.
- The route/section inventory accounts for wrappers with no existing `max-w-*` token, including static series hero, metadata, and episode paths.
- Browser console has no new errors and the change adds no runtime resource or initialization path.

**Verification:**

- `rg -n 'max-w-' apps/web/src/app/[locale]/[htmlLang] apps/web/src/components/watch apps/web/src/components/watch-language-inventory apps/web/src/components/home apps/web/src/components/sections`
- `pnpm --filter @forge/web exec vitest run src/lib/__tests__/content-width.test.ts src/components/watch/WatchLanguageIndexBrowser.test.tsx src/components/watch/__tests__/SeriesPageClient.test.tsx src/components/watch/__tests__/SeriesEpisodesGrid.test.tsx src/components/watch/__tests__/SeriesHero.test.tsx src/app/[locale]/[htmlLang]/languages/page.test.tsx src/app/[locale]/[htmlLang]/videos/[languageSlug]/page.test.tsx src/app/[locale]/[htmlLang]/history/page.test.tsx`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- `pnpm --filter @forge/web format:check` if exposed by the package scripts; otherwise run the repository's documented PR-focused format check for the touched files.

---

## Verification Contract

### Automated Gates

1. Focused Vitest suite for shared width, language index, language inventory, history, and series surfaces passes.
2. `@forge/web` typecheck passes.
3. `@forge/web` lint passes without new warnings attributable to this work.
4. PR-focused formatting and CI-sensitive checks for the touched scope pass.
5. The final width audit finds no public Watch parent or content section using a divergent maximum width.
6. The route/section inventory traces every public Watch route shape to a shared-frame assertion or browser geometry check, including wrappers that previously had no `max-w-*` token.

### Browser Gates

Use real browser geometry rather than visual estimation. For each representative route, capture the primary content-bearing section's `width`, `left`, and `right` at a mobile viewport, a common desktop viewport, and a viewport wider than 1920px.

- `/watch` — canonical home reference.
- A single-video route — canonical video reference.
- `/watch/languages` — formerly 112rem.
- A language inventory route such as `/watch/english.html/videos` — formerly `max-w-7xl`.
- `/watch/history` — formerly `max-w-5xl`.
- A series route — formerly uncapped metadata and episode sections.

At the ultrawide viewport, all representative primary sections must report 1920px width and the same centered origin. At smaller widths they must not overflow the viewport. Exercise language filtering/navigation, series hover/focus behavior, and history rendering sufficiently to catch structural regressions.

### Performance Evidence

- Final diff contains only imports, class composition, tests, and documentation for this scope.
- No new `useEffect`, client boundary, listener, request, dependency, or script is introduced.
- Browser network/resource inspection shows no additional request attributable to the width change, and console inspection shows no new hydration/runtime error.

### Review Gates

- Run code simplification after implementation and retain only changes that improve clarity without altering behavior.
- Run plan-scoped code review and resolve every P0/P1 finding before browser QA.
- Re-run affected tests after any review fix.

---

## Definition of Done

- [ ] `CONTENT_MAX_WIDTH` is directly locked to `max-w-[1920px]` by tests.
- [ ] Language index, language inventory, and history outer/content sections use the shared centered 1920px contract.
- [ ] Series metadata and episode sections use the same shared contract.
- [ ] Static series hero overlay content uses the same shared contract while its media remains full-bleed.
- [ ] No public Watch parent or content section retains a narrower or uncapped divergent width.
- [ ] Intentional inner measure constraints and all existing responsive gutter/grid/carousel behavior remain intact.
- [ ] Focused tests, typecheck, lint, formatting, and CI-sensitive checks pass for the touched scope.
- [ ] Mobile, desktop, and ultrawide browser geometry checks pass on all representative route families.
- [ ] Page-load evidence confirms no new requests, scripts, hydration work, or client initialization.
- [ ] Plan-scoped simplification and code review findings are resolved.
- [ ] Roadmap ticket `feat-263` is marked complete with verification evidence.
- [ ] Any genuinely new durable learning is compounded into `docs/solutions/`; otherwise existing guidance is cited as sufficient.
- [ ] Changes are committed, pushed, opened as a PR through the normal flow, and CI/review are merge-ready.
- [ ] The staged and PR diffs contain only ticket-owned hunks verified against the recorded dirty-tree baseline and explicit allowlist.
- [ ] No abandoned compatibility path, dead code, generated GraphQL output edit, unrelated user-owned change, or direct production deployment is included.
