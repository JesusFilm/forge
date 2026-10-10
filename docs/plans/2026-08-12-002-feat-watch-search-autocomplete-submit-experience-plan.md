---
title: "Complete the Watch search autocomplete and submit experience"
type: feat
status: completed
date: 2026-08-12
---

# Complete the Watch search autocomplete and submit experience

## Summary

Ship the accumulated Watch search experience as one coherent interaction: draft-only typing, validated phrase suggestions, grouped direct matches, deliberate submission, language-scoped context, and responsive desktop/mobile presentation. Preserve the cheaper autocomplete lane and the existing submitted-search pipeline while making every visible action communicate what it will do.

## Problem Frame

The earlier Watch modal submitted while typing and later iterations exposed title results in a panel that looked like query suggestions. That made the primary action ambiguous, weakened mobile behavior, and allowed generated phrases to imply results that were not guaranteed. The completed experience must separate draft, autocomplete, and submitted-result state while keeping language selection and direct content navigation understandable without competing with the primary field.

## Requirements

- R1. Typing updates only the search draft and autocomplete; Enter and the mobile Search keyboard action submit the current non-empty draft exactly once.
- R2. Autocomplete returns at most six language-scoped query phrases, ordered before direct matches, and every returned phrase has a confirmed lexical result at validation time. This is a bounded autocomplete-quality check, not a promise that later watchability/hydration cannot remove that result before display.
- R3. Activating a query phrase by keyboard, pointer, or stationary touch submits it immediately through the guarded full-search path; touch scrolling does not submit.
- R4. Direct matches include supported video, segment, and collection results with quiet type and description metadata, and activation navigates directly without running a query search.
- R5. Autocomplete uses exact public language identity, bounded request coalescing, cancellation and stale-response guards, and a bounded short-lived validation cache; reopening a populated panel reuses client state without another request.
- R6. The suggestion panel groups `Search suggestions` before `Direct match`, fills the available modal height, scrolls without a visible scrollbar, and remains aligned with the search field.
- R7. The contextual row reads `Search in [language] for "query"` for a draft or edited query and `Searching in [language]` for completed results. The query alone is emphasized.
- R8. The language name is an independent outlined control with language icon and chevron. Its first activation replaces the suggestion contents with the full language picker, while the rest of the draft context row submits.
- R9. The main field contains no competing visible submit button, retains clear/search affordances, preserves IME behavior, and remains usable at narrow mobile widths.
- R10. Existing result routing, pagination, search analytics, selected-language behavior, instant-shell loading, and no-request shell guarantees remain intact.
- R11. Tests, roadmap records, generated GraphQL contracts, translation catalogs, and durable solution guidance describe the final behavior consistently.
- R12. One cold autocomplete request performs no more than one candidate Typesense call plus one batched validation call containing at most six `per_page: 1` sub-searches; public rate limiting and the existing 24-request service-wide concurrency ceiling remain enforced.

## Key Technical Decisions

- **Keep three explicit states:** `draftQuery`, transient autocomplete, and submitted `query` remain separate. Completed results are identified from submitted state rather than input focus.
- **Make intent determine activation:** Phrase activation is a guarded submit; direct-match activation is direct navigation; ordinary typing never crosses into full search.
- **Use a cheaper autocomplete lane:** Typesense lexical fields produce phrase candidates and direct matches without embeddings or watchability hydration. Up to six phrases are checked in one `per_page: 1` multi-search batch before being returned.
- **Use exact language identity:** Language slug scopes requests, validation verdicts, and caches. BCP-47 selects tokenizer fields only.
- **Keep asynchronous state monotonic:** Abort controllers, normalized request keys, generation guards, identical-request coalescing, and bounded caches prevent stale responses or duplicate backend work from replacing newer intent.
- **Make helper UI secondary:** The field remains the visual anchor. Suggestions, direct matches, the contextual submit row, and the full-panel language picker are supporting surfaces with quieter borders, metadata, and interaction states.

## Scope Boundaries

- No popular or recent searches, people entities, personalization, query-log serving, or semantic phrase generation.
- No change to the submitted hybrid search ranking, embedding provider, watchability model, or analytics definition.
- No new production mutation or manual deployment path; release proceeds through the normal PR-to-main deployment.

## Implementation Units

### U1. Keep autocomplete bounded, language-correct, and result-backed

