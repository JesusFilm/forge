---
title: "fix: Stop watch internal rewrite redirect loop"
type: fix
status: completed
date: 2026-05-30
---

# fix: Stop watch internal rewrite redirect loop

## Summary

Fix the proxy/runtime gap where public watch URLs rewrite to the internal static locale tree, then the same proxy treats that internal target as a visible duplicate URL and redirects back to the public URL. The plan keeps the internal `[locale]/[htmlLang]` static route model, adds explicit second-pass protection in proxy tests and runtime proof, and updates the probe harness so documented intentional divergences do not mask real cutover failures.

---

## Problem Frame

The rebuilt local production server showed valid public URLs such as `/watch/jesus.html/english.html` returning a self-looping `308`: the first proxy pass rewrites to `/watch/en/en/jesus.html/english.html`, then the visible internal-prefix policy redirects that internal target back to `/watch/jesus.html/english.html`. Unit tests cover each branch in isolation, but they do not simulate the second proxy pass that Next performs around the rewrite target.

---

## Requirements

- R1. Canonical public watch URLs from `docs/research/jesusfilm-watch-url-patterns.md` must terminate in the intended `200`, `307`, `308`, or `404` outcome without a same-path redirect loop.
- R2. Visible direct requests to internal static prefixes such as `/watch/en/en/jesus.html/english.html` must still avoid duplicate public content by redirecting to the canonical public URL or returning `404`.
- R3. The fix must preserve static/ISR behavior: no `headers()`, `cookies()`, `unstable_noStore`, `cache: "no-store"`, or `force-dynamic` usage may enter cacheable watch render trees.
- R4. Existing manifest admission, hostile-path rejection, reserved asset/API/demo passthrough, and `/watch/search` modal fallback behavior must remain intact.
- R5. The watch URL probe must distinguish real preview regressions from documented intentional production divergences such as asset passthrough and deprecated `/watch/search`.
- R6. Completion requires production-server proof, not only unit tests: representative public URLs must return terminal responses, direct internal URLs must not 200 as ordinary public duplicates, and repeat cacheable requests must show ISR/cache headers.

---

## Scope Boundaries

- Do not redesign the static locale rewrite architecture or move watch pages back to public-shaped App Router files.
- Do not add dynamic request reads to `apps/web/src/app/[locale]/[htmlLang]/**` to identify internal rewrites.
- Do not make the admin route manifest a full route-existence oracle; it remains a compact dimensional admission prefilter.
- Do not preserve the old synthetic `/watch/search.html/search.html` page.
- Do not change public component links from audio slugs such as `english.html` back to catalog keys such as `en.html`.

### Deferred to Follow-Up Work

- If the rerun probe proves that `german`, `swahili`, or specific episode fixtures are now true data-contract mismatches rather than artifacts of the redirect loop, reconcile those entries in `docs/research/jesusfilm-watch-url-patterns.md` and the admin manifest snapshot in a separate data-focused PR.

---

## Context & Research

### Relevant Code and Patterns

- `apps/web/src/proxy.ts` owns the order: reserved subtree bypass, visible internal-prefix policy, canonicalization, deprecated search handling, manifest admission, then internal rewrite.
- `apps/web/src/proxy.test.ts` already pins canonicalization, reserved passthrough, explicit locale URLs, internal locale rewrites, manifest-hostile 404s, and direct-prefix redirects. It lacks a test for the "rewrite target re-enters proxy" runtime shape.
- `apps/web/src/app/[locale]/[htmlLang]/layout.tsx` and sibling pages are the static route tree the proxy targets. They must stay free of request-header reads.
- `apps/web/src/lib/watch-url-probe.ts` compares production and preview responses across the research-doc §5 matrix. Its current passthrough classification treats production's legacy asset redirects as a hard failure even when preview is following the new documented contract.
- `apps/web/next.config.mjs` sets `basePath: "/watch"` and has a root rewrite for `/watch` to `/en/en`; basePath semantics are part of this bug surface.
- `apps/web/node_modules/next/dist/server/web/spec-extension/response.d.ts` confirms `NextResponse.rewrite()` accepts `MiddlewareResponseInit`, including request-header overrides for the upstream request.

