---
title: "feat: Add mobile navigation carousel with scroll-to-section"
type: feat
status: active
date: 2026-03-25
origin: docs/brainstorms/2026-03-25-mobile-navigation-carousel-requirements.md
---

# feat: Add mobile navigation carousel with scroll-to-section

## Enhancement Summary

**Deepened on:** 2026-03-25
**Sections enhanced:** 6
**Research agents used:** best-practices-researcher, architecture-strategist, performance-oracle, code-simplicity-reviewer, spec-flow-analyzer, pattern-recognition-specialist, context7-docs, learnings-researcher

### Key Improvements

1. Corrected GraphQL query to 2 nesting levels (not 3) — CMS schema excludes navigation carousel from Container slots
2. Added `requestAnimationFrame` guard before `scrollTo` to handle layout settling
3. Specified `expo-image` + `LinearGradient` for card images instead of bare `react-native` Image
4. Added accessibility requirements, empty-state handling, and edge case coverage
5. Identified offset staleness limitation with documented follow-up path

### New Considerations Discovered

- On Fabric (New Architecture), `scrollTo({ animated: true })` fires `onScroll` during animation — add a programmatic-scroll guard flag to prevent blur bracket interference
- `disableIntervalMomentum={true}` needed to prevent auto-drift on some Android devices
- `onLayout` Y-offset is only stale when a _sibling above_ changes height (the View's own `onLayout` doesn't fire in that case) — acceptable for v1, measure-on-demand is the follow-up

---

## Overview

Port the navigation carousel from web to mobile. The carousel renders inline as a horizontal scrollable strip of image cards. Tapping a card smooth-scrolls the page to the section whose `sectionKey` matches the card's `contentId`. The CMS data model and seed data already exist — this is purely a mobile renderer + scroll wiring task.

## Problem Statement / Motivation

The Easter experience page has a navigation carousel in the CMS and web app, but mobile users cannot quick-jump to sections. The data is seeded and served via GraphQL; the mobile app just needs to render it and wire up scroll-to-section (see origin: `docs/brainstorms/2026-03-25-mobile-navigation-carousel-requirements.md`).

## Proposed Solution

1. Add the `NavigationCarouselSection` type model and GraphQL query fields.
2. Build a `NavigationCarouselRenderer` following `BibleQuotesCarouselRenderer` patterns (horizontal `ScrollView` with snap).
3. Implement the currently-stubbed `SectionNavContext` by adding a `ScrollView` ref to `FixedHeroLayout` and measuring section Y-offsets via `onLayout`.

## Deferred Questions — Resolved

These were flagged as open in the origin document. Research resolved all three:

| Question                                                          | Resolution                                                                                                                                                                                                                                           |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Does `FixedHeroLayout` expose a ScrollView ref?                   | **No.** Both ScrollView instances (hero and no-hero paths) lack refs. Add `useRef<ScrollView>(null)` and pass to `SectionNavContext.Provider`.                                                                                                       |
| Does the mobile GraphQL query include navigation carousel fields? | **No.** `ComponentSectionsNavigationCarousel` is missing from `queries.ts`. Must be added at **2 nesting levels** (top-level blocks + Section wrapper content). Container slots do NOT support navigation carousel per `container-slot.json` schema. |
| Should section Y-offsets use `onLayout`?                          | **Yes.** `onLayout` gives `layout.y` relative to the parent container. Since section wrapper Views are direct children of the ScrollView, this value is exactly what `scrollTo({ y })` needs. Handles rotation/resize automatically.                 |

## Technical Approach

### File Change Map

