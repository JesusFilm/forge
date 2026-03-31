---
title: "feat: Style Video Collection Carousel Cards to Match Reference Website"
type: feat
status: active
date: 2026-03-27
deepened: 2026-03-27
---

# feat: Style Video Collection Carousel Cards to Match Reference Website

## Enhancement Summary

**Deepened on:** 2026-03-27
**Research agents used:** 6 (best-practices, framework-docs, pattern-recognition, performance-oracle, learnings-check, accessibility-review)

### Key Improvements from Research

1. **Create a file-private `OverlayMediaCard` component** (not modify shared `MediaItemCard`) — follows established `QuoteCard` pattern
2. **Increase gradient opacity from 0.7 to 0.85** for WCAG AA compliance on bright images
3. **Bump card width from 0.45 to 0.48 \* screenWidth** to avoid tight text on iPhone SE (375pt)
4. **Use `expo-image` instead of RN `Image`** for disk caching, memory management, and transition animations
5. **Add `android_ripple` with `foreground: true`** to work around RN 0.80+ ripple regression
6. **Add `accessibilityRole="adjustable"`** to ScrollView and mark images as decorative

### New Considerations Discovered

- RN 0.80+ `android_ripple` regression requires `foreground: true` workaround
- Gradient `locations` prop should be used for faster falloff in text zone
- `expo-image` available in SDK 54 — significant upgrade over RN `Image` for carousel images
- `LinearGradient` prop objects (`colors`, `start`, `end`) should be extracted as constants to avoid re-renders

---

## Overview

Restyle the `MediaCollectionRenderer` carousel variant so that video collection cards match the reference website design: 4:3 aspect ratio cards with full-bleed background images, bottom gradient overlays, overlaid category labels and titles, and chapter count badges at the top-right. Also update the section header to include a "WATCH" button matching the reference.

## Problem Statement / Motivation

The current carousel cards use a stacked layout (16:9 thumbnail above, title/subtitle below) at a fixed 200px width. The reference website uses a more immersive card design with text overlaid on the image via gradient, which is more visually engaging and consistent with the website brand. This change brings the mobile app's video collection carousel in line with the established website design language.

## Proposed Solution

Modify the carousel variant of `MediaCollectionRenderer` to render cards with:

1. **4:3 aspect ratio** with responsive width (screen-relative, not fixed 200px)
2. **Full-bleed background image** using the existing `imageOverride?.url ?? video?.image?.url` resolution
3. **Bottom gradient overlay** for text readability (using `hexToRgba`, not `"transparent"`)
4. **Overlaid text**: category label (e.g., "FEATURE FILM") and title (e.g., "JESUS") at bottom-left
5. **Chapter count badge** (from `collectionSize`) at top-right
6. **"WATCH" button** in the section header area with play icon, linking to `https://www.jesusfilm.org/watch`
7. **Remove play icon** from individual cards (reference shows none)
8. **Snap-to-scroll** behavior matching `NavigationCarouselRenderer` pattern

### Key Design Decisions

- **Carousel variant only** — other variants (grid, hero, player, collection) remain unchanged. Create a file-private `OverlayMediaCard` component (not modify shared `MediaItemCard`).
- **Category label on cards** — use section-level `categoryLabel` repeated on each card (matches reference website behavior where all cards in a collection share the same category).
- **Card width** — `screenWidth * 0.48` with snap-to behavior, so ~2 cards visible with a peek of the next. Cap at `maxWidth: 280` for tablets.
- **Gradient** — bottom 60% of card, from `hexToRgba("#000000", 0)` to `rgba(0, 0, 0, 0.85)` with `locations={[0, 0.55]}`. Extract `hexToRgba` into shared utility first.
- **No-image fallback** — solid dark background (`#1a1a1a`) applied directly on card container (not a separate View, to reduce Android overdraw).

### Research Insights: Card Width

The pattern review found that `0.45 * screenWidth` produces cards of ~169pt on iPhone SE (375pt), which is narrower than the current fixed 200px. With 4:3 aspect ratio and overlaid text (category + title + badge), this is tight. **Recommendation: use `0.48 * screenWidth`** which yields ~180pt on iPhone SE — sufficient for text while still showing a peek of the next card.

| Device            | Width (pt) | Card at 0.48x  | Cards visible |
| ----------------- | ---------- | -------------- | ------------- |
| iPhone SE         | 375        | 180pt          | ~2            |
| iPhone 15         | 393        | 189pt          | ~2            |
| iPhone 15 Pro Max | 430        | 206pt          | ~2            |
| iPad Mini         | 744        | 280pt (capped) | ~2.5          |

