---
title: "Extract Shared StyleSheet Patterns into a Unified Module"
date: 2026-04-09
category: best-practices
module: apps/mobile-v2
problem_type: best_practice
component: tooling
severity: medium
applies_when:
  - "3+ components define identical or near-identical StyleSheet.create() patterns"
  - "Raw hex color literals appear instead of existing color constants"
  - "Bulk style changes require editing many files for a single visual tweak"
tags:
  - react-native
  - stylesheet
  - shared-styles
  - deduplication
  - mobile-v2
  - style-composition
---

# Extract Shared StyleSheet Patterns into a Unified Module

## Context

Across `apps/mobile-v2/`, 20 components each defined their own `StyleSheet.create()` blocks. Common patterns — containers, headings, subtitles, cards, pressed states, play overlays — were duplicated verbatim or near-verbatim. Additionally, 7 files used raw hex literals (`"#1c1917"`, `"#f5f5f4"`) instead of existing color constants from `src/lib/color.ts`. This made bulk style changes tedious and increased visual drift risk between screens.

## Guidance

Create a single shared module (`src/styles/shared.ts`) that exports pre-built `StyleSheet.create()` groups organized by namespace. Components import and compose these with their own local styles.

### Module structure

Organize shared styles into semantic namespaces — group by concern, not by component:

```
layout   — screenContainer, centered, sectionOuter, headerRow
text     — sectionHeading, sectionHeadingPadded, sectionSubtitle, errorTitle, errorMessage, accentLinkText
card     — base, surface
button   — accent, accentText, iconButton44
feedback — pressed
overlay  — playOverlay
carousel — listContent
```

Also export shared numeric constants that carry the same semantic meaning across 3+ files:

```typescript
export const HORIZONTAL_PADDING = 16
export const CARD_GAP = 12
export const CARD_BORDER_RADIUS = 12
```

### Composition pattern

Shared styles go FIRST in style arrays, component-specific overrides LAST. React Native resolves left-to-right (last wins):

```tsx
// Sole shared style
<View style={layout.screenContainer}>

// Compose shared + typography
<Text style={[text.sectionHeading, typography.heading]}>

// Compose shared + local override
<View style={[layout.sectionOuter, styles.localPadding]}>

// Compose shared + pressed feedback
style={({ pressed }) => [
  card.surface,
  { width: cardWidth },
  pressed && feedback.pressed,
]}
```

### Extraction threshold

Only extract patterns appearing in **3+ files with identical semantic purpose**. Two files sharing a value may be coincidental — confirm it's semantically the same before sharing. This follows the principle: incidental value equality does not equal intentional coupling (see `docs/solutions/mobile/typography-token-scope-shared-vs-purpose-specific.md`).

### What stays local

- Styles unique to one component (e.g., `activeBar`, `nowPlayingBadge`, `playCircle`)
- Styles that look similar but differ meaningfully (e.g., `retryButton` with different padding/borderRadius across files)
- Component-specific color schemes (e.g., EasterDates light cards with unique gradient hex colors)

## Why This Matters

- **One-line fixes**: Changing a shared pattern (e.g., card border radius) requires editing one file, not 5+
- **Consistency**: New screens import shared styles instead of reinventing them, preventing visual drift
- **Readability**: Component files shrink significantly (net -246 lines across 20 files) by removing boilerplate
- **Zero runtime cost**: `StyleSheet.create()` at module scope is evaluated once at import time

## When to Apply

- When adding a new screen or renderer, check `src/styles/shared.ts` before defining local styles
- When a local style matches a shared pattern exactly, use the shared version
- When a local style is close but not identical, compose: `[shared.x, styles.localOverride]`
- When a new pattern appears in 3+ files, extract it to shared.ts

## Examples

### Before: duplicated container style in 6 files

```tsx
// app/(tabs)/library.tsx
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#1c1917" },
  // ...30 more styles
})

// app/collection/[sectionKey].tsx
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG_COLOR },
  // ...25 more styles
})
```

### After: shared import, local styles only for unique patterns

```tsx
// app/(tabs)/library.tsx
import { layout } from "../../src/styles/shared"
// ...
<View style={layout.screenContainer}>

// app/collection/[sectionKey].tsx
import { layout, text } from "../../src/styles/shared"
// ...
<View style={layout.screenContainer}>
<Text style={[text.sectionHeading, typography.heading]}>{vcTitle}</Text>
```

### Before: raw hex everywhere

```tsx
<ActivityIndicator size="large" color="#CB333B" />
<Text style={{ color: "#f5f5f4" }}>Error</Text>
```

### After: color constants from color.ts

```tsx
import { ACCENT, TEXT_PRIMARY } from "../../src/lib/color"
;<ActivityIndicator size="large" color={ACCENT} />
```

## Related

- `docs/solutions/mobile/responsive-typography-hook.md` — typography tokens composed alongside shared styles via style arrays
- `docs/solutions/mobile/audit-driven-video-detail-refactor.md` — color tokens in `src/lib/color.ts` that `shared.ts` imports
- `docs/solutions/mobile/typography-token-scope-shared-vs-purpose-specific.md` — shared vs purpose-specific token design principle