- **Goal:** Serve useful phrase suggestions and direct matches without paying full-search cost while typing.
- **Existing state:** The branch already contains the public GraphQL operation, Typesense phrase/direct-match service, batched result validation, cache, generated contract, and focused backend coverage.
- **Remaining delta:** Review the accumulated implementation against R2/R4/R5, resolve only identified defects, and rerun the focused contract and generation checks.
- **Requirements:** R2, R4, R5, R10-R12
- **Files:** `apps/admin/src/services/typesense-watch-search-suggestions.ts`, `apps/admin/src/services/typesense-watch-search-suggestions.test.ts`, `apps/admin/src/services/typesense-client.ts`, `apps/admin/src/graphql/queries/watch-search.ts`, `apps/admin/schema.graphql`, `packages/admin-graphql/src/operations/watch-search.ts`, `packages/admin-graphql/src/admin-graphql-env.d.ts`
- **Approach:** Generate ranked lexical phrases and lightweight direct matches, validate up to six phrase candidates in one bounded Typesense batch, cache only well-formed verdicts, preserve direct matches on phrase-validation failure, and expose the typed public GraphQL operation.
- **Patterns to follow:** `apps/admin/src/services/bounded-ttl-promise-cache.ts`, `docs/solutions/best-practices/language-identity-on-slug-not-bcp47-20260605.md`, `docs/solutions/best-practices/batched-provider-input-position-stable-contract-20260505.md`
- **Test scenarios:** Positive and negative phrase verdicts; partial cache reuse and expiry; malformed, timed-out, and positionally incomplete validation; exact-language filtering; six-phrase cap; exactly two cold Typesense calls with at most six `per_page: 1` validation sub-searches; request coalescing; rate/concurrency bounds; direct-match preservation.
- **Verification:** Focused Admin suggestion, Typesense client, resolver, schema, and cache tests pass with generated GraphQL outputs current.

### U2. Preserve draft, autocomplete, and submitted-search boundaries

- **Goal:** Make every search action explicit and race-safe.
- **Existing state:** The branch already separates draft and submitted query state, debounces autocomplete, submits activated phrases, and directly routes content matches.
- **Remaining delta:** Verify the current working-tree refinements for duplicate activation, cached refocus, IME/touch behavior, routing, pagination, analytics, selected-language propagation, and no-request instant-shell submission.
- **Requirements:** R1, R3, R5, R9, R10
- **Files:** `apps/web/src/components/FloatingSearchContext.tsx`, `apps/web/src/components/FloatingSearchController.tsx`, `apps/web/src/components/FloatingSearchProvider.tsx`, `apps/web/src/components/FloatingSearchField.tsx`, `apps/web/src/lib/watch-search-client.ts`, `apps/web/src/lib/watch-search-query.ts`, `apps/web/src/lib/watch-search-suggestions-client.test.ts`, `apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx`
- **Approach:** Keep draft mutations request-free for the full-search pipeline, debounce and guard autocomplete, route phrase activation to one guarded submit path, route direct matches to navigation, reuse populated autocomplete state on refocus, and protect IME and touch-scroll interactions.
- **Test scenarios:** Enter/mobile Search, mouse, keyboard, stationary touch plus synthesized click, touch-scroll cancellation, duplicate-submit guard, IME composition, stale request cancellation, cached refocus, direct-match navigation, completed-to-edited transition, result pagination, result routing, analytics emission, and selected-language propagation.
- **Verification:** The full Watch search interaction suite and Web typecheck pass.

### U3. Present a coherent responsive search surface

- **Goal:** Make autocomplete and language controls clearly secondary to the search field across desktop and mobile.
- **Existing state:** The branch already groups suggestions and direct matches, uses a full-height aligned panel with hidden scrollbar, moves submission to the context row, and supports full-panel language takeover.
- **Remaining delta:** Resolve review findings around row copy/localization, interaction ownership, total result visibility, and shell parity; then capture final desktop and mobile proof.
- **Requirements:** R4, R6-R10
- **Files:** `apps/web/src/components/SearchOverlay.tsx`, `apps/web/src/components/SearchOverlayInstantShell.tsx`, `apps/web/src/components/FloatingSearchField.tsx`, `apps/web/src/components/watch/LanguageCombobox.tsx`, `apps/web/messages/en.json`, `apps/web/messages/*.json`
- **Approach:** Align the full-height suggestion panel to the field, group suggestions before direct matches, hide scrollbars, remove the field-level visual submit button, and use a contextual action row with an independent language chip and full-panel picker. Keep shell and loaded-overlay geometry synchronized.
- **Test scenarios:** Draft and completed helper copy; first-click language opening; row versus chip click ownership; narrow-width wrapping/truncation; keyboard focus; hidden scrollbar; instant-shell geometry and zero-request parity; persistent-header loading behavior.
- **Verification:** Desktop and narrow-mobile browser smoke show correct hierarchy, interaction ownership, and no console errors or loading regression.

