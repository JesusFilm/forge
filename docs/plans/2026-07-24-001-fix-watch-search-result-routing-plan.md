---
title: "fix: Prevent invalid Watch search result routing"
type: "fix"
status: "completed"
date: "2026-07-24"
---

# fix: Prevent invalid Watch search result routing

## Summary

Make the Web search boundary fail closed when Admin does not provide a
playable Watch action. Invalid results will not reach the public card grid, and
the shared card will no longer turn malformed input into a Watch homepage link.

---

## Problem Frame

FGE-2 documents production search cards whose generated destination is
`/watch`, including `Tümlükden Nura` and `La_Busqueda_La Recherche`. The current
Web mapper keeps unavailable results, substitutes descriptive or resolved
language metadata when the action has no language, and lets
`defaultHrefBuilder` fall back to the modal-capable Watch root when the content
slug is malformed.

Admin already exposes action, availability, and fallback state. Web consumes
only part of that contract. A syntactically valid action is not sufficient
either: subtitle-only watchability currently uses the subtitle language as the
href language even though public route admission requires an audio-language
pair.

---

## Requirements

### Result admission

- R1. Web search returns a video card only when Admin provides a `WATCH` action
  whose content slug, public-catalog href language, availability, and fallback
  state form a supported public Watch route.
- R2. Only target-audio and related-language audio availability are actionable
  until Admin can provide a proven playable audio destination for subtitle-only
  results.
- R3. Unavailable, unsupported, missing-action, malformed, and non-ASCII-slug
  results are suppressed before rendering.
- R4. An underscore in an otherwise-valid lowercase ASCII content slug does
  not make an otherwise-actionable audio-backed result invalid.

### Navigation behavior

- R5. The card destination is derived from action-owned language metadata and
  never from UI locale, resolved search language, or an English default.
- R6. A malformed result passed directly to `VideoCard` renders without an
  anchor and never calls result-click analytics.
- R7. No search result navigation failure is represented by `/watch` or `/`.

### Delivery and verification

- R8. Filtering preserves Admin's `nextOffset` and `hasMore` cursor semantics,
  and automatically advances through at most three consecutive source pages
  when a page contains no admissible results.
- R9. Regression coverage includes `Tümlükden Nura`,
  `La_Busqueda_La Recherche`, a missing action language, subtitle-only
  availability, and a valid underscore slug.
- R10. Browser verification exercises `Иисус`, `Jesuus`, and `耶稣` in the
  English Watch search UI and requires the named invalid results to be absent
  from the mapper-backed result grid.
- R11. If the three-page automatic drain ends with no admissible rows while
  Admin still reports `hasMore`, the empty state exposes the existing
  cursor-advancing load-more action so later valid rows remain reachable.

---

## Key Technical Decisions

- **Fail closed in the Web contract mapper:** This is the smallest boundary
  that prevents broken public cards without changing Admin ranking or the
  shared GraphQL schema.
- **Require audio-routable watchability:** `TARGET_AUDIO` and
  `RELATED_LANGUAGE` are backed by a published playable dub. `TARGET_SUBTITLE`
  is withheld because its current href language does not prove an admitted
  audio route.
- **Match proxy language admission:** Action languages must pass
  `isPublicWatchLanguageSlug` before they are branded for a route. Regex shape
  alone admits language-like strings the public proxy rejects.
- **Reject contradictory action state:** A target-audio action pairs with
  `NONE`, and related-language audio pairs with `RELATED_LANGUAGE`. Any other
  action, availability, and fallback combination fails closed.
- **Suppress invalid rows:** FGE-2 allows exclusion until source data or action
  resolution is corrected. Suppression avoids new unavailable-state copy and
  prevents malformed public titles from being shown.
- **Keep route syntax strict:** Unicode public-slug support would require a
  coordinated proxy, canonicalization, manifest, redirect, and SEO change.
  This fix keeps the existing lowercase ASCII content contract.
- **Preserve server cursors:** Client filtering must not derive offsets from
  accepted row count. A search action drains no more than three consecutive
  empty accepted pages, stops at the first admissible page, and leaves the
  final Admin cursor available to the existing load-more flow.
- **Defend route-shaped card input too:** `VideoCard` independently rejects an
  invalid content slug before invoking either its default or a custom
  destination builder. U1 remains the owner of action and availability
  admission.

---

## Scope Boundaries

### In scope

- Web consumption of the existing Admin action, availability, and fallback
  fields.
