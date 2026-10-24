---
title: "Hero mute button hybrid overlay touch target pattern"
category: "mobile"
severity: "medium"
date: "2026-04-08"
tags:
  - mobile-v2
  - react-native
  - expo
  - hero-video
  - z-order
  - touch-targeting
  - measureLayout
  - flashlist
  - android
related_issues: []
components:
  - VideoHeroRenderer
  - CuratedHomeLayout
  - SectionWrapperRenderer
last_updated: "2026-06-11"
---

## Problem

The mobile-v2 home feed uses a three-layer architecture: a video hero (zIndex 0) absolutely positioned behind a FlashList (default z), with an interactive overlay (zIndex 2) for touch targets. Several visual and interaction issues surfaced:

1. **Mute button untappable**: The mute button was inside the hero layer (zIndex 0), behind the FlashList. FlashList/ScrollView intercepts ALL touches within its frame — including padding areas — so the button was unreachable.
2. **Overlay button wrong z-order**: Moving the button to the overlay layer (zIndex 2) made it tappable but it floated visually above the scrollable feed content instead of being covered by it.
3. **Solid section backgrounds**: `SectionWrapperRenderer` applied solid colored backgrounds (purple, cosmic, blue) from a CMS field, clashing with the translucent feed-over-hero design.
4. **Back button showing "(tabs)"**: Expo Router used the group route name as the default back button label.
5. **CTA rendering with empty ctaLink**: The CTA validation only checked `!= null`, so empty strings from the CMS passed.

## Root Cause

- **Touch interception**: FlashList (built on ScrollView) captures all touches within its measured frame for scroll gesture detection. `pointerEvents` only affects React's hit testing within a single view hierarchy — it cannot pass touches through to sibling view hierarchies (hero layer behind FlashList).
- **Visual z-order vs touch z-order**: An absolutely-positioned overlay with zIndex 2 receives touches correctly but doesn't scroll with the FlashList content, staying visible when it should be covered.
- **CMS field handling**: Strapi serializes optional fields as empty strings `""` rather than `null`, bypassing nullish checks.

## Investigation Steps

1. Placed mute button inside hero layer → untappable (FlashList intercepts)
2. Moved button to overlay layer (zIndex 2) → tappable but floats above feed
3. Added scroll-driven opacity fade to overlay → fades but still visually "on top" during transition
4. Tried `headerBackTitle: " "` on source screen → did not work for Expo Router group routes
5. Tried `headerBackTitle` on destination screen → also ineffective

## Solution

> **Scope (2026-06-11):** This hybrid measureLayout pattern is only valid for **non-paged** heroes (a single hero, as in CuratedHomeLayout). Inside a paged FlatList, `measureLayout` rects are page-relative — they include the `index * screenWidth` offset — so the invisible overlay target drifts off-screen on any slide past index 0. Paged heroes render visible chrome directly in the touch overlay instead; see [paged-hero-overlay-chrome-touch-architecture.md](../ui-bugs/paged-hero-overlay-chrome-touch-architecture.md).

### Hybrid rendering pattern for mute button

Render the button in TWO places simultaneously:

**Visual button** — a plain `<View>` (not Pressable) inside the hero layer, in a flex row with the heading text. Gets naturally covered by the scrolling feed.

```typescript
// VideoHeroRenderer.tsx — visual only, no touch handling
<View style={styles.headingRow}>
  <Text style={[styles.heading, typography.display]}>{heading}</Text>
  {hasValidStream && onMuteToggle != null && (
    <View
      ref={muteButtonRef}
      onLayout={handleMuteButtonLayout}
      style={styles.muteButton}
    >
      <Text style={styles.muteIcon}>
        {mutedProp ? "\uD83D\uDD07" : "\uD83D\uDD0A"}
      </Text>
    </View>
  )}
</View>
```

**Invisible touch target** — a transparent `<Pressable>` in the overlay layer (zIndex 2), positioned via `measureLayout` to match the visual button exactly.

```typescript
// CuratedHomeLayout.tsx — touch handling only, no visuals
<View
  style={[styles.heroInteractiveLayer, { height: heroHeight }]}
  pointerEvents="box-none"
>
  {muteButtonRect != null && (
    <Pressable
      style={{
        position: "absolute",
        left: muteButtonRect.x,
        top: muteButtonRect.y,
        width: muteButtonRect.w,
        height: muteButtonRect.h,
      }}
      onPress={handleMuteToggle}
      accessibilityLabel={muted ? "Unmute video" : "Mute video"}
      accessibilityRole="button"
    />
  )}
</View>
```

