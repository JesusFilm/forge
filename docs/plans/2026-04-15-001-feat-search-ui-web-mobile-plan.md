---
title: "feat: Add search UI for web and mobile"
type: feat
status: active
date: 2026-04-15
origin: docs/brainstorms/2026-04-15-search-ui-web-mobile-requirements.md
---

# feat: Add search UI for web and mobile

## Overview

Add search interfaces to both the web (Next.js) and mobile (Expo) apps, consuming the existing `semanticSearch` GraphQL query (feat-010, complete). Two separate PRs: web ships first with the shared query definition, mobile follows.

## Problem Frame

955+ JesusFilm videos are semantically indexed with hybrid search (pgvector + FTS + RRF fusion), but no UI exists to search them. Users can only browse curated experience pages. (see origin: `docs/brainstorms/2026-04-15-search-ui-web-mobile-requirements.md`)

## Requirements Trace

- W1–W10: Web search requirements (Server Component page, SearchInput, SearchResults, VideoCard, data fetcher, site header, empty/error states, shareable URLs, locale)
- M1–M10: Mobile search requirements (SearchScreen, SearchResultCard, Discover tab entry, Apollo fetching, Load More, empty/error states, keyboard dismiss, experience route, locale)
- S1–S2: Shared GraphQL query and typed exports

## Scope Boundaries

- No personalization, search history, or filters
- No timestamp seeking on result tap
- No analytics/tracking in v1
- No voice search
- English locale only (`locale: "en"` hardcoded)
- No score indicator on cards
- TV app excluded

### Deferred to Separate Tasks

- Accessibility audit (ARIA roles, screen reader labels, focus management): separate follow-up PR
- Grid responsive breakpoint polish: can be refined post-launch

## Context & Research

### Relevant Code and Patterns

**Web:**

- `apps/web/src/lib/content.ts` — data fetching: `graphql()` query → Apollo `client.query()` → wrapped in `unstable_cache()` + React `cache()`
- `apps/web/src/lib/client.ts` — Apollo Client singleton, server uses `INTERNAL_GRAPHQL_URL` with Bearer token
- `apps/web/src/lib/recommendations.ts` — precedent for custom GraphQL extension queries. Uses raw `gql` tag, but `SearchResult`/`SearchResponse` types ARE in `graphql-env.d.ts` so `graphql()` should work
- `apps/web/src/components/sections/VideoRecommendations.tsx` — closest card grid pattern (dark theme, `next/image`, `Link`, `bg-stone-800`, `rounded-lg`)
- `apps/web/src/lib/content-width.ts` — `CONTENT_WIDTH_CLASSES` for layout alignment
- `apps/web/src/app/layout.tsx` — bare layout with no header, just font loading + `bg-stone-900` body

**Mobile:**

- `apps/mobile/src/lib/queries.ts` — query + fragment definitions using `graphql()` from `@forge/graphql`
- `apps/mobile/src/lib/apolloClient.ts` — lazy singleton via `getApolloClient()`
- `apps/mobile/src/lib/color.ts` — warm stone palette (`BG_COLOR`, `SURFACE_COLOR`, `TEXT_PRIMARY`, `TEXT_SECONDARY`, `ACCENT`)
- `apps/mobile/app/(tabs)/_layout.tsx` — 4 tabs, `headerShown: false` globally
- `apps/mobile/app/(tabs)/watch.tsx` — Discover tab, currently a `PlaceholderScreen`
- `apps/mobile/app/video/[sectionKey].tsx` — detail screen pattern (uses `useSectionByKey()` from ExperienceProvider)
- `apps/mobile/src/hooks/useExperience.ts` — loads experience by slug via Apollo `useQuery`
- `apps/mobile/src/contexts/ExperienceProvider.tsx` — wraps subtree with experience data + sectionMap

**Shared:**

- `packages/graphql/src/graphql-env.d.ts` — introspection types include `SearchResult`, `SearchResponse`
- `apps/cms/schema.graphql` line 2796 — `semanticSearch` query definition