### Institutional Learnings

- `docs/solutions/best-practices/nextjs-route-shape-migration-cross-cutting-contract-drift-20260430.md` warns that route-shape changes drift across proxy, URL builders, revalidation, metadata, and tests unless the seam is tested end to end.
- `docs/solutions/performance-issues/watch-static-locale-rewrite-route-manifest-admission-20260529.md` records the current invariant split: public audio slug, UI catalog key, and static `<html lang>` must not be conflated.
- `docs/solutions/architecture-patterns/admin-owned-watch-route-manifest-20260530.md` documents the manifest as an early admission gate, not a rendering payload or exact per-dub existence oracle.
- `apps/web/AGENTS.md` now explicitly forbids visible public links that use catalog keys such as `en.html` and keeps search in the modal surface.

### External References

- Next.js `NextResponse` API documents rewrites as URL-preserving responses and exposes request-header forwarding through the response init contract: `https://nextjs.org/docs/app/api-reference/functions/next-response`.
- Next.js Proxy documentation covers proxy as the route-boundary layer for redirects, rewrites, and matchers: `https://nextjs.org/docs/app/api-reference/file-conventions/proxy`.

---

## Key Technical Decisions

- Preserve the internal static route tree and fix the proxy boundary rather than re-opening the larger route-tree migration. The route tree is already static in `next build`; the bug is the proxy's inability to distinguish visible direct-prefix requests from its own rewrite target.
- Mark internal rewrite passes at the proxy layer, not inside page/layout rendering. The marker must be carried through the rewritten request so the second proxy pass can allow the internal target without introducing `headers()` into static render trees.
- Keep direct-prefix protection as a visible-request policy. A normal browser/crawler request to `/watch/en/en/...` should still redirect or 404; the marker is a proxy-internal coordination mechanism, not a public URL feature or auth boundary.
- Treat the watch URL probe as a cutover contract checker, not a blind production clone. Where the research doc intentionally diverges from current production, preview should be judged against the documented desired contract.

---

## Open Questions

### Resolved During Planning

- Should the fix move direct-prefix handling out of proxy entirely? No. The existing direct-prefix policy is the right SEO/correctness guard; moving it wholesale to route rendering would tempt dynamic request reads, and excluding internal prefixes from the matcher would expose duplicate 200s.
- Should `/watch/search` be restored as a page to satisfy the raw production-diff probe? No. Search is modal-only now; the plan should update probe expectations instead of reviving the synthetic page.

### Deferred to Implementation

- Does the chosen proxy marker survive the exact second-pass path in Next 16.2.4 production mode? Implementation should begin with a failing local production or integration proof and keep a fallback available if Next does not preserve the request marker as expected.
- After the loop is fixed, are `german`, `swahili`, and the two production-404 episode fixtures still mismatches? Re-probe after U2 before changing docs or data assumptions.

---

## High-Level Technical Design

> _This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce._

| Request shape                                                             | Proxy-internal marker | Desired behavior                                                                                 |
| ------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------ |
| Public canonical `/jesus.html/english.html`                               | absent on entry       | Canonicalize/admit, then rewrite to internal route with marker attached to the upstream request. |
| Internal target `/en/en/jesus.html/english.html` reached from the rewrite | present               | Allow the app route to render; do not apply the visible direct-prefix redirect.                  |
| Visible direct request `/en/en/jesus.html/english.html`                   | absent                | Redirect to `/jesus.html/english.html` or 404 if the pair/path is invalid.                       |
| Visible invalid pair `/en/es-419/jesus.html/english.html`                 | absent                | Preserve current 404 policy.                                                                     |
| Hostile public `/anything.html/english.html`                              | absent                | Manifest admission rejects before rewrite when manifest is available.                            |

