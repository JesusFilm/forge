---
title: "feat: /demo-search showcase (semantic search vs Algolia)"
type: feat
status: completed
date: 2026-04-20
---

# /demo-search — Semantic Search Demo with Algolia Cost/Speed Comparison

## Overview

Build `/demo-search` in `apps/web`: a demo page for stakeholder sharing that showcases the live `semanticSearch` API (feat-010 + feat-086), lets a user drill into a result at `/demo-search/[slug]/[locale]` to watch the video with scene-based recommendations underneath (feat-044), and ends with a cost + latency panel comparing our stack to JesusFilm's current Algolia-backed search on `www.jesusfilm.org/watch`.

Most building blocks exist. The work is ~70% composition of existing components and ~30% new (comparison panel, session-latency tracker, two thin route handlers).

## Problem Frame

Vlad needs a URL to demo Nisal's backend work to stakeholders. The shipped pieces — semantic search API, experience search integration, scene-level recommendations — have no standalone demo surface today:

- `/search` exists but is plain UI without recommendations or the comparison framing stakeholders need.
- `/demo-recommendations/[slug]/[locale]` shows scene recs but has no video playback and no search entry.
- No visible framing of **why** this stack is better than Algolia (cost per query, semantic quality, latency vs engine-only Algolia benchmarks).

A single `/demo-search` flow — search → watch → recommendations → cost panel — closes that gap in one URL.

## Requirements Trace

- **R1.** `/demo-search` renders a search input (max 200 chars, character counter visible), live-queries the `semanticSearch` GraphQL API, and displays ranked results including both `video` and `experience` types.
- **R2.** Clicking a result navigates to `/demo-search/[slug]/[locale]`.
- **R3.** `/demo-search/[slug]/[locale]` plays the video using the existing `VideoPlayer` component and renders scene-based recommendations (`sceneRecommendations`) underneath.
- **R4.** `/demo-search` renders a Cost & Latency panel at the bottom comparing our stack to Algolia, with every number source-cited.
- **R5.** Query input hard-caps at 200 characters, matches the CMS API limit already enforced in `searchVideos()`.
- **R6.** No changes to the CMS search API (`apps/cms/src/api/search/**`) or `semanticSearch` GraphQL extension.
- **R7.** No numbers in the comparison panel are fabricated — all pulled from cited public sources or measured at runtime.

## Scope Boundaries