### Institutional Learnings

- **Codegen strips optional variables** (`docs/solutions/cms/codegen-strips-optional-graphql-variables.md`): `optimizeDocumentNode: false` must be set. Without it, optional `limit`/`offset` vars get silently stripped from the DocumentNode AST — pagination silently breaks.
- **Strapi v5 error extensions** (`docs/solutions/integration-issues/strapi-v5-graphql-error-extensions-stripping-20260413.md`): Error codes (`RATE_LIMITED`, etc.) are in `errors[0].extensions.code`. Check `extensions.code`, never message strings. Watch for duplicate `graphql` package versions.
- **Server-side GraphQL in Next.js** (`docs/solutions/graphql/server-side-strapi-queries-nextjs.md`): Use `fetchPolicy: "no-cache"` in Server Components. Let Next.js handle caching.
- **ISR + headers() trap** (`docs/solutions/web/nextjs16-cachecomponents-isr.md`): `headers()` anywhere in page route forces dynamic rendering. Search pages are dynamic anyway (user-driven queries), so this is fine.
- **Expo Router slugs with slashes** (`docs/solutions/mobile/expo-router-slash-in-dynamic-route-params.md`): `encodeURIComponent()` at navigation time, `decodeURIComponent()` on receiving screen, wrap in try/catch.
- **Gradient banding** (`docs/solutions/mobile/linear-gradient-dark-banding-transparent-keyword.md`): Use `hexToRgba(color, 0)`, never `"transparent"`.
- **Mobile Apollo patterns** (`docs/solutions/mobile/mobile-v2-sdui-app-scaffold-and-review-findings.md`): Use `cache-and-network` fetch policy. Lazy init via `getApolloClient()`.

## Key Technical Decisions

- **Query definition location**: Define in each consuming app using `graphql()` from `@forge/graphql` (consistent with existing patterns in `content.ts` and `queries.ts`). Not in `packages/graphql` package itself per mobile CLAUDE.md rule.
- **Web search page rendering**: Dynamic rendering (not ISR). Search queries are user-driven — no point caching. Use `fetchPolicy: "no-cache"` for initial server fetch. Do NOT wrap in `unstable_cache()`.
- **Web Load More architecture**: Initial results server-rendered via RSC. "Load More" is a client component that receives `initialResults` + `initialHasMore` as props, then fetches subsequent pages client-side via Apollo Client (using `NEXT_PUBLIC_GRAPHQL_URL`).
- **Mobile experience loading for search results**: Reuse `useExperience({ slug })` hook (which already loads by slug via Apollo `useQuery`) inside a new `/experience/[slug]` route. No need to build new data fetching — just a new route that wraps ExperienceProvider + renders sections.
- **Error handling approach**: Parse `errors[0].extensions.code` from GraphQL response. For `RATE_LIMITED`, show static "Please wait N seconds" message (not a countdown timer). For `SERVICE_UNAVAILABLE`, show generic error with retry button.
- **No `gql` fallback needed**: `SearchResult` and `SearchResponse` types ARE in `graphql-env.d.ts`, confirming gql.tada introspection picks them up. Use `graphql()` (not raw `gql` tag).

## Open Questions

### Resolved During Planning

- **Where to define the query?**: In each consuming app (web: `content.ts`, mobile: `queries.ts`), not in `packages/graphql`. This follows the established pattern.
- **How does mobile load an experience by slug?**: `useExperience({ slug })` already exists and fetches by slug. Wrap it in a new route.
- **Should search use ISR?**: No. User-driven queries are inherently dynamic. Skip `unstable_cache()`.

### Deferred to Implementation

- **Exact header layout dimensions**: Height, logo sizing, breakpoint behavior — resolve during implementation with visual feedback.
- **Fallback image for null `imageUrl`**: Use a branded placeholder or `bg-stone-700` color fill — decide during VideoCard implementation.
- **Whether `NEXT_PUBLIC_GRAPHQL_URL` already exists**: Check `apps/web/src/env.ts`. If not, add it for client-side Load More fetches.

