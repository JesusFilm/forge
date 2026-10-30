---
title: "Video Detail Audit — UI Polish Fixes"
category: "mobile"
date: "2026-04-08"
last_updated: "2026-08-28"
module: "apps/mobile"
problem_type: "ui-bugs"
severity: "medium"
tags:
  - "mobile"
  - "react-native"
  - "expo"
  - "video-detail"
  - "ui-polish"
  - "sdui"
  - "color-tokens"
  - "navigation"
  - "code-review"
  - "ionicons"
  - "emoji-rendering"
  - "android"
  - "text-truncation"
  - "gradient"
  - "typography"
files_touched:
  - "apps/mobile/app/video/[sectionKey].tsx"
  - "apps/mobile/app/_layout.tsx"
  - "apps/mobile/src/components/sections/CuratedHomeLayout.tsx"
  - "apps/mobile/src/components/sections/QuizButtonRenderer.tsx"
  - "apps/mobile/src/components/sections/RelatedQuestionsRenderer.tsx"
  - "apps/mobile/src/components/sections/BibleQuotesCarouselRenderer.tsx"
  - "apps/mobile/src/components/sections/TextRenderer.tsx"
  - "apps/mobile/src/components/sections/VideoHeroRenderer.tsx"
  - "apps/mobile/src/components/ui/HomeHeader.tsx"
  - "apps/mobile/src/lib/color.ts"
related:
  - "docs/solutions/mobile/audit-driven-video-detail-refactor.md"
  - "docs/solutions/mobile/hero-mute-button-hybrid-overlay-touch-target.md"
  - "docs/solutions/mobile/linear-gradient-dark-banding-transparent-keyword.md"
  - "docs/solutions/mobile/sdui-experience-provider-block-index-parent-child-loss.md"
  - "docs/solutions/mobile/typography-token-scope-shared-vs-purpose-specific.md"
  - "docs/solutions/mobile/decorative-icon-view-text-pattern.md"
  - "docs/solutions/best-practices/shared-stylesheet-extraction-mobile-v2-20260409.md"
  - "docs/solutions/logic-errors/fit-budget-render-contract-numberoflines-zero-sentinel.md"
---

## Problem

The mobile-v2 video detail screen had multiple UI/UX defects found during a systematic audit:

**Layout issues**: `navigationCarousel` blocks leaked into video detail rendering. Title/subtitle duplicated in both nav bar and body. Android header title was left-aligned instead of centered. Header was transparent, causing the video player to render behind the nav bar.

**Interaction bugs**: Hero video kept playing audio after navigating away from home. Bible quotes CTA button had no `onPress` handler (dead tap target).

**Visual polish**: Quiz button used a flat ACCENT background instead of a gradient. Related questions CTA used verbose text instead of a compact icon.

**Code hygiene**: ACCENT color was declared in 4 separate files instead of the centralized `lib/color.ts` token. Non-null assertions, dead parameters, and YAGNI viewability scaffolding cluttered the codebase.

## Root Cause

The video detail page had accumulated regressions after rapid feature development. Navigation carousels leaked into detail views because the sibling content filter only excluded by `sectionKey` identity, not by block `kind`. The transparent header was a design choice that didn't account for non-hero content rendering behind it. Hero audio persisted because React Navigation keeps stack screens mounted — blur/unmount was never handled. Color tokens were duplicated because the centralized module was created but never enforced as the single import source.

## Solution

### 1. Navigation carousel filtering

Added a `kind` filter alongside the existing `sectionKey` exclusion in `app/video/[sectionKey].tsx`:

```typescript
const nestedContent = siblings.filter(
  (c) =>
    (c.sectionKey as string | undefined) !== currentKey &&
    c.kind !== "navigationCarousel",
)
```

### 2. Title in nav bar, solid header

Removed `headerTransparent: true` from `_layout.tsx`, set opaque background via `BG_COLOR`, added `headerShadowVisible: false` and `headerTitleAlign: "center"`. Moved title into `navigation.setOptions({ headerTitle: title ?? "" })` and removed title/subtitle from the scroll body.

