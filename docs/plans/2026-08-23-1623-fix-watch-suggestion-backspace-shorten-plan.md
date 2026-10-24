---
title: "Watch Suggestion Backspace Shorten - Plan"
type: fix
date: 2026-08-23
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
---

# Watch Suggestion Backspace Shorten - Plan

## Goal Capsule

- **Objective:** After Watch search suggestions display for a longer query, shortening the query by Backspace shows the shorter query's suggestions instead of a permanently blank panel.
- **Means:** Skip the per-keystroke suggestion invalidation when the input change does not alter the normalized suggestion request identity (KTD1).
- **Authority:** This plan defines scope. The existing Watch suggestion contracts — stale-response protection, language identity, ranking, and the feat-412 dropped-token recall — remain authoritative and unchanged.
- **Execution profile:** One bounded client-side diff in `apps/web` plus regression tests and roadmap bookkeeping, shipped as one PR that is opened but not merged.
- **Stop conditions:** Stop if the fix requires GraphQL/schema changes, admin service changes, or a redesign of the suggestion state machine.

## Product Contract

### Summary

Fix the production regression where Backspacing a multi-word Watch query (for example `Jesus for kids`) down to a shorter valid query (`Jesus`) leaves the suggestion panel blank, while typing the same short query directly works.

### Problem Frame

`SearchOverlay`'s input handler invalidates the suggestion request on every keystroke: it bumps the monotonic `suggestionGenerationRef` and clears the committed result. The debounced fetch effect, however, is keyed on the normalized query (NFC + trim). A keystroke that changes the raw input but not the normalized query — deleting or adding a trailing space — bumps the generation without re-running the effect. The pending timer or in-flight fetch fails its generation check and nothing reschedules, so the panel stays blank. Every word-by-word Backspace path passes through a trailing-space state (`"Jesus "` → `"Jesus"`), which is why shortening reliably blanks the panel while direct typing never does. Verified against `apps/web/src/components/SearchOverlay.tsx` (input handler near line 662, fetch effect near line 434) and `apps/web/src/lib/watch-search-query.ts`. The screenshot evidence matches: the context row renders for `Jesus` while the list stays empty. Commit `11f45d84` (PR #2009, feat-412) touched only the admin service and is orthogonal; the admin service is stateless per request and serves directly-typed `Jesus` correctly in production.

### Requirements

- R1. After suggestions display for a longer query, deleting trailing words with Backspace to a shorter query that passes the existing minimum-length gate displays that query's suggestions once the debounce and fetch settle.
- R2. A keystroke that changes the raw input but not the normalized query must not discard the pending request, the in-flight response, or the committed suggestions for that normalized query. This covers both deleting and adding a trailing space.
- R3. Stale-response protection is preserved: a response for a superseded normalized query or superseded language never displays, and the existing invalidation on submit, suggestion select, dismiss, Escape, and language change is unchanged.
- R4. No behavior change to direct typing, suggestion ranking, exact `languageIdentity` filtering, the admin suggestion service (including feat-412 dropped-token recall), GraphQL contracts, or generated artifacts.
- R5. The regression and its fix are recorded as a completed roadmap ticket with bidirectional dependencies and a regenerated roadmap index.

### Acceptance Examples

- AE1. **Covers R1.** Given suggestions displayed for `Jesus for kids`, when the user Backspaces to `Jesus` and the debounce elapses, a suggestion fetch is issued for `Jesus` and its suggestions display.
- AE2. **Covers R2.** Given suggestions displayed for `Jesus`, when the user types a trailing space and then deletes it, the suggestions remain displayed throughout, and an in-flight response for normalized `Jesus` still commits.
- AE3. **Covers R3.** Given an in-flight suggestion fetch for `Jesus for`, when the user edits to `Jesu` before it resolves, the `Jesus for` response never displays.

### Scope Boundaries

- No admin/server suggestion service changes, no GraphQL or schema changes, no empty-state UI work.
- No refactor of the inline suggestion state machine into a hook.

