---
title: "Watch Subtitle Discoverability and Hydration Safety - Plan"
type: "fix"
date: "2026-08-22"
artifact_contract: "ce-unified-plan/v1"
artifact_readiness: "implementation-ready"
product_contract_source: "ce-plan-bootstrap"
execution: "code"
---

# Watch Subtitle Discoverability and Hydration Safety - Plan

## Goal Capsule

- **Objective:** Viewers can identify and open subtitles before and during JESUS playback, and English, Afrikaans, and Xhosa Watch routes hydrate without divergent hero metadata.
- **Means:** Keep the existing subtitle modal and state model, make the existing affordances explicit, and serialize localized hero count labels from the server-owned route projection (KTD1-KTD3).
- **Authority:** Linear FGE-92 and the Product Contract in this plan govern behavior. `apps/web/AGENTS.md`, `apps/web/CLAUDE.md`, and the cited solution documents govern implementation constraints.
- **Stop conditions:** Stop if an offered track fails native loading, if the fix requires catalog mutation, or if the subtitle scope collides with FGE-70 or FGE-75. Do not change a localized hero field unless the pinned baseline proves that field diverges during Xhosa hydration.
- **Execution profile:** Code change with focused characterization, SSR/hydration proof, browser accessibility and playback proof, and page-load evidence.
- **Tail ownership:** Complete `docs/roadmap/platform/feat-418-watch-subtitle-discoverability-hydration.md`, open the PR, and reach a terminal CI decision without deploying or replying in Help Scout.

---

## Product Contract

### Summary

Make both existing subtitle entry points visibly and accessibly identifiable without redesigning the combined Language & Subtitles modal. Remove the Xhosa-only hydration mismatch by making the localized above-the-fold count labels stable server-produced values.

### Problem Frame

A returning facilitator could no longer find subtitles after the Watch interface changed. Production evidence shows that offered Afrikaans Forge and translated tracks still load through the same-origin VTT route with `HTMLTrackElement.readyState === 2`, so the live defect is not the completed FGE-67 delivery failure.

The current hero shows a captions glyph beside a generic language count and can render that affordance as non-interactive when only one audio Dub exists. The sound-on chrome becomes glyph-only when subtitles are off or match audio. The Xhosa route also emits React hydration error #418 while English and Afrikaans do not. Pinned-baseline capture attributes it to the audio-language count: server HTML renders `2 285 iilwimi`, while the first client DOM renders `2,285 iilwimi`; the adjacent runtime remains `128 min` on both sides.

### Requirements

**Subtitle identity and interaction**

- R1. The pre-reveal hero must identify its subtitle affordance with localized subtitle copy and the offered subtitle-language count.
- R2. Offered subtitles must open the existing Language & Subtitles modal even when the Video has only one playable audio Dub.
- R3. Sound-on player chrome must show a visible subtitle state when subtitles are off, match audio, or use a translated Language.
- R4. Both subtitle entry points must keep localized accessible names, keyboard activation, visible focus, and the existing compact/fullscreen layout contract.
- R5. Videos with no normalized offered subtitle must not render a subtitle option or imply that a failed track exists.

**State, availability, and delivery**

- R6. `WatchPageClient` must retain ownership of same-audio defaults, explicit translated preferences, unavailable states, and VTT selection.
- R7. Xhosa subtitle absence must remain a truthful catalog-availability state while genuinely offered translated options stay selectable.
- R8. The same-origin VTT route and Forge track injection must remain unchanged, and an offered Afrikaans track must still reach `readyState === 2` with cues.

**SSR, hydration, and loading**

- R9. Localized hero count labels must be identical in server HTML and the first client render for English, Afrikaans, and Xhosa.
- R10. The hydration fix must preserve localized output without `suppressHydrationWarning`, mount-only replacement, or moving the metadata surface out of SSR.
- R11. The Language & Subtitles modal and its option-loading work must remain absent from the initial path and load only through the existing interaction boundary.
- R12. The change must add no browser data request, dependency, eager media work, or material page-loading regression.

