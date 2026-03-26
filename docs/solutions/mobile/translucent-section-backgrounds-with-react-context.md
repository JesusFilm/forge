---
title: "Translucent section backgrounds over fixed video hero using React context"
category: mobile
date: 2026-03-26
severity: minor
tags:
  - react-native
  - expo
  - layout
  - context-api
  - translucency
  - scroll-view
  - hero-video
  - section-wrapper
affected_files:
  - apps/mobile/src/components/sections/HeroSectionContext.ts
  - apps/mobile/src/components/sections/FixedHeroLayout.tsx
  - apps/mobile/src/components/sections/SectionWrapperRenderer.tsx
reusable: true
---

# Translucent Section Backgrounds Over Fixed Video Hero

## Problem

In the Experience screen's `FixedHeroLayout`, a fixed video hero sits behind a transparent `ScrollView`. The scrollable content sections used an opaque `#1a1a1a` background that completely blocked the hero video from showing through below the gradient overlay. The desired effect was a translucent dark background so the video subtly bleeds through content sections.

## Root Cause

The architecture has **two independent layers** controlling section backgrounds:

1. **`FixedHeroLayout`** wraps each section in a styled View with its own background color (`#1a1a1a`).
2. **`SectionWrapperRenderer`** applies its own CMS-driven background color based on the `backgroundColor` field from the content model (also `#1a1a1a` for `dark`).

Both layers need to agree on transparency for the effect to work. Simple color changes hit one layer but not the other.

## Investigation Steps (What Didn't Work)

### Attempt 1: Simple color change on the outer wrapper

Changed `opaqueSection` from `#1a1a1a` to `rgba(0,0,0,0.8)`.

**Result**: Failed. `SectionWrapperRenderer` child components re-applied their own opaque `#1a1a1a`, blocking the video again.

### Attempt 2: Making both layers globally translucent

Changed `SectionWrapperRenderer`'s dark color to `rgba(0,0,0,0.5)` as well.

**Result**: Failed. Double-layered translucency — wrapper AND child both translucent — produced compounded opacity darker than intended. Visible seams appeared in margin gaps between sections where only one layer was present.

### Attempt 3: Negative margins to close gaps

Tried `marginTop: -4` to close the gap between the gradient overlay and the first section.

**Result**: Failed. Closing the gap caused translucent layers to overlap at boundaries, creating a dark band. Adjusting values traded gap width for band width.

### Key Realization

Per-section wrapping means N translucent Views with gaps between them. The gaps expose a different opacity than the sections, creating visible seams. The fix requires: (a) a **single** translucent wrapper instead of per-section wrappers, and (b) a way to tell children not to apply their own backgrounds.

## Working Solution

Use a **React Context** to signal child components they are inside a hero layout and should defer background control to the parent. This follows existing codebase patterns (`SectionColorSchemeContext`, `SectionNavContext`).

### Step 1: Create `HeroSectionContext.ts`

```typescript
import { createContext, useContext } from "react"

export const HeroSectionContext = createContext<boolean>(false)

export function useIsInsideHero(): boolean {
  return useContext(HeroSectionContext)
}
```

Defaults to `false` so all existing non-hero screens are unaffected.

### Step 2: Update `FixedHeroLayout.tsx`

Wrap **all** remaining sections in a **single** translucent View with the context provider:

```tsx
<HeroSectionContext.Provider value={true}>
  <View style={styles.translucentSection}>
    {remainingSections.map((section, index) => (
      <View key={`${section.id}-${index}`} ref={/* section ref */}>
        <SectionDispatcher section={section} />
      </View>
    ))}
  </View>
</HeroSectionContext.Provider>
```

```typescript
translucentSection: {
  backgroundColor: "rgba(0, 0, 0, 0.8)",
}
```

Single wrapper = no gaps between sections = no seam artifacts.

### Step 3: Update `SectionWrapperRenderer.tsx`

Skip own background and force light color scheme when inside the hero:

```typescript
const insideHero = useIsInsideHero()

const bgColor =
  backgroundColor && !insideHero ? backgroundColors[backgroundColor] : undefined

const colorScheme: ColorScheme = insideHero
  ? "light"
  : backgroundColor
    ? colorSchemes[backgroundColor]
    : "dark"
```

When `insideHero` is `true`:

- `bgColor` becomes `undefined` — no child background, deferring to the parent's single translucent layer.
- `colorScheme` is forced to `"light"` — text renders in light colors for contrast against the dark translucent overlay.

## Why This Works

| Problem                                            | How the solution addresses it                             |
| -------------------------------------------------- | --------------------------------------------------------- |
| Two layers both applying backgrounds               | Context tells the inner layer to skip its background      |
| Gaps/seams between per-section wrappers            | Single wrapper around all sections = no gaps              |
| Compounded opacity from stacked translucent layers | Only one layer is translucent; the other is transparent   |
| Text unreadable on translucent background          | Color scheme forced to `"light"` inside hero context      |
| Non-hero screens affected                          | Context defaults to `false`; behavior unchanged elsewhere |

## Prevention: Avoiding Double Background Problems

### Rules for translucent overlays in React Native

1. **Never rely on parent opacity alone.** The overlay container must be the only element with a background in that subtree, or children must explicitly opt out.
2. **Prefer `backgroundColor: 'transparent'` on children over `opacity` on parents.** `opacity` affects the entire composited layer including text, borders, and shadows.
3. **Eliminate margin gaps between siblings.** Margins inside a translucent container create seams where the parent's background bleeds through at a different effective opacity.
4. **Audit child component defaults.** Many components ship with a default opaque background. Grep for `backgroundColor` in any component rendered inside an overlay context.

### Maintaining the pattern for new section renderers

When adding a new section renderer that can appear inside a hero layout:

- Import and check `useIsInsideHero()` to skip opaque backgrounds
- Or use a shared `useSectionBackground(defaultColor)` hook that returns `'transparent'` inside hero context
- Add the renderer to integration test fixtures that render inside `HeroSectionContext.Provider`

### iOS vs Android testing

| Behavior                      | iOS                             | Android                                                      |
| ----------------------------- | ------------------------------- | ------------------------------------------------------------ |
| `rgba()` backgrounds          | Consistent                      | Consistent, but `elevation` adds an opaque layer on API < 28 |
| Video underlay z-order        | Works with `position: absolute` | Can be unreliable; use explicit `zIndex`                     |
| `borderRadius` + transparency | Clean edges                     | May show aliasing artifacts with `elevation`                 |

Set `elevation: 0` on children inside the hero context on Android. Profile scroll performance on mid-range Android devices.

## Cross-References

- [full-bleed-video-hero-with-scroll-over-content.md](./full-bleed-video-hero-with-scroll-over-content.md) — Documents the FixedHeroLayout architecture (note: architecture diagram references "opaque bg" which is now conditionally translucent)
- [responsive-typography-hook.md](./responsive-typography-hook.md) — Typography tokens used by section renderers affected by this change
- Existing context patterns: `SectionColorSchemeContext.ts`, `SectionNavContext.ts`
