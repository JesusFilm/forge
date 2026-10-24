---
title: "feat: Restyle VideoCardRenderer as cinematic letterbox card"
type: feat
status: active
date: 2026-04-14
origin: docs/brainstorms/2026-04-14-tv-video-thumbnail-cinematic-card-requirements.md
---

# feat: Restyle VideoCardRenderer as Cinematic Letterbox Card

## Overview

Replace the undersized 320×180px video thumbnail card with a cinematic letterbox card — 65% screen width, centered, with a gradient overlay, centered play icon, and crimson focus glow. This makes the video a clear call-to-action at 10-foot viewing distance without dominating the page like the hero.

## Problem Frame

On the TV experience detail page, inline video thumbnails use the same card size as carousel items. At 10-foot distance, these are too small to register as a primary CTA and visually blend into surrounding body text. (see origin: `docs/brainstorms/2026-04-14-tv-video-thumbnail-cinematic-card-requirements.md`)

## Requirements Trace

- R1. 60-70% screen width, 16:9 aspect ratio, centered horizontally
- R2. Distinct visual break from surrounding text content
- R3. Bottom gradient overlay with video title in gradient area
- R4. Play icon (~7% of card width) overlaid on thumbnail, maintaining similar visual weight to the carousel's 48px on 320px cards
- R5. surfaceContainerHigh background, 16px border radius
- R6. hexToRgba() for gradient stops
- R7. Focus state: 1.03x scale on both platforms + crimson glow on tvOS. On Android TV, the scale is the sole focus indicator (colored shadows are not supported)
- R8. Single focusable element triggering VideoPlayerContext
- R9. Focus restore on back-navigation via hasTVPreferredFocus
- R10. Accessibility label "Play [video title]", falling back to "Play video" when title is absent
- R11. Highest available thumbnail with Mux fallback

## Scope Boundaries

- Renderer-only change to `VideoCardRenderer` + minor backward-compatible prop addition to `FocusableCard`
- No changes to the SDUI normalizer, dispatcher, or video playback experience
- Android TV crimson shadow limitation is a pre-existing gap across all cards — not addressed here

### Deferred to Separate Tasks

- Android TV alternative focus indicator (crimson border fallback) — affects FocusableCard globally

### Known Limitations

- **Image loading state**: No skeleton or shimmer. The card renders with a solid `surfaceContainerHighest` background until the image loads (expo-image handles the transition). Acceptable for now since expo-image caches aggressively and loads are typically fast on TV with stable network.
- **Image error / broken URL**: Falls back to the solid `surfaceContainerHighest` View with the gradient and play icon still overlaid. Not ideal at cinematic size but functional. A proper error illustration should be addressed holistically across all card renderers.
- **Title absent**: If the CMS title field is null or empty, the gradient area renders without text. The play icon remains centered and the card is still pressable. The accessibility label falls back to "Play video" (see R10 fix below).
- **Press/active feedback**: No visual change on the press frame beyond the existing focus scale. TV users expect select→immediate action, so the lack of a press animation is acceptable for this iteration.

## Context & Research

### Relevant Code and Patterns

- `src/components/sections/VideoCardRenderer.tsx` — current 320×180 implementation, no gradient or play icon
- `src/components/FocusableCard.tsx` — shared focus wrapper, hardcodes 1.05x scale and crimson glow
- `src/components/sections/VideoHeroRenderer.tsx` — gradient pattern: `[hexToRgba(COLORS.surface, 0), COLORS.surface]`, locations `[0.4, 1]`; Mux thumbnail fallback: `getMuxThumbnailUrl(streamingUrl)`
- `src/components/sections/VideoCarouselRenderer.tsx` — play icon: 48px circle, centered, `hexToRgba("#000000", 0.5)` background
- `src/components/sections/MediaCollectionRenderer.tsx` — closest "card with gradient overlay and text at bottom" pattern
- `src/lib/colors.ts` — `COLORS` tokens and `hexToRgba()`
- `src/lib/types.ts` — `pickThumbnailUrl()` priority chain
- `src/lib/resolveImageUrl.ts` — `getMuxThumbnailUrl()` from Mux streaming URL
- `src/contexts/VideoPlayerContext.tsx` — `playVideo(streamingUrl, title?, subtitle?)`

