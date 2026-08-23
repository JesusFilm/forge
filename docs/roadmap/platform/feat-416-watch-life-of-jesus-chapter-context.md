---
id: "feat-416"
title: "Watch carousel context priority"
owner: "codex"
priority: "P1"
status: "in-progress"
start_date: "2026-08-22"
duration: 2
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "performance"
  - "accessibility"
---

## Problem

Watch currently lets a playable video's own children displace a collection
explicitly selected by a contextual URL, while a standalone playable video
defaults to external collection choices and appends its own chapter context.
That reverses the viewer's chosen context in one route shape and makes the
video's intrinsic hierarchy secondary in the other.

The carousel needs one mutually exclusive, route-shaped source hierarchy:

1. A contextual URL-selected canonical parent is authoritative.
2. Otherwise, a standalone playable video's own usable children win when at
   least two remain after admission.
3. Only then may eligible external parents provide the existing selectable
   fallback, preserving their relation order and default.

This structural rule applies generically to qualifying playable videos,
including JESUS, _Life of Jesus_, and _Book of Acts_. It must not match a title,
slug, or document ID, and owning children must not reclassify a playable film
or alter the separate `SeriesPage` flow.

Customer evidence: [Linear FGE-75](https://linear.app/jesus-film-project/issue/FGE-75/watchbug-route-the-73-clip-acts-study-to-its-intended-collection),
whose durable evidence originated in Help Scout. The 73-clip Acts shape is now
an explicit generic acceptance fixture, not deferred work or a special case.
This ticket does not authorize a Help Scout reply.

Implementation contract:
[`docs/plans/2026-08-22-0038-fix-life-of-jesus-chapters-plan.md`](../../plans/2026-08-22-0038-fix-life-of-jesus-chapters-plan.md).

## Entry Points — Read These First

1. `docs/plans/2026-08-22-0038-fix-life-of-jesus-chapters-plan.md` — product,
   scope, implementation, and verification contract.
2. `apps/web/src/app/[locale]/[htmlLang]/[...rest]/page.tsx` — standalone
   Watch route composition, eligible-parent filtering, route-manifest
   admission, and initial data-fetch concurrency.
3. `apps/web/src/lib/content.ts` — `CarouselParent`,
   `buildSiblingCarouselBlock`, and `mergeWatchExperience` contracts.
4. `apps/web/src/components/watch/SiblingCarousel.tsx` — compact context
   selector, child routing, active-item behavior, and lazy thumbnails.
5. `apps/web/src/components/watch/WatchPageClient.tsx` — pending Chapter
   navigation validation across selectable contexts.
6. `apps/web/src/app/[locale]/[htmlLang]/[...rest]/__tests__/page-routing.test.tsx`,
   `apps/web/src/lib/__tests__/content-watch-merge.test.ts`,
   `apps/web/src/components/watch/__tests__/SiblingCarousel.test.tsx`, and
   `apps/web/src/components/watch/__tests__/WatchPageClient.navigation.test.tsx`
   — focused routing, merge, selector, and navigation coverage.
7. `CONCEPTS.md` and
   `docs/solutions/logic-errors/tv-childcount-not-a-series-container-signal.md`
   — standalone Watch identity, route-manifest boundaries, and the rule that
   film-owned children do not make a film a series.

## Grep These

- `selectableParentsForStandaloneVideo`
- `withAdmittedCarouselChildren`
- `withAdmittedVideoChildren`
- `buildSiblingCarouselBlock`
- `selectableParents`
- `isPendingChapterStillRoutable`
- `episodePairsByParent`
- `audioLanguageIndexesByEpisode`
- `loading="lazy"`

## What To Build

1. At the shared Watch merge seam, resolve the carousel source in this order:
   contextual canonical parent, qualifying standalone own children, eligible
   external parents, then no carousel.
2. Treat contextual-parent resolution as terminal. If its admitted children
   fall below the two-item threshold, render no sibling carousel and do not
   fall through to the selected video's children or another parent.
3. On standalone routes, admit each own child for the exact current
   parent/child/selected-audio-language route. Apply the two-item threshold
   after filtering and preserve relation-owned child order.
4. When the standalone own-child rail qualifies, render it as the one fixed
   carousel source and omit external-parent choices from the block and client
   payload. Resolve eligible parents only when the own-child rail does not
   qualify; preserve their established order and default.
5. Align carousel cards, contextual hrefs, related-item JSON-LD, and
   contextual Up Next with the URL-selected canonical parent. Preserve the
   existing standalone own-video Up Next behavior independently of an
   external-parent fallback selector.
6. Add focused automated coverage for the hierarchy, exact partial admission,
   both thresholds, order, navigation, Up Next, structured data, identity
   invariants, and `SeriesPage`/collection isolation. Use production-shaped
   JESUS, Life of Jesus, and Book of Acts fixtures without branching on their
   current live counts.
7. Record credential-free desktop and compact browser proof plus a pinned
   `origin/main` page-load comparison covering requests, eager image loading,
   serialized payload growth, hydration, and user-visible loading.

## Constraints

- Keep production changes Web-only. Do not change Admin, GraphQL, generated
  artifacts, catalog data, LUMO content, publication or rights gates,
  redirects, content classification, or route admission.
- Never derive canonical, playback, hero, Share, download, rights, language,
  or media identity from the carousel source or an external-parent fallback.
- Preserve exact per-child admission and relation order. A missing manifest
  remains fail-open for already restriction-filtered own children; a present
  legacy manifest that cannot prove exact episode-language admission is
  inconclusive and uses the eligible-parent fallback.
- Apply the hierarchy generically, including Acts, JESUS, and Life of Jesus.
  Do not add a title, slug, document-ID, or current-count exception.
- Preserve `SeriesPage` separation and the established publication, deletion,
  restriction, playability, slug, and contextual-route gates.
- Add no initial browser request, eager alternate-context thumbnail set,
  effect, dependency, or client initialization. Quantify server payload growth
  and demonstrate no material page-load or hydration regression against the
  same pinned `origin/main` baseline.
- Use only unauthenticated public GraphQL/HTML and safe local fixtures for
  runtime evidence. Never forward credentials, create a credential-bearing
  proxy, deploy production, or send a Help Scout reply.
- Keep Chapter links on the existing public audio-language route builders and
  preserve modified-click, accessibility, pending-navigation, and responsive
  behavior.

## Verification

- `pnpm --filter @forge/web exec vitest run 'src/app/[locale]/[htmlLang]/[...rest]/__tests__/page-routing.test.tsx' src/lib/__tests__/content-watch-merge.test.ts src/components/watch/__tests__/SiblingCarousel.test.tsx src/components/watch/__tests__/WatchPageClient.navigation.test.tsx`
- `pnpm --filter @forge/web typecheck`
- Run changed-file ESLint and Prettier checks, the generated UI-locale/catalog
  drift checks required by Web, `pnpm --filter roadmap generate:readme`, and
  `git diff --check`.
- Run the PR-focused Web regression checks and a production build against the
  repository's supported local Admin setup; confirm no generated GraphQL
  drift or client/server boundary error.
- At desktop and compact widths, prove qualifying standalone Life of Jesus,
  JESUS, and Book of Acts routes render their own fixed ordered child rail
  without an external-parent selector and navigate a selected child through
  its existing contextual playback/download route.
- Prove a contextual URL-selected parent stays authoritative, including the
  terminal below-threshold case, even when the selected video owns children.
- In the same browser pass, verify film identity, canonical, Share, download,
  related-item JSON-LD, selector accessibility, responsive layout, and console
  output remain correct.
- Compare the pinned final merge-base and branch against the same Admin
  snapshot and runtime configuration. Record browser request/resource counts,
  transferred bytes, serialized HTML/RSC growth, timing, hydration, LCP, long
  tasks, console output, and alternate-context image requests. There must be
  no new browser data request or eager alternate rail, and warmed response and
  user-visible loading must remain within the existing 10% non-regression
  budget.

## Current Execution State

The earlier implementation through `60623c624e0f0ce4fd5f885956a3641a065e45ee`
against merge base `1f65d0af55f2c99df40a38a44053be5cb7463495`
established exact per-child admission and the evidence below, but implemented
the now-superseded eligible-parent-first/appended-own-context behavior. The
ticket is reopened to implement the contextual-parent → standalone-own →
eligible-parent-fallback hierarchy from the linked plan. The historical proof
remains useful characterization evidence; it is not evidence that the revised
priority is already shipped.

## Historical Characterization Evidence — 2026-08-22

### Deterministic and build proof

- The production-shaped focused suite passed **153 tests in 4 files**:
  `./node_modules/.bin/vitest run 'src/app/[locale]/[htmlLang]/[...rest]/__tests__/page-routing.test.tsx' src/lib/__tests__/content-watch-merge.test.ts src/components/watch/__tests__/SiblingCarousel.test.tsx src/components/watch/__tests__/WatchPageClient.navigation.test.tsx`
  from `apps/web`.
- The route proof characterized the superseded behavior by appending 49
  admitted own Chapters after ordered eligible parents and retaining the first
  eligible parent as `canonicalParent`. It also pins
  _Triumphal Entry and Results_ at zero-based index 29, preserves full-film
  video/Share/download identity, and covers manifest-unavailable and
  fewer-than-two fallback behavior. It also proves that a three-Chapter source
  with exactly two selected-language admissions appends only those two
  Chapters in relation order, and that the route-manifest request still begins
  alongside video resolution.
- Existing component and navigation coverage proves selector switching and
  announcement, contextual hrefs, active-card behavior, modified-click
  behavior, busy-state locking, contextual fixed-header parity, route warming,
  push, scroll preservation, and Share identity. The contextual route suite
  retains the fixed parent, playback/download identity, and 49-item rail.
- Generated UI-locale drift, TypeScript, changed-file ESLint, Prettier, and
  whitespace checks passed with direct repository binaries:
  `node scripts/generate-ui-locales.mjs --check`,
  `./node_modules/.bin/tsc --noEmit`, changed-file
  `./node_modules/.bin/eslint`, changed-file Prettier, and
  `git diff --check 1f65d0af...HEAD`.
- The production Web build passed with the tracked, non-secret
  `apps/web/.env.ci` placeholders:
  `node scripts/generate-ui-locales.mjs && ./node_modules/.bin/next build && node scripts/prune-next-isr-output.mjs`.
  The catch-all route remained statically generated. The absent local Admin
  produced the expected recoverable sitemap-manifest fetch diagnostic; there
  was no generated GraphQL drift, TypeScript failure, or client/server boundary
  error.

### Current production reference

Safe HTTPS reads on 2026-08-22 returned HTTP 200 for both controls:

- `https://www.jesusfilm.org/watch/life-of-jesus-gospel-of-john.html` remains
  the 183-minute playable feature film. Its server HTML has the standalone
  canonical, one hero poster, one download action, one eager hero image/image
  preload, lazy carousel thumbnails, and no browser GraphQL marker. The current
  selector has three eligible contexts and defaults to **JFM Collection**, with
  the film at **3 of 10** and a 10-item rail.
- `https://www.jesusfilm.org/watch/life-of-jesus-gospel-of-john.html/triumphal-entry-and-results/english.html`
  remains a playable/downloadable contextual Chapter. Its server HTML contains
  _Triumphal Entry and Results_, `Clip 30 of 49`, a hero poster/playback payload,
  one download action, the established standalone Chapter canonical, and the
  Life of Jesus 49-child parent.
- One compressed HTTP sample transferred 59,006 bytes for the production
  full-film HTML and 65,875 bytes for the contextual control; decoded bodies
  were 353,277 and 629,056 bytes, with 190 ms and 225 ms TTFB. These are
  current-production reference values, not a same-snapshot branch comparison.
- An interleaved nine-pair production run used the same two routes and current
  catalog snapshot. Excluding the first cold pair, the warmed median TTFB was
  232.0 ms for the standalone 10-card rail and 222.4 ms for the contextual
  49-card rail (about 4.1% faster, inside the 10% timing budget). Median
  compressed transfer was 58,964 bytes and 66,008 bytes respectively (about
  11.9% larger for the 49-card control). This separates the expected compact
  rail payload growth from response-time regression; it remains a production
  control comparison rather than a same-snapshot measurement of the unshipped
  selector.

Together with the route/component tests, these observations preserve reusable
catalog, identity, exact-admission, navigation, and performance
characterization without claiming the revised source hierarchy is present in
production.

## Performance and Browser Evidence

- The earlier production diff added only an in-memory array composition after
  the existing parallel video/manifest resolution. It added no import, fetch,
  effect, dynamic import, client directive, dependency, or client
  initialization. `SiblingCarousel.tsx` is byte-identical to the merge base,
  and its thumbnails remain explicitly `loading="lazy"`; the existing hero
  remains the sole eager image/image preload.
- A current-catalog serialization estimate was derived from the exact
  49-child `canonicalParent` object embedded in the production contextual
  response. Serialized alone, the context is **100,853 raw bytes**, **28,444
  gzip bytes**, and **26,172 Brotli bytes** (the escaped Flight representation
  is 104,591 bytes). This is a conservative single-object estimate: actual RSC
  transfer may reuse references, and no same-snapshot branch waterfall was
  available to measure that deduplication.
  No credential-bearing branch runtime was used for closeout. In particular, the
  Web server's bearer-attaching Admin client was not pointed at public GraphQL,
  no authorization header or credential-bearing proxy was created, and no
  secret was fetched. No authenticated local Admin snapshot was running at the
  repository-supported CI endpoint (`localhost:1437` refused the connection),
  the public route-manifest endpoint requires authorization, and public HTML
  does not expose an Admin snapshot or manifest version, so no snapshot version
  is claimed.
  Consequently an admitted branch selector could not be driven in a local
  desktop/compact browser, and this run does **not** claim viewport screenshots,
  document-overflow geometry, a browser waterfall/request count, console output,
  hydration timing, LCP, or long-task measurements. Following the completed
  feat-287 precedent, the replacement evidence is the focused real-chain
  route/component/navigation suite, the successful production build, current
  production server HTML for both controls, and the static proof that the change
  creates no new browser work. These gates show the added cost is the quantified
  compact server payload rather than a new request, eager thumbnail rail, effect,
  or hydration initializer.
- A host-integrated browser pass used the tracked, non-secret `.env.ci`
  placeholders and the repository's localhost-only Admin URL. The Web root
  served on port 3000, but the standalone Life of Jesus route fail-closed to
  HTTP 404 after `watch_route_manifest.fetch.error` because
  `localhost:1437/admin/api/watch-route-manifest` was unavailable. The
  contextual Chapter route returned HTTP 500 after its localhost Admin content
  fetch failed with `ECONNREFUSED`. These routes are therefore recorded as
  browser **Skips**, not branch passes or product failures; no credential,
  authorization header, proxy, or public GraphQL mutation was used.
- In the same integrated-browser session, the two unauthenticated production
  controls passed. The standalone page rendered the playable film with its
  standalone canonical, Download action, one eager image, lazy carousel images,
  and the current 10-card JFM Collection context. The contextual control
  rendered _Triumphal Entry and Results_, `Clip 30 of 49`, its established
  standalone Chapter canonical, Download action, one eager image, and all 49
  Chapter links. These observations describe current production only; they do
  not supply the unavailable same-snapshot branch waterfall or responsive
  selector proof.