---

## Implementation Units

### U1. Add Characterization Coverage for the Rewrite Loop

**Goal:** Pin the failing two-pass behavior before changing proxy policy, so the implementation cannot accidentally pass only the existing isolated unit tests.

**Requirements:** R1, R2, R6

**Dependencies:** None

**Files:**

- Modify: `apps/web/src/proxy.test.ts`
- Modify: `apps/web/src/lib/watch-url-probe.test.ts`
- Test: `apps/web/src/proxy.test.ts`
- Test: `apps/web/src/lib/watch-url-probe.test.ts`

**Approach:**

- Add proxy tests that model the runtime sequence: public canonical URL rewrites to an internal path, then that internal path is presented to proxy as the next routing step.
- Keep separate assertions for direct visible internal prefixes without the marker so the duplicate-content guard remains protected.
- Add a probe classifier test for a same-path redirect loop on an otherwise valid URL, so the cutover gate reports it as a hard failure with a clear note.

**Execution note:** Start characterization-first; this unit should fail against the current branch before U2 changes proxy behavior.

**Patterns to follow:**

- Existing `rewritePath(response)` helper in `apps/web/src/proxy.test.ts`.
- Existing `classifyProbe()` unit coverage in `apps/web/src/lib/watch-url-probe.test.ts`.

**Test scenarios:**

- Integration: public `/jesus.html/english.html` first pass produces an internal rewrite target and an internal marker that can be applied to the simulated second pass.
- Integration: second pass for `/en/en/jesus.html/english.html` with the internal marker does not return `307` or `308`.
- Error path: direct `/en/en/jesus.html/english.html` without the internal marker still redirects to `/jesus.html/english.html`.
- Error path: direct invalid `/en/es-419/jesus.html/english.html` without the marker still returns `404`.
- Error path: a probe result with repeated `308` to the same final path is classified as a hard regression, not a soft regression.

**Verification:**

- The new characterization tests fail before U2 and pass after U2.

---

### U2. Make Proxy Distinguish Internal Rewrite Passes from Visible Internal URLs

**Goal:** Stop the public URL -> internal rewrite -> direct-prefix redirect loop while preserving direct-prefix protection for ordinary public requests.

**Requirements:** R1, R2, R3, R4

**Dependencies:** U1

**Files:**

- Modify: `apps/web/src/proxy.ts`
- Modify: `apps/web/src/proxy.test.ts`
- Test: `apps/web/src/proxy.test.ts`

**Approach:**

- Introduce one proxy-local internal rewrite marker constant.
- When `rewriteToInternal()` builds the `NextResponse.rewrite()`, forward a cloned request header set with the marker attached for the rewritten upstream request.
- At the top of the proxy decision flow, honor the marker only for valid internal prefix paths: allow the route to continue without applying the visible direct-prefix redirect, and keep watch security headers on the response path.
- Continue to run the existing reserved-prefix bypass, canonicalization, manifest admission, and direct-prefix behavior for unmarked requests.
- Do not read the marker in `app/[locale]/[htmlLang]/**`; that would reintroduce dynamic rendering risk.

**Patterns to follow:**

- Current `applyWatchSecurityHeaders()` and `buildRedirect()` helpers in `apps/web/src/proxy.ts`.
- Current `internalPrefixDecision()` pair validation; reuse its classification instead of adding a parallel internal-prefix parser.
- Next.js `MiddlewareResponseInit.request.headers` contract surfaced by the installed Next type definitions.

**Test scenarios:**

- Happy path: `/jesus.html/english.html` still rewrites to `/en/en/jesus.html/english.html` and carries the internal marker for the upstream pass.
- Happy path: `/spanish-latin-american.html` style homes still rewrite with distinct `locale` and `htmlLang` identity.
- Happy path: `/videos` and `/` continue to rewrite to default internal identity without visible redirects.
- Error path: direct `/en/en/videos` without marker redirects to `/videos`.
- Error path: direct `/es/es-419/jesus.html/spanish-latin-american.html` without marker redirects to `/jesus.html/spanish-latin-american.html`.
- Error path: invalid marked internal prefixes do not become broad bypasses; they still reject or fall through only when they match the validated internal route shape.
- Integration: hostile `/anything.html/english.html` still returns `404` before internal rewrite when the manifest source has no matching slug.

