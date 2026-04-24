---
id: "feat-106"
title: "TV App — Search UI"
owner: "urim"
priority: "P1"
status: "not-started"
start_date: "2026-04-24"
duration: 7
depends_on:
  - "feat-074"
  - "feat-010"
blocks: []
tags:
  - "tv"
  - "search"
---

## Problem

The TV app currently has no way to search for content. Users can only discover Experiences through the home rail (feat-074). We need a D-pad-navigable search surface that hits the same semantic search backend the web and mobile apps use (feat-010), so a user can jump from the home screen into a query-driven results grid and then into playback.

**Brainstorm:** `docs/brainstorms/2026-04-24-tv-search-ui-requirements.md`
**Plan:** `docs/plans/2026-04-24-001-feat-tv-search-ui-plan.md`

**Scope cuts during planning & doc review:**

- External-keyboard input (Bluetooth + Apple TV Remote iOS app + Google TV app) is **out of scope** for feat-106 — `react-native-tvos` does not expose `onKeyPress` on non-`TextInput` views, so all three paths require a custom native module. File as a separate `feat-NNN` when the native-module investment is prioritized.
- Voice search (originally scoped as Siri / Google Assistant dictation) is **out of scope** for feat-106 — the feasibility pressure-test during planning showed the brainstorm's "zero-press voice" UX is not achievable on either platform. File as a separate `feat-NNN TV voice search` so the UX can be re-brainstormed.

feat-106 now ships as pure React Native work: on-screen keyboard + three typing-free paths (Recent, Categories, Popular) + results grid.

## Entry Points — Read These First

1. `apps/tv/app/index.tsx` — home screen; search entry point attaches here (focusable tile in header row or first rail)
2. `apps/tv/app/_layout.tsx` — expo-router Stack; add `search` route alongside `index` and `experience/[slug]`
3. `apps/tv/src/components/FocusableCard.tsx` — focus / D-pad pattern every TV control must follow
4. `apps/tv/src/components/ContentRail.tsx` — horizontal rail scrolling/focus behavior (reuse layout for results)
5. `apps/tv/src/lib/queries.ts` — add `SEMANTIC_SEARCH` GraphQL operation here (mirror the mobile/web shape)
6. `apps/web/src/components/FloatingSearchBar.tsx` and `apps/web/src/components/search/SearchInput.tsx` — reference for query lifecycle (debounce, submit, locale)
7. `docs/roadmap/content-discovery/feat-010-semantic-search-api.md` — response shape (`semanticSearch` → `{ results: [{ type, id, slug, title, imageUrl, snippet, startSeconds, playbackId, score }], hasMore, query }`)

## Grep These

- `useFocusable\|onFocus\|TVFocusGuideView` in `apps/tv/src/` — focus primitives to reuse
- `useRouter` in `apps/tv/app/` — expo-router navigation pattern
- `semanticSearch` in `packages/graphql/` and `apps/web/src/` — GraphQL operation shape
- `scale(` in `apps/tv/src/` — 10-foot-UI sizing helper; use for all dimensions
- `COLORS` in `apps/tv/src/lib/colors.ts` — do not hardcode hex values

## What To Build

1. Route: `apps/tv/app/search.tsx` (expo-router screen)

   ```typescript
   // Full-screen search surface.
   // Top: on-screen keyboard + query input (D-pad friendly).
   // Below: results grid that auto-focuses once results land.
   export default function SearchScreen() { ... }
   ```

2. Component: `apps/tv/src/components/SearchKeyboard.tsx`

   ```typescript
   // A-Z + 0-9 + space + delete, laid out in a focusable grid.
   // Each key is a FocusableCard. Pressing a key appends to the query.
   // D-pad up/down/left/right moves between keys; center press triggers.
   // Also wire hardware keyboard (Bluetooth) via onKeyPress for QA speed.
   type Props = {
     value: string
     onChange: (next: string) => void
     onSubmit: () => void
   }
   ```

