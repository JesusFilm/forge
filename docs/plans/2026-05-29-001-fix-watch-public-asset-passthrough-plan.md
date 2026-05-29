---
title: "fix: Preserve watch public asset passthrough"
type: fix
status: completed
date: 2026-05-29
---

# fix: Preserve watch public asset passthrough

## Summary

Fix the `/watch` proxy/canonicalizer boundary so public assets served from `apps/web/public` bypass watch URL `.html` normalization. The plan covers the live-broken `images` subtree plus the same-class `fonts` subtree, while preserving the existing watch content URL canonicalization rules.

---

## Problem Frame

Production requests for `/watch/images/jesusfilm-sign.svg` are being treated like watch content URLs and redirected to `/watch/images.html/jesusfilm-sign.svg.html`. The browser then receives HTML where an SVG was expected, which breaks the floating JesusFilm sign and puts the same failure mode on favicons, flags, overlays, and any future public asset path not covered by the proxy reserved-prefix contract.

---

## Requirements

- R1. Requests under `/watch/images/*`, `/watch/assets/*`, and `/watch/fonts/*` must pass through without proxy or canonicalizer redirects.
- R2. Existing watch content canonicalization must remain unchanged for localized home, two-segment video, three-segment episode, alias, and trailing-slash cases.
- R3. The reserved-prefix contract must stay consistent across route parsing, pure canonicalization, and proxy matching.
- R4. The watch URL probe matrix must include representative public asset paths from every first-level `apps/web/public` directory.
- R5. Runtime request handling must not add filesystem reads or dynamic public-directory scanning.

---

## Scope Boundaries

- Do not move or duplicate public assets to work around the proxy behavior.
- Do not replace the current `/watch/images/...` component paths with unrelated CDN or root-relative paths.
- Do not redesign the floating search/header/logo UI.
- Do not change the watch content URL shape or relax content slug validation.
- Do not introduce Cloudflare or Railway routing rules for a bug that belongs in the app-level proxy contract.

### Deferred to Follow-Up Work

- A generalized build-time check that validates every future `apps/web/public` first-level directory against proxy matcher coverage can be added later if this class recurs after the immediate production fix.

---

## Context & Research

### Relevant Code and Patterns

- `apps/web/next.config.mjs` sets `basePath: WATCH_BASE_PATH`, so public assets are served under `/watch/...` in production.
- `apps/web/public` currently has three first-level directories: `assets`, `fonts`, and `images`.
- `apps/web/src/lib/url-shape.ts` defines `RESERVED_PREFIXES`, currently covering `assets` but not `images` or `fonts`.
- `apps/web/src/proxy.ts` has a matcher exclusion that mirrors the reserved-prefix list and currently excludes `assets` but not `images` or `fonts`.
- `apps/web/src/lib/routes.ts` uses `RESERVED_PREFIXES` in `parseWatchPath`, so route classification should remain aligned with canonicalizer behavior.
- Current `/watch/images/...` call sites include `apps/web/src/components/FloatingSearchProvider.tsx`, `apps/web/src/components/SearchOverlay.tsx`, `apps/web/src/components/watch/LanguageCombobox.tsx`, `apps/web/src/app/layout.tsx`, `apps/web/src/components/watch/WatchSectionRenderer.tsx`, and `apps/web/src/components/sections/Section.tsx`.
- `apps/web/src/lib/media-image-url.ts` intentionally rewrites `/images/...` and `jesusfilm.org/images/...` values to `/watch/images/...`, so this helper depends on `images` passthrough being valid.
- Existing test anchors are `apps/web/src/lib/url-canonicalize.test.ts`, `apps/web/src/proxy.test.ts`, `apps/web/src/lib/url-shape.test.ts`, `apps/web/src/lib/routes.test.ts`, and `apps/web/src/lib/watch-url-probe.test.ts`.

### Institutional Learnings

- `docs/solutions/best-practices/nextjs-search-overlay-ui-patterns-20260415.md` documents the basePath/local-image trap: local files need a basePath-aware path in this app.
- `docs/solutions/best-practices/nextjs-route-shape-migration-cross-cutting-contract-drift-20260430.md` says URL/proxy changes are cross-cutting contracts and need seam-level coverage, not only colocated component tests.
- `docs/solutions/best-practices/idempotence-property-test-vacuous-on-malformed-fixed-point-20260528.md` says canonicalizers need output-contract tests in addition to idempotence tests; this plan applies that to public-asset passthrough.

### External References

- Not used. Local patterns and shipped repo contracts are sufficient for this bounded proxy/canonicalizer fix.

---

## Key Technical Decisions

