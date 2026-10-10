---
title: "fix: Restore Watch global language catalog loading"
type: fix
status: completed
date: 2026-07-23
---

# fix: Restore Watch global language catalog loading

## Summary

Restore the shared Watch language switcher by moving its lazy, read-only global
catalog request from a page-bound Server Action POST to the supported
`/watch/api/*` GET ingress, preserving the established data source, retry
behavior, and canonical navigation contract.

## Problem Frame

On `/watch/english-british.html`, the provider-owned global language modal loads
but its catalog request rejects. Browser network evidence shows the lazy
Next.js Server Action POST to the current public Watch page receives a
Cloudflare-owned plain-text 404 before the Web application can run the action.
The same origin successfully serves existing GET route handlers under
`/watch/api/*`, so the compact catalog needs a read-only route-handler boundary
that production routing admits.

The page-specific video and series pickers use a separate playable-Dub path and
are outside this focused repair.

## Requirements

### Catalog availability

- R1. Opening the provider-owned language switcher on
  `/watch/english-british.html` loads a non-empty catalog of valid public
  language slugs.
- R2. The global catalog request uses a same-origin GET under `/watch/api/*` and
  does not emit a Server Action POST to the current public page URL.
- R3. The existing Admin-backed language metadata source, compact projection,
  display names, deduplication, and exact public slug identity remain unchanged.

### Failure and navigation behavior

- R4. A failed, non-JSON, or malformed catalog response remains retryable and
  cannot poison the client single-flight cache.
- R5. Selecting another language writes the preference and navigates once
  through the existing route-family target contract.
- R6. The modal retains its localized loading, empty, error, focus, and
  pending-navigation behavior.

### Delivery confidence

- R7. The repair adds no catalog request to initial page rendering or the
  provider's disabled global-option warmup.
- R8. Focused tests and browser proof cover the production failure, successful
  GET load, successful language switching, retry behavior, and unchanged
  initial-loading posture.

## Key Technical Decisions

- **Keep the existing global-picker UX and route policy:** The modal,
  preference ordering, and `languageSwitcherTarget` contract are already
  established and should not be redesigned for a transport failure.
- **Use a read-only route handler for the global catalog:** Existing
  `/watch/api/*` GET routes reach the Web application through production edge
  routing, while page-bound Server Action POSTs return before Next.js. The
  endpoint returns only `{slug, englishName, nativeName}` options.
- **Reuse the cached search-language metadata source:** The production failure
  occurs before the query executes. Keeping the shared five-minute server cache
  avoids duplicating Admin pagination and preserves the established catalog
  projection.
- **Preserve bounded client loading:** The compact catalog stays lazy, concurrent
  opens share one request, successful results remain in memory, and rejected
  requests release the slot for Retry.
- **Validate the transport response:** The client accepts only the compact
  option shape before handing it to the modal's public-slug validation.

## Assumptions

- Cloudflare's Watch routing will continue to admit same-origin GET route
  handlers under `/watch/api/*`; the existing beta-tester endpoint was verified
  live as a working control.
- Admin's language metadata remains the source of truth; a hard-coded or
  generated client catalog would create drift and is outside scope.
- The existing metadata cache keeps repeated public requests bounded at the
  Admin boundary.
- The repair can stay within `apps/web` without changing the Admin GraphQL
  schema or generated GraphQL artifacts.

## Scope Boundaries

- Do not change page-specific playable-Dub switching, subtitle selection,
  timestamps, or series ownership.
- Do not change public Watch URL shapes, locale fallback, or canonicalization.
- Add only the read-only global language-options route; do not widen other
  Server Action or search transports in this repair.
- Do not add a dependency, message catalog, Admin schema field, or
  client-visible bearer.
- Do not expose raw upstream errors or cache the response in the browser or a
  shared edge cache.

## Implementation Units

### U1. Characterize the production transport failure

- **Goal:** Turn the observed connection state into a reproducible boundary
  failure and identify a working same-origin control.
- **Requirements:** R1, R2, R4, R8.
- **Dependencies:** None.
- **Files:** `docs/roadmap/platform/feat-300-watch-global-language-options-api.md`,
  `apps/web/src/lib/watch-interaction-loader.test.ts`, and browser network
  evidence.
- **Approach:** Reproduce the exact public route, capture the failed page POST
  status and response owner, verify an existing `/watch/api/*` GET succeeds, and
  add a loader test that fails until the default transport uses GET.