### 3. Hero mute-on-blur

Added a `blur` listener in `CuratedHomeLayout` that resets mute state when the user navigates away:

```typescript
const navigation = useNavigation()
useEffect(() => {
  return navigation.addListener("blur", () => setMuted(true))
}, [navigation])
```

This is the correct abstraction level — mute is a UI concern of the home screen's hero, not an app-wide media concern.

### 4. Interactive element fixes

- **Quiz button**: Wrapped content in `LinearGradient` using centralized `QUIZ_GRADIENT` token (orange to red)
- **Bible quotes CTA**: Added `onPress={() => Linking.openURL(ctaLink)}` using local variable extraction to avoid non-null assertion
- **Related questions**: Replaced "Ask yours" text with `Ionicons` `chatbubble-ellipses-outline` icon button

### 5. Color token centralization

Added `QUIZ_GRADIENT` to `src/lib/color.ts`. Replaced 4 local `const ACCENT = "#CB333B"` declarations in QuizButtonRenderer, RelatedQuestionsRenderer, TextRenderer, and VideoHeroRenderer with imports from `color.ts`. Replaced hardcoded hex in `_layout.tsx` with `BG_COLOR`/`ACCENT` imports.

### 6. Dead code removal

- Removed unused `insetTop` parameter from `VideoDetailContent`
- Removed YAGNI viewability scaffolding (empty `onViewableItemsChanged` + `viewabilityConfig`) from `CuratedHomeLayout`
- Removed orphaned imports (`useRef`, `ViewToken`)

## Prevention

1. **Lint for dead handlers**: `Pressable` without `onPress` should warn. Catches dead buttons at build time.
2. **Platform-aware defaults**: Always set `headerTitleAlign: "center"` explicitly. Never rely on platform defaults for alignment.
3. **Centralized color tokens**: All color values from `lib/color.ts`. Flag raw hex literals in CI.
4. **Navigation lifecycle cleanup**: Use blur/focus listeners to pause/mute media and reset transient state. Stack navigators keep screens mounted — never assume unmount handles cleanup.
5. **SDUI context gating**: Consider a `context` prop on renderers so blocks can declare which contexts they're valid in.
6. **Dead code sweeps**: Enable `noUnusedParameters` and `noUnusedLocals` in tsconfig to catch unused code at compile time.

## Audit Pattern

When auditing a feature page, work outward from the data layer:

1. **Filter bad data** (navigation carousel leak)
2. **Fix layout/navigation** (header transparency, title placement)
3. **Fix interactive behavior** (mute-on-blur, missing handlers)
4. **Visual polish** (gradient, icon CTA)
5. **Code hygiene** (tokens, dead code)

This order prevents rework — data fixes often eliminate layout issues, and layout fixes often reveal interaction bugs.

## Round 2 — Icon Consistency, Header Color, Carousel Readability (2026-04-09)

A second polish pass addressed visual inconsistencies across the home screen and bible quotes carousel.

### 7. Emoji mute icon → Ionicons vector icon

**Problem**: Mute/unmute button in `VideoHeroRenderer` used emoji characters (`\uD83D\uDD07` / `\uD83D\uDD0A`). Android renders these as colorful bitmapped Noto emoji — inconsistent with the monochrome design language.

**Before:**

```tsx
<Text style={styles.muteIcon}>
  {mutedProp ? "\uD83D\uDD07" : "\uD83D\uDD0A"}
</Text>
```

**After:**

```tsx
import Ionicons from "@expo/vector-icons/Ionicons"
// ...
;<Ionicons
  name={mutedProp ? "volume-mute" : "volume-high"}
  size={20}
  color={TEXT_ON_OVERLAY}
/>
```

Removed the now-unused `muteIcon` style. Ionicons renders as monochrome SVG-based vector glyphs on both platforms — immune to platform emoji rendering differences.

