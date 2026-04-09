---
date: 2026-04-09
topic: video-collection-player
---

# Video Collection Player Screen

## Problem Frame

When users tap a video in a home page carousel, they navigate to a video detail screen that has little to show beyond the player itself. The carousel items have a minimal schema (`streamingUrl`, `imageUrl`, `titleOverride`, `backgroundColor`, optional `video` relation), so the detail page feels hollow. Worse, watching multiple videos in a collection requires repeatedly navigating back to the home page and tapping the next item — defeating the purpose of curating a video collection.

## Requirements

**Collection-Aware Navigation**

- R1. Tapping a video carousel item on the home page navigates to a **collection player screen** (a screen that presents one `videoCarousel` section as a playable playlist) instead of the current single-video detail screen.
- R2. The collection player screen receives the full `videoCarousel` section context (title, subtitle, description, and all items), not just the tapped item.

**Player Behavior**

- R3. The tapped video begins playing immediately upon screen entry.
- R4. When a video finishes, the next playable item in the collection (skipping items without a `streamingUrl`) auto-advances and begins playing.
- R5. After the last playable video finishes, playback loops back to the first playable item in the collection.
- R6. No video playback occurs on the home page itself — only on the collection player screen. The home page video hero remains the sole exception.

**Screen Layout**

- R7. The screen uses a sticky-player layout: a 16:9 video player pinned to the top of the screen, with all content below scrolling independently. The player remains visible while browsing the playlist.
- R8. Below the player, the screen displays the collection title and subtitle from the `videoCarousel` section.

**Playlist UI**

- R9. Below the collection header, a vertical scrollable playlist shows all items in the collection with: thumbnail, title, and a "now playing" indicator for the active item.
- R10. Tapping any playable playlist row immediately switches playback to that video. Non-playable items (no `streamingUrl`) appear visually muted/disabled and are not tappable.
- R11. The playlist auto-scrolls to keep the active item visible when auto-advance triggers.

**SDUI Compliance**

- R12. The collection player screen renders only data available in the existing `videoCarousel` section of the Experience object. No new CMS content types or schema fields are required.
- R13. The screen must work generically for any `videoCarousel` section — no hard-coded assumptions about specific collections.

## Success Criteria

- A user can watch all videos in a 3+ item carousel without navigating back to the home screen.
- The collection player screen displays the carousel title, subtitle, and a scrollable playlist of all items with thumbnails and titles.
- Auto-advance creates a continuous viewing experience through the full collection and loops seamlessly.
- The screen works for any `videoCarousel` section in any Experience, not just a specific collection.

## Scope Boundaries

- No video playback on the home page (hero excepted).
- No changes to the CMS data model or GraphQL schema.
- No new SDUI block types — this screen is a presentation of the existing `videoCarousel` section data.
- Fullscreen/PiP player controls are inherited from existing `expo-video` setup — no custom player chrome.
- Video carousel items that lack a `streamingUrl` are skipped during auto-advance (they may still appear in the playlist but are not playable).

## Key Decisions

- **Collection player over single-video detail**: A carousel item navigates to a collection-aware screen rather than a bare video page, because the collection context is what gives the screen substance and enables sequential viewing.
- **Loop on completion over stop/return**: Continuous looping keeps users engaged and matches the "background viewing" behavior common in ministry video content.
- **Vertical playlist over horizontal strip**: A vertical list below the player gives each item enough room for a thumbnail + title, feels natural to scroll, and mirrors familiar patterns (YouTube playlist view).
- **Sticky 16:9 player over cinematic/full-scroll**: Pinning the 16:9 player at the top keeps video visible while browsing the playlist. Videos are landscape (16:9) despite the carousel showing portrait thumbnails. This avoids Android VideoView z-order issues and provides ~3-4 visible playlist rows.

## Deferred to Planning

- [Affects R1][Technical] Determine the routing approach: new route (e.g., `/collection/[sectionKey]`) vs. enhancing the existing `/video/[sectionKey]` route with collection context.
- [Affects R2][Technical] Determine how to pass the full carousel section data to the collection screen — route params, context, or ExperienceProvider lookup by carousel sectionKey.
- [Affects R4][Technical] Determine how to detect video completion with `expo-video` to trigger auto-advance.
- [Affects R8][Technical] Determine the playlist row layout dimensions and thumbnail aspect ratio.

## Next Steps

→ `/ce:plan` for structured implementation planning