3. Component: `apps/tv/src/components/SearchResultsGrid.tsx`

   ```typescript
   // Grid of VideoCardRenderer-style tiles (reuse visual language).
   // First result auto-focuses after submit so D-pad down from keyboard lands there.
   // Empty state: "No results for \"<query>\"". Loading state: ActivityIndicator.
   type Result = {
     id: number
     slug: string
     title: string
     imageUrl: string | null
     snippet: string
     startSeconds: number | null
     playbackId: string | null
   }
   ```

4. Entry point on home: add a Search tile at the start of the home rail or as a header focusable.
   In `apps/tv/app/index.tsx`, add a `FocusableCard` with a magnifying-glass glyph and `onPress={() => router.push('/search')}`.

5. GraphQL operation in `apps/tv/src/lib/queries.ts`:

   ```typescript
   export const SEMANTIC_SEARCH = graphql(`
     query SemanticSearch($query: String!, $locale: String!, $limit: Int) {
       semanticSearch(query: $query, locale: $locale, limit: $limit) {
         results {
           type
           id
           slug
           title
           imageUrl
           snippet
           startSeconds
           playbackId
           score
         }
         hasMore
         query
       }
     }
   `)
   ```

   **Do NOT use `useLazyQuery`** — `fetchMore()` on `useLazyQuery` silently drops page 1 (mobile search documented this). Use `getApolloClient().query({ fetchPolicy: "no-cache" })` inside a debounced callback with a `requestIdRef` stale-guard (plan U5). Also include `searchMode` in the selection set so the TV hook can distinguish `"keyword-only"` (degraded) from `"hybrid"` (healthy) — the degraded signal already exists on the backend.

6. Debounce: submit fires on keyboard "Search" key press OR after 600ms of no input (longer than web's 300ms — TV input is slower and we want fewer network round-trips). Cancel any in-flight query on new submit.

7. Selecting a result: `router.push(\`/experience/\${slug}\`)`. If `playbackId`is present and the result is an in-scene match, open playback and seek to`startSeconds` (reuse the VideoPlayer seek prop from feat-076).

## Constraints

- Every control must be focusable via D-pad. No hover-only, no mouse-only.
- Use `scale()` for every dimension; no raw pixels. TV viewports are 1080p/4K — hardcoded web sizes will look tiny.
- Do NOT import from `apps/web/src/` or `apps/mobile/src/`. Copy what you need and adapt.
- Use `getLocale()` from `apps/tv/src/lib/config.ts` for the locale variable — do NOT hardcode `"en"`. feat-109 will swap this to a dynamic value; this ticket must already read from the helper.
- No `<TextInput>` of any kind on `/search` — feasibility review during planning verified that tvOS routes any focused `<TextInput>` into the full-screen system text-entry overlay (not suppressible via `showSoftInputOnFocus={false}` which is Android-only). The on-screen keyboard is the sole input path for feat-106.
- Do NOT add search history/suggestions yet. Ship the minimal submit-and-render flow first; history is a follow-up.

## Verification

- Launch the TV app on Apple TV Simulator. From home, D-pad up/left to the Search tile, press center → navigates to `/search`.
- On the search screen, type a query using only the remote (no keyboard) → query appears in the input field.
- Press "Search" key → results grid populates; focus moves to the first result.
- D-pad to a result, press center → navigates to the experience screen and (if scene-level) begins playback near `startSeconds`.
- Submit an empty query → nothing happens (no network call).
- Submit a query with no matches → "No results" message renders; focus returns to keyboard.
- `pnpm --filter tv typecheck` passes.
- `pnpm --filter tv test` passes (add a unit test for `SearchResultsGrid` empty/loading/populated states).
- Confirm the GraphQL operation's `$locale` variable is declared as `String!` and NOT `I18NLocaleCode!`. Strapi's generated queries use `I18NLocaleCode!`, but `semanticSearch` is a custom resolver that expects `String!`. The wrong type causes a gql.tada compile-time mismatch with a confusing error. Verify against `packages/graphql/graphql-env.d.ts` after `pnpm --filter graphql codegen`. Reference: `docs/solutions/best-practices/nextjs-search-overlay-ui-patterns-20260415.md`.