**Position syncing** — `measureLayout` reports the visual button's coordinates relative to the hero container:

```typescript
// VideoHeroRenderer.tsx
const handleMuteButtonLayout = useCallback(() => {
  if (onMuteButtonLayout && containerRef.current && muteButtonRef.current) {
    muteButtonRef.current.measureLayout(
      containerRef.current,
      (x, y, w, h) => onMuteButtonLayout(x, y, w, h),
      () => {
        if (__DEV__)
          console.warn(
            "[VideoHeroRenderer] measureLayout failed for mute button",
          )
      },
    )
  }
}, [onMuteButtonLayout])
```

**Mute state lifted** to `CuratedHomeLayout` (controlled component pattern) so both the hero renderer and the overlay can access it. The hero syncs the prop to the native player via `useEffect`:

```typescript
useEffect(() => {
  player.muted = mutedProp
}, [mutedProp, player])
```

### Other fixes

- **Section backgrounds removed**: Deleted `BACKGROUND_COLORS` map from `SectionWrapperRenderer`. All sections now inherit the uniform `feedItemBackground` (`hexToRgba(BG_COLOR, 0.9)`).
- **Feed opacity increased**: 0.8 → 0.9 for both `feedItemBackground` and the feather gradient.
- **Custom back button**: `headerLeft` with Ionicons `chevron-back` and `router.back()` replaces the native back button.
- **CTA validation**: `ctaLabel != null && ctaLabel !== "" && ctaLink != null && ctaLink !== ""`.

## Prevention Strategies

### Touch targeting over scroll views

- **Never place tappable elements behind a ScrollView/FlashList** expecting them to receive touches. The scroll container captures all touches in its frame.
- **`pointerEvents="box-none"` does not cross view hierarchies.** It only affects hit testing within parent-child relationships, not between sibling views.
- **Use the hybrid pattern (non-paged heroes only)**: visual element in the correct z-layer + invisible touch target in a higher overlay. Sync positions via `measureLayout`. For paged heroes, render visible chrome directly in the overlay instead — measured rects carry the page offset.
- **Always test on Android**: `VideoView` renders on top of all RN views regardless of zIndex. The overlay pattern may behave differently.

### CMS field validation

- **Always check for empty strings** in addition to null when consuming CMS fields. Strapi serializes optional fields as `""` not `null`.
- Pattern: `field != null && field !== ""` or use `.trim()` before the check.

### Expo Router back button

- **`headerBackTitle` does not work reliably for group routes** like `(tabs)`. Use a custom `headerLeft` component instead.

## Key Files

- `apps/mobile-v2/src/components/sections/CuratedHomeLayout.tsx` — three-layer orchestrator, mute state owner
- `apps/mobile-v2/src/components/sections/VideoHeroRenderer.tsx` — visual mute button, measureLayout reporting
- `apps/mobile-v2/src/components/sections/SectionWrapperRenderer.tsx` — simplified container (no bg colors)
- `apps/mobile-v2/app/_layout.tsx` — custom back button
- `apps/mobile-v2/CLAUDE.md` — three-layer hero documentation

## Related Documentation

- [Paged hero overlay chrome touch architecture](../ui-bugs/paged-hero-overlay-chrome-touch-architecture.md) — the paged-hero variant; why this measureLayout pattern breaks on paged content
- [FlashList hero bleed-through feed background](flashlist-hero-bleed-through-feed-background.md) — the translucent feed wrapper pattern this builds on
- [FlashList opaque background hides absolute hero](flashlist-opaque-background-hides-absolute-hero.md) — why `contentContainerStyle` bg must stay transparent
- [Full-bleed video hero with scroll-over content](full-bleed-video-hero-with-scroll-over-content.md) — foundational two-layer architecture (now three layers)
- [ScrollView touch event z-index fix](react-native-scrollview-touch-event-z-index-fix.md) — why zIndex siblings don't reliably receive touches
- [LinearGradient dark banding](linear-gradient-dark-banding-transparent-keyword.md) — always use `hexToRgba()` not `"transparent"`
- [Translucent section backgrounds with React Context](translucent-section-backgrounds-with-react-context.md) — single-wrapper-no-gaps principle