| #   | File                                                                 | Change                                                                                                                                | New?    |
| --- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 1   | `apps/mobile/src/lib/sectionModels.ts`                               | Add `NavigationCarouselItem` type, `NavigationCarouselSection` type, add to `SectionContent` union                                    | No      |
| 2   | `apps/mobile/src/lib/graphql/queries.ts`                             | Add `ComponentSectionsNavigationCarousel` inline fragment at **2** nesting levels + `__typename` union                                | No      |
| 3   | `apps/mobile/src/lib/sectionMapper.ts`                               | Add `mapNavigationCarousel()`, wire into `mapContentItem()`, `mapSections()`, and `firstSectionTitle()`                               | No      |
| 4   | `apps/mobile/src/components/sections/FixedHeroLayout.tsx`            | Add `ScrollView` ref, wrap children in `SectionNavContext.Provider`, add `onLayout` to section wrappers for `sectionKey` registration | No      |
| 5   | `apps/mobile/src/components/sections/NavigationCarouselRenderer.tsx` | Horizontal snap-scroll carousel of nav cards; tap calls `scrollToSection(contentId)`                                                  | **Yes** |
| 6   | `apps/mobile/src/components/sections/SectionDispatcher.tsx`          | Add `"navigationCarousel"` case to both `SectionDispatcher` and `ContentDispatcher`                                                   | No      |

### Implementation Phases

#### Phase 1: Data Layer (types, query, mapper)

**`sectionModels.ts`** — Add types:

```typescript
// apps/mobile/src/lib/sectionModels.ts

type NavigationCarouselItem = {
  id: string
  contentId: string
  title: string
  category: string | null
  imageUrl: string | null
  backgroundColor: string | null
}

type NavigationCarouselSection = {
  kind: "navigationCarousel"
  id: string
  sectionKey: string | null
  items: NavigationCarouselItem[]
}
```

Add `NavigationCarouselSection` to the `SectionContent` union (which automatically includes it in `ExperienceSection`).

### Research Insights — Data Layer

**Pattern consistency (verified):** The naming follows all existing conventions exactly — `kind: "navigationCarousel"` (camelCase), PascalCase types with `Section`/`Item` suffixes, `__typename: "ComponentSectionsNavigationCarousel"` prefix. Consistent with `BibleQuotesCarouselSection`, `MediaCollectionSection`, etc.

**`queries.ts`** — Add inline fragment at **2 nesting levels** (not 3):

```graphql
... on ComponentSectionsNavigationCarousel {
  id
  sectionKey
  items {
    id
    contentId
    title
    category
    imageUrl
    backgroundColor
  }
}
```

Add at:

1. Top-level `blocks` dynamic zone (~line 63)
2. Inside `ComponentSectionsSection > sectionContent` (~line 329)

**Do NOT add to Container slot `slotContent`** — `container-slot.json` schema explicitly excludes `sections.navigation-carousel` from its components array. Adding it there is dead code.

Also add `"ComponentSectionsNavigationCarousel"` to the `WatchExperienceBlock.__typename` union type (~line 29).

**`sectionMapper.ts`** — Add mapper and wire into **three** switch statements:

```typescript
// apps/mobile/src/lib/sectionMapper.ts

function mapNavigationCarousel(
  raw: RawSection & { __typename: "ComponentSectionsNavigationCarousel" },
): NavigationCarouselSection {
  return {
    kind: "navigationCarousel",
    id: raw.id,
    sectionKey: raw.sectionKey ?? null,
    items: (raw.items ?? [])
      .filter((item: any): item is NonNullable<typeof item> => item != null)
      .map((item: any) => ({
        id: item.id,
        contentId: item.contentId,
        title: item.title,
        category: item.category ?? null,
        imageUrl: item.imageUrl ?? null,
        backgroundColor: item.backgroundColor ?? null,
      })),
  }
}
```

Wire into:

- `mapSections()` switch (~line 336): `case "ComponentSectionsNavigationCarousel": return mapNavigationCarousel(raw)`
- `mapContentItem()` switch (~line 262): same case (for Section wrapper nesting)
- `firstSectionTitle()` switch (~line 374): return `null` (carousel has no heading)

#### Phase 2: Scroll Infrastructure (SectionNavContext + FixedHeroLayout)

**`FixedHeroLayout.tsx`** — Four changes:

1. **Add `ScrollView` ref** to both scroll paths (hero and no-hero):

   ```typescript
   const scrollRef = useRef<ScrollView>(null)
   // ... pass ref={scrollRef} to both <ScrollView> instances
   ```

