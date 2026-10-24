---
date: "2026-06-30"
topic: "tv-client-performance-sweep"
---

> **Status (2026-07-17):** Largely implemented. PR #1424 (merged 2026-06-30, the same day this was written) shipped the sweep (R3–R9, R12 via client cache, R13), #1482 fixed the skeleton full-screen, and the fleet-key track (#1493/#1577/#1589) completed R11 — prod-build search verified `200` on 2026-07-16. Still open: the byte-dominant parent `variants: dubs` trim (~693 KB of the series payload — R1's other half, SC1/SC7), R10 category-thumbnail batching, and true batching for R12's cold first view. Do **not** re-action R13: the dead query was removed in #1424, and #1526 later introduced a new, live `GET_WATCH_SETTING` (`apps/tv/src/lib/watchHome/homeQueries.ts`).

## Summary

Improve perceived and actual performance of the `apps/tv` app across the screens a 2026-06-30 benchmark flagged: trim the 835 KB series payload, make Home feel instant with a loading skeleton, cut search's per-prefix cold-embedding cost, provision the search bearer, fix the per-citation N+1 bible-verse fetch, and delete a dead query. All work is client-side and owned by the TV app; the larger server-side search fix is handed off separately.

## Problem Frame

A benchmark of every TV→prod-admin API call (2026-06-30) found content delivery mostly healthy, with three real costs the client can address:

- **Series detail is the heaviest query — 835 KB, ~2.8–3.2 s to render.** The size comes from two per-language selections the query carries for a ~2,253-language title: the `childDubLanguages` union (3 scalars each) and the parent's full `variants: dubs` list (slug, published, HLS URL, and a language object each). Which one dominates the bytes is not established from source and is a measurement for planning. Watch detail by contrast is 18–55 KB.
- **Cold Home shows a blank shell + spinner for ~3.6–4.4 s.** The home query itself is ~942 ms; the rest is JS bundle evaluation on first launch (~1.3–1.5 s before any query fires) plus image decode.
- **Search fires a cold query-embedding per novel prefix.** Each distinct prefix a user types is a separate embedding computation; on a cache miss that is 1–7 s (a 30 s outlier was seen). The app fires from the first character with a 600 ms debounce and no minimum-length gate. Browse category thumbnails additionally fire one semantic search per category before the user types anything.

The embedding latency itself is computed in admin and is not fixable from the client. What the client controls is how often that cost is paid, how the wait is presented, and how much data is pulled per screen.

## Key Decisions

- **Home: perceived-first, not actual reduction.** Paint a shell + rail skeleton immediately and let content swap in. The bundle-eval cost stays; making the wait _feel_ instant is the lowest-risk, highest-felt win and does not touch startup.
- **Search stays live as-you-type, gated harder.** Live incremental results are the TV-platform convention (tvOS `UISearchController`, Android Leanback, Netflix, YouTube all do it). The app keeps that model but adds a ≥3-character gate and a slower debounce so fewer cold embeddings fire. Submit-only was rejected as off-convention.
- **Series language list lazy-loads.** The lean series query renders the hero and episode rail; the language union arrives in a secondary fetch, mirroring the existing per-dub lazy pattern. The hero language count and language panel populate a beat later.
- **Search bearer: provision now, default to scoped.** The token already exists in code as a global Authorization header, so the prod 401 is purely a provisioning gap (the EAS env var is unset). The key should be scoped to the Search operation (mirroring `apps/mobile`) by default; keeping the global header requires planning to confirm admin applies no per-key rate limit to non-search operations.

## Requirements

**Series payload**

- R1. The initial series-detail fetch must shed its heavy per-language data — the `childDubLanguages` union (`apps/tv/src/lib/videoQueries.ts:219-223`) and the parent's full `variants: dubs` list (`apps/tv/src/lib/videoQueries.ts:154-165`) — which together drive the ~835 KB. Planning measures which dominates and trims or lazy-loads accordingly.
- R2. The hero and episode rail render from the lean query without waiting on the per-language data; the language union loads in a secondary fetch and populates the hero count and `SeriesLanguagePanel` when it arrives. Until then the count shows a non-numeric placeholder (e.g. `—` or a shimmer), never `0`, so no false zero-count flashes on the hero. The parent's active dub loads on demand rather than in bulk; whether that reuses `GET_VIDEO_DUB` (which returns only downloads/subtitles) or needs a small dedicated fetch for `hls`/`slug`/`language` is for planning.
- R3. The series completeness/bounce check, currently keyed on `childDubLanguages !== undefined` (`apps/tv/app/series/[slug].tsx:91-95`), must re-key off the lean query's completeness so it no longer depends on the heavy field's presence.