**Verification:**

- Valid public watch URLs no longer emit a same-path `Location` header after a production-server run.
- Direct visible internal URLs remain non-200 for ordinary requests.

---

### U3. Preserve Static/ISR and Manifest Admission Contracts

**Goal:** Ensure the loop fix does not regress the performance reason the static locale rewrite exists.

**Requirements:** R3, R4, R6

**Dependencies:** U2

**Files:**

- Modify: `apps/web/src/proxy.test.ts`
- Modify: `apps/web/src/app/[locale]/[htmlLang]/[...rest]/__tests__/page-routing.test.tsx`
- Test: `apps/web/src/proxy.test.ts`
- Test: `apps/web/src/app/[locale]/[htmlLang]/[...rest]/__tests__/page-routing.test.tsx`

**Approach:**

- Keep the marker entirely in proxy-level routing; do not import `next/headers` or add request-header reads in layouts, pages, metadata, content helpers, or feature-flag paths.
- Reconfirm that invalid public route dimensions reject in proxy before reaching `dynamic = "force-static"` catch-all pages when the manifest is present.
- If implementation needs a route-level guard as fallback, require a static-safe design review before adopting it; this plan's preferred path avoids route-level request reads.

**Patterns to follow:**

- `docs/solutions/performance-issues/watch-static-locale-rewrite-route-manifest-admission-20260529.md` static proof and hostile-path examples.
- Existing page-routing tests that assert resolver mocks are not called for known-invalid shapes.

**Test scenarios:**

- Error path: `/anything.html/english.html` with a manifest missing `anything` returns `404` and does not rewrite.
- Error path: unknown episode pairs remain `404` before page resolver work.
- Happy path: valid one-segment collection slugs such as `easter` still route as collections, not localized home.
- Static audit: no new imports or calls to dynamic request APIs are introduced in cacheable watch render-tree files.

**Verification:**

- `next build` still marks `/[locale]/[htmlLang]`, `/[locale]/[htmlLang]/videos`, and `/[locale]/[htmlLang]/[...rest]` as static.
- Runtime repeat requests to a representative public route show cache hit behavior after the first render.

---

### U4. Make the URL Probe Gate Match the Desired Cutover Contract

**Goal:** Keep the probe useful after the loop fix by separating actual regressions from intentional deviations from legacy production.

**Requirements:** R1, R4, R5, R6

**Dependencies:** U2

**Files:**

- Modify: `apps/web/src/lib/watch-url-probe.ts`
- Modify: `apps/web/src/lib/watch-url-probe.test.ts`
- Modify: `docs/research/jesusfilm-watch-url-patterns.md`
- Test: `apps/web/src/lib/watch-url-probe.test.ts`

**Approach:**

- Treat `expect: "passthrough"` as a preview contract for asset/framework/API subtrees. Production's legacy redirect to fake `.html` paths should be reported as baseline drift, not as a preview hard regression when preview preserves the requested path.
- Treat `/watch/search` as an intentional rewrite-era divergence: preview redirecting or resolving to `/watch` with query preservation is acceptable; `/watch/search.html/search.html` must remain `404`.
- Keep production-vs-preview comparison for normal content URLs, but annotate any fixture whose production status has drifted from the research doc before changing the expected contract.
- Add explicit reporting for redirect loops so the next failure reads like "same-path redirect loop" instead of a generic soft regression.

**Patterns to follow:**

- Existing `ProbeExpect` fixture field and grouped report output in `apps/web/src/lib/watch-url-probe.ts`.
- Research doc TL;DR notes that `/watch/search` and asset subtree handling intentionally differ from legacy production.