## Implementation Units

### PR 1: Web Search (feat-011)

- [ ] **Unit 1: Search query definition + data fetcher**

**Goal:** Define the `semanticSearch` GraphQL query and a `searchVideos()` fetcher function.

**Requirements:** W5, W10, S1

**Dependencies:** None

**Files:**

- Create: `apps/web/src/lib/search.ts` (query definition + server fetcher — separate from `content.ts` because `content.ts` imports `unstable_cache` from `next/cache` which is server-only and would break client-side imports of the query constant)
- Test: `apps/web/src/lib/__tests__/search.test.ts`

**Approach:**

- Define `SEMANTIC_SEARCH` query using `graphql()` from `@forge/graphql` selecting all `SearchResult` fields. **Note:** `semanticSearch` uses `locale: String!` (not `I18NLocaleCode!` as in standard Strapi queries) — define the variable as `$locale: String!`
- Export the `SEMANTIC_SEARCH` query constant so both server-side `searchVideos()` and client-side `SearchResults.tsx` can import it
- Create `searchVideos(query: string, limit?: number, offset?: number)` async function
- Use `client.query()` with `fetchPolicy: "no-cache"` — no `unstable_cache()` wrapping (dynamic user queries)
- Hardcode `locale: "en"`
- Add max query length check (200 characters) — truncate before sending to API
- Return typed `{ results, hasMore, query }` or throw typed error with parsed `extensions.code`
- Verify `optimizeDocumentNode: false` is set in codegen config to prevent `limit`/`offset` variable stripping

**Patterns to follow:**

- `apps/web/src/lib/content.ts` existing query patterns (fragment composition, type extraction)
- `apps/web/src/lib/recommendations.ts` for custom extension query precedent

**Test scenarios:**

- Happy path: `searchVideos("forgiveness")` returns typed results with all fields
- Edge case: empty results array with `hasMore: false`
- Error path: function throws with parsed error code when API returns `RATE_LIMITED`
- Error path: function throws with parsed error code for `SERVICE_UNAVAILABLE`
- Edge case: `limit` and `offset` variables are present in the sent query (codegen stripping guard)

**Verification:**

- `searchVideos()` compiles with full type safety via gql.tada
- Calling with query string returns structured results

---

- [ ] **Unit 2: /search page + SearchInput component**

**Goal:** Create the search route and debounced input component.

**Requirements:** W1, W2, W7 (initial empty state), W8

**Dependencies:** Unit 1

**Files:**

- Create: `apps/web/src/app/search/page.tsx`
- Create: `apps/web/src/app/search/loading.tsx`
- Create: `apps/web/src/components/search/SearchInput.tsx`

**Approach:**

- `page.tsx`: Server Component. `searchParams` is a `Promise<{ q?: string }>` in Next.js 16 — must `await` before reading `.q` (per existing `[slug]/[locale]/page.tsx` pattern). If no query, render initial empty state ("Search for videos about any topic"). If query present, call `searchVideos()` inside an async RSC wrapped in `<Suspense>` with loading fallback.
- `loading.tsx`: Route-level loading skeleton (grid of placeholder cards).
- `SearchInput.tsx`: `'use client'` component. Controlled input with 300ms debounce via `setTimeout`/`clearTimeout`. Updates URL via `router.replace(`/search?q=${encoded}`)` on debounce fire. Reads initial value from `searchParams.q` prop. Autofocuses on mount via `useRef` + `useEffect`.
- Use `CONTENT_WIDTH_CLASSES` from `content-width.ts` for page layout alignment.

**Patterns to follow:**

- `apps/web/src/app/[slug]/[locale]/page.tsx` for dynamic route + async data fetching pattern

**Test scenarios:**

- Happy path: navigating to `/search?q=forgiveness` renders search results
- Happy path: refreshing the page with `?q=` preserves the query and re-fetches
- Edge case: navigating to `/search` with no query shows initial empty state
- Edge case: typing updates URL via `router.replace` (not `router.push`) after 300ms
- Integration: SearchInput reads initial query from URL and populates the input field