#### Deferred to Follow-Up Work

- Extracting the suggestion state machine from `SearchOverlay.tsx` into a testable hook is a tempting adjacent refactor; it is out of scope for this minimal fix.

## Planning Contract

### Key Technical Decisions

- KTD1. **Invalidate only on normalized-identity change.** In the input change handler, compare the next value's normalized form against the current normalized suggestion query and skip the generation bump and result clear when they are equal; keep panel-visibility and suppression-clearing behavior unchanged. Chosen over adding the raw query to the fetch effect's dependencies (would abort and reissue in-flight requests on normalization-neutral keystrokes, changing debounce semantics) and over removing the per-keystroke invalidation entirely (would orphan the loading state and weaken the stale guard for real edits).
- KTD2. **Leave the stale-guard architecture untouched.** The `suggestionGenerationRef` capture-and-compare, the request-key commit check, the `useLayoutEffect` bump on request-key change, and all non-keystroke invalidation call sites stay as they are. The fix narrows one caller's condition; it does not restructure the guard.
- KTD3. **Test at the provider-suite level with existing conventions.** Add regression scenarios to `apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx` using its established fake-timer and mocked `watch-search-client` patterns, exercising real input-value transitions rather than synthetic state.

### Assumptions

- The diagnosis is the trailing-space normalization seam described in Problem Frame; the regression tests must first fail against the unfixed handler to confirm it (execution-time proof).
- The regression predates PR #2009 and was surfaced, not caused, by it; no admin-side verification beyond the existing suites is required.
- The page-load performance rule is satisfied by recording that no rendering, hydration, media, routing, or client-initialization surface changed — the diff is a conditional inside an existing event handler (see `docs/solutions/conventions/frontend-change-page-load-performance-verification.md`).
- Per the StrictMode learning's boundary (trigger is cleanup-side ref mutation), the fix adds no effect-cleanup mutation, so no new StrictMode surface is created; existing suite posture stands.
- Accepted user-visible delta: after Escape-dismiss, a normalization-neutral keystroke (adding a trailing space) will now restore suggestions instead of leaving the panel blank. This matches the existing intent that any keystroke clears suggestion suppression.

## Implementation Units

### U1. Normalization-aware suggestion invalidation with regression tests

- **Goal:** Backspace-shortened queries repopulate suggestions while every stale-response guarantee holds.
- **Requirements:** R1, R2, R3, R4; KTD1, KTD2, KTD3.
- **Dependencies:** None.
- **Files:**
  - `apps/web/src/components/SearchOverlay.tsx`
  - `apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx`
- **Approach:**
  1. In the input change handler, compute the normalized form of the incoming value and call `invalidateSuggestionRequest()` only when it differs from the current normalized suggestion query (KTD1).
  2. Keep `setSuggestionPanelVisible(true)`, suppression clearing, and `setQuery` unconditional.
  3. Leave the fetch effect, its dependencies, and all other invalidation call sites unchanged (KTD2).
