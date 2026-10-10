---
title: "fix: Hide unavailable Watch sibling videos"
type: fix
status: completed
date: 2026-08-10
roadmap: docs/roadmap/platform/feat-343-watch-sibling-language-availability.md
---

# Hide Unavailable Watch Sibling Videos

## Summary

Stop rendering sibling-carousel links for videos that have no admitted route in the selected language. The server-side Watch route manifest already records exact parent, child, and audio-language admission; the page should use that contract before the carousel UI and related-item structured data receive the children.

This is a render-time availability fix. It does not add redirects or substitute a different video or language because the reported destinations have no equivalent working target.

## Problem Frame

Watch parent and collection queries include the full ordered child list, but some children have no published playable variant in the route's selected language. `buildSiblingCarouselBlock` currently forwards those children unchanged. `SiblingCarousel` then treats any non-empty slug as routable and creates a contextual URL with the current language, producing links that resolve to the native Watch 404 page. `watchRelatedItemListStructuredDataJson` also consumes the same unfiltered carousel model.

Review showed that `muxPlaybackId(languageSlug:)` is not an exact-language availability signal: Admin intentionally falls back to another playable variant when an exact dub is absent. The `WatchRouteManifest` is the authoritative route-admission contract and is already used by the standalone Watch page for exact parent choices.

## Requirements

- R1: A sibling without an admitted parent/child route for the selected language must not appear in the rendered carousel.
- R2: A filtered sibling must not appear in related-item structured data derived from the carousel block.
- R3: Playable siblings must retain their source order, contextual parent route, selected language, and active-video behavior.
- R4: The same rule must apply to contextual canonical-parent siblings, a parent video's own children, and standalone-route selectable parents.
- R5: A carousel source with fewer than two admitted children must be omitted. For selectable parents, omit ineligible parent choices; if none remain, continue through the existing own-child and canonical-parent fallbacks before omitting the carousel.
- R6: Do not add redirects, language fallback, GraphQL schema changes, or additional browser requests.
- R7: Add regression coverage for unavailable children and the fewer-than-two-playable boundary.
- R8: Verify the browser-visible behavior and confirm the change does not introduce a page-loading regression.

## Assumptions

- The route manifest's episode admission index is the authoritative selected-language route contract.
- A child can have a non-empty `muxPlaybackId` and still lack an admitted route in the selected language because playback metadata can fall back to another language.
- The currently rendered video has a playable selected-language variant even if malformed upstream parent data omits it from a child list.
- Preserving editorial child order after filtering is preferable to substituting another language or video.

## Technical Approach

Filter carousel data in the catch-all Watch server page, before `buildSiblingCarouselBlock` creates the model consumed by either the client component or JSON-LD generation:

1. Use `isWatchRouteAdmittedByManifest` with the exact parent slug, child slug, and selected audio-language slug to produce a filtered `CarouselParent` without mutating query results.
2. For standalone selectable parents, retain only parents with at least two admitted children and use the first retained parent as the default. If none remain, preserve the builder's existing fallback order instead of suppressing another valid carousel source.
3. Filter a standalone parent video's own children and a contextual episode's requested parent before calling `mergeWatchExperience`.
4. Preserve parent identity, title, slug, child order, and `currentVideoDocumentId`.
5. Preserve the current fail-open behavior when the manifest is unavailable so a transient manifest outage does not erase navigation.
6. Leave route and proxy behavior unchanged. The unavailable URL remains a truthful 404 when requested directly; the site simply stops advertising it as playable.

The contextual page starts the cached manifest read alongside episode resolution and awaits it with its existing server work. This adds no browser request and keeps the UI and `watchRelatedItemListStructuredDataJson` consistent.

## Implementation Units

### U1 — Filter carousel candidates by exact route admission

**Files:**

- `apps/web/src/app/[locale]/[htmlLang]/[...rest]/page.tsx`

**Work:**

