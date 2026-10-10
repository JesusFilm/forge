---
date: 2026-04-14
topic: tv-video-thumbnail-cinematic-card
---

# TV Video Thumbnail — Cinematic Letterbox Card

## Problem Frame

On the TV experience detail page, inline video thumbnails use the same 320x180px card size as carousel items. At 10-foot viewing distance, these are too small to serve as a clear call-to-action and visually compete with surrounding body text rather than standing out as the primary media element.

## Requirements

**Layout & Sizing**

- R1. Video thumbnail card renders at 60-70% of screen width, 16:9 aspect ratio, centered horizontally in the content area
- R2. Card creates a distinct visual break from surrounding left-aligned text content — it should feel like a cinematic moment, not an inline element

**Visual Treatment**

- R3. Bottom gradient overlay fades from transparent to the card's background color, with the video title rendered in the gradient area (left-aligned within the card)
- R4. Play icon (circular, ~72px) overlaid on the thumbnail, centered or positioned left of title in the gradient strip
- R5. Card background uses `surfaceContainerHigh` (`#2D2927`) with 16px border radius, consistent with the Crimson Gallery design system
- R6. Use `hexToRgba()` for gradient stops (never raw `"transparent"`)

**Focus & Interaction**

- R7. On D-pad focus: crimson glow ring (`#CB333B`) + subtle scale (1.03x) — less aggressive than carousel cards since the card is already large
- R8. Card is a single focusable element that triggers video playback on press via `VideoPlayerContext`
- R9. On back-navigation from the video player, focus must restore to this card (use `hasTVPreferredFocus` workaround for react-native-tvos #852)
- R10. Card must have an accessibility label for tvOS VoiceOver (pattern: "Play [video title]")

**Image Quality**

- R11. Use the highest available thumbnail resolution (mobileCinematicHigh > videoStill > Mux auto-generated at 1920x1080) to avoid blurry upscaling at this size. If all CMS image fields are null but a streaming URL exists, fall back to `getMuxThumbnailUrl(streamingUrl)` (matching the pattern in `VideoHeroRenderer`)

## Success Criteria

- Video card is immediately identifiable as the primary video CTA from 10 feet away
- Card feels balanced alongside body text and other page sections — prominent but not dominating like the hero
- Focus state is clearly visible with crimson glow at TV viewing distance

## Scope Boundaries

- This covers only the inline `VideoCardRenderer` on the experience detail page, not carousel cards, hero videos, or media collection cards
- No changes to the video playback experience itself
- No changes to the SDUI normalizer or dispatcher — this is a renderer-only change

## Key Decisions

- **Cinematic letterbox over full-width:** Full content-width (1760px) would dominate the page and compete with the hero. 60-70% width is large enough to be unmistakable at distance while maintaining visual hierarchy.
- **Centered over left-aligned:** Centering creates a deliberate visual break that signals "this is a media element" rather than flowing with the text. Matches how streaming apps present featured content.
- **Gradient overlay over metadata strip:** Keeping title within the image via gradient is more cinematic and reduces vertical space compared to a separate strip below. Consistent with the existing `VideoCarouselRenderer` pattern.

## Dependencies / Assumptions

- Thumbnail source images are high enough resolution to look sharp at ~1100-1200px width (Mux auto-generated thumbnails at 1920x1080 should be sufficient)

## Outstanding Questions

### Deferred to Planning

- [Affects R1][Technical] Exact width calculation — should this be a percentage of `Dimensions.get("window").width` or a fixed pixel value capped at a max?
- [Affects R3][Needs research] Optimal gradient opacity stops for readability over varied thumbnail content

## Next Steps

-> `/ce:plan` for structured implementation planning