2. **Add programmatic-scroll guard flag** to prevent blur bracket interference:

   ```typescript
   const isProgrammaticScroll = useRef(false)
   ```

   In `handleScroll`, skip blur/pause updates when the flag is set. This prevents the `onScroll` events fired during animated `scrollTo` (especially on Fabric/New Architecture) from triggering unnecessary state changes.

3. **Implement `SectionNavContext.Provider`** as a sibling of `ScrollContext.Provider`:

   ```typescript
   const sectionRegistry = useRef(new Map<string, number>())

   const sectionNav: SectionNavValue = useMemo(
     () => ({
       scrollToSection(sectionKey: string) {
         const y = sectionRegistry.current.get(sectionKey)
         if (y != null) {
           isProgrammaticScroll.current = true
           requestAnimationFrame(() => {
             scrollRef.current?.scrollTo({ y, animated: true })
             // Clear flag after animation settles (~350ms covers both platforms)
             setTimeout(() => {
               isProgrammaticScroll.current = false
             }, 400)
           })
         } else if (__DEV__) {
           console.warn(
             `[SectionNav] No section registered for key: "${sectionKey}"`,
           )
         }
       },
       registerSection(sectionKey: string, y: number) {
         sectionRegistry.current.set(sectionKey, y)
       },
     }),
     [],
   ) // empty deps — both refs are stable
   ```

   **Why `requestAnimationFrame`:** Calling `scrollTo` in the same frame as a layout change can target stale dimensions. The RAF ensures the current layout pass has settled before scrolling.

4. **Add `onLayout` to section wrappers** to register Y offsets:

   ```tsx
   {
     remainingSections.map((section, index) => (
       <View
         key={`${section.id}-${index}`}
         style={styles.opaqueSection}
         onLayout={(e) => {
           if (section.sectionKey) {
             sectionNav.registerSection(
               section.sectionKey,
               e.nativeEvent.layout.y,
             )
           }
         }}
       >
         <SectionDispatcher section={section} />
       </View>
     ))
   }
   ```

   Apply the same `onLayout` pattern to the no-hero scroll path (lines 83-87).

   **Why this works:** `layout.y` is relative to the parent — the ScrollView's content container. This is exactly what `scrollTo({ y })` expects. No offset math needed (see origin: R6).

   **Known limitation:** If a sibling section _above_ the target expands (e.g., late-loading image), the target's `onLayout` does NOT re-fire — its own dimensions didn't change. The registered Y offset becomes stale. Acceptable for v1 since experience sections are mostly static height. Follow-up: measure-on-demand using `measureLayout` at tap time eliminates this entirely.

### Research Insights — Scroll Infrastructure

**Architecture review (validated):** SectionNavContext provider placement in FixedHeroLayout is correct — it owns both ScrollView instances. The two contexts (ScrollContext and SectionNavContext) are independent; nesting them as siblings at the same level is preferred to make this explicit.

**Performance review (validated):** `onLayout` on section wrappers does NOT cause re-renders — the callback writes to a `Map` in a `useRef`, which is O(1) and render-free. The empty `useMemo([], [])` dep array is critical — if the context value identity changes per render, all `useSectionNav()` consumers re-render unnecessarily.

**iOS vs Android `scrollTo` differences:**

- iOS uses native `UIScrollView` animation (~300ms, non-configurable)
- Android uses `smoothScrollTo` with `OverScroller` (~250ms)
- On Android, `scrollTo` is clamped to `contentSize - viewportHeight` — if the last section can't scroll to top, add bottom padding. The existing `paddingBottom: 40` may need increasing.

#### Phase 3: Renderer Component

**`NavigationCarouselRenderer.tsx`** — New file following `BibleQuotesCarouselRenderer` patterns:

```typescript
// apps/mobile/src/components/sections/NavigationCarouselRenderer.tsx

import { Image } from "expo-image"
import { LinearGradient } from "expo-linear-gradient"
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native"
import { useSectionNav } from "./SectionNavContext"

// Props interface follows naming convention
export interface NavigationCarouselRendererProps {
  section: NavigationCarouselSection
}

export function NavigationCarouselRenderer({ section }: NavigationCarouselRendererProps) {
  const { width: screenWidth } = useWindowDimensions()
  const { scrollToSection } = useSectionNav()

  // Derive card sizing reactively (NOT at module scope)
  const CARD_GAP = 12
  const HORIZONTAL_PADDING = 16
  const cardWidth = (screenWidth - HORIZONTAL_PADDING * 2) * 0.6
  const snapInterval = cardWidth + CARD_GAP

  if (section.items.length === 0) return null  // empty state: render nothing

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: HORIZONTAL_PADDING }}
      snapToInterval={snapInterval}
      snapToAlignment="start"
      decelerationRate="fast"
      disableIntervalMomentum={true}  // prevents auto-drift on some Android devices
      accessibilityRole="adjustable"
    >
      {section.items.map((item, index) => (
        <Pressable
          key={`${item.contentId}-${item.id}-${index}`}  // composite key
          onPress={() => scrollToSection(item.contentId)}
          accessibilityLabel={`${item.category ?? ""} ${item.title}`.trim()}
          accessibilityHint="Scrolls to this section"
          style={[styles.card, { width: cardWidth, marginRight: CARD_GAP }]}
        >
          <View style={[
            StyleSheet.absoluteFill,
            { backgroundColor: item.backgroundColor ?? "#1A1815" }
          ]} />
          {item.imageUrl && (
            <Image
              source={item.imageUrl}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              transition={200}
            />
          )}
          <LinearGradient
            colors={["transparent", "rgba(0,0,0,0.7)"]}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.cardContent}>
            {item.category && (
              <Text style={styles.category}>{item.category.toUpperCase()}</Text>
            )}
            <Text style={styles.title}>{item.title}</Text>
          </View>
        </Pressable>
      ))}
    </ScrollView>
  )
}
```

### Research Insights — Renderer

**Use `expo-image` over `react-native` Image:** `expo-image` provides disk/memory caching (Glide on Android, SDWebImage on iOS), BlurHash placeholders, and `transition` for fade-in. It does NOT support gradient overlays natively — layer `LinearGradient` from `expo-linear-gradient` over the image with absolute positioning.