### Key Decisions

- **Treat subtitle delivery as healthy.** (session-settled: user-directed — chosen over reopening FGE-67 or changing the VTT proxy: offered Afrikaans tracks reach `readyState === 2` through the same-origin route.) Governs R8.
- **Keep Xhosa catalog absence outside this fix.** (session-settled: user-directed — chosen over fabricating or backfilling a Xhosa subtitle: the catalog does not offer that track.) Governs R5 and R7.
- **Keep support scopes separate.** (session-settled: user-directed — chosen over combining discovery, chapter context, and subtitles: FGE-70 and FGE-75 own distinct user problems.) Governs R1-R12.

### Acceptance Examples

- AE1. **Covers R1, R2, and R4.** Given one playable audio Dub and one offered subtitle, the pre-reveal hero shows an explicit localized subtitle label and count as a focusable button that opens the existing modal.
- AE2. **Covers R3 and R4.** Given sound-on playback, the subtitle control shows a visible off state when disabled, the active code when enabled for the audio Language, and the alternate code when translated subtitles are selected.
- AE3. **Covers R5-R7.** Given Xhosa audio with no Xhosa subtitle, the UI does not invent that option; the modal retains its explicit unavailable state and any genuinely offered translated choices.
- AE4. **Covers R9 and R10.** Given the Xhosa JESUS route, server HTML and hydrated DOM retain the same localized hero count text and emit no React #418 or recoverable hydration error.
- AE5. **Covers R8.** Given an offered Afrikaans Forge subtitle, selecting it creates the same-origin Forge track and native loading reaches `readyState === 2` with cues.
- AE6. **Covers R11 and R12.** Given a cold Watch load, no language-modal chunk or option request appears before interaction; opening subtitles loads the existing boundary once without adding an initial request.

### Success Criteria

- English, Afrikaans, and Xhosa browser passes show zero app-attributable hydration errors.
- Both subtitle controls are understandable without relying on a glyph alone, remain keyboard operable, and fit the narrowest verified layouts without horizontal overflow.
- Initial requests, eager resources, long tasks, LCP, and CLS remain within normal run variance against the pinned `origin/main` baseline; any changed application bytes are reported.

### Scope Boundaries

**In scope**

- `HeroPlayer` subtitle metadata identity, interaction gating, and runtime-label consumption.
- `HeroPlayerControls` visible subtitle state and accessible-name refinement.
- Server route projection of the localized audio- and subtitle-language count labels.
- Focused tests, SSR/hydration coverage, browser playback/accessibility proof, and page-load evidence.

**Outside this product's identity**

- Admin or Core catalog mutation, Xhosa subtitle creation, AI translation, or subtitle-quality work.
- Same-origin VTT proxy, download authentication, CORS, or track-injection redesign.
- FGE-70 JESUS discovery and FGE-75 Life of Jesus Chapter context.
- A new subtitle modal, separate audio/subtitle modal split, or changes to preference persistence.
- Production deployment and Help Scout communication.

### Sources