**Test scenarios:**

- Happy path: preview `200` for `/watch/images/jesusfilm-sign.svg` at the same final path is accepted even if production redirects to `/watch/images.html/...`.
- Happy path: preview `/watch/search` redirect or direct root modal fallback is accepted; `/watch/search.html/search.html` remains a hard failure if it resolves.
- Error path: preview `308` loop for a normal content URL remains a hard regression.
- Error path: expected 404 content routes such as `/watch/jesus.html/en.html` still fail hard if preview resolves or redirects.
- Edge case: query-param fixtures preserve the canonical content path while ignoring host differences.

**Verification:**

- The full probe report after U2 has no hard failures caused solely by production's legacy asset/search behavior.
- Remaining hard failures, if any, correspond to real route/data mismatches that can be fixed or intentionally documented.

---

### U5. Prove the Fix Against Local Production and Document Residuals

**Goal:** Produce the evidence needed to trust the cutover gate and leave clear notes for any remaining fixture/data disagreement.

**Requirements:** R1, R2, R3, R5, R6

**Dependencies:** U1, U2, U3, U4

**Files:**

- Modify: `docs/research/jesusfilm-watch-url-patterns.md`
- Modify: `docs/roadmap/platform/feat-148-watch-static-render-locale-rewrite.md`
- Test: `apps/web/src/proxy.test.ts`
- Test: `apps/web/src/lib/watch-url-probe.test.ts`
- Test: `apps/web/src/app/[locale]/[htmlLang]/[...rest]/__tests__/page-routing.test.tsx`

**Approach:**

- Rebuild the web app and run a local production server pointed at the intended admin GraphQL source for the smoke.
- Run the full `probe:watch-urls` matrix against the rebuilt server and production baseline.
- Capture representative header proof:
  - public content URL follows redirects to terminal `200`;
  - public `/watch/videos` terminal behavior is correct;
  - direct visible internal prefix returns redirect/404 for an ordinary request;
  - repeat cacheable request returns ISR/cache headers.
- Update the research doc only for confirmed current truth or intentional cutover divergence; do not paper over real route bugs by weakening fixtures.
- Update the roadmap verification notes if the final proof adds a new required guard for future static route work.

**Patterns to follow:**

- Runtime proof style in `docs/solutions/performance-issues/watch-static-locale-rewrite-route-manifest-admission-20260529.md`.
- Existing roadmap `Verification` section in `docs/roadmap/platform/feat-148-watch-static-render-locale-rewrite.md`.

**Test scenarios:**

- Integration: full §5 URL probe has zero untriaged hard failures.
- Integration: direct `/watch/en/en/jesus.html/english.html` does not 200 as a normal public request.
- Integration: `/watch/jesus.html/english.html` does not return repeated `308` with `Location` pointing to itself.
- Integration: `/watch/search?q=forgiveness` reaches the root/modal fallback without generating `/watch/search.html/search.html`.
- Integration: asset/API passthrough fixtures keep their requested path.
- Static proof: second request to a representative watch route returns cache-hit headers consistent with ISR.

**Verification:**

- Plan implementer can paste the final probe summary and representative headers into the PR description.
- Any remaining hard failures are either fixed in the same PR or documented as data/fixture follow-up with exact URLs.

---

## System-Wide Impact

- **Interaction graph:** `proxy.ts` sits before all watch pages, API, asset, and demo surfaces. The change affects public route admission, internal static rewrites, direct duplicate-prefix handling, and the URL probe gate.
- **Error propagation:** Invalid public paths should continue to terminate at proxy `404` when known impossible; valid public paths should reach the App Router and let page-level `notFound()` handle content misses.
- **State lifecycle risks:** The marker should not add a new unbounded public cache dimension. It is a request-routing coordination flag and must not be used by render-tree code.
- **API surface parity:** `/api/preview`, `/api/revalidate`, and `/api/download` remain reserved and outside the watch content rewrite.
- **Integration coverage:** Unit tests must be paired with production-server proof because the original bug existed between proxy passes, not inside a single pure branch.
- **Unchanged invariants:** Public links still use audio slugs, internal `[locale]` stays a message catalog key, internal `[htmlLang]` stays the static HTML language tag, and `params.rest` preserves the public audio slug for dub selection.