- Fix the routing boundary, not the components: the component paths are the expected basePath-aware asset URLs; the bug is that the proxy treats their first segment as watch content.
- Reserve every current first-level public asset directory: `assets` is already covered; add `images` for the production break and `fonts` for the same public-asset class.
- Keep proxy matching explicit and test-backed: Next proxy matcher configuration is static, so implementation should update the matcher and back it with contract tests rather than relying on request-time filesystem inspection.
- Test at all three layers that can drift: pure canonicalizer, route parser, and proxy integration.
- Extend the existing watch URL probe fixture so production and preview checks include public assets, not only watch content URLs.
- Make pass-through probe expectations contract-aware. A production baseline that is already redirecting an asset to a `.html` path must be reported as a failure, not treated as an acceptable difference.

---

## Open Questions

### Resolved During Planning

- Should `fonts` be included even though current font loading goes through `next/font` and `/_next`? Yes. It is a first-level public directory and shares the same bypass contract as `images` and `assets`.
- Should this be fixed by changing logo `src` values? No. The scan found many valid `/watch/images/...` consumers, and `media-image-url.ts` intentionally emits that shape.

### Deferred to Implementation

- Whether to add a small exported helper around reserved public prefixes or only extend the existing `RESERVED_PREFIXES` set is deferred. The behavior and tests matter more than the exact helper shape.
- Whether roadmap README regeneration is automated or manual is deferred to implementation, but the final roadmap state must include the new ticket if the implementation creates one.

---

## Implementation Units

### U1. Add Roadmap Tracking

**Goal:** Create or update the roadmap ticket that tracks this production watch public-asset passthrough bug before implementation proceeds.

**Requirements:** R1, R3

**Dependencies:** None

**Files:**

- Create: `docs/roadmap/platform/feat-147-watch-public-asset-passthrough.md`
- Modify: `docs/roadmap/README.md`

**Approach:**

- If implementation confirms no existing ticket covers this exact bug, add the next global roadmap ID in the platform lane because the change is a web deployment/proxy contract fix.
- Mark the ticket `in-progress` while the implementation is active.
- Keep the ticket short and agent-optimized: entry points, grep terms, constraints, and verification focused on `apps/web`.

**Patterns to follow:**

- `docs/roadmap/platform/feat-146-web-user-accounts-download-gate.md`
- `docs/roadmap/platform/feat-145-watch-question-panel-flag.md`

**Test scenarios:**

- Test expectation: none -- roadmap metadata only.

**Verification:**

- The roadmap has a discoverable ticket for this fix and no duplicate global feature ID.

---

### U2. Align Reserved Prefix Classification

**Goal:** Make `images`, `assets`, and `fonts` first-class reserved prefixes in the pure route-shape contract.

**Requirements:** R1, R3, R5

**Dependencies:** U1

**Files:**

- Modify: `apps/web/src/lib/url-shape.ts`
- Test: `apps/web/src/lib/url-shape.test.ts`
- Test: `apps/web/src/lib/routes.test.ts`

**Approach:**

- Extend the reserved-prefix set to include every current first-level public asset directory.
- Keep the set request-path-safe; do not read `apps/web/public` at runtime.
- Update route parser coverage so `/images/...`, `/assets/...`, and `/fonts/...` classify as reserved instead of content routes.

**Execution note:** Add the failing route/parser regression tests before changing the reserved-prefix set.

**Patterns to follow:**

- Existing `RESERVED_PREFIXES` comments in `apps/web/src/lib/url-shape.ts`
- Existing reserved-prefix tests in `apps/web/src/lib/routes.test.ts`

**Test scenarios:**

- Happy path: parsing `/images/jesusfilm-sign.svg` returns a reserved route with prefix `images`.
- Happy path: parsing `/fonts/Montserrat-VariableFont_wght.woff2` returns a reserved route with prefix `fonts`.
- Regression: existing `/assets/favicon-180.png` reserved behavior remains unchanged.
- Edge case: watch content paths with `.html` suffixes, such as `/jesus.html/english.html`, still parse as content routes rather than reserved paths.

**Verification:**

- Route classification consistently treats all public asset directories as reserved without changing content route parsing.

---

### U3. Preserve Asset Passthrough in Canonicalizer and Proxy

**Goal:** Stop `/watch/images/*` and `/watch/fonts/*` from being redirected by canonicalization in production.

**Requirements:** R1, R2, R3, R5

**Dependencies:** U2

**Files:**

- Modify: `apps/web/src/proxy.ts`
- Test: `apps/web/src/lib/url-canonicalize.test.ts`
- Test: `apps/web/src/proxy.test.ts`

**Approach:**

- Ensure `canonicalizeWatchPath` short-circuits for `images`, `assets`, and `fonts` through the shared reserved-prefix contract.
- Update the proxy matcher so those same subtrees do not enter the canonicalize pipeline.
- Preserve the existing reserved framework/API exclusions, especially `_next`, `api`, `.well-known`, `robots.txt`, and `sitemap.xml`.
- Keep current watch route security headers and content canonicalization behavior unchanged.