- Search-result admission and card navigation behavior.
- Focused route-contract, component, and browser regression coverage.
- A roadmap record for the FGE-2 implementation.

### Deferred to Follow-Up Work

- Admin collection watchability and canonical actions tracked by FGE-43.
- FGE-2 absorbs the narrow FGE-26 behavior that a missing action cannot become
  an executable route. FGE-26 retains broader field-separation and analytics
  work.
- FGE-2 absorbs default-grid suppression for currently unroutable results.
  FGE-25 retains broader unavailable and fallback presentation policy.
- A playable audio fallback for subtitle-only results.
- Unicode public Watch content slugs and source-title cleanup.

### Out of scope

- Changes to search relevance, ranking, query language detection, or title
  normalization.
- Changes to the Admin Pothos schema or generated GraphQL artifacts.
- Mobile and TV search behavior.

---

## Implementation Units

### U1. Enforce the Web result-action contract

- **Goal:** Admit only search results that can produce a supported public Watch
  route.
- **Requirements:** R1-R5, R8-R9.
- **Dependencies:** None.
- **Files:**
  - `apps/web/src/lib/search.ts`
  - `apps/web/src/lib/search.test.ts`
  - `apps/web/src/lib/search-actions.ts`
  - `apps/web/src/lib/search-actions.test.ts`
  - `apps/web/src/lib/locale.ts`
- **Approach:** Select action kind and fallback kind from the existing Admin
  operation. Validate the content slug and action language at the mapping
  boundary, require a public-catalog action language and a supported
  action/availability/fallback combination, and remove resolved-language
  promotion as a route source. When a mapped page is empty and nonterminal,
  fetch from its Admin cursor until an admissible page, a terminal page, or the
  three-page bound is reached.
- **Execution note:** Start with failing result-contract fixtures for every
  rejected state and one accepted underscore-slug state.
- **Patterns to follow:** `tryAsContentSlug` and `tryAsLocaleSlug` in
  `apps/web/src/lib/routes.ts`, `isPublicWatchLanguageSlug` in
  `apps/web/src/lib/locale.ts`, and fail-closed candidate boundaries in
  `CONCEPTS.md`.
- **Test scenarios:**
  - A `WATCH` action with `TARGET_AUDIO`, a valid content slug, and a valid
    public language slug maps to one actionable result when fallback is `NONE`.
  - A `WATCH` action with `RELATED_LANGUAGE` maps when fallback is
    `RELATED_LANGUAGE` and the href language is public.
  - A valid underscore content slug remains in the mapped response.
  - A missing or null action language is removed instead of receiving the
    resolved search language.
  - A missing action and an unsupported action kind are removed.
  - A regex-valid but non-public action language such as `non-existent` is
    removed.
  - An `UNAVAILABLE` action is removed even if descriptive language metadata
    exists.
  - A `TARGET_SUBTITLE` action is removed because its current href does not
    prove a playable audio route.
  - Contradictory availability and fallback combinations are removed.
  - A non-ASCII content slug for `Tümlükden Nura` is removed.
  - A malformed `La_Busqueda_La Recherche` slug is removed.
  - A fully filtered first page automatically advances to a second page whose
    valid result is returned from the same search action.
  - Three consecutive filtered pages stop at the bound and expose the final
    `hasMore` and `nextOffset` without repeating a cursor.
  - A normal page with a valid result makes one Admin search request.
- **Verification:** Every returned Web search result has enough validated
  action data to build a non-root Watch path, and no action language is
  synthesized after mapping.

### U2. Make the shared card destination fail closed

- **Goal:** Prevent direct or future invalid card inputs from creating a
  homepage link.
- **Requirements:** R4-R7, R9.
- **Dependencies:** U1.
- **Files:**
  - `apps/web/src/components/search/VideoCard.tsx`
  - `apps/web/src/components/search/VideoCard.test.tsx`
  - `apps/web/src/components/search/SearchResults.tsx`
  - `apps/web/src/components/SearchOverlay.tsx`
  - `apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx`
- **Approach:** Validate the result content slug before invoking either the
  default or a custom builder, and make the default destination resolver
  nullable. Render invalid card content without `Link`, hover preview, focus
  affordance, pointer affordance, or click callback. If the bounded drain still
  returns an empty nonterminal page, expose the existing load-more action in
  the empty state. Keep valid result layout, focus treatment, hover behavior,
  and routes unchanged.
- **Execution note:** Add component characterization for valid cards before
  refactoring the wrapper.
- **Patterns to follow:** The existing `VideoThumbnailInteractionFrame`
  presentation and the nullable route handling in Watch carousel components.
