---
title: "feat: Add semantic search UI to mobile app"
type: feat
status: active
date: 2026-04-16
origin: docs/brainstorms/2026-04-15-search-ui-web-mobile-requirements.md
---

# feat: Add semantic search UI to mobile app

## Overview

Add a search interface to the Expo mobile app consuming the existing `semanticSearch` GraphQL query (feat-010, complete). This is PR 2 of the search UI rollout — the web implementation (feat-011) is already shipped and the shared query pattern is proven.

## Problem Frame

955+ JesusFilm videos are semantically indexed with hybrid search (pgvector + FTS + RRF fusion), but mobile users have no way to search for content. They can only browse curated experience pages. The `semanticSearch` GraphQL query is live and the web UI already consumes it. (see origin: `docs/brainstorms/2026-04-15-search-ui-web-mobile-requirements.md`)

## Requirements Trace

- M1. SearchScreen with TextInput, 300ms debounce, FlatList
- M2. SearchResultCard with expo-image thumbnail, title, snippet
- M3. Search icon in Discover tab (`watch`) header bar
- M4. Apollo `useLazyQuery` with `network-only` fetch policy
- M5. Load More pagination in FlatList footer
- M6. Empty states + delayed skeleton loading (500ms before showing skeleton)
- M7. Keyboard dismiss on scroll
- M8. New `/experience/[slug]` route for result navigation
- M9. Error handling for rate limiting and service errors
- M10. Hardcoded `locale: "en"`
- M11. Stale response handling via request counter
- M12. Subtle fade-in animation on new result sets

## Scope Boundaries

- No personalization or search history
- No filters (by type, date, etc.)
- No timestamp seeking on result tap
- No analytics/tracking in v1
- No voice search
- English locale only
- No score indicator on cards
- TV app excluded

### Deferred to Separate Tasks

- **Video navigation from search-loaded experiences**: When a user navigates from search to `/experience/[slug]` and taps a video card within that experience, the `video/[sectionKey]` route reads from the outer ExperienceProvider (home experience), not the search result's provider. This is a known limitation — video playback from within search-loaded experiences will show "Video not found". Fix requires passing experience context to the video detail route (separate PR)
- **Accessibility audit**: ARIA roles, screen reader labels, focus management — separate follow-up PR
- **Shared query definition in packages/graphql**: S1 requirement deferred. Query defined in each consuming app per established convention. Accept duplication risk for now

## Context & Research

### Relevant Code and Patterns

**Existing mobile patterns:**

- `apps/mobile/src/lib/queries.ts` — fragment + query definitions using `graphql()` from `@forge/graphql` with `@_unmask`
- `apps/mobile/src/lib/apolloClient.ts` — lazy singleton via `getApolloClient()`, 15s timeout, Bearer token
- `apps/mobile/src/lib/color.ts` — warm stone palette (`BG_COLOR`, `SURFACE_COLOR`, `TEXT_PRIMARY`, `TEXT_SECONDARY`, `ACCENT`, `hexToRgba()`)
- `apps/mobile/src/hooks/useExperience.ts` — loads experience by slug via `useQuery(GET_WATCH_EXPERIENCE)` with `cache-and-network`
- `apps/mobile/src/contexts/ExperienceProvider.tsx` — wraps subtree with normalized experience data + O(1) sectionKey lookup
- `apps/mobile/src/contexts/ExperienceShell.tsx` — root wrapper that resolves default experience
- `apps/mobile/app/_layout.tsx` — root Stack with `require()`-based imports, ErrorBoundary, ApolloProvider
- `apps/mobile/app/video/[sectionKey].tsx` — detail screen pattern (params, header back button, Ionicons)
- `apps/mobile/app/(tabs)/_layout.tsx` — 4 tabs, `headerShown: false` globally, ACCENT/MUTED colors
- `apps/mobile/src/components/ui/AnimatedChevron.tsx` — only animation in codebase, uses native `Animated.timing()` + `LayoutAnimation`
- `apps/mobile/src/styles/shared.ts` — reusable style objects