### Institutional Learnings

- **Never use `position: "absolute"` for focusable elements on tvOS** — the focus engine requires horizontal projection overlap in flexbox flow. Reserve absolute positioning for decorative, non-interactive overlays only (`pointerEvents="none"`) — `docs/solutions/best-practices/react-native-tvos-porting-pitfalls-20260414.md`
- **Always use `hexToRgba(color, 0)` for transparent gradient stops** — `"transparent"` resolves to `rgba(0,0,0,0)` causing dark banding on Android TV — `docs/solutions/mobile/linear-gradient-dark-banding-transparent-keyword.md`
- **Focus lost on back-navigation (react-native-tvos #852)** — workaround is toggling `hasTVPreferredFocus` prop to `true` when focus needs to be restored (e.g., after video player dismisses). The experience detail page uses `setNativeProps` on invisible Pressable anchors for scroll-to-section, but for this card we use the simpler prop-based toggle since FocusableCard already accepts `hasTVPreferredFocus` — `docs/solutions/best-practices/expo-tv-platform-setup-sdui-monorepo-20260410.md`
- **Android TV has no colored shadows** — `shadowColor`/`shadowRadius` only work on tvOS. Android `elevation` produces only gray shadows — `docs/solutions/ui-bugs/tv-video-hero-blank-autoplay-20260413.md`

## Key Technical Decisions

- **65% screen width via Dimensions**: Use `Dimensions.get("window").width * 0.65` for card width and derive height from 16:9 ratio. This matches the VideoHeroRenderer pattern of percentage-based sizing and lands at the midpoint of the 60-70% range from requirements.
- **Add `focusScale` prop to FocusableCard**: Backward-compatible optional prop (defaults to 1.05) rather than bypassing FocusableCard entirely. Keeps focus logic centralized in one component.
- **Gradient fades to card background color**: Use `[hexToRgba(COLORS.surfaceContainerHigh, 0), COLORS.surfaceContainerHigh]` with `locations={[0.4, 1]}` — matching the hero's gradient shape but using the card's own background instead of the page surface.
- **Play icon centered on card**: Matches VideoCarouselRenderer pattern. At this larger card size, a centered play icon is more discoverable than left-aligned next to the title.
- **Card width is capped to parent container**: Use `Math.min(Dimensions.get("window").width * 0.65, parentWidth)` via an `onLayout` measurement on the card's parent View. This prevents overflow when VideoCardRenderer is placed inside a narrow ContainerRenderer flex slot (where `flexDirection: "row"` and `flex: gridSpan` constrain each slot's width). When used as a top-level section, `parentWidth` equals the full screen width and the card renders at the intended 65%.

## Open Questions

### Resolved During Planning

- **Width calculation method**: Percentage of `Dimensions.get("window").width` — consistent with VideoHeroRenderer, avoids hardcoded pixel values that break across TV resolutions.
- **Gradient opacity stops**: Follow VideoHeroRenderer's `locations={[0.4, 1]}` — proven readable over varied thumbnail content.
- **Play icon positioning**: Centered on card — simpler, matches carousel pattern, more discoverable at distance.

### Deferred to Implementation

- **Exact gradient colors over dark thumbnails**: The `[0.4, 1]` gradient works well for the hero but may need tuning if the card's shorter height compresses the gradient. Adjust locations during visual testing if needed.
- **Focus scale overflow on screen edges**: At 65% width with 1.03x scale, the card grows to ~67% — verify no clipping occurs against safe area margins.

## Implementation Units