**Execution note:** Start with failing tests for `/images` and `/fonts` passthrough, then update the matcher and reserved prefixes.

**Patterns to follow:**

- Existing `proxy — reserved-subtree pass-through` coverage in `apps/web/src/proxy.test.ts`
- Existing short-circuit guard coverage in `apps/web/src/lib/url-canonicalize.test.ts`

**Test scenarios:**

- Happy path: `canonicalizeWatchPath({ rawPathname: "/images/jesusfilm-sign.svg" })` returns canonical.
- Happy path: `canonicalizeWatchPath({ rawPathname: "/images/flags/ru.svg" })` returns canonical.
- Happy path: `canonicalizeWatchPath({ rawPathname: "/fonts/Montserrat-VariableFont_wght.woff2" })` returns canonical.
- Integration: `proxy(makeRequest("/images/jesusfilm-sign.svg"))` does not return a 307 or 308.
- Integration: `proxy(makeRequest("/images/favicon-32.png"))` does not return a 307 or 308.
- Integration: `proxy(makeRequest("/fonts/Montserrat-VariableFont_wght.woff2"))` does not return a 307 or 308.
- Regression: `proxy(makeRequest("/jesus"))` still duplicate-expands to the canonical watch URL.
- Regression: `proxy(makeRequest("/jesus.html/chinese-mandarin.html"))` still resolves the language alias.
- Regression: existing `/assets/*`, `/api/*`, `/_next/*`, and `/.well-known/*` pass-through tests remain green.

**Verification:**

- Public asset paths are never rewritten into `.html` watch-content shapes, while existing content canonicalization tests still pass.

---

### U4. Extend Watch URL Probe Coverage and Contract Checks

**Goal:** Make production/preview probing catch public asset rewrites before they reach users again, even when the current production baseline is already wrong.

**Requirements:** R1, R4

**Dependencies:** U3

**Files:**

- Modify: `apps/web/src/lib/watch-url-probe.ts`
- Test: `apps/web/src/lib/watch-url-probe.test.ts`

**Approach:**

- Expand the pass-through fixture group to include representative paths for all public asset directories: logo/sign, favicon or flag, overlay asset, and font.
- Keep these fixtures as pass-through expectations rather than content URL expectations.
- Strengthen the probe's expectation handling so `expect: "passthrough"` asserts that the probed response does not redirect and that the final path remains the requested path. This expectation should be evaluated for each side independently before the existing production-vs-preview diffing result is trusted.
- Keep the existing production-vs-preview comparison for content URLs; the new expectation check is specifically what catches a production asset path that is already being rewritten.

**Patterns to follow:**

- Existing `PASSTHROUGH` fixture group in `apps/web/src/lib/watch-url-probe.ts`
- Existing probe classification tests in `apps/web/src/lib/watch-url-probe.test.ts`

**Test scenarios:**

- Happy path: `/watch/images/jesusfilm-sign.svg` is included in the pass-through fixture group.
- Happy path: `/watch/images/flags/ru.svg` or another representative flag is included in the pass-through fixture group.
- Happy path: `/watch/assets/overlay.svg` is included in the pass-through fixture group.
- Happy path: `/watch/fonts/Montserrat-VariableFont_wght.woff2` is included in the pass-through fixture group.
- Error path: a pass-through fixture with any redirect hop is classified as a contract failure, even if the redirect eventually returns 200.
- Error path: a pass-through fixture whose final path changes from `/watch/images/jesusfilm-sign.svg` to `/watch/images.html/jesusfilm-sign.svg.html` is classified as a contract failure.
- Regression: content URL redirect comparisons still allow the existing acceptable/soft/hard outcomes where appropriate.

**Verification:**

- The probe matrix would flag the current live `/watch/images/jesusfilm-sign.svg` redirect as a pass-through contract failure.

---

### U5. Validate User-Facing Asset Surfaces

**Goal:** Prove the fix against both the visible logo and the other scanned asset consumers.

**Requirements:** R1, R2, R4

**Dependencies:** U3, U4

**Files:**

- Test: `apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx`
- Test: `apps/web/src/components/watch/__tests__/LanguageCombobox.test.tsx`
- Test: `apps/web/src/components/watch/__tests__/WatchSectionRenderer.test.tsx`
- Test: `apps/web/src/lib/media-image-url.test.ts`

**Approach:**

- Keep component-level tests focused on emitted asset paths, not proxy implementation details.
- Confirm existing tests that assert `/watch/images/flags/...` and `/watch/images/...` paths still match the intended basePath-aware asset URLs.
- During implementation verification, load a watch page and confirm the logo image response is SVG, flags resolve as SVG, and favicon/overlay requests do not redirect to HTML.

