---
id: "feat-012"
title: "Search UI — Mobile"
owner: "urim"
priority: "P0"
status: "not-started"
start_date: "2026-04-14"
duration: 21
depends_on:
  - "feat-010"
blocks:
  - "feat-058"
tags:
  - "mobile"
  - "search"
---

## Entry Points — Read These First

1. `apps/mobile/src/screens/` — list directory to see existing screen pattern
2. `apps/mobile/src/screens/WatchHomeScreen.tsx` — home screen pattern (data fetching, layout)
3. `apps/mobile/src/components/sections/` — existing section renderers you already know
4. `apps/mobile/src/navigation/` or grep for `expo-router|Stack|Tabs` — navigation setup

## Grep These

- `FlatList|SectionList` in `apps/mobile/src/` — list rendering pattern
- `useQuery|useLazyQuery|graphql(` in `apps/mobile/src/` — data fetching pattern
- `router.push|router.navigate|Link` in `apps/mobile/src/` — navigation pattern

## What To Build

1. New screen: `apps/mobile/src/screens/SearchScreen.tsx`
   - Search input at top (TextInput with debounce)
   - FlatList of results below
   - Loading indicator while searching
   - Empty state: "Search for videos, topics, and more"
   - No results state: "No results for '{query}'"

2. Search result card component: `apps/mobile/src/components/SearchResultCard.tsx`
   - Thumbnail (left or top), title, snippet text
   - Score indicator (subtle relevance badge or hidden)
   - Tappable → navigates to Experience screen

3. Data fetching — same API as web:

   ```typescript
   async function searchVideos(query: string): Promise<SearchResponse> {
     const res = await fetch(
       `${CMS_URL}/api/search?q=${encodeURIComponent(query)}&limit=20`,
     )
     return res.json()
   }
   ```

4. Add search entry point to navigation (tab bar icon, or button on home screen).

## Constraints

- Use `FlatList` for results, not `ScrollView` with `.map()` — performance matters for long lists.
- Debounce search input by 300ms — do not fire a request on every keystroke.
- Do NOT use a search library (Algolia, InstantSearch). Plain fetch.
- Handle keyboard: dismiss keyboard on scroll, show keyboard on screen focus.

## Verification

- Navigate to Search screen → input focused, keyboard appears
- Type "forgiveness" → results appear after debounce
- Scroll results → keyboard dismisses, list scrolls smoothly
- Tap a result → navigates to Experience screen
- Works on both iOS and Android (test both if possible)