**Web search implementation (reference, updated in PR #781):**

- `apps/web/src/lib/search.ts` — `SEMANTIC_SEARCH` query definition + `searchVideos()` fetcher, `SearchResult` type export, `SearchError` type, max 200-char query truncation
- `apps/web/src/components/SearchOverlay.tsx` — `requestIdRef` pattern for stale response handling, delayed skeleton (500ms timer), exit/enter animations, Load More with offset tracking. PR #781 added accessibility: `role="dialog"`, `aria-modal`, focus trap, `aria-live="polite"` on results region, `aria-hidden` on skeleton, sr-only "Searching..." announcement, 44px touch targets
- `apps/web/src/components/search/VideoCard.tsx` — **cinematic card design** (PR #781): full-bleed thumbnail with 4:3 aspect ratio, gradient overlay (`from-black via-black/25 to-transparent`), title + snippet positioned over gradient at bottom, rounded-2xl, hover scale effect

**No existing patterns for:** skeleton/shimmer components, `useLazyQuery`, page-level animations

### Institutional Learnings

- **Expo Router slug encoding** (`docs/solutions/mobile/expo-router-slash-in-dynamic-route-params.md`): `encodeURIComponent()` at navigation, `decodeURIComponent()` wrapped in try/catch on receiving screen
- **Stale response guard** (`docs/solutions/best-practices/nextjs-search-overlay-ui-patterns-20260415.md`, pattern 6): `requestIdRef` counter — increment on each search, discard response if counter has moved past the captured value
- **`semanticSearch` locale type** (same source, pattern 8): Uses `String!` not `I18NLocaleCode!` — copy-pasting from standard Strapi queries causes gql.tada type mismatch
- **Apollo fetch policy for search** (`docs/solutions/mobile/mobile-v2-sdui-app-scaffold-and-review-findings.md`): Use `network-only` for ephemeral user-driven queries. Only show loading when data is null, not on every `loading === true`
- **Gradient banding** (`docs/solutions/mobile/linear-gradient-dark-banding-transparent-keyword.md`): Use `hexToRgba(color, 0)`, never `"transparent"`
- **Strapi v5 error extensions** (`docs/solutions/integration-issues/strapi-v5-graphql-error-extensions-stripping-20260413.md`): Error codes in `errors[0].extensions.code`. Check `extensions.code`, never message strings
- **Android FlatList performance** (`docs/solutions/mobile/android-lazy-section-viewport-gating-oom-fix.md`): Track scroll offset in a ref, not state. Use `onMomentumScrollEnd` for final checks
- **Codegen variable stripping** (`docs/solutions/cms/codegen-strips-optional-graphql-variables.md`): `optimizeDocumentNode: false` must be set or `limit`/`offset` get silently stripped
- **Search overlay accessibility patterns** (PR #781): focus trap, `aria-live="polite"` on results region so screen readers announce updates, `aria-hidden` on skeleton loading, sr-only "Searching..." text during load. Mobile equivalents: `accessibilityRole`, `accessibilityLiveRegion="polite"`, `importantForAccessibility="no"` on skeleton

## Key Technical Decisions

- **Query definition location**: Define `SEMANTIC_SEARCH` in `apps/mobile/src/lib/queries.ts` using `graphql()` from `@forge/graphql`, consistent with existing mobile patterns. Not in `packages/graphql` (per mobile CLAUDE.md convention: operations defined in consuming apps)
- **`useLazyQuery` over `useQuery`**: Search is user-initiated, not screen-load-initiated. `useLazyQuery` with `network-only` avoids firing a query on mount and prevents cache pollution between different search terms
- **Stale response guard**: Use `requestIdRef` counter (proven in web overlay), not AbortController — Apollo Client's `useLazyQuery` doesn't expose AbortController cleanly
- **Skeleton approach**: Build a simple `SearchResultSkeleton` component using `Animated` API for shimmer (opacity pulse). No third-party skeleton library — the native Animated API is the only animation tool in the codebase
- **Fade-in**: Use `Animated.timing` with `useNativeDriver: true` for opacity fade on new results. Consistent with `AnimatedChevron.tsx` pattern
- **Experience route architecture**: New `/experience/[slug]` route wraps `ExperienceProvider` around `SectionDispatcher`, reusing the entire SDUI rendering pipeline. No new data fetching logic needed beyond `useExperience({ slug })`
- **No ExperienceShell dependency for search results**: The `/experience/[slug]` route loads its own experience data independently — it does not go through `ExperienceShell`'s selection/persistence flow

## Open Questions

### Resolved During Planning

- **Should search use ExperienceShell?**: No. ExperienceShell manages the "current active experience" for the home tab with AsyncStorage persistence. The search experience route loads independently via `useExperience({ slug })` and doesn't need selection persistence
- **FlatList vs FlashList**: FlatList. FlashList adds a dependency and has the opaque `contentContainerStyle` pitfall (learning). Search result lists are short (20 items per page) — FlatList is sufficient
- **Need for `@_unmask` on search fragment?**: No. `@_unmask` is used on SDUI fragments where parent queries need direct field access. Search results are consumed directly by `SearchResultCard`, not through a normalizer pipeline

### Deferred to Implementation

- **Exact skeleton card dimensions**: Match SearchResultCard layout — resolve when building the component
- **Whether `ExperienceProvider` needs any adaptation for the slug-based route**: The existing `useExperience({ slug })` hook and `ExperienceProvider` should work as-is, but verify during implementation that `SectionDispatcher` renders all section types correctly outside the ExperienceShell context
- **Minimum query length**: No minimum for v1. Single-character queries consume rate-limit tokens but the 300ms debounce filters most intermediate keystrokes. Reconsider if rate limiting becomes an issue in testing
- **Experience route header title**: Set `headerTitle` to `experience.title` after data loads, matching `video/[sectionKey].tsx` pattern (line 97). Resolve exact implementation during Unit 2

## Implementation Units

- [ ] **Unit 1: Search query definition in queries.ts**

**Goal:** Define the `semanticSearch` GraphQL query and `SearchResult` type for mobile consumption.

**Requirements:** M4, M10

**Dependencies:** None

**Files:**

- Modify: `apps/mobile/src/lib/queries.ts`

**Approach:**

- Define `SEMANTIC_SEARCH` query using `graphql()` from `@forge/graphql` selecting all `SearchResult` fields (`type`, `id`, `slug`, `title`, `imageUrl`, `snippet`, `startSeconds`, `playbackId`, `score`)
- Use `$locale: String!` (not `I18NLocaleCode!`) — the `semanticSearch` custom resolver uses a different type than standard Strapi queries
- Export the query constant and a `SearchResult` type alias via `ResultOf`
- Verify variables are present in DocumentNode at runtime: `SEMANTIC_SEARCH.definitions[0].variableDefinitions` should include `limit` and `offset` entries (gql.tada preserves these at runtime; no codegen config change is needed)

**Patterns to follow:**

- Existing fragment/query definitions in `apps/mobile/src/lib/queries.ts`
- Web's proven query shape in `apps/web/src/lib/search.ts`

**Test scenarios:**

- Happy path: query compiles with gql.tada type safety — `ResultOf<typeof SEMANTIC_SEARCH>` resolves to expected shape
- Edge case: `limit` and `offset` variables are present in the DocumentNode AST (codegen stripping guard)

**Verification:**

- TypeScript compiles without errors
- `SearchResult` type includes all expected fields

---

- [ ] **Unit 2: /experience/[slug] route**

**Goal:** Create a new route that loads an experience by slug, enabling search result navigation.

**Requirements:** M8

**Dependencies:** None (can be built in parallel with Unit 1)

**Files:**

- Create: `apps/mobile/app/experience/[slug].tsx`
- Modify: `apps/mobile/app/_layout.tsx`

**Approach:**

- New route file at `apps/mobile/app/experience/[slug].tsx`
- Read `slug` from `useLocalSearchParams()`. Apply `decodeURIComponent()` wrapped in try/catch for `URIError` (per Expo Router slug encoding learning)
- Use existing `useExperience({ slug })` hook to load the experience
- Wrap content in `ExperienceProvider` with the loaded experience data
- Render experience sections using `SectionDispatcher`
- In `_layout.tsx`: add `<Stack.Screen name="experience/[slug]" />` with the same header styling as `video/[sectionKey]` (headerShown, back button with Ionicons chevron-back in ACCENT, BG_COLOR background, no shadow)
- Loading state: centered `ActivityIndicator` with ACCENT color. Error state: error message with retry button
- Set `headerTitle` to `experience.title` after data loads via `navigation.setOptions()` (matching `video/[sectionKey].tsx` line 97 pattern)
- **Known limitation**: video navigation within search-loaded experiences will show "Video not found" because `video/[sectionKey]` reads from the outer ExperienceProvider. This is deferred — do not attempt to fix in this PR

**Patterns to follow:**

- `apps/mobile/app/video/[sectionKey].tsx` for detail screen pattern (params, header, back button, `navigation.setOptions` for title)
- `apps/mobile/app/_layout.tsx` existing Stack.Screen configuration pattern (require-style imports)

**Test scenarios:**

- Happy path: navigating to `/experience/easter` loads and renders the Easter experience sections
- Happy path: header title updates to experience title after data loads
- Edge case: slug with special characters (slashes, spaces) decoded correctly via try/catch
- Error path: invalid slug shows error state with retry button
- Edge case: back button returns to previous screen (search results)
- Integration: experience sections render correctly with SectionDispatcher outside ExperienceShell context

**Verification:**

- Route loads experiences by slug
- Sections render identically to how they render on the Home tab
- Back navigation works

---

- [ ] **Unit 3: SearchScreen + SearchResultCard + stale response handling**

**Goal:** Build the core search screen with debounced input, results list, result cards, stale response guard, and fade-in animation.

**Requirements:** M1, M2, M4, M7, M10, M11, M12

**Dependencies:** Unit 1, Unit 2

**Files:**

- Create: `apps/mobile/src/screens/SearchScreen.tsx`
- Create: `apps/mobile/src/components/SearchResultCard.tsx`
- Create: `apps/mobile/app/search.tsx` (route file — thin wrapper importing SearchScreen)
- Modify: `apps/mobile/app/_layout.tsx` (add search screen to Stack)

**Approach:**

- `SearchScreen.tsx`:
  - `TextInput` at top with 300ms debounce via `setTimeout`/`clearTimeout`
  - `useLazyQuery` with `fetchPolicy: "network-only"` for data fetching. Triggered on debounced input change
  - **Stale response guard**: `requestIdRef` counter. Each search call increments and captures the value. After response, check captured ID matches current before writing state. Discard stale responses
  - **Fade-in animation**: `Animated.Value` for opacity. On new results arriving, reset to 0 and run `Animated.timing` to 1 with `useNativeDriver: true` (~200ms duration)
  - `FlatList` with `numColumns={2}` and `keyboardDismissMode="on-drag"` for a 2-column card grid matching the web's responsive grid. Composite keys: `` `${item.type}-${item.id}-${index}` ``
  - Max query length: 200 characters (truncate before sending, matching web)
  - Track scroll offset in a ref (not state) if needed for future viewport gating

- `SearchResultCard.tsx`:
  - **Cinematic card design** matching the web's updated VideoCard (PR #781): full-bleed thumbnail with gradient overlay and text positioned over the image — not a horizontal thumbnail+text layout
  - `Pressable` wrapping a vertical card. Aspect ratio 4:3 for the thumbnail area
  - Thumbnail via `expo-image` with `recyclingKey` and `contentFit="cover"`. Fallback for null `imageUrl`: `SURFACE_COLOR` View with a play icon
  - Gradient overlay: `LinearGradient` from transparent at top to black at bottom for text legibility. Use `hexToRgba(BLACK, 0)` for the transparent stop (never `"transparent"` — gradient banding learning)
  - Title: `numberOfLines={2}`, white text, bold, positioned at bottom of card over gradient
  - Snippet: `numberOfLines={2}`, `TEXT_BODY` (stone-300), below title over gradient
  - On press: `router.push(`/experience/${encodeURIComponent(slug)}`)`
  - `accessibilityLabel={`${title}: ${snippet}`}` on the Pressable for VoiceOver/TalkBack
  - Card border radius 16, overflow hidden

- Colors: `BG_COLOR` background, `SURFACE_COLOR` card, `TEXT_PRIMARY`/`TEXT_SECONDARY`, `ACCENT` for input cursor/focus
- `Math.round()` all computed font sizes (Android sub-pixel blurring)

**Patterns to follow:**

- `apps/mobile/src/lib/color.ts` for color tokens
- `apps/mobile/app/video/[sectionKey].tsx` for screen layout
- `apps/mobile/src/components/ui/AnimatedChevron.tsx` for `Animated.timing` + `useNativeDriver` pattern
- `apps/web/src/components/SearchOverlay.tsx` for `requestIdRef` stale response pattern
- `apps/web/src/components/search/VideoCard.tsx` for cinematic card design (4:3 aspect, gradient overlay, text over image)

**Test scenarios:**

- Happy path: typing "forgiveness" shows debounced results after 300ms
- Happy path: tapping a result navigates to `/experience/[slug]`
- Edge case: empty input clears results and shows initial state
- Edge case: null `imageUrl` renders SURFACE_COLOR placeholder
- Edge case: keyboard dismisses on scroll
- Edge case: slug with slashes encoded correctly in navigation URL
- Edge case: rapid typing ("f" → "fo" → "for" → "forgiveness") — only final query's results display, intermediate responses discarded
- Edge case: query over 200 characters truncated before API call
- Happy path: new results fade in with opacity animation
- Integration: back-navigating from `/experience/[slug]` preserves search results (Stack keeps SearchScreen mounted)

**Verification:**

- Search screen shows results from the GraphQL API
- Results navigate to experience route correctly
- Stale responses from superseded searches are never displayed
- Results animate in with fade
- Search results survive push/pop navigation to experience detail

---

- [ ] **Unit 4: Discover tab search icon**

**Goal:** Add search entry point to the Discover tab header.

**Requirements:** M3

**Dependencies:** Unit 3

**Files:**

- Modify: `apps/mobile/app/(tabs)/_layout.tsx`

**Approach:**

- Enable `headerShown: true` for the Discover tab (`watch`) screen only
- Add `headerRight` with a search icon (`Ionicons` name `"search"` in ACCENT color) wrapped in `Pressable` with `hitSlop={12}`
- On press: `router.push("/search")`
- Header styling: `headerStyle: { backgroundColor: BG_COLOR }`, `headerTintColor: TEXT_PRIMARY`, `headerShadowVisible: false`
- Add `import { useRouter } from 'expo-router'` as a static import at the top of `(tabs)/_layout.tsx`, consistent with all other imports in that file. The `require()`-based guard in root `_layout.tsx` is specific to env-validation code paths and does not apply here
- `watch.tsx` remains unchanged — it's already a PlaceholderScreen

**Patterns to follow:**

- `apps/mobile/app/(tabs)/_layout.tsx` existing tab configuration
- `apps/mobile/app/_layout.tsx` for Pressable + Ionicons header button pattern

**Test scenarios:**

- Happy path: Discover tab shows header with search icon on right
- Happy path: tapping search icon navigates to SearchScreen
- Edge case: other tabs (Home, Library, Profile) remain unaffected — still `headerShown: false`
- Integration: back navigation from SearchScreen returns to Discover tab correctly

**Verification:**

- Search icon visible in Discover tab header
- Tapping navigates to search screen
- No regression on other tabs

---

- [ ] **Unit 5: Delayed skeleton + empty states + error handling**

**Goal:** Complete the search experience with delayed skeleton loading, empty states, pagination, and error handling.

**Requirements:** M5, M6, M9

**Dependencies:** Unit 3

**Files:**

- Modify: `apps/mobile/src/screens/SearchScreen.tsx`
- Create: `apps/mobile/src/components/search/SearchResultSkeleton.tsx`
- Create: `apps/mobile/src/components/search/LoadMoreButton.tsx`

**Approach:**

- `SearchResultSkeleton.tsx`:
  - Renders 4-6 placeholder cards matching the cinematic SearchResultCard layout (4:3 aspect ratio cards with shimmer, matching the full-bleed thumbnail card shape)
  - Shimmer effect via `Animated` API: looping opacity animation (0.3 → 0.7 → 0.3) with `useNativeDriver: true`
  - Uses `SURFACE_COLOR` for placeholder shapes
  - `importantForAccessibility="no-hide-descendants"` on the skeleton container (mobile equivalent of `aria-hidden`)

- **Delayed skeleton logic** in SearchScreen:
  - On search trigger, start a 500ms timer. If response arrives before timer fires, show results directly (no loading UI). If timer fires before response, show skeleton. Clear timer on response arrival
  - Pattern: `skeletonTimerRef` with `setTimeout(500)`, matching web overlay implementation

- `LoadMoreButton.tsx`:
  - Renders in `FlatList` `ListFooterComponent` when `hasMore` is true
  - Shows `ActivityIndicator` while loading, `Pressable` disabled during fetch
  - On pagination error: inline error text + retry button below existing results
  - Pagination: track `offset` in SearchScreen. On press: call `fetchMore()` with `offset: results.length`. Merge new results into existing array. Existing results remain visible during pagination
  - **Pagination cancellation**: when a new primary search fires (requestIdRef increments), reset offset to 0, clear results, and ignore any in-flight pagination response. Check `requestIdRef` in the pagination response handler the same way as the primary search

- **Empty states**:
  - Initial (no query): centered text "Search for videos about any topic" in `TEXT_SECONDARY`
  - No results: heading "No results for '[query]'" in `TEXT_PRIMARY`, body "Try different keywords or browse experiences" in `TEXT_SECONDARY`

- **Error handling**:
  - Parse `errors[0].extensions.code` from GraphQL errors (per Strapi v5 extensions learning)
  - `RATE_LIMITED`: "Too many requests. Please wait N seconds." — extract `retryAfterSeconds` from extensions
  - `SERVICE_UNAVAILABLE`: "Search is temporarily unavailable. Please try again." with retry button
  - General errors: "Search failed. Please try again." with retry button

**Patterns to follow:**

- `apps/mobile/src/components/ui/AnimatedChevron.tsx` for `Animated` looping pattern
- `apps/web/src/components/SearchOverlay.tsx` for delayed skeleton timer pattern
- `docs/solutions/integration-issues/strapi-v5-graphql-error-extensions-stripping-20260413.md` for error code parsing

**Test scenarios:**

- Happy path: fast response (<500ms) shows results with no skeleton flash
- Happy path: slow response (>500ms) shows skeleton cards, then results fade in
- Happy path: "Load More" button appears when `hasMore` is true, hidden when false
- Happy path: tapping "Load More" appends next page of results
- Edge case: "Load More" shows spinner during fetch, disabled state prevents double-tap
- Error path: pagination error shows inline error with retry, existing results preserved
- Error path: rate-limited response shows "Please wait N seconds" with extracted wait time
- Error path: service unavailable shows generic error with retry button
- Edge case: initial state (no query) shows centered prompt
- Edge case: query with zero results shows no-results message
- Edge case: navigating away from SearchScreen while search is in-flight doesn't cause state-update-on-unmounted-component warnings (timer cleanup)
- Edge case: tapping Load More then immediately changing query — pagination response from old query is discarded, not appended to new results

**Verification:**

- Skeleton appears only after 500ms delay, not for fast responses
- Pagination works and results accumulate
- All empty/error states render correctly
- Rate-limit error shows the actual wait time from API response

## System-Wide Impact

- **Interaction graph:** Discover tab header visibility changes (from hidden to shown). New Stack screens added to root navigator (`search`, `experience/[slug]`). ExperienceProvider used outside ExperienceShell for the first time
- **Error propagation:** GraphQL errors parsed at the response layer via `extensions.code`. Rate-limit errors from shared bucket (30 req/min/IP) affect all search consumers. Apollo Client surfaces errors through `useLazyQuery` result tuple
- **State lifecycle risks:** FlatList state (results, offset) lost on screen unmount — acceptable for search (user re-types). `requestIdRef` resets on remount, which is correct. Skeleton timer cleared on unmount via cleanup
- **API surface parity:** `semanticSearch` query defined independently in web and mobile — both must select the same fields. Web query in `apps/web/src/lib/search.ts` is the reference
- **Unchanged invariants:** Existing Home tab, SDUI pipeline, ExperienceShell selection/persistence, video/collection detail routes — all remain unchanged. Search is purely additive

## Risks & Dependencies

| Risk                                                            | Mitigation                                                                                                                                    |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `graphql()` fails for `semanticSearch` types (custom extension) | Types confirmed in `packages/graphql/src/graphql-env.d.ts`. If it fails, fall back to raw `gql` tag per web's `recommendations.ts` pattern    |
| Codegen strips `limit`/`offset` optional variables              | Verify `optimizeDocumentNode: false` in codegen config. Test that pagination variables reach the API                                          |
| ExperienceProvider doesn't work outside ExperienceShell         | `useExperience({ slug })` is self-contained — it calls `useQuery` directly. ExperienceShell only manages slug selection. Test early in Unit 2 |
| `useLazyQuery` not used elsewhere in codebase                   | Well-documented Apollo API. The web overlay uses a similar manual-trigger pattern. Low risk                                                   |
| Skeleton shimmer performance on low-end Android                 | Use `useNativeDriver: true` — animation runs on UI thread. Limit to 4-6 skeleton cards. Monitor for jank                                      |
| Discover tab header change affects tab bar height/layout        | Only `headerShown` changes for one tab. Test all tabs after Unit 4                                                                            |

## Sources & References

- **Origin document:** [docs/brainstorms/2026-04-15-search-ui-web-mobile-requirements.md](docs/brainstorms/2026-04-15-search-ui-web-mobile-requirements.md)
- **Parent plan:** [docs/plans/2026-04-15-001-feat-search-ui-web-mobile-plan.md](docs/plans/2026-04-15-001-feat-search-ui-web-mobile-plan.md) (Units 6-9, superseded by this plan)
- Web search implementation (reference): `apps/web/src/lib/search.ts`, `apps/web/src/components/SearchOverlay.tsx`
- Related roadmap: `docs/roadmap/content-discovery/feat-011-search-ui-web.md`
- Error handling learning: `docs/solutions/integration-issues/strapi-v5-graphql-error-extensions-stripping-20260413.md`
- Codegen learning: `docs/solutions/cms/codegen-strips-optional-graphql-variables.md`
- Slug encoding learning: `docs/solutions/mobile/expo-router-slash-in-dynamic-route-params.md`
- Stale response pattern: `docs/solutions/best-practices/nextjs-search-overlay-ui-patterns-20260415.md`
- Apollo Client patterns: `docs/solutions/mobile/mobile-v2-sdui-app-scaffold-and-review-findings.md`