**Patterns to follow:**

- Existing image path assertions in `apps/web/src/components/watch/__tests__/LanguageCombobox.test.tsx`
- Existing basePath rewrite assertions in `apps/web/src/lib/media-image-url.test.ts`
- Existing `floating-header-logo` test coverage in `apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx`

**Test scenarios:**

- Happy path: floating header logo emits `/watch/images/jesusfilm-sign.svg`.
- Happy path: language flags still emit `/watch/images/flags/<code>.svg`.
- Happy path: watch section overlay backgrounds still emit `/watch/images/overlay.svg`.
- Happy path: media image URL resolution still prefixes `/images/...` as `/watch/images/...`.
- Integration: a rendered watch page no longer shows a broken image icon for the floating JesusFilm sign.
- Integration: representative `/watch/images/*`, `/watch/assets/*`, and `/watch/fonts/*` HTTP responses do not redirect to `.html` content paths.

**Verification:**

- The visible watch header sign renders correctly, and no scanned public asset consumer depends on a path that the proxy still rewrites.

---

## System-Wide Impact

- **Interaction graph:** `apps/web/src/proxy.ts`, `apps/web/src/lib/url-canonicalize.ts`, `apps/web/src/lib/routes.ts`, and public-asset component call sites all share the same first-segment routing contract.
- **Error propagation:** A missed reserved prefix turns an asset request into a content-route redirect and then HTML response, so the browser reports only a broken image. Tests must assert the HTTP redirect behavior directly.
- **State lifecycle risks:** No persistent data or cache mutation is involved. Browser caches may hold stale broken-image outcomes briefly, but the current redirect response uses private no-cache semantics.
- **API surface parity:** The same reserved-prefix list must protect pure parsing, canonicalization, proxy matching, and the production probe matrix. Probe expectations need their own contract checks because production can be the broken baseline.
- **Integration coverage:** Unit tests prove rule behavior; probe/browser checks prove the deployed app serves the asset paths through Railway/Cloudflare without rewriting.
- **Unchanged invariants:** Watch content canonical URLs, security headers for watch routes, `_next` framework asset bypass, and server-only data fetching remain unchanged.

---

## Risks & Dependencies

| Risk                                                                               | Mitigation                                                                                                        |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Proxy matcher and `RESERVED_PREFIXES` drift again                                  | Update both in the same unit and add tests at parser, canonicalizer, proxy, and probe layers.                     |
| Over-broad reserved prefixes block a future content slug named `images` or `fonts` | Reserve only first-level public asset directory names; content URLs with `.html` segment shapes remain available. |
| Tests pass locally but production still routes differently under basePath          | Include deployed-style `/watch/...` probe fixtures and a browser or HTTP smoke proof against the running app.     |
| Fix only covers the logo and misses flags/favicons/overlays                        | Scan-backed test cases include multiple `/watch/images/...` consumers and the full public directory set.          |

---

## Documentation / Operational Notes

- If implementation confirms this is a production incident pattern rather than a one-off, add a short `docs/solutions/` note during `ce-compound` about keeping public asset subtrees in the `/watch` proxy reserved-prefix contract.
- The implementation PR should mention the live symptom: `/watch/images/jesusfilm-sign.svg` redirected to `/watch/images.html/jesusfilm-sign.svg.html`.
- Deployment verification should include direct asset URL checks for SVG, PNG, and WOFF2 content types, plus a watch-page visual smoke of the floating sign.

---

## Sources & References

- Related code: `apps/web/src/proxy.ts`
- Related code: `apps/web/src/lib/url-shape.ts`
- Related code: `apps/web/src/lib/url-canonicalize.ts`
- Related code: `apps/web/src/lib/routes.ts`
- Related code: `apps/web/src/lib/watch-url-probe.ts`
- Related code: `apps/web/src/lib/media-image-url.ts`
- Related code: `apps/web/src/components/FloatingSearchProvider.tsx`
- Related code: `apps/web/src/components/SearchOverlay.tsx`
- Related code: `apps/web/src/components/watch/LanguageCombobox.tsx`
- Related plan: `docs/plans/2026-05-27-002-feat-watch-url-html-shape-i18n-restructure-plan.md`
- Institutional learning: `docs/solutions/best-practices/nextjs-search-overlay-ui-patterns-20260415.md`
- Institutional learning: `docs/solutions/best-practices/nextjs-route-shape-migration-cross-cutting-contract-drift-20260430.md`
- Institutional learning: `docs/solutions/best-practices/idempotence-property-test-vacuous-on-malformed-fixed-point-20260528.md`
