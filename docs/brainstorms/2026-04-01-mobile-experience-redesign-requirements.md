---
date: 2026-04-01
topic: mobile-experience-redesign
---

# Mobile Experience Screen Redesign

## Problem Frame

The current mobile app renders Experience pages (like Easter) as an endless ScrollView of content blocks — identical to the web layout. The previous mockup iterations tried to impose YouTube/Netflix patterns (tabs, grids, view counts, trending) that don't match the data model and create a false "community platform" feel.

The JesusFilm Experience is not a community-driven video platform. It's a **curated collection** — hand-assembled by content editors for a specific season or theme. The mobile layout should feel personal, like someone prepared this journey specifically for you. No algorithms, no trending, no social proof — just a beautiful, thoughtfully ordered sequence of videos and supporting content to explore at your pace.

## Design Philosophy

- **Curated, not algorithmic**: The CMS editor ordered these blocks intentionally. Respect that order.
- **Personal, not social**: No view counts, no "Popular", no "Trending". The app says "here's what we've prepared for you."
- **Gallery, not catalog**: Large cinematic thumbnails with generous spacing. Each video gets room to breathe, like an art exhibition.
- **Journey, not browse**: The vertical scroll IS the navigation. The sequence tells a story.

## Data Model (from Experience JSON)

An Experience has a flat `blocks[]` array. The actual block types:

- **VideoHero**: `heading`, `subheading`, `streamingUrl`, `ctaLabel`, `video`
- **NavigationCarousel**: `items[]` with `title`, `category`, `imageUrl`, `contentId` (deep-links to sectionKeys)
- **Section** (wrapper with `sectionKey`, `backgroundColor`), containing:
  - **Video**: `sectionVideoTitle`, `subtitle`, `streamingUrl`, `video.images[].mobileCinematicHigh`
  - **Container**: `Text` (heading, subtitle, paragraphs) + `RelatedQuestions` (heading, ctaLink)
  - **BibleQuotesCarousel**: `quotes[]` with `reference`, `text`, `attribution`, `imageUrl`
  - **QuizButton**: `buttonText`, `iframeSrc`
- **VideoCarousel**: `vcTitle`, `vcSubtitle`, `vcDescription`, `items[]` with `titleOverride`, `imageUrl`, `streamingUrl`
- **MediaCollection**: `categoryLabel`, `sectionMcTitle`, `items[]` with `video`, `labelOverride`, `collectionSize`

**Not in the data**: categories, tags, duration, view counts, watch history, popularity, day/date groupings.

## Requirements

- R1. **Full-bleed VideoHero**: The home screen opens with the VideoHero block — full-width edge-to-edge cinematic video/image with heading, subheading, and "Watch now" CTA. This sets the tone.
- R2. **NavigationCarousel as quick-access**: Below the hero, a horizontal scrollable row of NavigationCarousel items (image + title + category label). Tapping jumps to or pushes to the corresponding video. This is the CMS-authored "table of contents."
- R3. **Full-width video cards for each Section**: Each Section containing a Video block renders as a large full-width card with the `mobileCinematicHigh` thumbnail, `sectionVideoTitle`, and `subtitle`. One card per section, stacked vertically. Generous spacing between cards. Tapping pushes to the video detail screen.
- R4. **VideoCarousels as horizontal rows**: VideoCarousel blocks ("Did Jesus Defeat Death?", "Easter Events Day By Day", "New Believer Course") render as titled horizontal scroll rows with `vcTitle` as header and each item as a swipeable card. These punctuate the vertical feed naturally.
- R5. **MediaCollection as featured row**: The "Video Bible Collection" renders as a horizontal carousel of tall collection cards (title, label, collection size).
- R6. **Video detail: player + scrollable content**: Tapping any video pushes to a detail screen. Layout top to bottom: video player (16:9), title + subtitle, expandable description text (from Text block's `contentParagraphs`), bible quotes carousel (horizontal cards), related questions CTA ("Ask yours" external link), quiz button ("What's your next step of faith?").
- R7. **All block types rendered**: Every block type in the Experience JSON has a mobile representation. Nothing is dropped.
- R8. **Platform-appropriate UI**: iOS follows HIG, Android follows Material Design 3. Same React Native codebase, cosmetic differences only.
- R9. **No invented metrics or social features**: No view counts, no "Trending", no "Popular", no "Continue Watching", no duration badges (not in data). The UI shows only what the CMS provides.

## Success Criteria

- The home screen feels like a curated personal journey, not a video store catalog
- Users can find and start any video within 2 taps (NavigationCarousel card or feed card)
- All complementary content is accessible on the detail page
- Layout works for both Easter and Christmas Experiences without code changes
- Every element in the mockups maps to a real field in the Experience JSON

## Scope Boundaries

- No new CMS content types
- No watch history, progress tracking, or social features
- No duration display (not in Experience JSON)
- No search within an Experience
- Video player implementation out of scope — focus is on surrounding layout
- No category tabs or grouping — blocks render in CMS order

## Key Decisions

- **Full-width stacked cards**: Large cinematic thumbnails maximize the `mobileCinematicHigh` images and create the "gallery" feel. Each video gets dedicated visual real estate instead of competing in a grid.
- **CMS order IS the navigation**: No invented categories or tabs. The blocks are intentionally ordered by content editors — the vertical scroll respects that order as a curated journey.
- **NavigationCarousel for quick-access only**: It's a "table of contents" shortcut, not the primary navigation. The primary experience is scrolling through the curated feed.
- **VideoCarousels as natural rhythm**: Horizontal rows (documentary series, easter events, new believer course) break up the vertical feed organically, adding variety without invented structure.

## Dependencies / Assumptions

- NavigationCarousel `contentId` maps to Section `sectionKey` for deep-linking
- `mobileCinematicHigh` images available for most videos (1280x600 cinematic format)
- Existing `sectionMapper.ts` can be extended for the new card-based layout

## Outstanding Questions

### Deferred to Planning

- [Affects R6][Needs research] Should RelatedQuestions show actual Q&A text or just the CTA link? The Experience JSON only provides `rqHeading` and `ctaLink`.
- [Affects R2][Technical] Should NavigationCarousel taps scroll-to within the feed or push directly to the detail screen?
- [Affects R3][Technical] Should EasterDates/AdventCountdown blocks render inline between video cards, or be accessible via a different UI affordance?

## Next Steps

-> Regenerate Stitch mockups with curated gallery layout
-> `/ce:plan` for structured implementation planning