### 8. Profile button color mismatch

**Problem**: Search icon in `HomeHeader` used `ACCENT` (red `#CB333B`) but profile icon used `TEXT_SECONDARY` (gray `#a8a29e`). Visually unbalanced header.

**Fix**: Changed profile icon color from `TEXT_SECONDARY` to `ACCENT`. Removed unused `TEXT_SECONDARY` import. Same principle as the color token centralization in round 1 — sibling interactive icons in the same bar should share a color token.

### 9. Bible quotes carousel readability

**Problem**: Quote text obscured by background image — gradient too light, attribution/reference text semi-transparent, body truncated at 8 lines, fixed `aspectRatio: 4/3` prevented card from growing to fit content.

**Fixes:**

| Property                     | Before                  | After                           | Why                                             |
| ---------------------------- | ----------------------- | ------------------------------- | ----------------------------------------------- |
| Gradient `top`               | `"40%"`                 | `"20%"`                         | Darker backdrop starts higher behind text       |
| Gradient `locations`         | `[0, 0.5]`              | `[0, 0.6]`                      | Opaque point pushed lower for stronger coverage |
| Attribution color            | `rgba(255,255,255,0.7)` | `TEXT_ON_OVERLAY` (solid white) | Full opacity for legibility                     |
| Reference color              | `rgba(255,255,255,0.9)` | `TEXT_ON_OVERLAY` (solid white) | Full opacity for legibility                     |
| Attribution/reference weight | `"700"` / `"600"`       | `"800"` / `"800"`               | Heavier weight for contrast against image       |
| `numberOfLines`              | `8`                     | removed                         | No truncation — full quote visible              |
| Card sizing                  | `aspectRatio: 4/3`      | `overflow: "hidden"`            | Card grows with content                         |
| Quote `marginBottom`         | `12`                    | `4`                             | Tighter spacing at bottom                       |

### 10. Duplicate `fontWeight` key (caught in code review)

The round 2 refactor of `BibleQuotesCarouselRenderer` left a duplicate `fontWeight: "700"` alongside the new `"800"` in the `attribution` style. JavaScript objects with duplicate keys silently keep only the last value — the `"700"` was dead code. Removed during review.

**Lesson**: ESLint `no-dupe-keys` rule catches this at lint time. `StyleSheet.create` does not warn about duplicate keys at runtime.

## Updated Prevention

In addition to the round 1 prevention items:

7. **Never use Unicode emoji literals for UI icons in React Native.** Use `@expo/vector-icons` (Ionicons, MaterialIcons, etc.) — they render identically on both platforms. The `apps/mobile` (deprecated) `View+Text` workaround is superseded by Ionicons in mobile-v2.
8. **Use a single color token for a logical icon group.** All interactive header icons should share `ACCENT`. Mixing semantic tokens across siblings signals a styling error.
9. **Avoid `numberOfLines` on content that must not be truncated.** Prefer `overflow: "hidden"` on the container if visual clipping is the actual constraint.

   > **Superseded for `BibleQuotesCarouselRenderer` on 2026-08-28.** This rule
   > holds only while the container can grow. That card is now a fixed square
   > with bottom-aligned content. `overflow: "hidden"` therefore clips the top
   > of the stack and removes the reference. The card now gives every region a
   > `numberOfLines` from a shared line budget. See
   > `docs/solutions/logic-errors/fit-budget-render-contract-numberoflines-zero-sentinel.md`,
   > which also records why a budget of `0` must never reach the prop.

10. **Always test icon/typography changes on a physical Android device or emulator.** iOS renders many emoji as monochrome by default, masking platform inconsistencies.
11. **Lint for duplicate object keys.** Enable ESLint `no-dupe-keys` to catch static duplicates in `StyleSheet.create` calls at build time.

## Related Issues

- #373 — `feat(mobile-expo): snap scrolling and pagination for bible quotes carousel`
- #364 — `feat(web): implement Bible Quotes Carousel section component`
