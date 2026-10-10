---
title: Strapi GraphQL relation pagination cap causes wrong-language variant playback on watch page
date: 2026-05-04
category: logic-errors
module: web
problem_type: logic_error
component: service_object
symptoms:
  - "Watch page silently rendered non-English variants (Tarifit, Filipino, German, Norwegian, Thai) when users clicked English search results"
  - "37 of 95 video search hits resolved to wrong language across 10 sample queries before the fix"
  - "Strapi v5 GraphQL caps nested relation pagination at 10 rows when no `pagination` argument is supplied"
  - "REST `maxLimit: 100` in apps/cms/config/api.ts has no effect on GraphQL relations"
  - "High-variant-count videos (e.g. `mary-visit-to-elizabeth` with 242 variants) reliably reproduced the failure"
root_cause: wrong_api
resolution_type: code_fix
severity: high
related_components:
  - tooling
  - graphql
tags:
  - strapi
  - graphql
  - pagination
  - watch-page
  - variant-selection
  - locale-fallback
  - relation-truncation
---

# Strapi GraphQL relation pagination cap causes wrong-language variant playback on watch page

## Problem

The `apps/web` watch page silently rendered non-English variants when users clicked English search results, because Strapi v5's GraphQL plugin defaults to 10-row pagination on nested relations and the `variants` field in the watch-video fragment had no explicit `pagination` argument. For any video with more than 10 variants, the English variant fell outside the response window — and the watch page's locale-priority selection logic, finding nothing to match the URL locale, fell through to "first playable" and rendered whatever language Strapi happened to return first (Tarifit, Filipino, German, etc.).

## Symptoms

- Watch page rendered a non-English language variant for users who clicked English search results. No error was thrown — the page just played the wrong language.
- Reproduction was wide: 37 of 95 video search hits across 10 sample queries played in the wrong language before the fix; 0 after.
- Specific examples (live data probe): `q=father` → `friends-and-enemies` played Thai; `q=kingdom` → `lumo-luke-17-1-18-8` played Norwegian; `q=mary` → `lazarus-rises` played German.
- High-variant-count videos were the worst affected — `mary-visit-to-elizabeth` (242 variants) reliably reproduced the failure on every load.
- The bug was introduced in PR #860 (`feat/watch-page-mux-parity`) and survived a full `ce-code-review` pass without detection — silent truncation produces no error to flag.

## What Didn't Work

- **Suspecting the search layer.** First hypothesis: the search query was returning slugs of non-English videos. Disproved by probing live Strapi: the search SQL filters via `JOIN languages l ON l.id = vll.language_id AND l.bcp_47 = ?`, so the English constraint was applied correctly at the search layer. Slugs in search results were correct English video slugs.
- **Suspecting the variant-selection logic.** Second hypothesis: the priority chain in `fetchResolvedWatchVideoBySlug` (URL locale slug → `bcp47` match → primary language → first playable) was selecting the wrong variant. Disproved by inspection — the logic was correct. Adding more fallbacks would not have helped because English was simply absent from the GraphQL response.
- **Increasing `maxLimit` in `apps/cms/config/api.ts`.** The REST API config (`rest.maxLimit: 100`) does not apply to the GraphQL plugin. The GraphQL plugin has its own default relation pagination of 10 and is configured separately.
- **Filtering variants client-side after fetch.** Impossible — the variant didn't come back from Strapi at all, so there was nothing on the client to filter. The missing data had to be fixed at the query layer.
- **Consulting prior art.** A directly-related solution doc — `docs/solutions/performance-issues/strapi-nested-relation-truncation-and-n-plus-one-manager-20260328.md` — already documented the same Strapi cap from the manager-app angle (silent "no coverage" for languages that exist). This doc was not consulted when authoring `watchVideoFragment` two months later, and the same root cause re-surfaced under a different symptom. (session history)

## Solution

Add explicit `pagination: { limit: -1 }` to every `variants` list in the watch-video GraphQL fragment and the route-video query.

```graphql
# apps/web/src/lib/fragments/watch-video.ts:43
variants(pagination: { limit: -1 }) {
  documentId
  slug
  published
  hls
  duration
  language { coreId bcp47 slug name }
  downloads { documentId quality size url }
  muxVideo { playbackId }
}
```

```graphql
# apps/web/src/lib/content.ts:74 (GET_ROUTE_VIDEO)
variants(pagination: { limit: -1 }) {
  documentId
  hls
  published
  language { coreId }
}
```

**RSC payload mitigation** (applied alongside the fix to prevent payload bloat from 242-variant videos): `stripNonSelectedVariantFields` in `apps/web/src/lib/content.ts` strips `downloads`, `muxVideo`, and `duration` from non-selected variants before the `JSON.parse(JSON.stringify(resolved))` normalization. The selected variant retains all fields. This drops the RSC payload from ~500KB (242 × 2KB) to ~100KB. The 60-second `unstable_cache` wrapping `fetchResolvedWatchVideo` and `fetchResolvedWatchVideoBySlug` absorbs the Strapi DB cost.