- [ ] **Unit 1: Add focusScale prop to FocusableCard**

  **Goal:** Make the focus scale configurable so the cinematic card can use 1.03x while existing cards keep 1.05x.

  **Requirements:** R7

  **Dependencies:** None

  **Files:**
  - Modify: `src/components/FocusableCard.tsx`

  **Approach:**
  - Add optional `focusScale?: number` prop to `FocusableCardProps`, defaulting to `1.05`
  - Split `styles.cardFocused` into two parts: keep shadow properties (`shadowColor`, `shadowRadius`, `shadowOpacity`, `shadowOffset`) in a static `styles.cardFocusedShadow` StyleSheet entry, and apply the transform dynamically as an inline style `{ transform: [{ scale: focusScale ?? 1.05 }] }`. This avoids creating a new object every render for properties that never change
  - Style merge becomes: `[styles.card, isFocused && styles.cardFocusedShadow, isFocused && { transform: [{ scale: focusScale ?? 1.05 }] }, style]`
  - All existing consumers pass no `focusScale` and get the current 1.05 behavior — zero breaking changes

  **Patterns to follow:**
  - Current `FocusableCard.tsx` style merge pattern: `[styles.card, isFocused && styles.cardFocused, style]`

  **Test scenarios:**
  - Happy path: FocusableCard with no focusScale prop renders with 1.05x scale on focus (existing behavior preserved)
  - Happy path: FocusableCard with `focusScale={1.03}` renders with 1.03x scale on focus
  - Edge case: FocusableCard with `focusScale={1}` renders with no visible scale change on focus

  **Verification:**
  - Existing carousel cards, media collection cards, and navigation cards still have 1.05x focus scale
  - No TypeScript errors in any FocusableCard consumer