- **Test scenarios:**
  - A valid audio-backed result renders one anchor with the canonical
    content-and-language route.
  - A valid underscore slug remains clickable.
  - A non-ASCII slug renders no anchor and never points to `/` or `/watch`.
  - A missing or malformed action language renders no anchor.
  - A regex-valid but non-public action language renders no anchor.
  - A custom builder is not invoked for an invalid content slug, while a valid
    demo result still uses its custom route.
  - Clicking a valid card invokes the click callback once.
  - An invalid card cannot invoke the click callback.
  - An empty nonterminal result state exposes load more with the preserved
    cursor, while a terminal empty state keeps the definitive no-results UI.
- **Verification:** Search-card markup has no root-path fallback, and valid
  cards preserve existing interaction and visual behavior.

### U3. Record and verify the routed-result fix

- **Goal:** Keep the roadmap and production-facing evidence aligned with the
  shipped behavior.
- **Requirements:** R8-R10.
- **Dependencies:** U1, U2.
- **Files:**
  - `docs/roadmap/content-discovery/feat-308-watch-search-result-route-contract.md`
- **Approach:** Add an agent-optimized FGE-2 roadmap record, keep it
  `in-progress` during implementation, and mark it `complete` once focused
  tests and browser verification pass. Verify one valid card navigation and the
  three query strings observed in production for FGE-2. Prove the normal valid
  path still makes one Admin request, the invalid-page drain is capped at
  three, and no extra browser-to-server round trip is added.
- **Patterns to follow:** `docs/roadmap/platform/feat-254-watch-universal-multilingual-search.md`
  and
  `docs/solutions/conventions/frontend-change-page-load-performance-verification.md`.
- **Test scenarios:** Test expectation: none -- this unit records status and
  verification outcomes rather than adding runtime behavior.
- **Verification:** The roadmap status matches delivery state, the local branch
  omits the invalid rows for the three production-observed query strings, a
  known valid result opens its canonical route, and request-count evidence
  matches the bounded policy. Any live production observation remains a
  separately recorded post-deploy check.

---

## Acceptance Examples

- AE1. Given Admin returns target-audio watchability with a valid slug and
  action language, when Web maps and renders the result, then the card opens
  the canonical content-and-language route.
- AE2. Given Admin returns unavailable watchability or a null action language,
  when Web maps the response, then the row is absent and no English route is
  invented.
- AE3. Given a non-ASCII or malformed content slug reaches `VideoCard`
  directly, when the card renders, then it has no anchor and cannot navigate to
  the Watch homepage.
- AE4. Given Admin returns a valid underscore content slug with an audio-backed
  action, when Web renders it, then the canonical underscore route remains
  clickable.
- AE5. Given a response page contains rejected rows and Admin reports a later
  cursor, when Web maps the response, then it advances through at most three
  empty accepted pages and returns the first admissible page.
- AE6. Given the bounded drain ends on an empty nonterminal page, when the
  empty state renders, then the viewer can advance from the final Admin cursor
  with the existing load-more action.

---

## Risks and Dependencies

- Filtering after Admin pagination can create short pages and can require up to
  three Admin requests before a result is shown. The bound caps added latency;
  the empty-state load-more action keeps later cursors reachable. Producer-side
  eligibility remains deferred because it changes ranking windows and overlaps
  broader search-contract tickets.
- PR #1725 restored a collection link by accepting underscore slugs and
  promoting language fallback. This fix preserves underscore syntax but will
  suppress collections until Admin supplies an audio-routable action.
- Production may not yet include the branch behavior during verification.
  Local browser proof is authoritative for the PR; production checks are
  recorded separately and do not justify bypassing the normal merge/deploy
  path.

---

## Sources and Research

- [Linear FGE-2](https://linear.app/jesus-film-project/issue/FGE-2/watch-search-result-cards-can-route-to-the-watch-homepage)
- `apps/admin/src/services/watch-search.service.ts`
- `apps/admin/src/services/search-watchability.ts`
- `apps/web/src/lib/search.ts`
- `apps/web/src/lib/search-actions.ts`
- `apps/web/src/components/search/VideoCard.tsx`
- `apps/web/src/lib/routes.ts`
- `apps/web/src/proxy.ts`
- `docs/plans/2026-07-14-001-feat-watch-universal-multilingual-search-plan.md`
- `docs/solutions/best-practices/admin-watch-search-production-rollout-20260720.md`
- GitHub PR #1725, `fix(web): restore Watch search collection links`