**Verification:**

- `/search` renders without errors
- `/search?q=test` triggers data fetch and displays results
- Browser back button works correctly (no history pollution from debounce)

---

- [ ] **Unit 3: VideoCard + SearchResults with Load More**

**Goal:** Build the result card and paginated results list.

**Requirements:** W3, W4

**Dependencies:** Unit 1, Unit 2

**Files:**

- Create: `apps/web/src/components/search/VideoCard.tsx`
- Create: `apps/web/src/components/search/SearchResults.tsx`

**Approach:**

- `VideoCard.tsx`: Server component. `next/image` for thumbnail (aspect-ratio container, `fill` + `sizes`). Fallback for null `imageUrl` (stone-colored placeholder). Title (truncated 1 line), snippet (truncated 2 lines via `line-clamp-2`). Wrapped in `<Link href={/${slug}/en}>`. Dark theme: `bg-stone-800 rounded-2xl` matching VideoRecommendations pattern.
- `SearchResults.tsx`: `'use client'` component. Receives `initialResults`, `initialHasMore`, and `query` as props from the server-rendered page. Manages offset state. "Load More" button at bottom when `hasMore` is true. On click: fetches next page via Apollo Client (client-side), appends to results array. Button shows spinner while loading, disabled during fetch. On error: inline error message below results with retry button.
- Responsive grid: `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6`.
- No-results state when query exists but results are empty: heading "No results for '[query]'", body "Try different keywords or browse experiences".

**Patterns to follow:**

- `apps/web/src/components/sections/VideoRecommendations.tsx` for dark card grid, `next/image` with `fill`, Link wrapping

**Test scenarios:**

- Happy path: renders grid of VideoCards from results array
- Happy path: "Load More" button appears when `hasMore` is true, hidden when false
- Happy path: clicking "Load More" fetches next page and appends results
- Edge case: null `imageUrl` renders placeholder instead of broken image
- Edge case: long snippet truncated to 2 lines
- Error path: pagination fetch error shows inline error with retry button
- Edge case: no results for query shows "No results for '[query]'" message

**Verification:**

- Results display in responsive grid
- Load More fetches and appends without losing existing results
- Card links navigate to correct experience page

---

- [ ] **Unit 4: Minimal site header**

**Goal:** Add a fixed site header with logo and search icon to all pages.

**Requirements:** W6

**Dependencies:** None (can be built in parallel with Units 1-3)

**Files:**

- Create: `apps/web/src/components/SiteHeader.tsx`
- Modify: `apps/web/src/app/layout.tsx`

**Approach:**

- `SiteHeader.tsx`: Fixed-position header, `h-16` (64px). Logo (JesusFilm logo or text mark) on left, search icon (magnifying glass) on right. `bg-stone-900/80 backdrop-blur-sm` for subtle transparency. `z-50` to float above content. `CONTENT_WIDTH_CLASSES` for inner alignment. Search icon is a `<Link href="/search">`.
- `layout.tsx`: Add `<SiteHeader />` inside `<body>` before `{children}`. Add `pt-16` to body or a wrapper to prevent content from being hidden behind the 64px fixed header.
- Keep it minimal — no navigation links, no dropdown menus. Just logo + search icon.

**Patterns to follow:**

- `apps/web/src/lib/content-width.ts` for `CONTENT_WIDTH_CLASSES`
- Existing `bg-stone-900` dark theme from `layout.tsx`

**Test scenarios:**

- Happy path: header visible on homepage
- Happy path: header visible on `/search` page
- Happy path: search icon navigates to `/search`
- Edge case: header stays fixed on scroll
- Integration: existing experience pages (`/[slug]/[locale]`) render correctly with header (no layout regressions)

**Verification:**

- Header renders on all pages
- Search icon navigates to `/search`
- No layout shifts or regressions on existing pages

---

