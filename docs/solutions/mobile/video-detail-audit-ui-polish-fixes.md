---
title: "Video Detail Audit — UI Polish Fixes"
category: "mobile"
date: "2026-04-08"
module: "apps/mobile-v2"
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
files_touched:
  - "apps/mobile-v2/app/video/[sectionKey].tsx"
  - "apps/mobile-v2/app/_layout.tsx"
  - "apps/mobile-v2/src/components/sections/CuratedHomeLayout.tsx"
  - "apps/mobile-v2/src/components/sections/QuizButtonRenderer.tsx"
  - "apps/mobile-v2/src/components/sections/RelatedQuestionsRenderer.tsx"
  - "apps/mobile-v2/src/components/sections/BibleQuotesCarouselRenderer.tsx"
  - "apps/mobile-v2/src/components/sections/TextRenderer.tsx"
  - "apps/mobile-v2/src/components/sections/VideoHeroRenderer.tsx"
  - "apps/mobile-v2/src/lib/color.ts"
related:
  - "docs/solutions/mobile/audit-driven-video-detail-refactor.md"
  - "docs/solutions/mobile/hero-mute-button-hybrid-overlay-touch-target.md"
  - "docs/solutions/mobile/linear-gradient-dark-banding-transparent-keyword.md"
  - "docs/solutions/mobile/sdui-experience-provider-block-index-parent-child-loss.md"
  - "docs/solutions/mobile/typography-token-scope-shared-vs-purpose-specific.md"
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
