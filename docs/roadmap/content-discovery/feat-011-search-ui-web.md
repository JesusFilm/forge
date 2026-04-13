---
id: "feat-011"
title: "Search UI — Web"
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
  - "web"
  - "search"
---

## Entry Points — Read These First

1. `apps/web/src/app/[slug]/[locale]/page.tsx` — existing dynamic route pattern to follow
2. `apps/web/src/lib/content.ts` — add the search fetch function here
3. `apps/web/src/components/sections/Video.tsx` — Video component for rendering results (reuse for video cards)
4. `docs/roadmap/content-discovery/feat-010-semantic-search-api.md` — the search response shape

## Grep These

- `next/image` in `apps/web/src/` — how images are used (required for thumbnails)
- `next/link` in `apps/web/src/` — how internal links work
- `Suspense` in `apps/web/src/` — loading state pattern
- `searchParams` in `apps/web/src/app/` — how URL params are read in App Router

## Search API Contract (from Nisal — updated April 13, 2026)

```
GET /api/search?q=:query&locale=:lang&limit=:n&offset=:n

Also available via GraphQL:
{ semanticSearch(query: "forgiveness", locale: "en", limit: 20, offset: 0) { ... } }

Response:
{
  "results": [
    {
      "type": "video",
      "id": 123,
      "slug": "story-of-forgiveness",
      "title": "The Story of Forgiveness",
      "imageUrl": "https://cloudflare.../thumbnail.jpg",
      "snippet": "A powerful scene exploring the theme of forgiveness as a father reconciles...",
      "startSeconds": 45.0,
      "playbackId": "abc123",
      "score": 0.87
    }
  ],
  "total": 42,
  "query": "forgiveness"
}

Notes:
- `type` is always "video" in v1. Future: "experience" and other content types.
- `startSeconds` + `playbackId` enable deep-linking to the matching scene in the video.
- `imageUrl` is the video's primary image (mobile_cinematic_high or url fallback).
- `snippet` is the matching scene's description (semantic, not a raw transcript chunk).
- `locale` is required. Only videos with a published variant in that language are returned.
- No `topicSlug` filter in v1 (locale only). Additional filters coming later.
```

## What To Build

1. New route: `apps/web/src/app/search/page.tsx`

   ```typescript
   // Server Component
   // Reads ?q= from searchParams
   // Fetches results from CMS search API
   // Renders SearchResults component

   export default async function SearchPage({
     searchParams,
   }: {
     searchParams: Promise<{ q?: string; topic?: string; page?: string }>
   }) { ... }
   ```

2. Client component: `apps/web/src/components/SearchInput.tsx`

   ```typescript
   "use client"
   // Text input with debounce (300ms)
   // On submit: router.push(`/search?q=${encodeURIComponent(query)}`)
   // Use useRouter() from next/navigation
   ```

3. Server component: `apps/web/src/components/SearchResults.tsx`

   ```typescript
   // Receives results array as props
   // Renders grid of VideoCard components
   // Shows "snippet" text with the matching excerpt
   // Pagination: "Load more" or page numbers
   ```

4. Component: `apps/web/src/components/VideoCard.tsx`

   ```typescript
   // Reusable card: thumbnail (next/image), title, description/snippet, score indicator
   // Links to the video's Experience page
   // Used by search results AND topic pages
   ```

5. Data fetcher in `apps/web/src/lib/content.ts`:

   ```typescript
   export async function searchVideos(
     query: string,
     options?: {
       locale?: string
       limit?: number
       offset?: number
     },
   ): Promise<SearchResponse> {
     const params = new URLSearchParams()
     params.set("q", query)
     if (options?.locale) params.set("locale", options.locale)
     params.set("limit", String(options?.limit ?? 20))
     params.set("offset", String(options?.offset ?? 0))
     const res = await fetch(`${process.env.CMS_URL}/api/search?${params}`)
     return res.json()
   }
   ```

6. AI-generate the design: use `/ce:brainstorm` to explore the visual design, then iterate with screenshots. Do NOT wait for mockups.

## Constraints

- Search page is a **Server Component** that fetches on the server. Only the search input is `'use client'`.
- Do NOT use `useEffect` + `fetch` for search results. Server-side fetch with URL-driven state.
- Use `next/image` for all thumbnails. Never raw `<img>`.
- Search URLs must be shareable: `/search?q=forgiveness` should work when copy-pasted.
- Do NOT add a search framework (Algolia InstantSearch, etc.). Plain fetch against Nisal's API.

## Stub for Development (Before Nisal's API Is Ready)

Create `apps/web/src/lib/searchStub.ts`:

```typescript
export function mockSearchResults(query: string): SearchResponse {
  return {
    results: Array.from({ length: 5 }, (_, i) => ({
      type: "video" as const,
      id: i,
      slug: `result-${i}`,
      title: `Result ${i + 1} for "${query}"`,
      imageUrl: "/placeholder.jpg",
      snippet: `A scene exploring themes related to ${query}...`,
      startSeconds: i * 30,
      playbackId: `mock-playback-${i}`,
      score: 1 - i * 0.1,
    })),
    total: 5,
    query,
  }
}
```

Switch to real API when Nisal's endpoint is live. Use an environment variable: `SEARCH_API_URL`.

## Verification

- Navigate to `/search` → page loads with search input
- Type "forgiveness" and submit → URL updates to `/search?q=forgiveness`
- Results display with thumbnails, titles, snippets
- Click a result → navigates to the video's Experience page
- Refresh `/search?q=forgiveness` → same results (server-rendered, shareable URL)
- `pnpm build` → search page builds without errors
- Responsive: works on mobile viewport (375px) and desktop (1440px)