**Home cold-start**

- R4. On cold launch with no cached home data, Home paints the app shell and a rail skeleton immediately, before `GET_WATCH_HOME_VIDEOS` resolves.
- R5. Content replaces the skeleton when the home query resolves. The skeleton must not appear on warm re-entry, where the existing cache-first fetch returns data instantly.
- R6. The skeleton is presented on both tvOS and Android TV and makes no change to JS bundle evaluation or the startup module graph.

**Search cost and UX**

- R7. Search keeps live, incremental as-you-type results — no submit-only model.
- R8. The semantic search fires only when the trimmed query is at least 3 characters; shorter prefixes do not fire. While the query is under 3 characters, the results area retains the pre-search browse/category view rather than showing a blank or stale state.
- R9. Raise the auto-submit debounce from 600 ms (`apps/tv/src/lib/search.ts:7-9`) to ~900 ms.
- R10. Browse category thumbnails must not fire a fresh semantic search per category on every browse-screen entry (`apps/tv/src/components/search/useCategoryThumbnails.ts:34`). Mechanism (cache, static thumbnail, or single batched query) is for planning.
- R11. Authenticated search must work on prod builds (200, not 401) by provisioning the consumer bearer (`EXPO_PUBLIC_ADMIN_GRAPHQL_TOKEN` in EAS env and `.env.local`). The key must be scoped to the Search operation (mirroring `apps/mobile`, whose `apolloClient.ts` notes bearer'd requests bucket as `consumer:<key>` rather than per-IP) unless planning confirms admin rate-limits no non-search operation by key; absent that confirmation, default to the scoped link rather than the current global header (`apps/tv/src/lib/apolloClient.ts:28-51`).

**Bible verses**

- R12. The watch-detail bible-verse fetch must not issue one CDN request per citation (`apps/tv/src/hooks/useBibleVerses.ts:44-62`, N+1 against jsDelivr). Mechanism (batch, client cache, or admin-served source) is for planning.

**Cleanup**

- R13. Remove the unused `GET_WATCH_SETTING` query (`apps/tv/src/lib/queries.ts:355`) and its tests; it has no non-test importer.

## Success Criteria

- SC1. Both per-language lists are removed from the initial series fetch and the resulting payload is reported; target well under ~50 KB pending confirmation that the residual (episode rail + locales + bibleCitations) fits. The language union arrives as a separate, smaller fetch.
- SC2. On cold launch, Home shows a populated shell (skeleton or content) as soon as JS bundle evaluation completes (~1.5 s) — replacing the ~942 ms home-query + image-decode wait — versus the ~3.6–4.4 s blank-spinner baseline. A sub-1 s shell would require a native splash, which R4 does not describe.
- SC3. Typing a 1–2 character prefix fires zero embeddings; the first browse-screen entry fires at most one batched-or-cached call rather than one cold embedding per category (warm re-entry is already free via the module-scope cache); the auto-submit debounce is ≥900 ms; live typing still returns results.
- SC4. Authenticated search returns 200 on a prod build.
- SC5. No regression to existing tvOS or Android TV focus/navigation behavior.
- SC6. The watch-detail bible-verse fetch issues at most one network request per unique citation set shown, regardless of citation count.
- SC7. Cold series detail reaches interactive within a target measured on a real TV device — the ~2.8–3.2 s felt cost today is mostly client-side parse/render, not the ~884 ms network, so SC1's byte reduction alone does not satisfy this.

## Scope Boundaries

**Out of scope**

- The server-side search cold-embedding optimization (pre-warming/caching embeddings, the 30 s outlier) — the single largest latency, but an admin-team hand-off, not client work.
- Home D-pad navigation jank, rail virtualization, and FlashList migration — owned by `docs/brainstorms/2026-06-23-tv-android-home-performance-requirements.md`. This effort is initial-load only.
- Voice search.

## Dependencies / Assumptions

- SC4 depends on the consumer bearer value being provisioned in the EAS env; the value follows the `apps/mobile` consumer-key precedent.
- Client gating (R8, R9, R10) reduces how often the cold embedding is paid; it does not change the embedding's latency. The user-visible cold-search wait improves only when the server-side fix lands.
- The 2026-06-30 benchmark table (Sources) is the baseline; figures were measured from this machine to prod admin and on the tvOS simulator, so absolute render times are environment-dependent.

## Outstanding Questions

All items are deferred to planning — none block it.

- Bearer scoping: default is the Search-scoped link; confirm whether keeping the global header is acceptable once admin's rate-limit keying (per-IP vs per-key) is known.
- Which of the two per-language lists dominates the 835 KB, and whether the series screen consumes the parent's `variants: dubs` at all (if not, it is a pure cut).
- Lazy language-load mechanism: a secondary query on mount vs. fetch on language-panel open.
- Category-thumbnail cost-cut mechanism for the first-session cold burst (warm re-entry is already free via the module-scope cache): static curated thumbnails or one batched query.
- Bible-verse de-N+1 mechanism: batch endpoint, client cache, or admin-served verses.
- Skeleton shape and where the "has cached data" gate that suppresses it on warm re-entry lives.

## Sources / Research

Benchmark baseline (2026-06-30, TV → `https://admin.jesusfilm.org/api/graphql`, warm median of 10 samples):

| Feature           | Operation                  | Resp size | Server TTFB |      Warm total |                    Cold | End-to-end on TV |
| ----------------- | -------------------------- | --------: | ----------: | --------------: | ----------------------: | ---------------: |
| Home              | `GetWatchHomeVideos`       |  449.4 KB |      851 ms |          942 ms |                 1043 ms |      ~4.0 s cold |
| Watch detail      | `GetVideoBySlug` (14 dubs) |   18.5 KB |      319 ms |          324 ms |                  330 ms |       ~1.0–1.2 s |
| Series detail     | `GetSeriesBySlug`          |  835.6 KB |      741 ms |          884 ms |                  842 ms |       ~2.8–3.2 s |
| Lazy dub          | `GetVideoDub`              |    5.4 KB |      288 ms |          288 ms |                  284 ms |             lazy |
| Search (auth)     | `SemanticSearch`           |         — |           — | 550–900 ms warm | 994 ms – 30,460 ms cold |    1–7 s typical |
| Search (no token) | `SemanticSearch`           |         — |           — |             401 |                     401 |                — |

Code breadcrumbs:

- Series heavy selections: `childDubLanguages` union at `apps/tv/src/lib/videoQueries.ts:219-223` (consumed via `buildLanguages`, `apps/tv/src/lib/normalizeVideo.ts:418-433`) and the parent `variants: dubs` list at `apps/tv/src/lib/videoQueries.ts:154-165`; completeness check `apps/tv/app/series/[slug].tsx:91-95`.
- Home fetch: `apps/tv/src/hooks/useWatchHome.ts:60-75`; rails are `FlatList` (no FlashList).
- Search debounce + gate: `apps/tv/src/lib/search.ts:7-9` (600 ms) and `:114-116` (empty-trim gate only, no min length); category thumbnails `apps/tv/src/components/search/useCategoryThumbnails.ts:34`.
- Bearer: `apps/tv/src/lib/apolloClient.ts:28-51` (global header today); `apps/tv/src/lib/config.ts:13-15`.
- Bible verses N+1: `apps/tv/src/hooks/useBibleVerses.ts:44-62`.
- Dead query: `apps/tv/src/lib/queries.ts:355` (only test importers).
- Existing lazy/cache patterns to reuse: `GET_VIDEO_DUB` (`apps/tv/src/lib/videoQueries.ts:232-275`); WeakMap normalize cache (`apps/tv/src/lib/normalizeVideo.ts:277-290`).

## Deferred / Open Questions

### From 2026-06-30 review

- [P1] Ship-first decoupling: the prod 401 is a live search **outage** fixable by a one-line env provision. Should R11/SC4 ship as a standalone hotfix ahead of the payload/skeleton work, rather than as one item in the sweep? (product-lens)
- [P1] Focus destination on skeleton→content swap: where does D-pad focus land when the Home skeleton unmounts and content rails mount? `hasTVPreferredFocus` is mount-only and won't restore on swap — needs an explicit mechanism (`requestTVFocus` / `TVFocusGuideView`), and a decision on whether skeleton items are themselves focusable. (design-lens)
- [P2] Search success-criteria framing: SC3 verifies only zero-fire cases, but client gating doesn't change the 1–7 s cold wait. Either add a criterion quantifying embedding-frequency reduction (distinct embeddings per typical query, before/after) or explicitly defer all cold-wait measurement to the server-side hand-off. (adversarial)
