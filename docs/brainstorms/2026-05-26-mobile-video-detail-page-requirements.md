# Mobile Video Detail Page (Search Result Videos)

**Date:** 2026-05-26
**Owner:** urim
**Status:** Draft

## Problem

When a user discovers a video through the Discover tab's search results and taps on it, there is no dedicated video detail experience. The existing `app/video/[sectionKey].tsx` route is designed as a child of the Experience context — it receives data from the parent experience's block pipeline. Search result videos are standalone; they don't belong to an experience context and need their own data fetching and full-featured detail page.

## Solution

A new route at `app/watch/[slug].tsx` dedicated to videos selected from search results. This page fetches its own data via a new GraphQL query (modeled after the web app's `GetWatchVideoBySlug`) and renders the full video detail experience matching the "Video Detail - Final Iteration" Stitch design.

## Scope

### In Scope

**New route: `app/watch/[slug].tsx`**

- Only reachable from Discover tab search results
- Fetches video data independently (no Experience context dependency)
- Stack screen with back navigation to search results

**Video Player Zone**

- Full-width 16:9 player with true-black background
- Custom overlay controls: play/pause (48px circle), progress bar (accent track, white scrubber), timestamps, volume, CC toggle, fullscreen toggle
- Fullscreen with landscape rotation on fullscreen tap
- Picture-in-Picture mini player when user scrolls past the main player (floating thumbnail in corner)
- Poster/thumbnail before playback starts

**Video Metadata Bar**

- Uppercase category label (e.g., "SEGMENT") in muted stone with letter-spacing
- Bold title in cream white
- Subtitle (e.g., "Part of The Easter Story") in muted text
- Action button row: Download, Language, Subtitles, Share — vertical icon+label stacks, evenly spaced

**Up Next Carousel**

- Section heading "Up Next"
- Horizontal scrolling 16:9 thumbnail cards (45% screen width, 12px gap, 12px radius)
- Cards sourced from sibling videos (children of canonical parent, or related videos)
- "Playing" badge on current video
- Tapping a card replaces the current video (stays on same route, updates slug)

**Description Section**

- "About This Video" heading
- Body text with 3-line collapse and "Read more" toggle

**Study Questions Accordion**

- "Study Questions" heading with chat icon CTA
- Expandable question rows with chevron animation
- Hairline dividers between rows

**Scripture References**

- "Scripture References" heading with share icon
- Full-width square card with background image, gradient overlay
- Attribution, reference, and italic quote text
- Pagination dots for multiple citations

**Mini Player Bar**

- Appears at bottom when scrolled past main player
- Small thumbnail, title, play/pause control
- Tapping returns scroll to player

**Action Modals (bottom sheets)**

- Download: quality picker with file sizes
- Language: language variant picker with subtitle sub-picker
- Subtitles: subtitle track selector (on/off, language)
- Share: native share sheet with video title and deep link

### Out of Scope

- Offline download storage and playback
- Subtitle rendering overlay on the player (Phase 2 — use native expo-video captions if available)
- Experience detail page changes (untouched)
- Existing `app/video/[sectionKey].tsx` route (untouched)
- Collection route changes (untouched)

## Data Layer

### New GraphQL Query

A new query in `apps/mobile/src/lib/queries.ts` to fetch a single video by slug with all detail fields. Modeled after web's `resolveWatchVideoBySlug`:

**Required fields:**

- `documentId`, `slug`, `title`, `snippet`, `description`
- `label` (e.g., "SEGMENT", "EPISODE")
- `images[]` (poster/thumbnail URLs)
- `primaryLanguage` (coreId, bcp47)
- `parents[]` (for sibling discovery — canonical parent's children)
- `children[]` (for episode/clip lists)
- `variants[]` (language dubs with streaming URLs, downloads, Mux data)
- `subtitles[]` (VTT sources, language info)
- `studyQuestions[]` (text, order)
- `bibleCitations[]` (OSIS ID, book name, chapter/verse range)

### Search Result Routing

Update `SearchResultCard.onSelect` to route to `app/watch/[slug]` instead of the current handler, when the result type is a video (not an experience).

## Navigation

```
(tabs)/watch (Discover tab)
  └── Search results grid
       └── Tap video result
            └── app/watch/[slug].tsx  ← NEW (this page)

(tabs)/index (Home tab)
  └── Experience (CuratedHomeLayout)
       └── Tap video card/hero
            └── app/video/[sectionKey].tsx  ← EXISTING (unchanged)
```

## Design Reference

- Stitch project: "Forge Mobile Video Player Screen" (ID: `7542446117970637815`)
- Screen: "Video Detail - Final Iteration"
- Design system: "JesusFilm Forge Mobile" (`assets/8505a8f6da58400086eab45dee43a4d8`)
- Local design system: `apps/mobile/.stitch/DESIGN.md`

## Success Criteria

- [ ] New route `app/watch/[slug].tsx` renders when tapping a video search result
- [ ] Video plays with custom controls (play/pause, seek, volume, CC, fullscreen)
- [ ] Fullscreen rotates to landscape
- [ ] PiP mini player appears when scrolling past the main player
- [ ] Metadata displays category label, title, subtitle
- [ ] Action buttons (Download, Language, Subtitles, Share) open respective modals
- [ ] Up Next carousel shows sibling videos and allows switching
- [ ] Description collapses at 3 lines with "Read more" toggle
- [ ] Study questions render as expandable accordion
- [ ] Bible quotes render as paginated cards
- [ ] Existing `app/video/[sectionKey].tsx` and experience rendering are unaffected
- [ ] All interactive elements meet 48px minimum touch targets