- **Execution note:** Write the AE1 regression test first and confirm it fails against the current handler before applying the fix — this proves the diagnosed mechanism is the production defect.
- **Patterns to follow:** Existing suggestion tests in `FloatingSearchProvider.test.tsx` (fake timers advanced by the 180 ms debounce, mocked `fetchWatchSearchSuggestions`, `setInputValue` helper); `docs/solutions/design-patterns/watch-search-draft-suggestion-submit-separation.md` for the guard contract.
- **Test scenarios:**
  - Covers AE1. Suggestions displayed for `Jesus for kids`; Backspace word-by-word through `Jesus for`, `Jesus `, to `Jesus`; advance the debounce; a fetch is issued for `Jesus` and its suggestions render.
  - Covers AE2. Suggestions displayed for `Jesus`; input becomes `Jesus ` (trailing space added); suggestions remain displayed with no refetch requirement; input returns to `Jesus`; suggestions still displayed.
  - Covers AE2. Input transitions `Jesus ` → `Jesus` while the fetch for normalized `Jesus` is still in flight; when it resolves, its suggestions commit and display.
  - Covers AE3. Fetch in flight for `Jesus for`; input edited to `Jesu` before resolution; the resolved `Jesus for` response never displays.
  - Covers R2. A non-trim normalization-neutral edit also preserves suggestions: with a query at the 200-code-point normalization cap, a keystroke appending one more code point leaves suggestions displayed (pins the guard to `normalizeWatchSearchQuery` identity rather than a trim heuristic).
  - Covers R3. Fetch in flight for normalized `Jesus`; a trailing-space keystroke preserves it; a real edit to `Jesus x` lands before resolution; the resolved `Jesus` response never displays (neutral-preserve then real-edit interleaving).
  - Direct typing unchanged: typing `Jesus` character-by-character issues one debounced fetch and displays results (guards against over-suppressing invalidation).
  - Language change mid-flight still discards the in-flight response (existing scenario stays green).
  - Backspacing below the two-meaningful-character minimum blanks the panel and issues no fetch (existing gate unchanged).
  - Submit, suggestion select, and dismiss still suppress and invalidate as before (existing scenarios stay green).
- **Verification:** New scenarios pass, the AE1 test demonstrably fails when the fix is reverted, and the full `FloatingSearchProvider` suite plus adjacent web search suites pass unchanged.

### U2. Roadmap integrity

- **Goal:** Record the regression fix as a completed roadmap ticket without dependency or index drift.
- **Requirements:** R5.
- **Dependencies:** U1.
- **Files:**
  - `docs/roadmap/content-discovery/feat-420-watch-suggestion-backspace-shorten-recovery.md` (new)
  - `docs/roadmap/content-discovery/feat-337-watch-search-suggestions.md`
  - `docs/roadmap/README.md`
- **Approach:**
  1. Create feat-420 (next unused global ID) in the content-discovery lane with agent-optimized body sections, `depends_on: feat-337`, owner `vlad`, and `status: complete` on ship. The Problem section records the bidirectional trigger: any normalization-neutral keystroke (deleting or adding a trailing space) blanked the panel, so forward-typing reports of the same blank state are this bug, not a new one.
  2. Add `feat-420` to feat-337's `blocks` list to keep dependencies bidirectional.
  3. Regenerate the roadmap index with the repository-owned generator (`apps/roadmap` `generate:readme` script) and confirm a second run produces no diff.
- **Test expectation:** none -- this unit changes roadmap metadata and generated documentation only.
- **Verification:** Frontmatter is schema-complete, dependencies are bidirectional, and the regenerated index includes feat-420 with no unrelated changes.

## Verification Contract

- `pnpm --filter @forge/web test -- src/components/__tests__/FloatingSearchProvider.test.tsx` — regression and guard scenarios.
- `pnpm --filter @forge/web typecheck` and `pnpm --filter @forge/web lint`.
- Prettier check on every touched file.
- Roadmap generator run twice; second run yields no diff.
- Browser verification in the closest production-like environment: reproduce the exact transition (type `Jesus for kids`, wait for suggestions, Backspace to `Jesus`) and confirm suggestions repopulate; confirm direct typing and language switching still work.
- Page-load performance: record that the diff touches only an existing input event handler — no rendering, hydration, media, routing, or client-initialization change — per `docs/solutions/conventions/frontend-change-page-load-performance-verification.md`; attach a cheap timing sanity check if browser verification is already running.

## Definition of Done

- U1 satisfies every listed test scenario, including the reverted-fix failure proof for AE1.
- U2 leaves roadmap dependencies and the generated index consistent.
- All verification gates pass, or an environment-only blocker is recorded with the evidence used instead.
- The branch contains no admin, GraphQL, or generated-artifact changes and no abandoned experimental code.
- The work is committed, pushed, and represented by an open, unmerged PR summarizing root cause and validation evidence.
