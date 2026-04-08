---
title: "LinearGradient Dark Banding from CSS transparent Keyword"
category: mobile
date: 2026-03-26
severity: medium
tags:
  - react-native
  - linear-gradient
  - transparent-color-banding
  - expo-linear-gradient
  - carousel
  - color-interpolation
symptom: "Visible dark shadow band in LinearGradient transition zone when fading from transparent to a non-black color"
root_cause: "CSS 'transparent' is rgba(0,0,0,0) — transparent BLACK. Interpolating from transparent black to a light color passes through dark intermediate tones."
fix: "Use the target color at alpha 0 instead of 'transparent', so only the alpha channel interpolates"
module: apps/mobile-v2
---

## Problem

When using `expo-linear-gradient` in React Native with `"transparent"` as a gradient start color and a non-black background color as the end, a visible dark shadow band appears in the gradient transition zone. This is especially noticeable over images or light-colored backgrounds.

## Root Cause

CSS `"transparent"` is defined as `rgba(0,0,0,0)` -- transparent **black**. When `LinearGradient` interpolates between `rgba(0,0,0,0)` and a target color like `#8B7355`, the RGB channels blend from `(0,0,0)` toward `(139,115,85)`. Even though the alpha is transitioning from 0 to 1, the intermediate pixels have dark RGB components combined with partial opacity.

At the midpoint, the interpolated color is approximately `rgba(70,58,43,0.5)` -- a semi-transparent dark brown -- rather than the expected `rgba(139,115,85,0.5)`.

**The only case where `"transparent"` works correctly is fading to/from black**, because the RGB channels already match `(0,0,0)`.

## Solution

Replace `"transparent"` with a transparent version of the target color that shares the same RGB channels but has alpha 0. This ensures the gradient interpolates **only the alpha channel** while RGB stays constant.

```typescript
/** Convert a hex color (3 or 6 digit) to rgba with the given alpha. */
function hexToRgba(hex: string, alpha: number): string {
  const stripped = hex.replace("#", "")
  const expanded =
    stripped.length === 3
      ? stripped[0] +
        stripped[0] +
        stripped[1] +
        stripped[1] +
        stripped[2] +
        stripped[2]
      : stripped
  if (expanded.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(expanded)) {
    return `rgba(26,24,21,${alpha})` // safe fallback
  }
  const r = parseInt(expanded.substring(0, 2), 16)
  const g = parseInt(expanded.substring(2, 4), 16)
  const b = parseInt(expanded.substring(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}
```

### Before (dark banding)

```tsx
<LinearGradient colors={["transparent", bgColor]} locations={[0, 0.5]} />
```

### After (clean fade)

```tsx
const bgColorTransparent = hexToRgba(bgColor, 0)
<LinearGradient colors={[bgColorTransparent, bgColor]} locations={[0, 0.5]} />
```

## Key Insight

**When creating gradients that fade to or from a color, always use that same color at alpha 0 -- never `"transparent"`.** The word `transparent` is syntactic sugar for `rgba(0,0,0,0)`, so the gradient engine interpolates all four channels (R, G, B, A) toward the destination. The fix is to make the invisible end share the exact same RGB as the visible end, differing only in alpha.

| Intent                      | Wrong                        | Correct                                                                     |
| --------------------------- | ---------------------------- | --------------------------------------------------------------------------- |
| Fade white to nothing       | `['#FFF', 'transparent']`    | `['#FFF', 'rgba(255,255,255,0)']`                                           |
| Fade brand color to nothing | `['#1E3A5F', 'transparent']` | `['#1E3A5F', 'rgba(30,58,95,0)']`                                           |
| Fade black to nothing       | `['#000', 'transparent']`    | `['#000', 'rgba(0,0,0,0)']` (only case where `transparent` happens to work) |

This principle applies universally -- CSS on web, React Native, and any platform that performs linear color interpolation.

## Prevention

1. **Never use `"transparent"` in gradient `colors` arrays.** Treat it as a banned token in gradient contexts. Always derive the transparent stop from the target color with alpha 0.

2. **Code review checklist item:** When reviewing PRs with `LinearGradient`, verify that no color stop is the string `"transparent"`.

3. **Extract `hexToRgba` to a shared utility** (`apps/mobile-v2/src/lib/color.ts`) so all renderers use the same safe conversion. This module now also exports semantic color tokens (`BG_COLOR`, `ACCENT`, `TEXT_PRIMARY`, etc.).

4. **Test gradients on light backgrounds.** Banding from `transparent` is most visible on light surfaces but can appear on any non-black background.

## Affected Components

- **BibleQuotesCarouselRenderer** -- fixed in this PR
- **NavigationCarouselRenderer** -- still uses `"transparent"`, needs backport (currently safe because it fades black-to-black, but fragile)
- **VideoHeroRenderer** -- still uses `"transparent"`, same situation

## Cross-References

- [translucent-section-backgrounds-with-react-context.md](translucent-section-backgrounds-with-react-context.md) -- Opacity stacking rules, Android `elevation` + translucency concerns
- [full-bleed-video-hero-with-scroll-over-content.md](full-bleed-video-hero-with-scroll-over-content.md) -- Uses `LinearGradient` with `"transparent"` in hero overlay (currently black-to-black, so safe, but fragile)
- [decorative-icon-view-text-pattern.md](decorative-icon-view-text-pattern.md) -- Opacity compounding in hero layouts