- Add a small parent-filter helper based on `isWatchRouteAdmittedByManifest`.
- Apply it to standalone selectable parents, standalone own children, and contextual requested-parent siblings.
- Start contextual manifest loading in parallel with episode resolution and preserve fail-open behavior when unavailable.
- Pass the filtered copies into `mergeWatchExperience`; keep the raw parent for download-sequence totals.

**Acceptance:**

- When the manifest is available, every `WatchSiblingCarouselBlock.canonicalParent.children` entry has an admitted route in the selected language.
- Every `selectableParents` entry has at least two admitted children.

### U2 — Add focused regression coverage

**Files:**

- `apps/web/src/app/[locale]/[htmlLang]/[...rest]/__tests__/page-routing.test.tsx`

**Work:**

- Prove manifest-unavailable children are removed while admitted-child order is preserved.
- Cover standalone selectable-parent/own-child behavior and contextual canonical-parent behavior.
- Give an unavailable child a non-empty fallback `muxPlaybackId` so the test guards the production contract.
- Confirm the raw parent still drives download-sequence totals while carousel and JSON-LD use the filtered model.

**Acceptance:**

- Tests fail without route-manifest filtering and pass with it.
- Tests do not treat `muxPlaybackId` as exact-language availability proof.

### U3 — Browser and performance verification

**Files:** none expected.

**Work:**

- Run targeted unit/type/format validation for the touched Web scope.
- Exercise a representative Watch route with mixed selected-language availability.
- Confirm the unavailable sibling title/link is absent, playable siblings remain navigable, and the page has no new console or network errors.
- Capture a screenshot and a lightweight page-loading/network comparison appropriate to this render-model-only change.

## Constraints and Non-Goals

- No mass redirects: there is no semantically equivalent destination for the missing language variants.
- No deletion of videos or relationships in Admin.
- No change to standalone/contextual canonicalization or route-manifest admission.
- No generated GraphQL files or schema changes.
- No redesign of the sibling carousel.
- Keep one PR scoped to this availability defect.

## Verification

- Focused page-routing, content-builder, renderer, and structured-data tests.
- Web-scope typecheck and formatting/CI-sensitive checks identified by package scripts.
- Browser smoke on a known affected language route: unavailable card absent; retained card navigation succeeds.
- Screenshot of the corrected carousel.
- Browser console/network inspection and a before/after request-count or performance trace showing no added client request.

## Risks and Mitigations

- **Risk:** A parent choice may remain selectable with too few cards after filtering, or filtering may hide a valid lower-priority source. **Mitigation:** filter each parent before applying the two-child threshold, then preserve the builder's existing fallback order when every selectable parent is removed.
- **Risk:** UI and structured data diverge. **Mitigation:** filter the shared `WatchSiblingCarouselBlock` rather than only JSX output.
- **Risk:** A transient manifest failure hides all navigation. **Mitigation:** preserve the existing fail-open behavior when the manifest is unavailable.
- **Risk:** A playback fallback is mistaken for exact-language availability. **Mitigation:** tests use a non-empty fallback playback ID on a route the manifest admits only in another language.

## Done When

- The reported class of unavailable selected-language siblings is absent from carousel markup and related-item JSON-LD.
- Playable siblings and active-state navigation still behave correctly.
- Targeted validation, review, browser proof, commit, PR, and CI complete successfully.

## Completion Evidence

- Exact affected route: `/watch/family.html/delight/jula.html`, rendered locally against current read-only Admin data.
- The reported broken title and href for `the-story-of-jesus-for-children/jula.html` are absent from both server HTML and the browser carousel; the visible rail contains 11 admitted Jula items.
- A retained sibling navigates successfully to `/watch/family.html/fellowship-of-believers/jula.html` and becomes the active item.
- Browser errors: none. Browser-side `watch-route-manifest` requests: none.
- Page timing after the initial dev compile: 1.75 seconds, then 0.08 and 0.08 seconds warm. The manifest request starts alongside route resolution in both standalone and contextual route tests.
- Screenshot: `output/playwright/watch-jula-sibling-language-filtered.png` (local proof artifact, intentionally uncommitted).