- [ ] **Unit 5: Error handling**

**Goal:** Handle API errors gracefully with user-friendly messages.

**Requirements:** W9

**Dependencies:** Unit 2, Unit 3

**Files:**

- Create: `apps/web/src/app/search/error.tsx`
- Modify: `apps/web/src/components/search/SearchResults.tsx`

**Approach:**

- `error.tsx`: Route-level error boundary for unexpected errors. Shows "Something went wrong" with retry button.
- In `searchVideos()`: parse GraphQL `errors[0].extensions.code` and throw typed errors.
- In `SearchResults.tsx` (client component): catch pagination errors. Extract error codes via Apollo Client v4 path: `(error as ApolloError).graphQLErrors?.[0]?.extensions?.code` and `retryAfterSeconds` via `graphQLErrors?.[0]?.extensions?.retryAfterSeconds`. For `RATE_LIMITED`, show "Too many requests. Please wait N seconds." For `SERVICE_UNAVAILABLE`, show "Search is temporarily unavailable. Please try again."
- In the server-rendered initial fetch: try/catch around `searchVideos()`. On error, render error state inline (not throw to error boundary) so SearchInput remains usable.

**Patterns to follow:**

- `docs/solutions/integration-issues/strapi-v5-graphql-error-extensions-stripping-20260413.md` for error code parsing

**Test scenarios:**

- Error path: rate-limited response shows message with wait time
- Error path: service unavailable shows generic error with retry
- Error path: server-side fetch error renders inline error without breaking the page
- Happy path: error boundary catches unexpected errors with retry action

**Verification:**

- Error states render correctly for each error code
- SearchInput remains functional even when results error

---

### PR 2: Mobile Search (feat-012)

- [ ] **Unit 6: /experience/[slug] route**

**Goal:** Create a new route that loads an experience by slug, enabling search result navigation.

**Requirements:** M8

**Dependencies:** None (prerequisite for search navigation)

**Files:**

- Create: `apps/mobile/app/experience/[slug].tsx`
- Modify: `apps/mobile/app/_layout.tsx` (add screen to Stack)

**Approach:**

- New route file at `apps/mobile/app/experience/[slug].tsx`.
- Read `slug` from `useLocalSearchParams()`. Apply `decodeURIComponent()` wrapped in try/catch (per Expo Router slug learning).
- Use existing `useExperience({ slug })` hook to load the experience by slug.
- Wrap content in `ExperienceProvider` with the loaded experience data.
- Render experience sections using the existing `SectionDispatcher` pattern.
- In `_layout.tsx`: add `<Stack.Screen name="experience/[slug]" options={{ headerShown: true, headerTitle: "" }} />`.
- Loading state: full-screen spinner. Error state: error message with back button.

**Patterns to follow:**

- `apps/mobile/app/video/[sectionKey].tsx` for detail screen pattern (params, layout, back button)
- `apps/mobile/src/hooks/useExperience.ts` for experience loading by slug
- `apps/mobile/src/contexts/ExperienceProvider.tsx` for wrapping with experience context

**Test scenarios:**

- Happy path: navigating to `/experience/easter` loads and renders the Easter experience
- Edge case: slug with special characters decoded correctly
- Error path: invalid slug shows error state
- Edge case: back button returns to previous screen
- Integration: experience sections render correctly with SectionDispatcher

**Verification:**

- Route loads experiences by slug
- Sections render identically to how they render on the Home tab

---

- [ ] **Unit 7: Search query + SearchScreen + SearchResultCard**

**Goal:** Build the core search screen with input, results list, and result cards.

**Requirements:** M1, M2, M4, M7, M10

**Dependencies:** Unit 6

**Files:**

- Create: `apps/mobile/src/screens/SearchScreen.tsx`
- Create: `apps/mobile/src/components/SearchResultCard.tsx`
- Modify: `apps/mobile/src/lib/queries.ts` (add search query + fragment)
- Create: `apps/mobile/app/search.tsx` (route file)
- Modify: `apps/mobile/app/_layout.tsx` (add search screen to Stack)