**Regression test** added to `apps/web/src/lib/fragments/__tests__/watch-video.test.ts` asserting the printed query contains `variants(pagination: { limit: -1 })` so the argument can't silently disappear.

## Why This Works

Strapi v5's GraphQL plugin enforces a default relation pagination limit of 10 rows when no `pagination` argument is supplied. This is separate from and unaffected by the REST API's `rest.maxLimit` config. Passing `limit: -1` is treated by Strapi's GraphQL resolver as "return all records in the relation" — empirically confirmed and used as a pattern across the JFP monorepo (apps/manager applies it to multiple relations).

The variant-selection logic in `fetchResolvedWatchVideoBySlug` (`apps/web/src/lib/content.ts:685-720`) was always correct: URL locale slug → `bcp47` match → primary language → first playable. The bug was not in selection logic but in the input data — with only 10 variants returned for a 242-variant video, the locale priority chain had nothing to find and fell through to "first playable". "First playable" returned whatever language Strapi happened to surface first, which was the alphabetically-first variant for that video.

## Prevention

- **Any Strapi v5 GraphQL fragment that fetches a list-shaped relation must include `pagination: { limit: -1 }` explicitly.** Omitting it silently caps results at 10. This is the failure mode, not an error you can catch — there is no warning, no log, and no exception. Audit existing fragments for this pattern when touching the watch / share / language-picker code.
- **Add a regex assertion in fragment tests.** Mirror the watch-video pattern at `apps/web/src/lib/fragments/__tests__/watch-video.test.ts` for any new fragment that fetches a relation. The test prints the query AST and asserts `variants(pagination:\s*\{\s*limit:\s*-1\s*\}\)`. A future edit removing the argument fails the test.
- **Flag in code review.** Any Strapi GraphQL fragment touching a list-shaped relation without an explicit `pagination` argument is a review blocker. The current `ce-code-review` API-contract reviewer missed this on PR #860; consider promoting it to a default check. (session history)
- **`limit: -1` is undocumented Strapi behavior.** A future Strapi upgrade could close this bypass, silently reverting high-variant-count videos to wrong-language rendering. If Strapi is upgraded, verify `limit: -1` still returns unbounded results with a probe query against a known high-variant video (e.g. `mary-visit-to-elizabeth`) before deploying.
- **Long-term: split the watch-video fragment.** Decompose into a thin language-picker projection (all variants, minimal fields: `documentId`, `language { bcp47 slug }`, `hls`, `published`) and a selected-variant detail projection (single variant, full fields with `downloads` and `muxVideo`) fetched only after locale resolution. This eliminates the unbounded-fetch payload cost entirely rather than mitigating it in post-processing.
- **Always cross-link related solutions docs.** When `watchVideoFragment` was authored, the related manager-side solution doc existed but wasn't consulted. Cross-linking from `docs/solutions/best-practices/watch-single-video-template-pages-strapi-nextjs-2026-04-11.md` (and related architecture docs) to the Strapi pagination doc would have surfaced the prior art.

## Related Issues

- **Same root cause, different surface:** [`docs/solutions/performance-issues/strapi-nested-relation-truncation-and-n-plus-one-manager-20260328.md`](../performance-issues/strapi-nested-relation-truncation-and-n-plus-one-manager-20260328.md) — original documentation of the Strapi 10-row cap from the manager app's coverage-dashboard angle. Cross-references this doc for the canonical root-cause explanation; the present doc adds the watch-page wrong-language-playback symptom as a second observed instance.
- **Architecture context:** [`docs/solutions/best-practices/watch-single-video-template-pages-strapi-nextjs-2026-04-11.md`](../best-practices/watch-single-video-template-pages-strapi-nextjs-2026-04-11.md) — covers the watch page route resolution, `watchVideoFragment` shape, and `resolveWatchPage` priority chain. Add a pointer to the present doc from there so future fragment authors find this fix.
- **Adjacent player concerns:** [`docs/solutions/design-patterns/mux-player-custom-react-chrome-pattern-20260430.md`](../design-patterns/mux-player-custom-react-chrome-pattern-20260430.md) — covers `HeroPlayer` chrome and loading state. Currently flags `aspect-video` and `onCanPlay` as superseded approaches; PR #878 re-introduces both as part of the watch-page fix bundle. **Refresh candidate** — should be updated post-merge to reflect the combined `aspect-video` + ResizeObserver + `onCanPlay`-with-`onError` pattern.
- **Shipped in:** [PR #878](https://github.com/JesusFilm/forge/pull/878) — `feat(web): fix English variant selection + redesign watch share modal + harden hero loading`. Bundles the pagination fix with HeroPlayer loading-state hardening and ShareModal redesign; full per-reviewer artifact at `/tmp/compound-engineering/ce-code-review/20260504-144216-141469c4/`.
- **Bug introduced in:** PR #860 (`feat/watch-page-mux-parity`) — the original watch page implementation that authored `watchVideoFragment` without explicit pagination. (session history)