---

## Risks & Dependencies

| Risk                                                                                                   | Mitigation                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Next does not preserve the chosen request marker through the rewrite's second pass in production mode. | Start with characterization/runtime proof; if the marker is unavailable, stop and choose a fallback before touching render-tree dynamic APIs.                                                                                                         |
| A spoofed custom header can bypass visible direct-prefix redirects for non-browser clients.            | Treat the marker as SEO/correctness coordination, not auth. Normal browser/crawler requests cannot attach custom navigation headers; direct unmarked requests remain covered. If this is unacceptable, require a deeper design before implementation. |
| Probe changes hide a real content regression by over-accepting preview behavior.                       | Only special-case documented intentional divergences (`search`, passthrough). Keep expected 404 and content URL comparisons strict.                                                                                                                   |
| Static behavior regresses while route tests stay green.                                                | Require `next build` static output and runtime cache-hit proof in U5.                                                                                                                                                                                 |
| Manifest unavailable in local/prod smoke causes hostile-path fail-open behavior.                       | Report manifest fetch status separately from the loop fix and ensure at least tests cover manifest-present rejection.                                                                                                                                 |

---

## Documentation / Operational Notes

- Record the final probe summary in the PR.
- If the probe still shows `german` or `swahili` mismatches after the loop is fixed, explicitly decide whether the research doc is stale or the admin route manifest/source data is incomplete.
- Keep `apps/web/AGENTS.md` public-link guidance intact; this fix is about internal rewrites, not link-builder semantics.

---

## Alternative Approaches Considered

- Move direct-prefix redirects to `next.config.mjs`: rejected for now because validating `locale/htmlLang` pairs and safely de-prefixing arbitrary rest paths is already implemented in `proxy.ts`, while config redirects are less expressive and basePath interactions would still need runtime proof.
- Exclude internal prefixes from the proxy matcher: rejected because visible `/watch/en/en/...` requests would bypass the duplicate guard and could serve as public duplicate URLs.
- Revert to public-shaped App Router pages: rejected as too broad for this fix and contrary to the current static `<html lang>` route-param design.
- Read request headers inside the App Router page/layout to distinguish public from internal requests: rejected because it risks reintroducing the dynamic rendering problem this branch is fixing.

---

## Sources & References

- Origin plan: `docs/plans/2026-05-29-001-perf-restore-watch-static-render-locale-rewrite-plan.md`
- URL matrix: `docs/research/jesusfilm-watch-url-patterns.md`
- Roadmap: `docs/roadmap/platform/feat-148-watch-static-render-locale-rewrite.md`
- Proxy code: `apps/web/src/proxy.ts`
- Proxy tests: `apps/web/src/proxy.test.ts`
- Probe code: `apps/web/src/lib/watch-url-probe.ts`
- Static route tree: `apps/web/src/app/[locale]/[htmlLang]/layout.tsx`
- Catch-all route: `apps/web/src/app/[locale]/[htmlLang]/[...rest]/page.tsx`
- Route-shape learning: `docs/solutions/best-practices/nextjs-route-shape-migration-cross-cutting-contract-drift-20260430.md`
- Manifest learning: `docs/solutions/architecture-patterns/admin-owned-watch-route-manifest-20260530.md`
- Static admission learning: `docs/solutions/performance-issues/watch-static-locale-rewrite-route-manifest-admission-20260529.md`
- Next.js `NextResponse` docs: `https://nextjs.org/docs/app/api-reference/functions/next-response`
- Next.js Proxy docs: `https://nextjs.org/docs/app/api-reference/file-conventions/proxy`