## Technical Considerations

### Architecture

- **New component**: Create file-private `OverlayMediaCard` inside `MediaCollectionRenderer.tsx` — follows the established `QuoteCard` pattern from `BibleQuotesCarouselRenderer`. Do NOT modify the shared `MediaItemCard` which serves 5 variants.
- **Shared utility**: Extract `hexToRgba` from `BibleQuotesCarouselRenderer.tsx` into `apps/mobile/src/lib/color.ts`
- **Pattern reference**: `NavigationCarouselRenderer.tsx` implements the closest pattern (background image, `LinearGradient`, overlaid text, responsive sizing, snap scroll)
- **Module-level constants**: Define `CARD_GAP`, `HORIZONTAL_PADDING`, `CARD_ASPECT_RATIO` at module level, compute `cardWidth` inside the component — matching the established pattern in `NavigationCarouselRenderer`

```typescript
const CARD_GAP = 12
const HORIZONTAL_PADDING = 24
const CARD_ASPECT_RATIO = 4 / 3
```

### Key Files to Modify

| File                                                                   | Change                                                                                        |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `apps/mobile/src/components/sections/MediaCollectionRenderer.tsx`      | Add `OverlayMediaCard` component, restyle carousel variant, add WATCH button, add snap scroll |
| `apps/mobile/src/lib/color.ts` (new)                                   | Extract shared `hexToRgba` utility                                                            |
| `apps/mobile/src/components/sections/BibleQuotesCarouselRenderer.tsx`  | Import `hexToRgba` from shared utility instead of local definition                            |
| `apps/mobile/src/components/sections/NavigationCarouselRenderer.tsx`   | Fix `"transparent"` → `hexToRgba` (documented bug from learnings)                             |
| `apps/mobile/src/components/sections/MediaCollectionRenderer.test.tsx` | Update tests for new card structure                                                           |

### Performance

#### Research Insights

- **`LinearGradient` per card is lightweight** — renders as native `CAGradientLayer` (iOS) / `GradientDrawable` (Android), GPU-composited. 20 gradient views is well within budget.
- **ScrollView is appropriate** — at 5-20 items, FlatList virtualization overhead exceeds benefit. FlatList introduces snap alignment complexity and blank-space flicker. Threshold for reconsidering: 40+ items.
- **`expo-image` recommended over RN `Image`** — provides disk caching on both platforms, automatic downsampling, `transition` animations, and `recyclingKey` for list recycling. Available in Expo SDK 54. Consider adopting for this carousel first, then migrating other carousels as a follow-up chore.
- **Extract `LinearGradient` prop objects as constants** (`colors`, `locations`) to avoid creating new object literals on every render.
- **Apply `backgroundColor` directly on card container** — not as a separate absolute-fill View. This eliminates one overdraw layer per card on Android.
- **Wrap `OverlayMediaCard` in `React.memo`** — following the `QuoteCard` pattern. Protects against unnecessary re-renders from parent state changes.
- **Defensive item cap**: Add `items.slice(0, 25)` to protect against unbounded CMS content.

```typescript
// Extract gradient constants to avoid re-creation per render
const GRADIENT_COLORS = [hexToRgba("#000000", 0), "rgba(0,0,0,0.85)"] as const
const GRADIENT_LOCATIONS = [0, 0.55] as const
```

#### Memory Budget (iPhone 15, 3x scale)

| Metric                   | Value                                                          |
| ------------------------ | -------------------------------------------------------------- |
| Card display size        | ~189 x 142 pt                                                  |
| Decoded bitmap per image | ~567 x 426 px = ~966 KB                                        |
| 20 images total          | ~19 MB decoded                                                 |
| Verdict                  | Acceptable; `expo-image` manages memory better than RN `Image` |

### Documented Learnings to Apply

1. **Gradient dark banding** — never use `"transparent"` in `LinearGradient` colors. Use `hexToRgba(targetColor, 0)` instead (see `docs/solutions/mobile/linear-gradient-dark-banding-transparent-keyword.md`)
2. **Responsive typography** — use `useTypography()` hook for all text, never hardcode font sizes. Keep `fontWeight` and `color` in StyleSheet; spread only `fontSize`/`lineHeight` from tokens (see `docs/solutions/mobile/responsive-typography-hook.md`)
3. **Screen dimensions** — use `useWindowDimensions()` inside component body, not `Dimensions.get("window")` at module scope (stale after rotation)
4. **Hero context** — check `useIsInsideHero()` and skip opaque backgrounds if inside hero layout. Set `elevation: 0` on Android inside hero context (see `docs/solutions/mobile/translucent-section-backgrounds-with-react-context.md`)
5. **Decorative icons** — use View+Text with Unicode for play icon in WATCH button, not icon libraries. Hide from screen readers with both `accessibilityElementsHidden` (iOS) and `importantForAccessibility="no-hide-descendants"` (Android) (see `docs/solutions/mobile/decorative-icon-view-text-pattern.md`)