### U4. Reconcile delivery records and release safely

- **Goal:** Leave repository, GitHub, production, and work tracking in one verified final state.
- **Existing state:** The branch contains completed roadmap records and durable solution guidance, but its final local refinements are not yet reviewed, committed, or represented by a merged PR.
- **Remaining delta:** Complete review and QA, reconcile docs, ship through GitHub, validate the exact deployed merge, and update only demonstrably related Linear work.
- **Requirements:** R10, R11
- **Files:** `docs/roadmap/content-discovery/feat-336-watch-search-explicit-submit.md`, `docs/roadmap/content-discovery/feat-337-watch-search-suggestions.md`, `docs/roadmap/content-discovery/feat-352-watch-search-suggestion-result-validation.md`, `docs/roadmap/content-discovery/feat-357-watch-search-suggestion-immediate-submit.md`, `docs/roadmap/content-discovery/feat-358-watch-search-contextual-submit-row.md`, `docs/roadmap/README.md`, `docs/solutions/design-patterns/watch-search-draft-suggestion-submit-separation.md`, this plan
- **Approach:** Keep roadmap dependencies bidirectional, record final interaction evidence, run plan-based review and browser tests, open a PR, require passing checks and clean mergeability, squash-merge, confirm the normal production deployment, run production search smoke, then update only related Linear issues whose completion is supported by the merged PR.
- **Verification:** GitHub reports the PR merged without conflict, the exact merge is deployed, production Watch passes desktop/mobile search checks, and related Linear records link to the merged PR and reflect verified completion.

## Acceptance Examples

- AE1. **Draft autocomplete:** Given a viewer types `bibl`, when autocomplete resolves, then up to six validated phrases render before grouped direct matches and no full results search has run. Covers R1-R6.
- AE2. **Phrase selection:** Given `Bible` is a phrase suggestion, when the viewer clicks or presses Enter on it, then the modal submits `Bible` once and renders completed results. Covers R3, R5, R10.
- AE3. **Direct content selection:** Given a collection direct match, when the viewer activates it, then Watch navigates to the collection without submitting a query search. Covers R4, R10.
- AE4. **Language ownership:** Given the contextual row is visible, when the viewer first clicks the language chip, then the full-panel language picker opens; when the viewer clicks elsewhere on the draft row, the current query submits. Covers R7-R9.
- AE5. **Completed results:** Given results for `Paul` are rendered, then the helper reads `Searching in [English]`; editing the draft restores `Search in [English] for "query"`. Covers R7.
- AE6. **Validation unavailable:** Given direct-match retrieval succeeds and phrase validation fails, then direct matches remain available, unverified phrases are omitted, and ordinary explicit submission still works. Covers R2, R4, R5.

## Risks & Dependencies

- Cold autocomplete adds one bounded phrase-validation round trip; batching, minimal projection, a 750-millisecond deadline, and the short verdict cache bound the cost.
- Lexical validation materially reduces empty suggestion risk but does not reproduce final watchability and hydration. Production smoke must submit representative suggestions and report any visible zero-result case rather than describing the check as an absolute end-to-end guarantee.
- The branch touches generated GraphQL and translation catalogs. Generated-file and format checks must remain part of the PR gate.
- The modal contains overlapping pointer, touch, keyboard, focus, and asynchronous request state; interaction tests and real mobile-width browser verification are both required.
- Production completion depends on GitHub checks and the normal Forge Web deployment becoming successful for the squash merge commit.

## Sources

- `docs/plans/2026-08-05-003-feat-watch-search-explicit-submit-plan.md`
- `docs/plans/2026-08-06-001-feat-watch-search-suggestions-plan.md`
- `docs/plans/2026-08-12-001-fix-watch-search-suggestion-result-validation-plan.md`
- `docs/solutions/design-patterns/watch-search-draft-suggestion-submit-separation.md`
- `docs/solutions/ui-bugs/watch-search-modal-mobile-header-rows.md`
- `docs/solutions/ui-bugs/watch-search-modal-close-reset.md`
- `CONCEPTS.md`