**`disableIntervalMomentum={true}`:** Prevents a known Android issue ([react-native#29922](https://github.com/facebook/react-native/issues/29922)) where `snapToInterval` causes auto-scroll drift on some Vivo/Oppo devices.

**Card sizing:** `useWindowDimensions()` inside the component ensures card width updates on rotation/foldable state changes. Constants like `CARD_GAP` are fine at module scope (they're design tokens, not runtime-derived).

**Empty carousel:** Return `null` when `items.length === 0`, matching the `BibleQuotesCarouselRenderer` pattern.

**Accessibility:** `accessibilityRole="adjustable"` on the ScrollView and descriptive labels on cards, following the existing carousel pattern.

**`SectionDispatcher.tsx`** — Add case to both dispatchers:

```typescript
case "navigationCarousel":
  return <NavigationCarouselRenderer section={section} />
```

Import follows alphabetical grouping convention.

## Gotchas from Institutional Learnings

- **Use `useWindowDimensions()`** inside the renderer, never `Dimensions.get("window")` at module scope — stale after rotation/split-screen (from `docs/solutions/mobile/full-bleed-video-hero-with-scroll-over-content.md`).
- **Composite React keys** for carousel items: `${item.contentId}-${item.id}-${index}` since Strapi component IDs are per-type, not globally unique (from `docs/solutions/integration-issues/expo-graphql-schema-drift-and-fragment-validation.md`).
- **Don't use `Animated.Value.addListener()`** for scroll logic — use plain `onScroll` JS callbacks (from `docs/solutions/mobile/full-bleed-video-hero-with-scroll-over-content.md`).
- **Validate GraphQL fragments against schema** — Strapi's GraphQL plugin silently ignores invalid spreads in some cases but rejects them outright in others, causing blank screens (from `docs/solutions/integration-issues/expo-graphql-schema-drift-and-fragment-validation.md`).
- **Filter nulls from items array** — Use `.filter(item => item != null)` before mapping, matching the pattern in `mapBibleQuotesCarousel` and `mapMediaCollection`.

## Edge Cases

| Case                                      | Behavior                                                                           |
| ----------------------------------------- | ---------------------------------------------------------------------------------- |
| Empty items array                         | Carousel renders nothing (`return null`)                                           |
| Missing `imageUrl` on a card              | Show `backgroundColor` fill only, no image                                         |
| Missing `category` on a card              | Skip category label, show title only                                               |
| `contentId` matches no section            | No-op; `console.warn` in `__DEV__` only (origin: R7)                               |
| Duplicate `sectionKey` across sections    | Last registration wins (Map.set overwrites); acceptable default                    |
| Rapid sequential taps                     | Second `scrollTo` interrupts the first animation — RN default behavior, acceptable |
| Device rotation mid-carousel              | `useWindowDimensions` updates card sizing; `onLayout` re-registers section offsets |
| Section above target expands after layout | **Known limitation:** offset may be stale. Follow-up: measure-on-demand            |

## Acceptance Criteria

- [ ] Navigation carousel renders as horizontal scrollable strip of image cards on the Easter experience page
- [ ] Each card shows background color, image (via `expo-image`), category label, and title
- [ ] Tapping a card smooth-scrolls to the section with matching `sectionKey`
- [ ] Tapping a card whose `contentId` has no matching section does nothing (dev console warning only)
- [ ] Carousel scrolls inline with content (not sticky)
- [ ] Cards snap to intervals during horizontal scroll
- [ ] Empty items array renders nothing
- [ ] Works on both iOS and Android with no platform-specific divergence
- [ ] No regressions to existing section rendering or scroll behavior
- [ ] Accessibility labels on cards and carousel ScrollView

## Dependencies & Risks

- **Scroll ref access:** Both `ScrollView` instances in `FixedHeroLayout` need refs. Low risk — standard React Native pattern.
- **`onLayout` timing:** Section offsets are measured after layout. `onLayout` fires on every layout change of that specific View, keeping the registry current. However, if a _sibling above_ changes height, this View's `onLayout` does NOT fire — documented limitation, acceptable for v1.
- **GraphQL query update:** Adding fields to the mobile query is manual (no codegen). Risk of typo. Mitigation: test against local Strapi.
- **Programmatic scroll + blur handler:** On Fabric, `scrollTo({ animated: true })` fires `onScroll` events during animation. The `isProgrammaticScroll` guard flag prevents unnecessary blur bracket state changes.
- **`expo-image` dependency:** Verify `expo-image` is installed (`npx expo install expo-image`). It ships with Expo SDK but may need explicit installation.

## Sources & References

- **Origin document:** [docs/brainstorms/2026-03-25-mobile-navigation-carousel-requirements.md](docs/brainstorms/2026-03-25-mobile-navigation-carousel-requirements.md) — Key decisions: inline (not sticky), scroll to top of screen, dev-only warning on missing section.
- **Web reference implementation:** [apps/web/src/components/sections/NavigationCarousel.tsx](apps/web/src/components/sections/NavigationCarousel.tsx)
- **Mobile carousel pattern:** [apps/mobile/src/components/sections/BibleQuotesCarouselRenderer.tsx](apps/mobile/src/components/sections/BibleQuotesCarouselRenderer.tsx)
- **Scroll infrastructure:** [apps/mobile/src/components/sections/SectionNavContext.ts](apps/mobile/src/components/sections/SectionNavContext.ts), [apps/mobile/src/contexts/ScrollOffsetContext.ts](apps/mobile/src/contexts/ScrollOffsetContext.ts)
- **Scroll architecture learnings:** [docs/solutions/mobile/full-bleed-video-hero-with-scroll-over-content.md](docs/solutions/mobile/full-bleed-video-hero-with-scroll-over-content.md)
- **GraphQL drift patterns:** [docs/solutions/integration-issues/expo-graphql-schema-drift-and-fragment-validation.md](docs/solutions/integration-issues/expo-graphql-schema-drift-and-fragment-validation.md)
- **React Native ScrollView docs:** scrollTo, onLayout, snapToInterval
- **Expo Image docs:** caching, blurhash, transition
- **RN issue #29922:** Android auto-drift with snapToInterval — mitigated by `disableIntervalMomentum`