**Approach:**

- Define `SEMANTIC_SEARCH_QUERY` in `queries.ts` using `graphql()` from `@forge/graphql` with a `SearchResultFragment` selecting all fields. Hardcode `locale: "en"`.
- `SearchScreen.tsx`: `TextInput` at top with 300ms debounce. `useLazyQuery` with `fetchPolicy: "network-only"` for data fetching (search results are ephemeral user-driven queries — do not cache). Triggered on debounced input change. `FlatList` for results with `keyboardDismissMode="on-drag"`. Composite keys: `` `search-${item.id}-${index}` ``.
- `SearchResultCard.tsx`: `Pressable` wrapping horizontal card layout. Thumbnail via `expo-image` with `recyclingKey` (fallback for null `imageUrl`: stone-colored `View`). Title (1 line, `numberOfLines={1}`). Snippet (2 lines, `numberOfLines={2}`). On press: `router.push(`/experience/${encodeURIComponent(slug)}`)`.
- Colors: `BG_COLOR` background, `SURFACE_COLOR` card background, `TEXT_PRIMARY`/`TEXT_SECONDARY` for text, `ACCENT` for focus states.
- `Math.round()` all computed font sizes (Android sub-pixel blurring).

**Patterns to follow:**

- `apps/mobile/src/lib/queries.ts` for fragment + query definition patterns
- `apps/mobile/src/lib/color.ts` for color tokens
- `apps/mobile/app/video/[sectionKey].tsx` for screen layout patterns

**Test scenarios:**

- Happy path: typing "forgiveness" shows debounced results after 300ms
- Happy path: tapping a result navigates to `/experience/[slug]`
- Edge case: empty input shows initial state ("Search for videos about any topic")
- Edge case: null `imageUrl` shows placeholder instead of broken image
- Edge case: keyboard dismisses on scroll
- Edge case: slug with slashes encoded correctly in navigation

**Verification:**

- Search screen shows results from the GraphQL API
- Results navigate to experience route correctly

---

- [ ] **Unit 8: Discover tab search icon**

**Goal:** Add search entry point to the Discover tab header.

**Requirements:** M3

**Dependencies:** Unit 7

**Files:**

- Modify: `apps/mobile/app/(tabs)/_layout.tsx`
- Modify: `apps/mobile/app/(tabs)/watch.tsx`

**Approach:**

- In `_layout.tsx`: enable `headerShown: true` for the Discover tab screen. Add `headerRight` option with a search icon (`Ionicons search` in `ACCENT` color). On press: `router.push("/search")`.
- Style header: `headerStyle: { backgroundColor: BG_COLOR }`, `headerTintColor: TEXT_PRIMARY`, `headerShadowVisible: false`.
- `watch.tsx`: remains a placeholder for now. The Discover tab shows its placeholder content; the search icon in the header is the entry point to search.

**Patterns to follow:**

- `apps/mobile/app/(tabs)/_layout.tsx` existing tab configuration
- `apps/mobile/app/_layout.tsx` for `headerRight` pattern with Pressable + Ionicons

**Test scenarios:**

- Happy path: Discover tab shows header with search icon
- Happy path: tapping search icon navigates to SearchScreen
- Edge case: other tabs unaffected by header change
- Integration: back navigation from SearchScreen returns to Discover tab

**Verification:**

- Search icon visible in Discover tab header
- Tapping navigates to search screen
- No regression on other tabs

---

- [ ] **Unit 9: Load More + empty states + error handling**

**Goal:** Complete the search experience with pagination, empty states, and error handling.

**Requirements:** M5, M6, M9

**Dependencies:** Unit 7

**Files:**

- Modify: `apps/mobile/src/screens/SearchScreen.tsx`
- Create: `apps/mobile/src/components/LoadMoreButton.tsx`

**Approach:**