### Accessibility

#### Research Insights

- **Gradient contrast**: Increase max gradient opacity from 0.7 to **0.85** for WCAG AA compliance. White text (#fff) over 0.7 black overlay on a white image yields ~4.6:1 — barely passing. At 0.85 opacity, worst-case contrast is ~7:1 (AAA compliant).
- **Text shadow as secondary contrast**: Add `textShadowColor: 'rgba(0,0,0,0.8)', textShadowOffset: {width: 0, height: 1}, textShadowRadius: 3` for extra readability insurance.
- **VoiceOver/TalkBack structure**: Group each card as a single accessible element via `accessibilityLabel={`${categoryLabel ?? ""} ${title}`.trim()}` on the `Pressable`. Mark the Image and badge as decorative (`accessible={false}`).
- **ScrollView adjustable role**: Add `accessibilityRole="adjustable"` to the ScrollView when snap behavior is added — matching the `NavigationCarouselRenderer` pattern.
- **Touch targets**: Cards at ~180x135pt far exceed the 44pt minimum.
- **Decorative images**: Mark with `accessible={false}`, `accessibilityElementsHidden={true}`, `importantForAccessibility="no-hide-descendants"`.

### Platform-Specific Considerations

#### Android

- **`android_ripple` regression in RN 0.80+**: The default `foreground: false` is broken ([GitHub #52939](https://github.com/facebook/react-native/issues/52939)). Use `foreground: true` — actually ideal for image cards since the ripple overlays content.
- **Overdraw**: Reduce layers by applying `backgroundColor` on card container directly (not a separate View). Target: 3 layers max (container+image, gradient, text).
- **`snapToInterval` is horizontal-only on Android** — our carousel is horizontal, so no issue.

#### iOS

- **Opacity feedback**: Use `style={({ pressed }) => [styles.card, pressed && Platform.OS === 'ios' && { opacity: 0.8 }]}` for press feedback since `android_ripple` doesn't apply on iOS.

## Acceptance Criteria

- [ ] Carousel cards display at 4:3 aspect ratio with responsive width (`screenWidth * 0.48`, capped at 280pt)
- [ ] Cards show full-bleed background image from `imageOverride` or `video.image`
- [ ] Bottom gradient overlay with 0.85 max opacity makes overlaid text readable on any image (WCAG AA)
- [ ] Category label (from section `categoryLabel`) appears at bottom-left of each card, uppercase, small font
- [ ] Title appears below category label at bottom-left of each card, bold, white
- [ ] Chapter count badge (from `collectionSize`) appears at top-right of each card with semi-transparent background
- [ ] Play icon removed from individual carousel cards
- [ ] "WATCH" button with play icon triangle appears in section header, linking to `https://www.jesusfilm.org/watch`
- [ ] Snap-to-scroll behavior works smoothly with `snapToInterval`, `decelerationRate="fast"`, `disableIntervalMomentum`
- [ ] No-image cards render with solid dark background (`#1a1a1a`) and readable text
- [ ] `hexToRgba` extracted into shared `apps/mobile/src/lib/color.ts` utility
- [ ] `NavigationCarouselRenderer` updated to use shared `hexToRgba` (fixing transparent bug)
- [ ] `BibleQuotesCarouselRenderer` updated to import from shared utility
- [ ] Typography uses `useTypography()` hook throughout
- [ ] Works on both iOS and Android (test `android_ripple` with `foreground: true`)
- [ ] Cards grouped as single accessible elements with descriptive `accessibilityLabel`
- [ ] Images and badges marked as decorative for screen readers
- [ ] Tests updated for new card structure (smoke test + carousel variant rendering)

## MVP Implementation

### Step 1: Extract shared `hexToRgba` utility

#### `apps/mobile/src/lib/color.ts`

```typescript
/**
 * Convert hex color to rgba string.
 * Use this instead of "transparent" in LinearGradient to avoid dark banding.
 * See: docs/solutions/mobile/linear-gradient-dark-banding-transparent-keyword.md
 */
export function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}
```

Update `BibleQuotesCarouselRenderer.tsx` and `NavigationCarouselRenderer.tsx` to import from this shared utility. Fix the `"transparent"` bug in `NavigationCarouselRenderer` at the same time.

### Step 2: Create `OverlayMediaCard` and restyle carousel in `MediaCollectionRenderer.tsx`

```tsx
// Module-level constants (matching codebase convention)
const CARD_GAP = 12
const HORIZONTAL_PADDING = 24
const CARD_ASPECT_RATIO = 4 / 3

// Pre-computed gradient constants (avoid re-creation per render)
const GRADIENT_COLORS = [hexToRgba("#000000", 0), "rgba(0,0,0,0.85)"] as const
const GRADIENT_LOCATIONS = [0, 0.55] as const

// File-private overlay card component (following QuoteCard pattern)
const OverlayMediaCard = React.memo(function OverlayMediaCard({
  item,
  cardWidth,
  categoryLabel,
  typography,
  onPress,
}: {
  item: MediaCollectionItem
  cardWidth: number
  categoryLabel: string | null
  typography: TypographyScale
  onPress?: () => void
}) {
  const title = item.titleOverride ?? item.video?.title ?? "Untitled"
  const thumbnailUrl = item.imageOverride?.url ?? item.video?.image?.url ?? null

  return (
    <Pressable
      style={({ pressed }) => [
        styles.overlayCard,
        { width: cardWidth },
        pressed && Platform.OS === "ios" && { opacity: 0.8 },
      ]}
      android_ripple={{ color: "rgba(255,255,255,0.3)", foreground: true }}
      onPress={onPress}
      accessibilityLabel={`${categoryLabel ?? ""} ${title}`.trim()}
      accessibilityHint="Opens this video"
    >
      <View
        style={[styles.overlayCardImage, { aspectRatio: CARD_ASPECT_RATIO }]}
      >
        {/* Background image or dark fallback */}
        {thumbnailUrl ? (
          <Image
            source={{ uri: thumbnailUrl }}
            style={StyleSheet.absoluteFillObject}
            resizeMode="cover"
            accessible={false}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
        ) : null}

        {/* Gradient overlay — bottom 60%, 0.85 max opacity for WCAG AA */}
        <LinearGradient
          colors={GRADIENT_COLORS}
          locations={GRADIENT_LOCATIONS}
          style={styles.overlayCardGradient}
          pointerEvents="none"
        />

        {/* Chapter count badge — top right */}
        {item.collectionSize != null && (
          <View
            style={styles.overlayBadge}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            <Text style={[styles.overlayBadgeText, typography.caption]}>
              {item.collectionSize}
            </Text>
          </View>
        )}

        {/* Category + Title — bottom left */}
        <View style={styles.overlayTextContainer}>
          {categoryLabel != null && (
            <Text style={[styles.overlayCategoryLabel, typography.caption]}>
              {categoryLabel}
            </Text>
          )}
          <Text
            style={[styles.overlayTitle, typography.titleSmall]}
            numberOfLines={2}
          >
            {title}
          </Text>
        </View>
      </View>
    </Pressable>
  )
})
```

### Step 3: Add WATCH button to section header

```tsx
// WATCH button links to https://www.jesusfilm.org/watch (hardcoded, not CMS-driven)
// Uses View+Text Unicode pattern for play icon (no icon library)
<Pressable
  style={styles.watchButton}
  onPress={() => Linking.openURL("https://www.jesusfilm.org/watch")}
  accessibilityLabel="Watch"
  accessibilityRole="link"
>
  <View
    style={styles.watchButtonIconContainer}
    accessibilityElementsHidden
    importantForAccessibility="no-hide-descendants"
  >
    <Text style={styles.watchButtonIcon}>▶</Text>
  </View>
  <Text style={[styles.watchButtonText, typography.bodySmall]}>WATCH</Text>
</Pressable>
```

### Step 4: Add snap-to-scroll behavior

```tsx
<ScrollView
  horizontal
  showsHorizontalScrollIndicator={false}
  snapToInterval={cardWidth + CARD_GAP}
  snapToAlignment="start"
  decelerationRate="fast"
  disableIntervalMomentum
  accessibilityRole="adjustable"
  contentContainerStyle={{
    paddingHorizontal: HORIZONTAL_PADDING,
    gap: CARD_GAP,
  }}
>
  {items.slice(0, 25).map((item, index) => (
    <OverlayMediaCard
      key={`mediaCollection-${item.id}-${index}`}
      item={item}
      cardWidth={cardWidth}
      categoryLabel={categoryLabel}
      typography={typography}
      onPress={() => handleItemPress(item)}
    />
  ))}
</ScrollView>
```

### Step 5: StyleSheet additions

```typescript
const styles = StyleSheet.create({
  overlayCard: {
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#1a1a1a", // Dark fallback — directly on container to reduce Android overdraw
  },
  overlayCardImage: {
    width: "100%",
    borderRadius: 12,
    overflow: "hidden",
  },
  overlayCardGradient: {
    ...StyleSheet.absoluteFillObject,
    top: "40%", // Gradient covers bottom 60% of card
  },
  overlayBadge: {
    position: "absolute",
    top: 10,
    right: 10,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  overlayBadgeText: {
    color: "#FFFFFF",
    fontWeight: "600",
  },
  overlayTextContainer: {
    position: "absolute",
    bottom: 12,
    left: 12,
    right: 12,
  },
  overlayCategoryLabel: {
    color: "rgba(255, 255, 255, 0.95)", // Near-full opacity for contrast
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 2,
    textShadowColor: "rgba(0, 0, 0, 0.8)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  overlayTitle: {
    color: "#FFFFFF",
    fontWeight: "700",
    textShadowColor: "rgba(0, 0, 0, 0.8)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  watchButton: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.5)",
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    alignSelf: "flex-start",
  },
  watchButtonIconContainer: {
    marginRight: 6,
  },
  watchButtonIcon: {
    color: "#FFFFFF",
    fontSize: 10,
  },
  watchButtonText: {
    color: "#FFFFFF",
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
})
```

## Dependencies & Risks

- **`expo-linear-gradient`** — already a dependency (used in `NavigationCarouselRenderer` and `BibleQuotesCarouselRenderer`)
- **No data model changes** — uses existing fields (`categoryLabel`, `collectionSize`, `imageOverride`, `video.image`, `titleOverride`)
- **Optional: `expo-image`** — available in SDK 54, recommended but can ship with RN `Image` first and migrate later
- **Risk: CMS content gaps** — some items may lack images. Mitigated by dark fallback background on container.
- **Risk: Long titles overflow** — mitigated with `numberOfLines={2}` truncation within gradient zone
- **Risk: Light images reduce text contrast** — mitigated by 0.85 opacity gradient + text shadow
- **Risk: Android ripple regression** — mitigated by `foreground: true` workaround (RN 0.80+ bug)

## Sources & References

### Internal References

- Pattern reference: [NavigationCarouselRenderer.tsx](apps/mobile/src/components/sections/NavigationCarouselRenderer.tsx) — closest existing pattern (bg image + gradient + overlaid text)
- Pattern reference: [BibleQuotesCarouselRenderer.tsx](apps/mobile/src/components/sections/BibleQuotesCarouselRenderer.tsx) — `hexToRgba` source, gradient best practice, `QuoteCard` component pattern
- Target component: [MediaCollectionRenderer.tsx](apps/mobile/src/components/sections/MediaCollectionRenderer.tsx) — component to modify
- Data models: [sectionModels.ts](apps/mobile/src/lib/sectionModels.ts) — `MediaCollectionItem` and `MediaCollectionSection` interfaces

### Documented Learnings Applied

- [LinearGradient dark banding](docs/solutions/mobile/linear-gradient-dark-banding-transparent-keyword.md) — never use `"transparent"` keyword
- [Responsive typography hook](docs/solutions/mobile/responsive-typography-hook.md) — `useTypography()` for all text
- [Decorative icon pattern](docs/solutions/mobile/decorative-icon-view-text-pattern.md) — View+Text Unicode, hide from screen readers
- [Translucent section backgrounds](docs/solutions/mobile/translucent-section-backgrounds-with-react-context.md) — hero context check, no elevation on Android
- [Full-bleed video hero](docs/solutions/mobile/full-bleed-video-hero-with-scroll-over-content.md) — `useWindowDimensions()` not `Dimensions.get()`

### External References

- [Expo Image documentation](https://docs.expo.dev/versions/latest/sdk/image/)
- [Expo LinearGradient documentation](https://docs.expo.dev/versions/latest/sdk/linear-gradient/)
- [React Native ScrollView snap props](https://reactnative.dev/docs/scrollview)
- [RN 0.80+ android_ripple regression — GitHub #52939](https://github.com/facebook/react-native/issues/52939)
- [WCAG 2.2 Contrast (Minimum)](https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html)