- [ ] **Unit 2: Rewrite VideoCardRenderer as cinematic letterbox card**

  **Goal:** Replace the 320×180 card with a cinematic 65%-width centered card featuring gradient overlay, centered play icon, title in gradient area, Mux thumbnail fallback, accessibility label, and focus restore.

  **Requirements:** R1, R2, R3, R4, R5, R6, R8, R9, R10, R11

  **Dependencies:** Unit 1 (focusScale prop)

  **Files:**
  - Modify: `src/components/sections/VideoCardRenderer.tsx`

  **Approach:**
  - **Sizing**: Wrap the card in a View that measures its available width via `onLayout`. Compute `CARD_WIDTH = Math.min(Dimensions.get("window").width * 0.65, measuredParentWidth)` and `CARD_HEIGHT = CARD_WIDTH / (16/9)`. Use `Math.round()` for both (Android sub-pixel rendering). Use `useWindowDimensions()` hook instead of module-level `Dimensions.get()` to avoid a zero-width cold-start edge case on Android TV
  - **Layout**: `FocusableCard` with `focusScale={1.03}`, `alignSelf: "center"`, explicit width/height, `overflow: "hidden"`, `borderRadius: 16`, `backgroundColor: COLORS.surfaceContainerHigh`
  - **Thumbnail**: `expo-image` Image at full card size with `contentFit="cover"`. Resolution chain: `resolveImageUrl(pickThumbnailUrl(video?.images)) ?? getMuxThumbnailUrl(streamingUrl)`. Fallback to solid `surfaceContainerHighest` View if both are null
  - **Gradient overlay**: `LinearGradient` from `expo-linear-gradient` absolutely positioned with `StyleSheet.absoluteFill` and `pointerEvents="none"`. Colors: `[hexToRgba(COLORS.surfaceContainerHigh, 0), COLORS.surfaceContainerHigh]`, locations: `[0.4, 1]`
  - **Play icon (decorative overlay, not focusable)**: Absolutely positioned View, centered on card, `pointerEvents="none"`. Size computed as `Math.round(CARD_WIDTH * 0.07)` (~7% of card width, yielding ~80px on a 1920px TV — proportionally similar to the carousel's 48px on 320px). Circle shape, `backgroundColor: hexToRgba("#000000", 0.5)`, containing the Unicode triangle glyph (▶)
  - **Title**: Absolutely positioned at bottom-left within the gradient area, `pointerEvents="none"`. Use title from section data, fontSize scaled up for TV distance (~24px, `Math.round()`), fontWeight 600, `COLORS.text`, `numberOfLines={2}`
  - **Focus restore**: Use prop-based toggle — track a `shouldRestoreFocus` state that flips to `true` when the video player dismisses (listen to `VideoPlayerContext.isVisible` transitioning from true→false). Pass `hasTVPreferredFocus={shouldRestoreFocus}` to FocusableCard. Reset the flag after focus is restored. This avoids `setNativeProps` (which requires ref forwarding through FocusableCard and is deprecated in Fabric) and keeps focus logic declarative
  - **Accessibility**: Add `accessibilityLabel={title ? `Play ${title}` : "Play video"}` to the FocusableCard. This ensures VoiceOver/TalkBack always has a meaningful label even when the CMS title is null
  - **Critical**: All decorative overlays (gradient, play icon, title) must use `pointerEvents="none"` and `position: "absolute"`. The FocusableCard's Pressable remains the sole focusable element in normal flexbox flow

  **Patterns to follow:**
  - `VideoHeroRenderer.tsx` — gradient overlay, Mux thumbnail fallback, Dimensions-based sizing
  - `VideoCarouselRenderer.tsx` — play icon styling (proportionally scaled to ~7% of card width)
  - `MediaCollectionRenderer.tsx` — card with gradient overlay and bottom-positioned text

  **Test scenarios:**
  - Happy path: Card renders at ~65% screen width, centered, with thumbnail, gradient, play icon, and title visible
  - Happy path: Pressing the card triggers `playVideo()` with the correct streaming URL and title
  - Happy path: Focus state shows crimson glow and 1.03x scale
  - Edge case: Video with no CMS images but valid Mux streaming URL — falls back to Mux-derived thumbnail
  - Edge case: Video with no CMS images and no valid streaming URL — shows solid surfaceContainerHighest fallback
  - Edge case: Long video title (>2 lines) — truncates with ellipsis via numberOfLines={2}
  - Integration: After pressing card → video plays → pressing Back → focus returns to this card (hasTVPreferredFocus restore)
  - Integration: D-pad can navigate to and from the card in all four directions within the experience detail page

  **Verification:**
  - Card is visually prominent and centered on the experience detail page
  - Focus glow is visible at TV viewing distance
  - D-pad navigation works correctly to/from the card
  - Focus restores to the card after back-navigation from video player
  - VoiceOver reads "Play [title]" when card is focused

## System-Wide Impact

- **FocusableCard prop addition**: All existing consumers are unaffected (default 1.05). No behavioral change to carousel, media collection, or navigation cards.
- **VideoCardRenderer sizing in ContainerRenderer**: Card width is capped to `Math.min(screenWidth * 0.65, parentWidth)` via `onLayout`. In a narrow container slot, the card fills the available width instead of overflowing. Aspect ratio is always maintained via the 16:9 height calculation from the resolved width.
- **Unchanged invariants**: SectionDispatcher routing, normalizer logic, VideoPlayerContext API, and all other renderers remain untouched.

## Risks & Dependencies

| Risk                                                             | Mitigation                                                                                      |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| FocusableCard prop change breaks existing consumers              | Default value preserves current behavior; TypeScript catches any type issues                    |
| Gradient looks muddy over dark thumbnails at shorter card height | Adjust locations during visual testing — `[0.4, 1]` is a starting point, not a hard constraint  |
| Card in narrow ContainerRenderer slots                           | Width capped to parent via `onLayout` measurement; card fills slot width instead of overflowing |
| Focus scale (1.03x) causes clipping at screen edges              | 65% × 1.03 = ~67% — well within safe area margins (90% usable)                                  |

## Sources & References

- **Origin document:** [docs/brainstorms/2026-04-14-tv-video-thumbnail-cinematic-card-requirements.md](docs/brainstorms/2026-04-14-tv-video-thumbnail-cinematic-card-requirements.md)
- Related patterns: `src/components/sections/VideoHeroRenderer.tsx`, `src/components/sections/MediaCollectionRenderer.tsx`
- Institutional learnings: `docs/solutions/best-practices/react-native-tvos-porting-pitfalls-20260414.md`, `docs/solutions/mobile/linear-gradient-dark-banding-transparent-keyword.md`