- `LoadMoreButton.tsx`: renders in `FlatList` `ListFooterComponent` when `hasMore` is true. Shows `ActivityIndicator` while loading, disabled during fetch. On pagination error: inline error text + retry button below existing results.
- Pagination: track `offset` state in SearchScreen. On "Load More" press: call `fetchMore()` with `offset: results.length`. Merge new results into existing array.
- Empty states: initial (no query) — centered illustration-free prompt "Search for videos about any topic". No results — "No results for '[query]'" + "Try different keywords or browse experiences".
- Error handling: parse `errors[0].extensions.code`. For `RATE_LIMITED`: "Too many requests. Please wait N seconds." For `SERVICE_UNAVAILABLE`: "Search is temporarily unavailable. Please try again."

**Patterns to follow:**

- `apps/mobile/src/components/ui/` for UI component patterns
- `docs/solutions/integration-issues/strapi-v5-graphql-error-extensions-stripping-20260413.md` for error code parsing

**Test scenarios:**

- Happy path: "Load More" button appears when `hasMore` is true
- Happy path: tapping "Load More" appends next page of results
- Edge case: "Load More" shows spinner during fetch, disabled state
- Error path: pagination error shows inline error with retry, existing results preserved
- Error path: rate-limited shows wait time message
- Error path: service unavailable shows generic error
- Edge case: initial state (no query) shows prompt
- Edge case: query with zero results shows no-results message

**Verification:**

- Pagination works and results accumulate
- All empty/error states render correctly

## System-Wide Impact

- **Interaction graph:** Web header added to root layout affects all pages. Mobile Discover tab header visibility changes. New mobile Stack screen added.
- **Error propagation:** GraphQL errors parsed at the data-fetching layer and surfaced as typed errors to UI components. Rate-limit errors from shared bucket (30 req/min/IP) affect both search and any other search consumers.
- **State lifecycle risks:** Web Load More state is client-side — navigating away and back resets to server-rendered initial page (correct behavior for URL-driven search). Mobile FlatList state lost on screen unmount (acceptable for search).
- **API surface parity:** `semanticSearch` query defined independently in web and mobile — ensure both select the same fields.
- **Unchanged invariants:** Existing `/[slug]/[locale]` routes, experience pages, SDUI pipeline, and recommendations remain unchanged. The site header is additive only.

## Risks & Dependencies

| Risk                                                             | Mitigation                                                                                                                           |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `graphql()` fails for `semanticSearch` types (custom extension)  | Types confirmed in `graphql-env.d.ts`. If it fails, fall back to raw `gql` tag per `recommendations.ts` pattern                      |
| Codegen strips `limit`/`offset` optional variables               | Verify `optimizeDocumentNode: false` in codegen config. Test that pagination variables reach the API                                 |
| `NEXT_PUBLIC_GRAPHQL_URL` not configured for client-side fetches | Check `apps/web/src/env.ts`. Add if missing — needed for Load More client-side fetching                                              |
| Mobile experience route doesn't render all section types         | Reuse exact same ExperienceProvider + SectionDispatcher. If a section type fails, it's a pre-existing renderer gap, not a search bug |
| Site header breaks existing full-bleed experience pages          | Use `fixed` positioning with `z-50`. Add body padding-top. Test against existing pages                                               |

## Sources & References

- **Origin document:** [docs/brainstorms/2026-04-15-search-ui-web-mobile-requirements.md](docs/brainstorms/2026-04-15-search-ui-web-mobile-requirements.md)
- Related roadmap: `docs/roadmap/content-discovery/feat-011-search-ui-web.md`, `docs/roadmap/content-discovery/feat-012-search-ui-mobile.md`
- CMS search API: `apps/cms/src/api/search/`, `apps/cms/src/graphql/search.ts`
- Error handling learning: `docs/solutions/integration-issues/strapi-v5-graphql-error-extensions-stripping-20260413.md`
- Codegen learning: `docs/solutions/cms/codegen-strips-optional-graphql-variables.md`
- Slug encoding learning: `docs/solutions/mobile/expo-router-slash-in-dynamic-route-params.md`
