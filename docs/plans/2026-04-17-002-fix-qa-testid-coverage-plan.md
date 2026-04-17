---
title: "fix: Add testID coverage to unblock QA pipeline Maestro and Playwright flows"
type: fix
status: active
date: 2026-04-17
---

# fix: Add testID coverage to unblock QA pipeline Maestro and Playwright flows

## Overview

The cross-platform QA pipeline (PR #795) is set up correctly but 30 flows fail because the React Native and Next.js components lack the `testID` / `data-testid` attributes that Maestro and Playwright flows reference. This plan adds those attributes, then re-runs the pipeline to verify 100% pass rate is achievable.

## Problem Frame

First real run of the local QA pipeline surfaced:

- **iOS Maestro**: 29/49 passed, 20/49 failed — all failures are `Element not found: Id matching regex: tab-discover|tab-home|tab-library|tab-profile` (tab bar testIDs missing)
- **Android Maestro**: 29/49 passed, 20/49 failed — identical pattern to iOS
- **Playwright web**: 190/200 passed, 10/200 failed — mix of missing `data-testid` and fragile selector fallback chains (`.or()` with generic CSS selectors)
- **TV runner**: 76/76 passed — no testID coverage issues (focus navigation doesn't need them)

The QA pipeline itself works. What's missing is the component-side test hook contract.

## Requirements Trace

- R1. Mobile tab bar gets testIDs for each tab (tab-home, tab-discover, tab-library, tab-profile)
- R2. Mobile header buttons, search input, video controls, carousel items, cards, and modal controls get testIDs matching Maestro flow references
- R3. Web app equivalents get `data-testid` attributes matching Playwright flow references
- R4. After testID additions, `/qa` pipeline achieves ≥95% pass rate across all 5 surfaces for a representative change
- R5. Implementation does not change any user-visible behavior — testIDs are pure test infrastructure hooks

## Scope Boundaries

- No component logic changes, styling changes, or refactors
- No new flows — existing flows stay as-is, only the component attributes change
- Does not fix the Playwright `waitForTimeout` anti-pattern flagged in code review — that's a separate test-authoring concern
- Does not add testIDs for elements not referenced by existing flows

### Deferred to Separate Tasks

- Playwright `waitForTimeout` → `waitForSelector`/`expect` migration: separate PR focused on test reliability
- Additional Maestro/Playwright flows for coverage gaps: add incrementally as features ship
- Fragile `.or()` fallback selector cleanup: fold into the `waitForTimeout` PR since both are test-quality work

## Context & Research

### Relevant Code and Patterns

**Mobile:**

- `apps/mobile/app/(tabs)/_layout.tsx` — tab bar configuration (needs tab-home/discover/library/profile testIDs)
- `apps/mobile/src/components/HomeHeader.tsx` — search + profile buttons (header-search, header-profile)
- `apps/mobile/src/components/CuratedHomeLayout.tsx` — hero mute button (mute-button)
- `apps/mobile/src/components/sections/VideoHeroRenderer.tsx` — hero CTA (hero-cta)
- `apps/mobile/src/components/sections/VideoCardRenderer.tsx` — video-card-{N}
- `apps/mobile/src/components/sections/VideoCarouselRenderer.tsx` — video-carousel-card-{N}
- `apps/mobile/src/components/sections/MediaCollectionRenderer.tsx` — media-collection-item-{N}
- `apps/mobile/src/components/sections/NavigationCarouselRenderer.tsx` — nav-carousel-item-{N}
- `apps/mobile/src/components/sections/BibleQuotesCarouselRenderer.tsx` — share-quote, quote-cta
- `apps/mobile/src/components/sections/RelatedQuestionsRenderer.tsx` — accordion-question-{N}, accordion-cta
- `apps/mobile/src/components/sections/QuizButtonRenderer.tsx` — quiz-button, modal-close
- `apps/mobile/src/screens/SearchScreen.tsx` (DiscoverScreen) — search-input, search-result-{N}
- `apps/mobile/src/screens/LibraryScreen.tsx` — experience-card-{N}
- `apps/mobile/src/screens/VideoDetailScreen.tsx` — video-thumbnail, share-button, back-button
- `apps/mobile/src/screens/CollectionPlayerScreen.tsx` — playlist-item-{N}, collection-card-{N}

**Web:**

- `apps/web/src/app/layout.tsx` or header component — logo + search toggle
- `apps/web/src/components/SearchOverlay.tsx` — search-close, search-input, long-query handling
- `apps/web/src/components/sections/VideoHero.tsx` — hero, hero-cta, hero-heading, hero-mute
- `apps/web/src/components/sections/CarouselVideoPlayer.tsx` — carousel-thumbnail
- `apps/web/src/components/sections/MediaCollection.tsx` — media-collection, media-collection-item, collection-size
- `apps/web/src/components/sections/NavigationCarousel.tsx` — nav-carousel, nav-carousel-item
- `apps/web/src/components/sections/BibleQuotesCarousel.tsx` — bible-quotes, quote-cta, resource-cta
- `apps/web/src/components/sections/RelatedQuestions.tsx` — accordion-trigger, accordion-cta
- `apps/web/src/components/sections/AdventCountdown.tsx` — advent-days, advent-toggle
- `apps/web/src/components/sections/EasterDates.tsx` — easter-toggle
- `apps/web/src/components/sections/QuizButton.tsx` — quiz-button, modal-close
- `apps/web/src/lib/content.ts` section error handling — error-block, null-block

### Flow Reference Source

Complete testID list extracted from flows:

```bash
# Mobile (27 unique testIDs)
grep -rhoE 'id: "[^"]+"' apps/mobile/.maestro/ | sort -u

# Web (20+ unique data-testids, mixed with fallback CSS selectors)
grep -rhoE 'data-testid="[^"]+"' apps/web/e2e/flows/ | sort -u
```

### Institutional Learnings

- **`testID` vs `accessibilityLabel` in React Native** (per React Native docs): `testID` is the correct attribute for e2e test hooks. `accessibilityLabel` serves a different purpose (screen readers) and should not be overloaded for testing.
- **`data-testid` convention** for Next.js: Use `data-testid` attribute directly on DOM elements; Playwright's `getByTestId()` method uses this by default.
- **Pattern from `apps/mobile`**: existing accessibility labels are already present on many interactive elements — testIDs should be added alongside, not replacing them.

## Key Technical Decisions

- **Use `testID` prop on React Native, `data-testid` attribute on web**: Standard platform conventions. No custom wrappers needed.
- **Indexed testIDs for list items**: `{base}-{index}` pattern (e.g., `video-card-0`, `experience-card-1`). Maestro flows already reference index 0; supporting more indices is automatic via the mapping.
- **Parallel structure across platforms**: Same testID semantics for web and mobile where the component exists on both (e.g., both have `quiz-button`, `modal-close`). Makes cross-platform debugging easier.
- **No test utility helpers**: Adding raw attributes is simpler than introducing a wrapper component or hook. The 50-ish touches are mechanical and don't need abstraction.
- **Verify via pipeline re-run, not manual testing**: The `/qa` skill is the verification tool. Running it after each layer reveals remaining gaps quickly.

## Open Questions

### Resolved During Planning

- **Should we use a shared testID constants file?**: No — flows reference string literals in YAML/spec files. A TS constants file wouldn't remove the duplication on the test side. Keep as inline strings.
- **Should indexed testIDs include total count for bounds safety?**: No — Maestro and Playwright both tolerate missing testIDs gracefully when `optional: true` is used. For required taps, we rely on "index 0 always exists if the list renders."

### Deferred to Implementation

- **Exact element placement for hero-mute testID**: The mute button is conditionally rendered based on video state; implementer should confirm it's always mounted (with a hidden state) vs conditionally inserted.
- **Whether AdventCountdown toggle needs both `advent-toggle` and `advent-days` testIDs on the same element or on different children**: depends on component structure, resolve when editing.

## Implementation Units

- [ ] **Unit 1: Add testIDs to mobile React Native components**

**Goal:** Add `testID` prop to all mobile components referenced by Maestro flows, matching the 27 unique testIDs extracted from `apps/mobile/.maestro/`.

**Requirements:** R1, R2, R5

**Dependencies:** None

**Files:**

- Modify: `apps/mobile/app/(tabs)/_layout.tsx` — add testID prop to each Tab.Screen's tabBarButton (tab-home, tab-discover, tab-library, tab-profile)
- Modify: `apps/mobile/src/components/HomeHeader.tsx` — header-search, header-profile on respective Pressables
- Modify: `apps/mobile/src/components/CuratedHomeLayout.tsx` — mute-button on hero mute Pressable
- Modify: `apps/mobile/src/components/sections/VideoHeroRenderer.tsx` — hero-cta on CTA button
- Modify: `apps/mobile/src/components/sections/VideoCardRenderer.tsx` — video-card-${index} passed via prop
- Modify: `apps/mobile/src/components/sections/VideoCarouselRenderer.tsx` — video-carousel-card-${index} on FlatList item Pressable
- Modify: `apps/mobile/src/components/sections/MediaCollectionRenderer.tsx` — media-collection-item-${index}
- Modify: `apps/mobile/src/components/sections/NavigationCarouselRenderer.tsx` — nav-carousel-item-${index}
- Modify: `apps/mobile/src/components/sections/BibleQuotesCarouselRenderer.tsx` — share-quote on share button, quote-cta on CTA
- Modify: `apps/mobile/src/components/sections/RelatedQuestionsRenderer.tsx` — accordion-question-${index} on each row, accordion-cta on header button
- Modify: `apps/mobile/src/components/sections/QuizButtonRenderer.tsx` — quiz-button on button, modal-close on modal close button
- Modify: `apps/mobile/src/screens/SearchScreen.tsx` (Discover) — search-input on TextInput, search-result-${index} on result cards
- Modify: `apps/mobile/src/screens/LibraryScreen.tsx` — experience-card-${index} on FlashList item
- Modify: `apps/mobile/src/screens/VideoDetailScreen.tsx` — video-thumbnail on overlay thumbnail, share-button on header share, back-button on header back
- Modify: `apps/mobile/src/screens/CollectionPlayerScreen.tsx` — playlist-item-${index}, collection-card-${index}

**Approach:**

- Add `testID` as an explicit prop on each Pressable/TouchableOpacity/TextInput. Do not alter component structure or styling.
- For indexed testIDs, use template literal: `testID={`video-card-${index}`}`.
- Preserve existing `accessibilityLabel` props — do not replace them.
- Run `pnpm --filter @forge/mobile run typecheck` after each file edit to catch typos.

**Test scenarios:**

- Happy path: `maestro test apps/mobile/.maestro/tab-navigation.yaml` passes on iOS Simulator after this unit — tab-home, tab-discover, tab-library, tab-profile all found
- Happy path: Full iOS Maestro suite (`maestro test apps/mobile/.maestro/`) improves from 29/49 to ≥47/49 passing
- Happy path: Same suite on Android emulator improves to same level
- Edge case: `search-result-0` found when search returns at least 1 result; flow reports element-not-found gracefully when results are empty (existing flow handles this with `optional: true` or equivalent)
- Integration: Existing app behavior unchanged — smoke test home screen renders, tabs navigate correctly, video plays, no visual regressions

**Verification:**

- `maestro test apps/mobile/.maestro/` on iOS Simulator: ≥47/49 flows pass
- `maestro test apps/mobile/.maestro/` on Android emulator: ≥47/49 flows pass
- Any remaining 1-2 failures are non-testID issues (e.g., CMS data unavailable, rate limiting) and documented

---

- [ ] **Unit 2: Add data-testid attributes to web Next.js components**

**Goal:** Add `data-testid` attribute to all web components referenced by Playwright flows, matching the ~20 unique data-testids extracted from `apps/web/e2e/flows/`.

**Requirements:** R3, R5

**Dependencies:** None (can run in parallel with Unit 1)

**Files:**

- Modify: site header component (locate via `apps/web/src/app/layout.tsx` or header component) — data-testid="logo" on logo link, data-testid="search-toggle" on search button
- Modify: `apps/web/src/components/SearchOverlay.tsx` — data-testid="search-close" on close button
- Modify: `apps/web/src/components/sections/VideoHero.tsx` — data-testid="hero", data-testid="hero-heading", data-testid="hero-cta" on respective elements, data-testid="hero-mute" on mute button
- Modify: `apps/web/src/components/sections/CarouselVideoPlayer.tsx` — data-testid="carousel-thumbnail" on each thumbnail
- Modify: `apps/web/src/components/sections/MediaCollection.tsx` — data-testid="media-collection" on wrapper, data-testid="media-collection-item" on each item, data-testid="collection-size" on badge
- Modify: `apps/web/src/components/sections/NavigationCarousel.tsx` — data-testid="nav-carousel", data-testid="nav-carousel-item" on each item
- Modify: `apps/web/src/components/sections/BibleQuotesCarousel.tsx` — data-testid="bible-quotes" on wrapper, data-testid="quote-cta" on quote CTA, data-testid="resource-cta" on resource card CTA
- Modify: `apps/web/src/components/sections/RelatedQuestions.tsx` — data-testid="accordion-trigger" on each question button, data-testid="accordion-cta" on header CTA
- Modify: `apps/web/src/components/sections/AdventCountdown.tsx` — data-testid="advent-toggle" on toggle button, data-testid="advent-days" on days count span
- Modify: `apps/web/src/components/sections/EasterDates.tsx` — data-testid="easter-toggle" on toggle button
- Modify: `apps/web/src/components/sections/QuizButton.tsx` — data-testid="quiz-button" on button, data-testid="modal-close" on modal close
- Modify: section error fallbacks (likely in `apps/web/src/lib/content.ts` or SectionDispatcher) — data-testid="error-block" on error section, data-testid="null-block" on null fallback

**Approach:**

- Add `data-testid` attribute directly in JSX. For server components, add as a plain HTML attribute. For client components, same pattern — React passes `data-*` through.
- Prefer adding to the outermost interactive element (button, link, input). For wrappers, add to the top-level `<section>` or `<div>`.
- Run `pnpm --filter @forge/web run typecheck` and `pnpm --filter @forge/web run lint` after edits.

**Test scenarios:**

- Happy path: `pnpm --filter @forge/web run e2e` improves from 190/200 to ≥198/200 passing against dev server with CMS running
- Happy path: Each affected flow file's screenshot captures show the intended UI (e.g., search overlay opens and captures, not a blank page)
- Edge case: Pages that conditionally render sections (no CMS data, missing fields) don't crash when `data-testid` is present — the attribute is inert when the element doesn't render
- Integration: No visual regression — add a sample page load test before and after to verify identical DOM (ignoring the new data-testid attributes)

**Verification:**

- `pnpm --filter @forge/web run e2e` with CMS running: ≥198/200 flows pass
- Any remaining 1-2 failures are non-testid issues (e.g., timing, CMS data shape) and documented

---

- [ ] **Unit 3: Run full QA pipeline verification and document results**

**Goal:** Verify the testID additions unblock the previously failing flows by running the complete `/qa` pipeline and updating the QA solution doc with the achieved pass rate.

**Requirements:** R4

**Dependencies:** Unit 1, Unit 2

**Files:**

- Create: `docs/solutions/platform/local-qa-pipeline-first-runs-20260417.md` — capture what passed/failed, time to complete, known remaining issues, and operational notes (e.g., Android mobile needs phone emulator, iOS mobile needs correct Metro bundler on 8081)

**Approach:**

- Make a small cross-cutting change (e.g., edit a shared typography constant used by all 3 apps) to trigger full-pipeline execution.
- Invoke `/qa` in a Claude Code session. The skill will analyze the diff, run Layers 1-4, and report per-surface results.
- Record the pass/fail counts per surface and total pipeline duration.
- Document any surface-specific prerequisites encountered (e.g., "tvOS requires AppleScript accessibility permission", "Android mobile needs phone emulator distinct from Android TV emulator").

**Test scenarios:**

- Happy path: `/qa` produces verdict "Ready with fixes" or "Ready to merge" with ≥95% total pass rate
- Edge case: Document what happens if CMS is down (expected: warning + flows skip or screenshot error states)
- Edge case: Document what happens if only one simulator pair is booted (expected: pipeline skips unaffected platforms and warns)
- Integration: The solution doc is discoverable via `compound-engineering:research:learnings-researcher` search — verify by querying "QA pipeline" or "Maestro testIDs"

**Verification:**

- Solution doc exists at `docs/solutions/platform/local-qa-pipeline-first-runs-20260417.md` with frontmatter, pass-rate summary, and lessons learned
- Pass rate across all 5 surfaces documented with actual numbers

## System-Wide Impact

- **Interaction graph:** None — `testID` and `data-testid` are pure metadata. No React render cycles, no state, no event handlers affected.
- **Error propagation:** None — inert attributes that do not throw.
- **State lifecycle risks:** None — does not touch component state, context, or side effects.
- **API surface parity:** Mobile and web share several testID names (quiz-button, modal-close, mute-button) — maintaining parity helps future cross-platform debugging.
- **Integration coverage:** The `/qa` pipeline itself is the integration check. If a testID is added but the flow still fails, the failure is informative (element is hidden, obscured, or in a different component).
- **Unchanged invariants:** No user-visible behavior changes. Component props, render output, styling, accessibility labels, and event handlers all remain identical.

## Risks & Dependencies

| Risk                                                                                                 | Mitigation                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| testID typo between component and flow (e.g., `tab-discover` vs `tab_discover`)                      | Reference the extracted testID list in `apps/mobile/.maestro/` as source of truth. Verify with a single Maestro flow before batch changes.                  |
| Indexed testIDs on virtualized lists (FlashList, FlatList) may not render all indices simultaneously | Use `index` from renderItem callback directly — virtualization does not affect Maestro's element lookup as long as the current visible item has the testID. |
| Adding testIDs on nested wrapper elements may capture the wrong event target                         | Apply testID to the same element that receives the user event (Pressable, TouchableOpacity, button, a).                                                     |
| CMS required for web flows may be unavailable during CI                                              | Out of scope — CI integration is not in this plan. Local runs explicitly warn about CMS availability in Layer 4a.                                           |
| Android Maestro requires a phone emulator separate from Android TV emulator                          | Document in solution doc; prerequisites section of QA pipeline plan already captures this.                                                                  |

## Documentation / Operational Notes

- After Unit 3 completes, link the solution doc from the QA pipeline plan (`docs/plans/2026-04-16-003-feat-cross-platform-local-qa-pipeline-plan.md`) under Sources & References.
- If any flows still fail after Unit 1+2, triage them as either "flow needs rewrite" (e.g., `waitForTimeout` anti-pattern) or "component needs refactor" (e.g., conditional rendering makes testID unreachable). Both are separate follow-up work.

## Sources & References

- **PR with QA pipeline:** https://github.com/JesusFilm/forge/pull/795
- **QA pipeline plan:** `docs/plans/2026-04-16-003-feat-cross-platform-local-qa-pipeline-plan.md`
- **Test scenarios:** `docs/plans/2026-04-16-003-e2e-test-scenarios.md`
- **Extracted testID list:** `grep -rhoE 'id: "[^"]+"' apps/mobile/.maestro/ | sort -u`
- **Extracted data-testid list:** `grep -rhoE 'data-testid="[^"]+"' apps/web/e2e/flows/ | sort -u`
- **Maestro testID docs:** https://docs.maestro.dev/api-reference/selectors
- **Playwright getByTestId docs:** https://playwright.dev/docs/api/class-page#page-get-by-test-id