- No changes to the main `/search` route or its components (parameterize, don't regress).
- No changes to the CMS search API surface, SQL, or fusion logic.
- No analytics, personalization, or query-history features.
- No locale switcher on `/demo-search` landing (English only, matches `/search`). `/demo-search/[slug]/[locale]` supports locale in the URL because scene recommendations are locale-aware.
- No type-filter toggle (video/experience) on the demo landing; the API supports it (feat-086) but it's out of scope here.
- No public site-header entry point — `/demo-search` is a direct-link demo.

## Context & Research

### Relevant Code and Patterns

- `apps/web/src/lib/search.ts` — `searchVideos()` already enforces 200-char limit (`MAX_QUERY_LENGTH`), returns `{ results, hasMore, query }`, handles `BAD_USER_INPUT` / `RATE_LIMITED` / `SERVICE_UNAVAILABLE` errors.
- `apps/web/src/lib/recommendations.ts` — `getSceneRecommendations(slug, locale, limit)` and `getVideoBySlug(slug, locale)` are cached + ready to reuse.
- `apps/web/src/lib/content.ts` — `normalizeRouteVideo()` and `selectPlayableVariant()` pick the HLS URL from `video_variants.hls`. The demo watch page reuses the same pattern via an existing helper if one exports it, otherwise mirrors it in a small demo-scoped fetcher.
- `apps/web/src/components/search/SearchInput.tsx` — currently hardcodes `/search` route. Needs parameterization.
- `apps/web/src/components/search/SearchResults.tsx` — renders client-side "Load more"; unchanged shape works for the demo.
- `apps/web/src/components/search/VideoCard.tsx` — currently hardcodes `href="/${slug}/en"`. Needs parameterization.
- `apps/web/src/components/sections/Video.tsx` — exports `VideoPlayer({ src, poster })` using `@forge/video-player`. Reuse directly.
- `apps/web/src/components/sections/VideoRecommendations.tsx` — rail renderer used by `/demo-recommendations/[slug]/[locale]`. Reuse directly.
- `apps/web/src/app/demo-recommendations/[slug]/[locale]/page.tsx` — structural reference for the demo watch page.

### Institutional Learnings

- The API already returns a `searchMode: "hybrid" | "keyword-only"` discriminator (`apps/cms/src/api/search/services/search.ts:71`). Surface this on the demo page when keyword-only so stakeholders aren't surprised by degraded results during OpenRouter blips.
- `apps/web/CLAUDE.md`: GraphQL operations live in `packages/graphql` — but `recommendations.ts` uses `gql` directly because `sceneRecommendations` is a custom extension not in introspection. Established precedent; mirror it if new custom extensions are added (none planned here).

### External References

- **Algolia pricing (Grow):** $0.50/1K search requests after the 10K-included floor; Grow Plus $1.75/1K for AI features. ([algolia.com/pricing](https://www.algolia.com/pricing); [Algolia support — Grow billing](https://support.algolia.com/hc/en-us/articles/15745996583441-How-am-I-billed-on-the-Grow-plan))
- **Algolia NeuralSearch (semantic equivalent):** Elevate-tier only, contact sales — no public price.
- **Algolia latency claim:** "most search queries take from 1 to 20 milliseconds to process" (engine-side, excludes network). ([Algolia support — How fast is Algolia?](https://support.algolia.com/hc/en-us/articles/4406975267089-How-fast-is-Algolia))
- **pgvector HNSW @ 1M × 1536d:** ~5–8 ms p50 on Neon-class hardware per community benchmarks.
- **Embedding cost per query (OpenAI text-embedding-3-small via OpenRouter):** ~$0.0000006 per query (~20 tokens × $0.02/1M).
- **JF confirms Algolia use:** [docs.core.jesusfilm.org/docs/basics/frontend/algolia](https://docs.core.jesusfilm.org/docs/basics/frontend/algolia/).

## Key Technical Decisions

- **Parameterize, don't fork.** Add `searchPath` prop to `SearchInput` and `hrefBuilder` prop to `VideoCard`. Defaults preserve current behavior; demo pages pass `/demo-search` and `(slug, locale) => "/demo-search/${slug}/${locale}"`. Rationale: two consumers is the threshold where parameterization beats duplication — no regression to `/search`.
- **Latency is measured client-side.** Algolia's 1–20 ms is engine-side; real user-facing latency includes network. Measure wall-clock round-trip in the browser and display p50/p95 for the current session. Note the methodology in the panel so the comparison is fair.
- **No server-side timing field added.** The CMS API is out of scope (R6). Server-side p50/p95 can be added later via search-health.ts instrumentation without touching the GraphQL contract.
- **Cost panel mixes static + session-live.** Static table with cited Algolia / pgvector / embedding costs; a live widget next to it shows "This session: N queries, p50 Xms, embedding cost ~$Y". Grounds the stakeholder numbers in something they just experienced.
- **Video playback uses existing route-video resolution, not Mux URL synthesis.** The `semanticSearch` result has `playbackId`, but the source of truth for `streamingUrl` is `video_variants.hls` (mirrored by `normalizeRouteVideo`). Reusing the existing helper keeps non-Mux variants working.
- **Recommendations use the existing `sceneRecommendations` query, not `semanticSearch`.** They're different features (feat-044 vs feat-010/086). Scene recs are more useful below a playing video than another search call.
- **`searchMode` banner.** If the API returns `searchMode: "keyword-only"`, render a subtle amber banner on the demo page. Small touch, big honesty boost for a demo.
- **Robots / sharing.** The demo is intended to be linkable. Add `metadata.robots = { index: false }` on both demo pages so it doesn't pollute search engines while still being shareable.

## Open Questions

### Resolved During Planning

- **Static vs dynamic cost panel** → Both. Static cited table for authority, session-live widget for tangibility.
- **How to get streaming URL from a search-result slug** → Reuse the route-video resolution pattern from `apps/web/src/lib/content.ts` (normalizes `video_variants.hls`). Demo fetcher lives in `apps/web/src/lib/demo-search.ts`.
- **Should the 200-char cap be UI-only or also enforced server-side?** Already both — `searchVideos()` slices to 200 and the CMS API rejects over its own cap. UI adds `maxLength={200}` + counter for UX.
- **Parameterize existing components vs fork?** Parameterize (see Key Technical Decisions).
- **Locale handling** → Landing page hardcodes `en` (matches `/search`). Watch page honors the URL locale segment since scene recs are locale-sensitive.
- **noindex** → Yes on both demo routes.

### Deferred to Implementation

- Exact Tailwind/copy for the comparison panel (design at write time, not plan time).
- Whether the latency tracker persists across page reloads (default: session-scoped via `sessionStorage`; revisit if Vlad wants cumulative).
- Exact JesusFilm Algolia cost estimate for the panel — requires either a public signal of their query volume or a hedged framing ("at 1M queries/month: $X"). Plan assumes hedged framing with a slider or fixed assumed volume noted in copy.
- Whether to render `score` / `searchMode` debug strip on result cards (nice-to-have; default off, add if layout allows).

## Implementation Units

- [ ] **Unit 1: Parameterize shared search components**

**Goal:** Make `SearchInput` and `VideoCard` reusable by the demo route without regressing `/search`.

**Requirements:** R1, R2

**Dependencies:** None

**Files:**

- Modify: `apps/web/src/components/search/SearchInput.tsx`
- Modify: `apps/web/src/components/search/VideoCard.tsx`
- Modify: `apps/web/src/components/search/SearchResults.tsx` (only to forward the new prop through if needed)
- Test: `apps/web/src/components/search/SearchInput.test.tsx` (new or extended)
- Test: `apps/web/src/components/search/VideoCard.test.tsx` (new or extended)

**Approach:**

- Add `searchPath?: string` to `SearchInput` (default `/search`). Use it in `debouncedNavigate`.
- Add `hrefBuilder?: (result) => Route` to `VideoCard` (default current `/${slug}/en` behavior).
- Optional: expose a `maxLength` prop on `SearchInput` with default 200 so the demo can show a counter while still letting `/search` work unchanged.
- Export an inline character-counter affordance (demo-only UX) as a sibling component rather than baking it into the shared `SearchInput`, to keep the existing search UI minimal.

**Patterns to follow:**

- Keep prop defaults in a way that `/search/page.tsx` does not need to change.

**Test scenarios:**

- `SearchInput` with default props navigates to `/search?q=...`.
- `SearchInput` with `searchPath="/demo-search"` navigates to `/demo-search?q=...`.
- `VideoCard` with default props renders `/slug/en` href.
- `VideoCard` with `hrefBuilder` renders the custom href.

**Verification:**

- `/search` continues to work in dev with no visible change.
- Shared components accept but do not require the new props.

- [ ] **Unit 2: Session latency tracker**

**Goal:** A tiny client-only module that records wall-clock round-trip for each `semanticSearch` call made on the demo and exposes `{ count, p50Ms, p95Ms, totalEmbeddingCostUsd }`.

**Requirements:** R4

**Dependencies:** None

**Files:**

- Create: `apps/web/src/lib/demo-search-metrics.ts`
- Test: `apps/web/src/lib/demo-search-metrics.test.ts`

**Approach:**

- Record samples in-memory with `sessionStorage` backing so the widget survives client-side navigation within the demo.
- Expose `recordQuery(durationMs)` and `getStats()`.
- Embedding cost = `count × 0.0000006` (OpenAI text-embedding-3-small @ ~20 tokens/query). Documented as an assumption in the module's top comment so future changes to the embedding model are traceable.
- Use a simple sorted-array p50/p95 — sample sizes are tiny (demo session), no need for a quantile sketch.

**Patterns to follow:**

- Pure functions + a small module-scope state object. No React.

**Test scenarios:**

- `recordQuery` appends and computes p50/p95 across samples.
- Empty state returns `{ count: 0, p50Ms: null, p95Ms: null, totalEmbeddingCostUsd: 0 }`.
- `sessionStorage` unavailable (SSR / private mode) falls back to in-memory without throwing.

**Verification:**

- Unit tests pass.
- Module is importable from client components without pulling in server-only deps.

- [ ] **Unit 3: Cost & latency comparison panel**

**Goal:** A client component rendering the stakeholder-facing comparison: static sourced table (Algolia vs pgvector/OpenRouter) + live session widget.

**Requirements:** R4, R7

**Dependencies:** Unit 2

**Files:**

- Create: `apps/web/src/components/demo-search/CostLatencyPanel.tsx`
- Create: `apps/web/src/components/demo-search/costs.ts` (static sourced-number table, one object per row + source URL)
- Test: `apps/web/src/components/demo-search/CostLatencyPanel.test.tsx`

**Approach:**

- `costs.ts` is the single source of truth for the numbers — each row has `{ label, ourValue, algoliaValue, ourSource, algoliaSource, note? }`.
- Panel renders two sections: "Steady-state cost (per 1M queries)" and "Latency (engine / end-to-end)".
- Footnote block with every source URL cited.
- Live widget pulls from `demo-search-metrics` every 1s (or on refocus) using `useSyncExternalStore` over the tracker module.
- Include a methodology note: "Algolia latency is Algolia's own published engine-side range. Our latency is measured client-side, end-to-end, from this browser session."

**Patterns to follow:**

- `'use client'` component; no SSR.
- Keep copy in the component JSX, not in a separate config — this is demo surface, not internationalized.

**Test scenarios:**

- Renders all rows from `costs.ts`.
- Live widget shows "no data yet" with 0 samples.
- Live widget updates when the tracker records new samples.

**Verification:**

- Every `ourSource`/`algoliaSource` URL in `costs.ts` is a real live page (manual smoke at implementation time).
- Panel renders without console warnings on initial and empty states.

- [ ] **Unit 4: /demo-search landing page**

**Goal:** The demo entry route: input, results, search-mode banner, cost/latency panel.

**Requirements:** R1, R2, R4, R5

**Dependencies:** Unit 1, Unit 3

**Files:**

- Create: `apps/web/src/app/demo-search/page.tsx`
- Create: `apps/web/src/app/demo-search/loading.tsx`
- Create: `apps/web/src/app/demo-search/error.tsx`
- Create: `apps/web/src/components/demo-search/DemoSearchInput.tsx` (thin wrapper around `SearchInput` with `searchPath="/demo-search"` + character counter)
- Create: `apps/web/src/components/demo-search/DemoSearchResults.tsx` (thin wrapper delegating to `SearchResults`, passing `hrefBuilder={(r) => \`/demo-search/${r.slug}/en\`}`via the updated`VideoCard` prop)
- Create: `apps/web/src/components/demo-search/SearchModeBanner.tsx`
- Test: `apps/web/src/app/demo-search/page.test.tsx`

**Approach:**

- RSC + Suspense structure mirrors `/search/page.tsx`.
- `export const metadata.robots = { index: false, follow: false }` to keep the demo out of search engines.
- The client-side "Load more" path in `SearchResults` is where latency tracking hooks in — wrap the fetch call with a timer that calls `recordQuery(durationMs)` from Unit 2.
  - The initial server-rendered page has no browser-measurable latency; note this limitation in the methodology copy (measurement starts on "Load more" and on subsequent URL-change driven fetches).
  - Alternative: also add a `/api/demo-search/query` passthrough so the first page is fetched client-side when the user types — cleaner measurement, but couples the demo to a new API route. Defer unless the stakeholder pushes for it.
- Render `SearchModeBanner` only when the response's `searchMode === "keyword-only"`.

**Patterns to follow:**

- Mirror `apps/web/src/app/search/page.tsx` exactly for the Suspense + error shape.

**Test scenarios:**

- Page renders initial empty state when no `?q=`.
- With `?q=easter`, renders results and the cost panel.
- When API returns `searchMode: "keyword-only"`, banner is visible.
- Query longer than 200 chars is truncated before hitting the API.

**Verification:**

- Navigating to `/demo-search?q=easter` in dev returns results, shows the panel, and the live widget ticks up when "Load more" is clicked.

- [ ] **Unit 5: /demo-search/[slug]/[locale] watch page**

**Goal:** Play the video with scene recommendations underneath.

**Requirements:** R3

**Dependencies:** None (independent of Units 1–4, can run in parallel once Unit 1 lands)

**Files:**

- Create: `apps/web/src/app/demo-search/[slug]/[locale]/page.tsx`
- Create: `apps/web/src/lib/demo-search.ts` — exports `getDemoPlayableVideo(slug, locale)` returning `{ title, description, streamingUrl, posterUrl, imageUrl }` or null, built on the existing route-video resolution pattern in `apps/web/src/lib/content.ts`.
- Test: `apps/web/src/lib/demo-search.test.ts`

**Approach:**

- Server Component. `Promise.all` for `getDemoPlayableVideo` + `getSceneRecommendations`.
- If `streamingUrl` is null (no playable variant), render a graceful fallback with just the recommendations — don't 404.
- Reuse `<VideoPlayer src={streamingUrl} poster={posterUrl} />` from `apps/web/src/components/sections/Video.tsx`.
- Reuse `<VideoRecommendations>` from `apps/web/src/components/sections/VideoRecommendations.tsx`, wrapping each card link to stay inside `/demo-search/*` if trivially supported; otherwise accept that recommendation clicks leave the demo (acceptable for v1, note in copy).
- `export const metadata.robots = { index: false, follow: false }`.
- `export const revalidate = 60` (mirror `/demo-recommendations`).

**Patterns to follow:**

- Structural clone of `apps/web/src/app/demo-recommendations/[slug]/[locale]/page.tsx` minus the locale toggle.

**Test scenarios:**

- Valid slug + locale returns hero + player + recs.
- Unknown slug returns fallback UI (not 404) with recs hidden.
- Variant with `hls = null` renders poster only + recs.

**Verification:**

- `/demo-search/jesus/en` plays video and shows ≥1 recommendation in dev.

## System-Wide Impact

- **Interaction graph:** New demo routes only. No change to `/search`, `/demo-recommendations`, header, or nav.
- **Error propagation:** `searchVideos()` already surfaces `SearchError`. Reuse its error shape in the demo page. Recommendations fetcher already swallows errors → empty list (existing pattern).
- **State lifecycle risks:** The session-latency tracker must handle SSR (no `sessionStorage`); plan specifies a fallback.
- **API surface parity:** `/search` gains optional props but its page.tsx stays identical. No mobile impact.
- **Integration coverage:** Manual smoke of a full flow (query → result click → playback → reco click) is required before sharing the URL.

## Risks & Dependencies

- **Algolia "NeuralSearch" comparator has no public price.** Panel must frame this honestly — we compare against Grow/Grow Plus pricing (non-semantic Algolia) and explicitly note that Algolia's semantic tier is contact-sales.
- **Client-side latency includes browser network.** Numbers will vary by viewer location. Panel copy must state this; consider pinning a "tested from [region]" string.
- **Query volume assumption in cost panel.** Without JF's real Algolia query volume, the comparison must hedge ("at 1M queries/month: $X"). Stakeholder may push back — be ready to add a simple volume slider if needed.
- **apps/web has no public prod URL today** (per Railway probe). This plan delivers the feature; actually demoing it requires either running locally or provisioning a `*.up.railway.app` on `@forge/web`. Out of plan scope, tracked as deployment follow-up.
- **Recommendations links leave the demo.** Cheapest v1 accepts this; a follow-up could wrap `VideoRecommendations` cards with a demo-scoped href builder.

## Documentation / Operational Notes

- Add a one-paragraph entry in the README of `apps/web` (or a new `docs/demos/2026-04-20-demo-search.md`) pointing Vlad at the URL + describing the measurement methodology, so the demo is self-explanatory without Nisal in the room.
- Roadmap: no new ticket needed — this is a demo derivative of shipped feat-010, feat-044, and feat-086. If it becomes a permanent surface, file a new `feat-NNN`.

## Sources & References

- Origin conversation: Vlad's Slack DM 2026-04-20 asking what to demo.
- Related code:
  - `apps/web/src/lib/search.ts` (200-char enforcement)
  - `apps/web/src/lib/recommendations.ts` (scene recs + video-by-slug)
  - `apps/web/src/lib/content.ts` (route-video normalization)
  - `apps/web/src/components/sections/Video.tsx` (`VideoPlayer`)
  - `apps/web/src/components/sections/VideoRecommendations.tsx`
  - `apps/web/src/app/demo-recommendations/[slug]/[locale]/page.tsx` (structural reference)
  - `apps/cms/src/api/search/services/search.ts` (`searchMode` discriminator)
- Related roadmap: `docs/roadmap/content-discovery/feat-010-semantic-search-api.md`, `feat-044-recommendation-query-api.md`, `feat-086-experience-search-integration.md`.
- Related brainstorms: `docs/brainstorms/2026-04-15-search-ui-web-mobile-requirements.md`.
- External docs:
  - Algolia pricing: https://www.algolia.com/pricing
  - Algolia Grow billing: https://support.algolia.com/hc/en-us/articles/15745996583441-How-am-I-billed-on-the-Grow-plan
  - Algolia latency: https://support.algolia.com/hc/en-us/articles/4406975267089-How-fast-is-Algolia
  - OpenAI embedding pricing: https://platform.openai.com/docs/models/text-embedding-3-small
  - Railway pricing: https://railway.com/pricing
  - JF Algolia confirmation: https://docs.core.jesusfilm.org/docs/basics/frontend/algolia/
