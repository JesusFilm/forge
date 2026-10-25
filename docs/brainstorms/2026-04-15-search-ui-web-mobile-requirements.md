---
date: 2026-04-15
topic: search-ui-web-mobile
---

# Search UI — Web & Mobile

## Problem Frame

955+ JesusFilm videos are semantically indexed (feat-010, complete), but users have no way to search for content. The `semanticSearch` GraphQL query is live — hybrid semantic + keyword search with RRF fusion — but no UI consumes it. Users currently browse only through curated experience pages.

## Decisions

- **Two separate PRs**: Web (feat-011) ships independently from Mobile (feat-012). Shared GraphQL query definition in `packages/graphql` lands with the first PR.
- **Web entry point**: Minimal site header with logo and search icon, visible on all pages. Search icon navigates to `/search`.
- **Mobile entry point**: Search icon in the Discover tab header bar (enable `headerShown: true`). Tapping pushes SearchScreen onto the navigation stack.
- **Mobile result navigation**: New `/experience/[slug]` route that loads an experience by slug (existing routes use `sectionKey` which search results don't provide).
- **Pagination**: Explicit "Load More" button (not infinite scroll). Uses `offset` param. Default page size: 20 results (`limit=20` for initial and subsequent loads).
- **Result tap action**: Navigate to the experience page (`/[slug]/[locale]` on web, `/experience/[slug]` on mobile). No timestamp seeking in v1.
- **Locale**: Hardcoded `en` for v1.
- **No search frameworks**: No Algolia, no ElasticSearch UI, no third-party search components.
- **No score indicator**: Results are sorted by relevance — position communicates rank. Score field is not rendered.
- **Data fetching**: GraphQL via `packages/graphql` only (not REST). Consistent with CLAUDE.md rule: "apps never call Strapi REST."
- **Web architecture**: Server Component page with Suspense boundary for SearchResults. Initial results server-rendered. "Load More" is a client component that fetches additional pages client-side.

## API Contract (Locked — feat-010)

```graphql
semanticSearch(query: String!, locale: String!, limit: Int, offset: Int): SearchResponse!

type SearchResponse {
  results: [SearchResult!]!
  hasMore: Boolean!
  query: String!
}

type SearchResult {
  type: String!          # "video" in v1
  id: Int!
  slug: String!
  title: String!
  imageUrl: String       # nullable
  snippet: String!
  startSeconds: Float    # nullable (keyword-only matches)
  playbackId: String     # nullable (keyword-only matches)
  score: Float!          # 0-1 RRF-normalized
}
```

Error codes: `BAD_USER_INPUT`, `RATE_LIMITED` (with `retryAfterSeconds`), `SERVICE_UNAVAILABLE`.

## Requirements — Web (feat-011)

- W1. `/search` route as a Server Component reading `?q=` from `searchParams`. Wrap SearchResults in a `<Suspense>` boundary with a loading fallback. Add `loading.tsx` for route-level loading state.
- W2. `SearchInput` client component: text input with 300ms debounce, updates URL via `router.replace` on keystroke (not `useEffect` fetch). Autofocuses on mount.
- W3. `SearchResults`: initial results server-rendered inside Suspense boundary. "Load More" is a client component that fetches additional pages client-side and appends to the list. Button shows loading spinner and is disabled while fetching. On pagination error, show inline error below existing results with retry action.
- W4. `VideoCard` component: thumbnail via `next/image` (fallback for null `imageUrl`), title, snippet (truncated to 2 lines).
- W5. `searchVideos()` data fetcher in `apps/web/src/lib/content.ts` using the `semanticSearch` GraphQL query (not REST).
- W6. Minimal site header: logo + search icon. Fixed position, visible on all pages. Search icon navigates to `/search`.
- W7. Empty states: initial state (no query — centered search prompt: "Search for videos about any topic"), no results state (heading: "No results for '[query]'", body: "Try different keywords or browse experiences"), loading state via Suspense fallback.
- W8. Shareable URLs: refreshing `/search?q=forgiveness` re-runs the search with the same query.
- W9. Error handling: display user-friendly message for rate limiting (with retry hint) and service errors.
- W10. All `semanticSearch` calls pass `locale: "en"` hardcoded. No runtime locale switching in v1.

## Requirements — Mobile (feat-012)

- M1. `SearchScreen` with `TextInput` at top, 300ms debounce, `FlatList` for results.
- M2. `SearchResultCard` component: thumbnail (via `expo-image`, fallback for null `imageUrl`), title, snippet (truncated to 2 lines via `numberOfLines={2}`).
- M3. Search icon in Discover tab header bar. Enable `headerShown: true` on the Discover tab and add search icon via `headerRight`. Pushes SearchScreen onto stack.
- M4. Apollo Client `useLazyQuery` for data fetching with the `semanticSearch` query. Triggered on debounced input change.
- M5. "Load More" button in `FlatList` footer when `hasMore` is true. Button shows loading spinner and is disabled while fetching. On pagination error, show inline error below existing results with retry action. Existing results remain visible during pagination.
- M6. Empty states: initial state (no query entered — centered search prompt: "Search for videos about any topic"), no results state (query entered but zero results — heading: "No results for '[query]'", body: "Try different keywords or browse experiences"), loading spinner.
- M7. Keyboard dismisses on scroll (`keyboardDismissMode="on-drag"`).
- M8. New `/experience/[slug]` route: loads an experience by slug and renders it. Tapping a search result navigates to this route using the result's `slug`.
- M9. Error handling: display user-friendly message for rate limiting and service errors.
- M10. All `semanticSearch` calls pass `locale: "en"` hardcoded. No runtime locale switching in v1.

## Shared (packages/graphql)

- S1. Define the `semanticSearch` query operation using `graphql()` from `@forge/graphql` with a `SearchResultFragment`. Fragment selects all SearchResult fields.
- S2. Export typed result types for consuming apps.

## Scope Boundaries

- No personalization or search history.
- No filters (by type, date, etc.) — v1 returns all matching videos.
- No timestamp seeking on result tap.
- No analytics/tracking for search queries in v1.
- No voice search.
- English locale only.
- No score indicator on result cards.
- TV app (apps/tv) excluded from this feature.

## Success Criteria

- Typing a query on web navigates to `/search?q=...` and displays ranked results from the semantic search API.
- Refreshing the URL re-runs the search with the same results.
- On mobile, tapping the search icon opens a search screen; typing shows debounced results.
- Tapping a mobile search result navigates to the new experience route and renders the experience.
- "Load More" fetches the next page on both platforms.
- Empty, loading, no-results, and error states all render appropriately.
- When the API returns `RATE_LIMITED`, the UI shows a retry message with the wait time. When the API returns `SERVICE_UNAVAILABLE`, the UI shows a service error message.
- No regressions to existing experience pages or navigation.
