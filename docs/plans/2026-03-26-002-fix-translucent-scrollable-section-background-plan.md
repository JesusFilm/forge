---
title: "fix: Make scrollable section background translucent to match hero gradient"
type: fix
status: completed
date: 2026-03-26
---

# fix: Make scrollable section background translucent to match hero gradient

## Overview

The scrollable content sections below the video hero overlay currently use an opaque dark gray background (`#1a1a1a`), which blocks the hero video from showing through. The bottom edge of the `VideoHeroOverlay` gradient fades to `rgba(0, 0, 0, 0.8)` — a translucent dark gray. The scrollable sections should use this same translucent color so the background video subtly bleeds through, creating a seamless visual transition.

## Problem Statement

In the Experience screen's `FixedHeroLayout`, the hero video is pinned behind a transparent `ScrollView`. The overlay gradient transitions from transparent to `rgba(0, 0, 0, 0.8)`, but the remaining sections immediately below use `backgroundColor: "#1a1a1a"` (fully opaque). This creates a hard visual cut where the video abruptly disappears behind an opaque wall, instead of continuing the translucent effect.

## Proposed Solution

Change the `opaqueSection` style in `FixedHeroLayout.tsx` from opaque `#1a1a1a` to translucent `rgba(0, 0, 0, 0.8)` — the exact color at the bottom edge of the `VideoHeroOverlay` gradient.

### Files to Change

#### `apps/mobile/src/components/sections/FixedHeroLayout.tsx`

**Line 260–262** — rename and update the section style:

```tsx
// Before
opaqueSection: {
  backgroundColor: "#1a1a1a",
},

// After
translucentSection: {
  backgroundColor: "rgba(0, 0, 0, 0.8)",
},
```

**Line 219** — update the style reference:

```tsx
// Before
style={styles.opaqueSection}

// After
style={styles.translucentSection}
```

### Color Reference

| Element                       | Color                | Opacity       |
| ----------------------------- | -------------------- | ------------- |
| Hero gradient bottom          | `rgba(0, 0, 0, 0.8)` | 80%           |
| Section background (current)  | `#1a1a1a`            | 100% (opaque) |
| Section background (proposed) | `rgba(0, 0, 0, 0.8)` | 80%           |

## Acceptance Criteria

- [ ] Scrollable section background uses `rgba(0, 0, 0, 0.8)` instead of `#1a1a1a`
- [ ] Background video is subtly visible through the content sections
- [ ] Transition from hero gradient to scrollable sections is seamless (no hard color cut)
- [ ] Verify on both iOS and Android — ensure the translucent background renders correctly on both platforms
- [ ] Text readability is preserved against the translucent background

## Context

- The `FixedHeroLayout` architecture uses `position: absolute` for the hero video behind a transparent `ScrollView` — so reducing the section opacity will naturally reveal the video underneath.
- The `SectionWrapperRenderer` also defines a `dark` background as `#1a1a1a`, but that component is used for CMS-driven section wrappers and is **not** affected by this change. Only the `FixedHeroLayout` wrapper around remaining sections needs updating.
- No other files reference the `opaqueSection` style name.

## Sources

- [FixedHeroLayout.tsx:261](apps/mobile/src/components/sections/FixedHeroLayout.tsx#L261) — current opaque background
- [VideoHeroRenderer.tsx:276](apps/mobile/src/components/sections/VideoHeroRenderer.tsx#L276) — gradient bottom color `rgba(0, 0, 0, 0.8)`
