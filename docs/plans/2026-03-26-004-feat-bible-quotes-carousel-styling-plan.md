---
title: "feat: Style Bible Quotes carousel with square cards, reordered labels, and imageUrl backgrounds"
type: feat
status: completed
date: 2026-03-26
deepened: 2026-03-26
---

# feat: Style Bible Quotes carousel with square cards, reordered labels, and imageUrl backgrounds

## Enhancement Summary

**Deepened on:** 2026-03-26
**Agents used:** TypeScript reviewer, Performance oracle, Pattern recognition, Code simplicity, Frontend races, Architecture strategist, Best practices researcher, Framework docs researcher, Learnings researcher

### Key Improvements

1. **Simplified fallback chain** — drop `backgroundImage`, use only `imageUrl` + `backgroundColor` (matches web, eliminates YAGNI)
2. **Scroll performance fix** — replace continuous `onScroll` with `onMomentumScrollEnd` for pagination dots
3. **Pre-existing snap bug** — `snapToInterval` misaligns with `paddingHorizontal`; switch to `snapToOffsets`
4. **Accessibility gaps** — add `accessibilityActions` (increment/decrement) and hide pagination dots from screen readers
5. **Consistent rendering pattern** — adopt NavigationCarousel's layered `Image` + overlay approach instead of `ImageBackground`

### New Considerations Discovered