- [Linear FGE-92](https://linear.app/jesus-film-project/issue/FGE-92)
- `docs/solutions/design-patterns/mux-player-custom-react-chrome-pattern-20260430.md`
- `docs/solutions/design-patterns/watch-language-player-chrome-layout-20260609.md`
- `docs/solutions/ui-bugs/watch-caption-language-availability-20260615.md`
- `docs/solutions/ui-bugs/watch-subtitle-vtt-proxy-account-gate.md`
- `docs/solutions/conventions/frontend-change-page-load-performance-verification.md`
- `docs/solutions/performance-issues/watch-staged-client-loading-20260611.md`

---

## Planning Contract

### Key Technical Decisions

- KTD1. **Format hero count labels at the server projection boundary.** The pinned baseline proves the Xhosa audio-language count differs between server ICU (`2 285 iilwimi`) and browser ICU (`2,285 iilwimi`), while runtime text is stable. Add nullable localized audio- and subtitle-language count labels to the synthetic hero block, compute them while pruning route data for the client, and render the serialized strings verbatim. This removes browser number formatting from the hydration comparison while preserving localized plurals and grouping. Governs R9 and R10.
- KTD2. **Use the subtitle-specific interaction gate.** Compose the existing `subtitlesHeading` and `languageCount` messages exactly as `{subtitlesHeading}: {languageCount}` for both visible hero text and its base accessible name, and choose button versus informational text with `hasSubtitleSwitcher`. The audio switcher gate remains independent. Governs R1, R2, R4, and R5.
- KTD3. **Expose state inside the compact subtitle control.** Reuse the existing localized off/on messages for disabled or code-less enabled tracks and the normalized subtitle Language code when available. Compose that state into the localized accessible name without adding catalog keys. Governs R3 and R4.
- KTD4. **Prove the real browser boundaries.** Unit tests own render and interaction branches; route tests own server projection; browser evidence owns native track loading, recoverable hydration errors, responsive fit, focus, lazy mounting, and performance windows. Governs R4 and R8-R12.

### Assumptions

- The existing short localized off label and normalized Language codes are the smallest visible chrome states that fit narrow layouts; browser evidence at 320 and 375 CSS pixels must validate this bet.
- The server route locale is the correct owner for the localized count presentation already emitted in server HTML.
- The reported JESUS English, Afrikaans, and Xhosa routes remain suitable comparable browser fixtures; record their exact offered subtitle inventories before asserting behavior.

### Implementation Constraints

- Keep `WatchPageClient` subtitle state, modal staging, analytics, and language-option fetching unchanged.
- Keep `HeroPlayer` track creation, `FORGE_SUBTITLE_TRACK_LABEL`, `subtitleVttSrc`, and `/watch/api/download` behavior unchanged.
- Reuse existing message keys and normalized Language codes. Do not widen all locale catalogs for new copy.
- Preserve poster-first rendering, the deferred Mux component, chrome opacity states, subtitle lift, fullscreen portal behavior, and touch-target sizing.
- Do not hand-edit generated GraphQL artifacts.

### Sequencing

U1 and U2 are independent: U1 establishes the deterministic localized hero-count contract from captured causal proof; U2 fixes the subtitle affordances. U3 depends on both outcomes and validates the combined route and interaction behavior before the roadmap ticket is closed.

---

## Implementation Units

### U1. Serialize deterministic localized hero counts

- **Goal:** Remove the environment-sensitive localized count seam while preserving hero metadata.
- **Requirements:** R9, R10, R12; AE4.
- **Dependencies:** None.
- **Files:**
  - `apps/web/src/lib/content.ts`
  - `apps/web/src/app/[locale]/[htmlLang]/[...rest]/page.tsx`
  - `apps/web/src/app/[locale]/[htmlLang]/[...rest]/__tests__/page-routing.test.tsx`
  - `apps/web/src/components/watch/HeroPlayer.tsx`
  - `apps/web/src/components/watch/__tests__/HeroPlayer.test.tsx`
  - `apps/web/src/components/watch/SeriesPageClient.tsx`
  - `apps/web/src/components/watch/SeriesHero.tsx`
  - `apps/web/src/components/watch/__tests__/SeriesPageClient.test.tsx`
  - `apps/web/src/components/watch/__tests__/SeriesHero.test.tsx`
- **Approach:** Preserve the pinned-baseline capture that reproduces React #418 and shows the Xhosa audio count changing from `2 285 iilwimi` in server HTML to `2,285 iilwimi` in the first client DOM while runtime remains stable. Extend the synthetic hero block with server-produced audio- and subtitle-language count labels. Populate them in the existing client-pruning path for standalone and contextual Watch route compositions and pass the same serialized values through the series-trailer route, then make `HeroPlayer` consume them instead of reformatting those counts in the browser.
- **Execution note:** Start from a failing route/component contract for the absent serialized labels. Do not modify runtime formatting, suppress the warning, or make the metadata client-only.
- **Patterns to follow:** `pruneMergedWatchBlocksForClient`, `WatchHeroPlayerBlock`, and the existing hero metadata test fixture.
- **Test scenarios:**
  1. English, Afrikaans, and Xhosa route projections carry localized audio- and subtitle-language count labels when their normalized counts are positive.
  2. Zero or missing counts produce no corresponding serialized label.
  3. `HeroPlayer` renders supplied count labels verbatim and does not recompute them with client locale APIs.
  4. Series trailers receive the same server-formatted count labels through `SeriesPageClient` and `SeriesHero`.
  5. Server HTML and hydration retain the same Xhosa language-count text without a recoverable error.
- **Verification:** The block shape is type-safe, video, episode, and series-trailer route compositions serialize the label, and the focused route/hero suites pass.

### U2. Make subtitle affordances explicit and independently interactive

- **Goal:** Make subtitles discoverable before and during playback without changing modal or selection ownership.
- **Requirements:** R1-R7, R11; AE1-AE3.
- **Dependencies:** None.
- **Files:**
  - `apps/web/src/components/watch/HeroPlayer.tsx`
  - `apps/web/src/components/watch/HeroPlayerControls.tsx`
  - `apps/web/src/components/watch/__tests__/HeroPlayer.test.tsx`
  - `apps/web/src/components/watch/__tests__/HeroPlayerControls.test.tsx`
  - `apps/web/src/components/watch/__tests__/LanguagePickerModal.test.tsx`
- **Approach:** Compose existing localized strings for explicit hero subtitle copy. Use the existing subtitle-specific gate for interaction. Add a compact visible off/on/code state to the chrome button while leaving callback, modal, preference, and track flows intact.
- **Execution note:** Characterize the one-audio offered-subtitle branch before changing the render gate.
- **Patterns to follow:** `ChromeButton`, `hasSubtitleSwitcher`, `LanguagePickerModal.subtitlesHeading`, `LanguagePickerModal.toggleOff`, and normalized `languageCodeFor` output.
- **Test scenarios:**
  1. One audio Dub plus offered subtitles renders a focusable subtitle button with explicit localized copy and invokes `onLanguageClick` once.
  2. Offered subtitles without a callback render the same explicit information as non-interactive text.
  3. No offered subtitle omits both hero and chrome subtitle controls.
  4. Disabled subtitles render the localized off state and accessible name.
  5. Enabled same-audio subtitles render the active code instead of a glyph-only state; an enabled track without a resolvable code renders the localized on state rather than claiming subtitles are off.
  6. Enabled translated subtitles render the alternate code and preserve the same modal callback.
  7. Existing Xhosa unavailable and translated-choice modal states remain truthful.
- **Verification:** Focused hero, chrome, and modal tests pass without message-catalog changes or subtitle state changes.

### U3. Prove hydration, accessibility, playback, and page-load behavior

- **Goal:** Validate the production-shaped route and interaction boundaries that unit tests cannot establish.
- **Requirements:** R4, R7-R12; AE4-AE6.
- **Dependencies:** U1 and U2.
- **Files:**
  - `docs/solutions/ui-bugs/watch-subtitle-discoverability-hydration.md`
  - `docs/roadmap/platform/feat-418-watch-subtitle-discoverability-hydration.md`
- **Approach:** Compare the pinned final merge base and branch with the same runtime configuration. Exercise one canonical JESUS title through English, Afrikaans, and Xhosa routes. Record initial hydration, both subtitle entry points, modal focus/lazy loading, responsive layout, native track state, and page-load measurements.
- **Patterns to follow:** `docs/solutions/conventions/frontend-change-page-load-performance-verification.md` and `docs/solutions/ui-bugs/watch-subtitle-vtt-proxy-account-gate.md`.
- **Test scenarios:**
  1. English, Afrikaans, and Xhosa routes emit no React #418, recoverable hydration error, or app-attributable console error.
  2. Tab, Enter, and Space activate both subtitle controls; the dialog receives focus and returns focus to the invoking control on close.
  3. The exact `{subtitlesHeading}: {languageCount}` pre-reveal copy and the widest audio-code plus translated-subtitle-code chrome state fit in English, Afrikaans, and Xhosa at 320 and 375 CSS pixels and compact landscape without clipping, overlap, or horizontal overflow.
  4. The known Afrikaans Forge track reaches `readyState === 2` with cues through the same-origin URL.
  5. Xhosa does not expose an invented same-language track and keeps offered translated choices truthful.
  6. The modal chunk and language-option work are absent before interaction and load once after opening subtitles.
  7. Initial request count, transferred bytes, eager media, long tasks, LCP, and CLS show no material regression against `origin/main`.
- **Verification:** The durable solution record contains the exact routes, environment, browser results, skipped checks, and before/after measurements; `feat-418` is then marked complete and the roadmap index is regenerated.

---

## Verification Contract

| Gate                   | Command or evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Covers |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| Focused behavior       | `pnpm --filter @forge/web exec vitest run src/components/watch/__tests__/HeroPlayer.test.tsx src/components/watch/__tests__/HeroPlayerControls.test.tsx src/components/watch/__tests__/LanguagePickerModal.test.tsx src/components/watch/__tests__/SeriesHero.test.tsx src/components/watch/__tests__/SeriesPageClient.test.tsx 'src/app/[locale]/[htmlLang]/[...rest]/__tests__/page-routing.test.tsx'`                                                                                                                                                     | U1, U2 |
| Web contracts          | `pnpm --filter @forge/web typecheck` and changed-file ESLint                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | U1, U2 |
| Locale/catalog drift   | `pnpm --filter @forge/web verify:categories` and `node apps/web/scripts/generate-ui-locales.mjs --check`                                                                                                                                                                                                                                                                                                                                                                                                                                                     | U2     |
| Production composition | `pnpm --filter @forge/web build` with the repository's supported non-secret environment                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | U1-U3  |
| Roadmap index          | `pnpm --filter roadmap generate:readme`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | U3     |
| Formatting             | Changed-file Prettier plus `git diff --check`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | U1-U3  |
| Browser/accessibility  | English, Afrikaans, and Xhosa initial/hydrated DOM; keyboard/focus; desktop, 320/375 portrait, and compact landscape                                                                                                                                                                                                                                                                                                                                                                                                                                         | U3     |
| Subtitle delivery      | Same-origin Forge track `readyState === 2` with cues for an offered Afrikaans track                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | U3     |
| Page loading           | On identical routes/build configuration, run one warm-up and three recorded cold navigations per route and compare medians. Initial browser data requests, dependencies, eager media, and pre-interaction modal/catalog work must not increase. Compressed initial JavaScript must stay within +10 KiB and +2%; LCP within +200 ms and +10%; CLS within +0.02; long-task count within +1 and total duration within +50 ms. Repeat once when run-to-run spread exceeds 10%; any repeated breach blocks completion or requires an explicit recorded exception. | U3     |
| Review and CI          | CE code review has no unresolved eligible finding; PR reaches a terminal CI decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | U1-U3  |

---

## Definition of Done

- U1 is done when every Watch video, episode, and series-trailer route composition supplies deterministic localized hero count metadata and Xhosa server/client text no longer diverges.
- U2 is done when offered subtitles are explicit, independently interactive, stateful in chrome, and covered without changing modal, preference, availability, or delivery behavior.
- U3 is done when browser, accessibility, playback, hydration, and page-load evidence is durable; honest environmental skips name their blocker and impact.
- The final diff contains no abandoned experiments, client-only hydration workaround, generated-artifact edits, catalog fabrication, FGE-70/FGE-75 work, deployment action, or Help Scout reply.
- `feat-418` is complete, Linear FGE-92 and the PR are cross-linked where authorized, all required checks pass, and CI has a terminal decision.