- **Execution note:** The failing test must exercise the default loader rather
  than a test-injected loader so it distinguishes a Server Action import from a
  fetch boundary.
- **Test scenarios:**
  1. The default global loader calls `/watch/api/language-options` with GET and
     `no-store`.
  2. A non-success response rejects and a later call performs a new request.
  3. A malformed success payload rejects safely.
- **Verification:** The tests fail against the Server Action loader and pass
  only after the default transport changes.

### U2. Add the read-only catalog route and preserve client semantics

- **Goal:** Load the compact catalog through production-supported routing
  without changing the source data or modal/navigation behavior.
- **Requirements:** R1-R7.
- **Dependencies:** U1.
- **Files:** `apps/web/src/app/api/language-options/route.ts`,
  `apps/web/src/app/api/language-options/route.test.ts`,
  `apps/web/src/lib/watch-interaction-loader.ts`,
  `apps/web/src/lib/watch-interaction-loader.test.ts`, and
  `apps/web/src/lib/watch-language-actions.ts`.
- **Approach:** Add a force-dynamic GET route that calls the cached catalog
  source, projects compact options, sets private no-store headers, and returns a
  fixed 503 error body on failure. Replace only the global loader's dynamic
  Server Action import with a validated same-origin fetch. Remove the now-unused
  global action export while leaving page-specific language actions unchanged.
- **Patterns to follow:** Existing no-store GET handling in
  `apps/web/src/app/api/beta-tester-cta/route.ts`, path construction in
  `apps/web/src/lib/watch-paths.ts`, and rejected-promise eviction in
  `apps/web/src/lib/watch-interaction-loader.ts`.
- **Test scenarios:**
  1. The route returns projected options and private no-store headers.
  2. An upstream failure returns 503 with no raw error detail.
  3. Concurrent client calls share one request and reuse a successful result.
  4. HTTP and shape failures release the client request slot for Retry.
  5. Existing modal success, empty, error, focus, and navigation tests stay
     green.
- **Verification:** Focused route, loader, and modal suites pass; Web typecheck,
  lint, and production build recognize the new dynamic route.

### U3. Verify production-shaped behavior and loading posture

- **Goal:** Prove the repair on the reported route and guard against a
  performance regression.
- **Requirements:** R1, R2, R4-R8.
- **Dependencies:** U2.
- **Files:** Browser evidence under `output/playwright/` and the roadmap ticket.
- **Approach:** Launch the Watch app with its normal Admin-backed configuration
  or a controlled local catalog fixture, then exercise the global switcher at
  desktop and compact viewports. Inspect network timing to confirm the GET
  begins only after interaction and no page-bound POST occurs.
- **Test scenarios:**
  1. On `/watch/english-british.html`, open the modal and observe a populated
     catalog without the connection error.
  2. Select a different public language and confirm one canonical navigation
     plus the new document language and selected content route.
  3. Simulate one catalog failure, use Retry, and confirm the recovered options
     remain interactive.
  4. Reload without opening the modal and confirm no language-options request
     occurs before interaction.
  5. Repeat at a narrow viewport and confirm the modal remains visible, focused,
     and free of document overflow.
- **Verification:** Focused tests, a production-shaped browser switch, a
  screenshot, and network inspection provide release evidence.

## Risks & Dependencies

- A public GET endpoint is callable without the modal, so the server-side
  metadata cache must remain the traffic-control boundary and responses must
  reveal only public routing identity.
- Importing the existing server catalog source from a route handler must be
  verified by a production build, not only Vitest, because Next.js compiles
  `"use server"` modules specially.
- Unit tests can prove client retry behavior but not Cloudflare routing; the
  exact public path and `/watch/api/*` control require browser/network proof.

## Sources & Research

- Live reproduction on `/watch/english-british.html`: page-bound action POST
  returns `404 text/plain` from Cloudflare before the Web action executes.
- Live control on `/watch/api/beta-tester-cta`: same-origin GET returns
  `200 application/json`.
- `apps/web/src/lib/watch-language-actions.ts` was the prior global Server
  Action boundary.
- `apps/web/src/lib/search-language-actions.ts` owns the cached Admin-backed
  catalog source.
- `docs/solutions/architecture-patterns/provider-owned-watch-language-fallback-and-page-overrides.md`
  establishes that the global catalog stays lazy, compact, server-backed, and
  retryable.
- `docs/roadmap/platform/feat-260-watch-global-language-switcher.md` preserves
  the existing route, ownership, accessibility, and performance contract.