- `snapToInterval` has a float-width bug on iOS (RN issue #48393) — use `Math.round()` on snap offsets
- Android `borderRadius` + `overflow: hidden` clipping issues still present in RN 0.81.x — keep dual `borderRadius` on container + image
- `expo-image` is a strong future migration candidate (disk caching, transitions, native `borderRadius`) but not required for this PR
- Existing `BibleQuotesCarouselRenderer` had stale-dimensions bug (already fixed with `useWindowDimensions()`) — do not reintroduce

---

## Overview

The mobile Bible Quotes carousel needs visual styling to match the reference website design. Three changes are needed: square card shape, reference label moved above the quote text, and background images rendered from the `imageUrl` string field (instead of the current `backgroundImage` media upload).

The web app ([BibleQuotesCarousel.tsx](apps/web/src/components/sections/BibleQuotesCarousel.tsx)) already implements this target design and serves as the reference implementation.

## Problem Statement

The current mobile carousel cards are:

- **Rectangular** (`minHeight: 200`) instead of square
- **Reference label below** the quote text (should be above)
- **Missing `imageUrl`** — the GraphQL query fetches `backgroundImage` (media upload) but not the `imageUrl` string field or `backgroundColor` field that the CMS provides and the web app uses

## Proposed Solution

### 1. Add `imageUrl` and `backgroundColor` to the data pipeline

**GraphQL query** ([queries.ts](apps/mobile/src/lib/graphql/queries.ts)):
Add `imageUrl` and `backgroundColor` fields to ALL occurrences of the `ComponentSectionsBibleQuotesCarousel` fragment (lines ~142, ~313, ~440, ~570 — 4 locations).

```graphql
... on ComponentSectionsBibleQuotesCarousel {
  id
  sectionKey
  carouselHeading: heading
  quotes {
    id
    reference
    text
    attribution
    ctaLabel
    ctaLink
    imageUrl          # NEW
    backgroundColor   # NEW
    backgroundImage {
      url
      alternativeText
    }
  }
}
```

> **Note:** `backgroundImage` is retained for backward compatibility during CMS content migration. See Research Insights below for deprecation plan.

**Model** ([sectionModels.ts](apps/mobile/src/lib/sectionModels.ts)):
Add to `BibleQuoteItem`:

```typescript
export interface BibleQuoteItem {
  id: string
  reference: string
  text: string
  /** @deprecated Use imageUrl instead. Retained as fallback during CMS content migration. */
  backgroundImage: UploadFileModel | null
  imageUrl: string | null // NEW
  backgroundColor: string | null // NEW
  ctaLabel: string | null
  ctaLink: string | null
  attribution: string | null
}
```

**Mapper** ([sectionMapper.ts](apps/mobile/src/lib/sectionMapper.ts)):
Map the new fields in `mapBibleQuotesCarousel`:

```typescript
imageUrl: q.imageUrl ?? null,
backgroundColor: q.backgroundColor ?? null,
```

#### Research Insights — Data Pipeline

**Simplicity (Code Simplicity Reviewer):**

- The web app uses only `imageUrl` + `backgroundColor` — no `backgroundImage`. The mobile app should converge toward this.
- The triple fallback chain (`imageUrl` → `backgroundImage.url` → solid color) adds an untested code path. Prefer the simpler two-layer approach: `imageUrl` over `backgroundColor`.
- **Decision:** Keep `backgroundImage` in the query for now (backward compat) but mark as `@deprecated`. The renderer should prefer `imageUrl` and fall back to `backgroundImage.url` only temporarily. Remove `backgroundImage` from the query once all CMS content is migrated to `imageUrl`.

**Architecture (Architecture Strategist):**

- The 4x query duplication is pre-existing debt. Do not fix it in this PR — extract a shared fragment string as a follow-up task.
- The data layer change (query + model + mapper) is proportionate and follows the exact pattern used by `NavigationCarouselItem`.
- No schema modification or codegen step needed (mobile does not use `gql.tada`).

**TypeScript (TypeScript Reviewer):**

- Extract the fallback color to a named constant: `const CARD_FALLBACK_COLOR = '#1A1815'` — the current code has two different hardcoded fallbacks (`#2d1b4e` in `cardFallback` and `#1A1815` from the web). Unify to one constant.
- The accessibility label should explicitly use `reference` as alt text for `imageUrl`-sourced images (since `imageUrl` has no associated alt text field).

### 2. Style the QuoteCard component

**Square shape**: Replace `minHeight: 200` with `aspectRatio: 1` on the `card` style.

**Reorder labels**: Move reference above quote text in the JSX:

```tsx
<View style={styles.cardOverlay}>
  {/* Attribution FIRST (e.g., "APOSTLE PAUL:") */}
  {attribution != null && (
    <Text style={[styles.attribution, typography.caption]}>{attribution}</Text>
  )}
  {/* Reference SECOND (e.g., "1 Corinthians 15:55-57") */}
  <Text style={[styles.reference, typography.bodySmall]}>{reference}</Text>
  {/* Quote text LAST */}
  <Text style={[styles.quoteText, typography.body]} numberOfLines={8}>
    {text}
  </Text>
  {/* CTA button after quote */}
</View>
```

**Image rendering priority chain**:

1. `imageUrl` (string URL) — primary source
2. `backgroundImage.url` (media upload) — deprecated fallback
3. `backgroundColor` or `CARD_FALLBACK_COLOR` (`#1A1815`)

#### Research Insights — Card Layout

**`aspectRatio: 1` behavior (Framework Docs):**

- Safe to use with explicit `width` set on the parent — this is the existing pattern in `MediaCollectionRenderer` and `VideoRenderer`.
- Inside a horizontal `ScrollView`, items need an explicit `width`; `aspectRatio` alone would collapse. The current `{ width: cardWidth }` inline style satisfies this requirement.
- Use `Math.round(cardWidth)` to avoid the iOS float-width snap bug (RN issue #48393).

**Pattern consistency (Pattern Recognition):**

- The `letterSpacing` pattern (`0.8` to `2.0`) is established in the codebase for category/label text (`NavigationCarouselRenderer`, `MediaCollectionRenderer`, `VideoHeroRenderer`).
- However, `textTransform: 'uppercase'` on Bible references changes "Luke 8:2" to "LUKE 8:2". Verify this matches the design intent. The web uses uppercase for the reference. If confirmed, use `.toUpperCase()` in code rather than `textTransform` for consistency with `NavigationCarouselRenderer`'s approach.

### 3. Updated QuoteCard rendering — adopt layered pattern

Align with `NavigationCarouselRenderer`'s established layered approach instead of using `ImageBackground`:

```tsx
const CARD_FALLBACK_COLOR = "#1A1815"

function QuoteCard({
  quote,
  cardWidth,
  typography,
  onNavigate,
}: QuoteCardProps) {
  const {
    text,
    reference,
    attribution,
    imageUrl,
    backgroundImage,
    backgroundColor,
    ctaLabel,
    ctaLink,
  } = quote
  const imageUri = imageUrl ?? backgroundImage?.url ?? null
  const bgColor = backgroundColor ?? CARD_FALLBACK_COLOR

  const cardContent = (
    <View style={styles.cardOverlay}>
      {attribution != null && (
        <Text style={[styles.attribution, typography.caption]}>
          {attribution}
        </Text>
      )}
      <Text style={[styles.reference, typography.bodySmall]}>{reference}</Text>
      <Text style={[styles.quoteText, typography.body]} numberOfLines={8}>
        {text}
      </Text>
      {ctaLabel != null && ctaLink != null && (
        <Pressable
          style={({ pressed }) => [
            styles.ctaButton,
            pressed && styles.ctaButtonPressed,
          ]}
          onPress={() => onNavigate(ctaLink)}
          accessibilityRole="link"
          accessibilityLabel={ctaLabel}
        >
          <Text style={[styles.ctaText, typography.bodySmall]}>{ctaLabel}</Text>
        </Pressable>
      )}
    </View>
  )

  return (
    <View
      style={[
        styles.card,
        { width: Math.round(cardWidth), backgroundColor: bgColor },
      ]}
      accessible={true}
      accessibilityLabel={`${reference}: ${text}`}
    >
      {imageUri != null && (
        <Image
          source={{ uri: imageUri, cache: "force-cache" }}
          style={[StyleSheet.absoluteFill, styles.cardImage]}
          resizeMode="cover"
          accessibilityLabel={backgroundImage?.alternativeText ?? reference}
        />
      )}
      {cardContent}
    </View>
  )
}
```

#### Research Insights — Rendering

**Pattern consistency (Pattern Recognition):**

- `NavigationCarouselRenderer` uses layered `View` + `Image` (absoluteFill) + overlay — not `ImageBackground`. Adopting this pattern aligns the two carousel components.
- This approach also separates the image from the content more cleanly, making it easier to add loading states or transitions later.

**Performance (Performance Oracle):**

- Add `cache: 'force-cache'` to image sources to improve caching on iOS.
- Square cards at 3x resolution = ~4.2MB decoded bitmap per card. For 5 cards in a `ScrollView` = ~21MB total. Acceptable but worth monitoring.
- Future optimization: migrate to `expo-image` for disk caching, blurhash placeholders, and native `borderRadius` handling.

**Cross-platform (Best Practices Researcher):**

- Keep dual `borderRadius` (container + image) for Android compatibility — RN 0.81.x still has clipping issues.
- Set `elevation: 0` explicitly if the card ever inherits elevation from a parent style.
- `expo-image` would bypass all Android `overflow: hidden` clipping bugs via native rendering, but is not required for this PR.

## Technical Considerations

- **4 query locations**: The Bible quotes fragment appears 4 times in `queries.ts` (top-level blocks, Container slot content, Section wrapper content, and nested Section content). All must be updated.
- **Android `elevation`**: Per compound learning, avoid `elevation` on cards inside hero layouts. The current card has no explicit elevation — keep it that way.
- **`borderRadius` + `overflow: hidden`**: May show aliasing on Android. Keep `borderRadius` on both the container and `imageStyle` (existing workaround). On Android, `overflow: hidden` clipping bugs are still present in RN 0.81.x (issues #20278, #29265, #50029).
- **Memory**: Square cards at 3x resolution (~1026x1026 pixels) use ~71% more memory per card than the current 342x200 cards. Acceptable for the typical 3-5 card carousel.
- **`numberOfLines`**: Increase from 6 to 8 since square cards have more vertical space.
- **No new dependencies**: Uses existing `Image` from React Native with layered rendering. No `expo-linear-gradient` or `expo-image` needed for this PR.
- **`Math.round()`**: Apply to `cardWidth` and snap offsets to avoid iOS float-width snap bug (RN #48393) and Android sub-pixel blur (per responsive typography compound learning).

### Scroll Performance Optimization

**Problem (Performance Oracle + Frontend Races Reviewer):**
The current `onScroll` handler fires every 16ms (60fps) and calls `setActiveIndex`, causing a React re-render on every frame where the index changes. During a fast swipe, the dot flickers through intermediate positions.

**Solution:** Replace continuous `onScroll` with `onMomentumScrollEnd`:

```tsx
const handleMomentumScrollEnd = useCallback(
  (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offsetX = e.nativeEvent.contentOffset.x
    const index = Math.round(offsetX / snapInterval)
    setActiveIndex(Math.min(Math.max(index, 0), quotes.length - 1))
  },
  [quotes.length, snapInterval],
)
```

This reduces re-renders from ~30-60 per swipe to exactly 1.

### Fix Pre-Existing Snap Misalignment

**Problem (Frontend Races Reviewer):**
`snapToInterval` snaps to multiples from offset 0, but `contentContainerStyle` uses `paddingHorizontal: 24`. The first card is correct, but subsequent cards are misaligned by the padding offset. This becomes more visually noticeable with taller square cards.

**Solution:** Switch to `snapToOffsets` for precise snap positions:

```tsx
const snapOffsets = quotes.map((_, i) => i * (cardWidth + CARD_GAP))

<ScrollView
  horizontal
  snapToOffsets={snapOffsets}
  // remove snapToInterval
  decelerationRate="fast"
  disableIntervalMomentum  // prevents skipping cards on fast swipe (matches NavigationCarousel)
  onMomentumScrollEnd={handleMomentumScrollEnd}
  // remove onScroll and scrollEventThrottle
>
```

### Orientation Change Race Condition

**Problem (Frontend Races Reviewer):**
During orientation change, the `onScroll` handler can fire with a stale `snapInterval` from the previous render, causing the pagination dot to briefly show the wrong index.

**Solution:** Using `onMomentumScrollEnd` (above) largely mitigates this — it fires after layout settles. Additionally, `snapToOffsets` is recalculated on re-render since it depends on `cardWidth` from `useWindowDimensions()`.

## Accessibility Improvements

**Current gaps (Framework Docs + Best Practices):**

1. No `accessibilityActions` for screen reader carousel navigation
2. Pagination dots are focusable but provide no useful information to screen readers
3. Individual cards lack composite accessibility labels

**Additions:**

```tsx
// ScrollView — add increment/decrement actions
<ScrollView
  horizontal
  accessible={true}
  accessibilityRole="adjustable"
  accessibilityLabel={`${quotes.length} Bible quotes`}
  accessibilityValue={{ text: `Item ${activeIndex + 1} of ${quotes.length}` }}
  accessibilityActions={[
    { name: 'increment', label: 'Next quote' },
    { name: 'decrement', label: 'Previous quote' },
  ]}
  onAccessibilityAction={(event) => {
    switch (event.nativeEvent.actionName) {
      case 'increment':
        scrollToIndex(Math.min(activeIndex + 1, quotes.length - 1))
        break
      case 'decrement':
        scrollToIndex(Math.max(activeIndex - 1, 0))
        break
    }
  }}
>

// PaginationDots — hide from screen readers
<View
  style={styles.dotsContainer}
  accessibilityElementsHidden={true}
  importantForAccessibility="no-hide-descendants"
>
```

This requires adding a `scrollRef` and `scrollToIndex` helper:

```tsx
const scrollRef = useRef<ScrollView>(null)
const scrollToIndex = (index: number) => {
  scrollRef.current?.scrollTo({
    x: index * (cardWidth + CARD_GAP),
    animated: true,
  })
}
```

## Acceptance Criteria

- [ ] Carousel cards are square (aspect ratio 1:1)
- [ ] Reference label appears above the quote body text
- [ ] Attribution (e.g., "APOSTLE PAUL:") appears above the reference when present
- [ ] `imageUrl` field is fetched from GraphQL and rendered as background image
- [ ] `backgroundColor` field is fetched and used as card background color
- [ ] Fallback chain: `imageUrl` → `backgroundImage.url` → solid `backgroundColor`/`CARD_FALLBACK_COLOR`
- [ ] Cards render correctly inside hero layout (translucent background context)
- [ ] Works on both iOS and Android
- [ ] Existing tests updated with new fields; new test cases for `imageUrl`-only and no-image paths
- [ ] No `elevation` added to cards (Android transparency concern)
- [ ] `Math.round()` applied to `cardWidth` (iOS float-width bug, Android sub-pixel blur)
- [ ] Pagination uses `onMomentumScrollEnd` instead of continuous `onScroll`
- [ ] Snap positions use `snapToOffsets` instead of `snapToInterval`
- [ ] `disableIntervalMomentum` added to prevent card-skipping on fast swipe
- [ ] Pagination dots hidden from screen readers
- [ ] `accessibilityActions` (increment/decrement) added to ScrollView
- [ ] `backgroundImage` field marked `@deprecated` in model

## Files to Change

| File                                                                                                             | Change                                                                                    |
| ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| [queries.ts](apps/mobile/src/lib/graphql/queries.ts)                                                             | Add `imageUrl`, `backgroundColor` to 4 fragment locations                                 |
| [sectionModels.ts](apps/mobile/src/lib/sectionModels.ts)                                                         | Add `imageUrl`, `backgroundColor` to `BibleQuoteItem`; `@deprecated` on `backgroundImage` |
| [sectionMapper.ts](apps/mobile/src/lib/sectionMapper.ts)                                                         | Map `imageUrl`, `backgroundColor` in `mapBibleQuotesCarousel`                             |
| [BibleQuotesCarouselRenderer.tsx](apps/mobile/src/components/sections/BibleQuotesCarouselRenderer.tsx)           | Square shape, reorder labels, layered image rendering, scroll perf, accessibility         |
| [BibleQuotesCarouselRenderer.test.tsx](apps/mobile/src/components/sections/BibleQuotesCarouselRenderer.test.tsx) | Update fixtures, add test cases                                                           |

## MVP

### BibleQuotesCarouselRenderer.tsx — key style changes

```typescript
const CARD_FALLBACK_COLOR = "#1A1815"

const styles = StyleSheet.create({
  card: {
    aspectRatio: 1, // was: minHeight: 200
    borderRadius: 12,
    overflow: "hidden",
  },
  cardImage: {
    borderRadius: 12, // preserved for Android clipping compat
  },
  cardOverlay: {
    flex: 1,
    padding: 20,
    backgroundColor: "rgba(0, 0, 0, 0.45)",
    justifyContent: "flex-end",
  },
  attribution: {
    color: "rgba(255, 255, 255, 0.7)",
    marginBottom: 2,
  },
  reference: {
    fontWeight: "600",
    color: "rgba(255, 255, 255, 0.9)",
    textTransform: "uppercase",
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  quoteText: {
    fontStyle: "italic",
    color: "#ffffff",
    marginBottom: 12,
  },
})
```

## Follow-Up Tasks (Not This PR)

1. **Extract shared Bible quotes fragment** in `queries.ts` to eliminate 4x duplication
2. **Migrate to `expo-image`** for disk caching, blurhash placeholders, transitions, and native `borderRadius` handling
3. **Remove `backgroundImage`** from the query once all CMS content is migrated to `imageUrl`
4. **Evaluate mobile → `gql.tada` migration** for compile-time query safety

## Sources

- **Web reference implementation**: [BibleQuotesCarousel.tsx](apps/web/src/components/sections/BibleQuotesCarousel.tsx) — square cards with `aspect-square`, reference above quote, `imageUrl` + `backgroundColor`
- **Web GraphQL fragment**: [bible-quotes-carousel.ts](apps/web/src/lib/fragments/bible-quotes-carousel.ts) — fetches `imageUrl`, `backgroundColor`
- **CMS schema**: [bible-quote-item.json](apps/cms/src/components/sections/bible-quote-item.json) — has both `imageUrl` (string) and `backgroundImage` (media) fields
- **Codebase pattern**: [NavigationCarouselRenderer.tsx](apps/mobile/src/components/sections/NavigationCarouselRenderer.tsx) — layered `Image` + overlay pattern, `disableIntervalMomentum`, `imageUrl`/`backgroundColor` usage
- **Compound learning**: [translucent-section-backgrounds-with-react-context.md](docs/solutions/mobile/translucent-section-backgrounds-with-react-context.md) — avoid `elevation`, use `rgba()` backgrounds
- **Compound learning**: [responsive-typography-hook.md](docs/solutions/mobile/responsive-typography-hook.md) — use `useTypography()` tokens, `useWindowDimensions()`, `Math.round()`
- **RN issue #48393**: `snapToInterval` float-width bug on iOS — mitigate with `Math.round()` on offsets
- **RN issues #20278, #29265, #50029**: Android `borderRadius` + `overflow: hidden` clipping bugs — keep dual `borderRadius`
- **React Native AMA**: Carousel accessibility guidelines — `accessibilityActions`, `accessibilityValue`
