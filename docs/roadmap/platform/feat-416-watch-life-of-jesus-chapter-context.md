---
id: "feat-416"
title: "Watch Life of Jesus chapter context"
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

The standalone Watch page for _Life of Jesus (Gospel of John)_ preserves the
playable film and its eligible collection contexts, but it does not expose the
film's own 49 manifest-admitted Chapters as another selectable continuation
context. Viewers therefore cannot continue the curriculum from the full-film
page even though the catalog already models those Chapters and their routes.

Customer evidence: [Linear FGE-75](https://linear.app/jesus-film-project/issue/FGE-75/watchbug-route-the-73-clip-acts-study-to-its-intended-collection),
whose durable evidence originated in Help Scout. FGE-75's separate 73-clip
Acts report remains unresolved and is not evidence that the same fix applies
there. This ticket does not authorize a Help Scout reply.

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

1. On eligible standalone film routes, append a virtual selectable context
   for the film's own Chapters after the existing eligible parent contexts.
2. Admit only film-owned Chapters whose contextual route is present for the
   active audio language in the existing Watch route manifest, and require at
   least two admitted Chapters before adding the context.
3. Keep the first eligible parent selected by default. Selecting the film
   context must expose the admitted 49-Chapter sequence without leaving the
   standalone full-film URL; with current catalog data, _Triumphal Entry and
   Results_ is Chapter 30 of 49.
4. Reuse the existing selector, carousel, and pending-navigation behavior so a
   selected Chapter follows its existing contextual route and retains its
   playback and download identity.
5. Add focused automated coverage for ordering, manifest fallback, selector
   behavior, Chapter navigation, and the standalone film's canonical, hero,
   Share, download, and structured-data identity.
6. Record desktop and compact browser proof plus a pinned `origin/main`
   page-load comparison covering requests, eager image loading, serialized
   payload growth, hydration, and user-visible loading.

## Constraints

- Limit production changes to standalone Watch route composition. Do not
  change Admin, GraphQL, generated artifacts, contextual routes, LUMO content,
  publication or rights gates, film classification, redirects, or route
  admission.
- Preserve the existing eligible-parent order and default selection. When the
  route manifest is unavailable, fewer than two own Chapter routes are
  admitted, or no eligible parent exists, preserve current fallback behavior.
- Preserve full-film playback, download, canonical URL, Share payload,
  language and media identity, hero next-item behavior, and existing
  parent-context related-item JSON-LD before the viewer selects another
  context.
- Do not infer a fix for the unresolved 73-clip Acts report or affect unrelated
  Watch content that lacks the same eligible-parent plus admitted-own-Chapters
  contract.
- Add no new initial browser request, eager alternate-context thumbnail set,
  effect, dependency, or client initialization. Quantify server payload growth
  and demonstrate no material page-load or hydration regression against the
  same pinned `origin/main` baseline.
- Keep Chapter links on the existing public audio-language route builders and
  preserve modified-click, accessibility, pending-navigation, and responsive
  selector behavior.

## Verification

- `pnpm --filter @forge/web exec vitest run 'src/app/[locale]/[htmlLang]/[...rest]/__tests__/page-routing.test.tsx' src/lib/__tests__/content-watch-merge.test.ts src/components/watch/__tests__/SiblingCarousel.test.tsx src/components/watch/__tests__/WatchPageClient.navigation.test.tsx`
- `pnpm --filter @forge/web typecheck`
- Run changed-file ESLint and Prettier checks, the generated UI-locale/catalog
  drift checks required by Web, `pnpm --filter roadmap generate:readme`, and
  `git diff --check`.
- Run the PR-focused Web regression checks and a production build against the
  repository's supported local Admin setup; confirm no generated GraphQL
  drift or client/server boundary error.
- At desktop and compact widths, prove the standalone Life of Jesus route
  defaults to its first eligible parent, offers the film context, reports 49
  Chapters, places _Triumphal Entry and Results_ at 30 of 49, and navigates a
  selected Chapter through its existing contextual playback/download route.
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
