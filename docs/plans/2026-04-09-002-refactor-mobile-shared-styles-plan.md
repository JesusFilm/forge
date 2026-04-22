---
title: "refactor: Extract shared styles into unified module for mobile-v2"
type: refactor
status: completed
date: 2026-04-09
origin: docs/brainstorms/2026-04-09-mobile-shared-styles-requirements.md
---

# refactor: Extract shared styles into unified module for mobile-v2

## Overview

Extract duplicated `StyleSheet.create()` patterns from 20 components across `apps/mobile-v2/` into a single shared module at `src/styles/shared.ts`. This is a pure visual no-op refactor — no appearance changes, just deduplication. As a side fix, replace raw hex literals with existing color constants in 7 files.

## Problem Frame

20 components define their own inline `StyleSheet.create()` blocks. Common patterns — containers, headings, subtitles, cards, pressed states, play overlays — are duplicated verbatim or near-verbatim. This makes bulk style changes tedious and increases drift risk between screens that should look consistent. (see origin: `docs/brainstorms/2026-04-09-mobile-shared-styles-requirements.md`)

## Requirements Trace

- R1. Create `src/styles/` directory and shared StyleSheet module with grouped exports
- R2. Shared styles must use `src/lib/color.ts` constants and be compatible with `useTypography` style array composition
- R3. Export shared spacing/sizing constants
- R4. Migrate all 20 components to import shared styles for matching patterns
- R5. Components retain local `StyleSheet.create()` for unique styles
- R6. No visual regressions — pure refactor

## Scope Boundaries

- Not building a design system, theming engine, or factory functions
- Not changing `useTypography` — it stays as-is
- Not introducing new dependencies
- Not changing any visual appearance
- Raw hex → color constant fixes are in-scope as a consistency improvement

## Context & Research

### Relevant Code and Patterns

- `src/lib/color.ts` — all color constants (BG_COLOR, SURFACE_COLOR, TEXT_PRIMARY, TEXT_SECONDARY, TEXT_BODY, ACCENT, TEXT_ON_OVERLAY, BLACK)
- `src/hooks/useTypography.ts` — returns `{ fontSize, lineHeight }` tokens, composed via `style={[styles.foo, typography.bar]}`
- Style array composition pattern used throughout: `<Text style={[styles.heading, typography.heading]}>` — StyleSheet objects and plain objects both work in RN style arrays

### Institutional Learnings

- **Incidental value equality ≠ intentional coupling** (`docs/solutions/mobile/typography-token-scope-shared-vs-purpose-specific.md`): Before sharing a value, confirm it's semantically the same, not just coincidentally equal. Applied: only extract patterns appearing in 3+ files with the same semantic purpose.
- **Don't remove fontWeight during migration** (`docs/solutions/mobile/responsive-typography-hook.md`): Typography tokens deliberately exclude weight. Shared text styles must keep `fontWeight`.
- **contentContainerStyle backgroundColor gotcha** (`docs/solutions/mobile/flashlist-opaque-background-hides-absolute-hero.md`): Don't set backgroundColor on contentContainerStyle when using absolute hero patterns. Shared styles should not include this pattern.
- **Semantic token names** (`docs/solutions/mobile/audit-driven-video-detail-refactor.md`): Use role-based names (sectionHeading, errorTitle) not visual names (FONT_22_BOLD).

## Key Technical Decisions

- **16 shared style groups organized in 7 namespaces**: `layout`, `text`, `card`, `button`, `feedback`, `overlay`, `carousel` — derived from audit of all 20 files. Groups contain only patterns appearing in 3+ files with identical semantic purpose.
- **3 shared constants**: `HORIZONTAL_PADDING = 16`, `CARD_GAP = 12`, `CARD_BORDER_RADIUS = 12` — the only numeric values that are truly shared (same value, same meaning) across 3+ files.
- **Raw hex replacement bundled with migration**: Files that use raw hex literals (`"#1c1917"` instead of `BG_COLOR`) get fixed in the same pass to avoid a separate commit for trivial changes.
- **Style array ordering convention**: Shared styles first, component-specific overrides last — matches RN's left-to-right resolution where last wins.

## Open Questions

### Resolved During Planning

- **Which patterns to share?** Audit identified 16 groups across 7 namespaces. Only patterns in 3+ files with identical semantic purpose are shared. Near-identical patterns with different values (e.g., `retryButton` with different padding/borderRadius across files) are excluded.
- **What about `playCircle` (appears in 3 files)?** Excluded — sizes (48/56/72) and colors differ per context. Only the outer `playOverlay` is truly shared.
- **Migration order?** By directory: shared module first, then app/ routes, then sections (two batches), then UI/contexts. This lets each batch verify independently.

### Deferred to Implementation

- Exact import aliasing — implementer decides whether `shared.layout.screenContainer` or destructured `const { layout } = shared` reads better per file
- Whether `sectionOuterPadded` (marginVertical: 10 + paddingHorizontal: 16 + paddingVertical: 16) is worth extracting vs composing `[shared.layout.sectionOuter, localPaddedStyle]` — only 2 files use it

## Implementation Units

- [x] **Unit 1: Create shared styles module**

**Goal:** Create `src/styles/shared.ts` with all shared style groups and spacing constants.

**Requirements:** R1, R2, R3

**Dependencies:** None

**Files:**

- Create: `apps/mobile-v2/src/styles/shared.ts`

**Approach:**

- Create `src/styles/` directory
- Import all needed color constants from `../lib/color`
- Export spacing constants: `HORIZONTAL_PADDING = 16`, `CARD_GAP = 12`, `CARD_BORDER_RADIUS = 12`
- Export 7 namespaced `StyleSheet.create()` blocks:
  - **layout**: `screenContainer` (flex:1, BG_COLOR), `centered` (flex:1, BG_COLOR, centered, paddingHorizontal:16), `sectionOuter` (marginVertical:10), `headerRow` (flexDirection:row, alignItems:center, justifyContent:space-between)
  - **text**: `sectionHeading` (fontWeight:700, TEXT_PRIMARY, System), `sectionHeadingPadded` (+paddingHorizontal:16, marginBottom:12), `sectionSubtitle` (fontWeight:400, TEXT_SECONDARY, System), `errorTitle` (TEXT_PRIMARY, fontSize:22, bold, System, marginBottom:8), `errorMessage` (TEXT_SECONDARY, fontSize:15, System, textAlign:center), `accentLinkText` (fontWeight:600, ACCENT, System)
  - **card**: `base` (borderRadius:12, overflow:hidden), `surface` (base + SURFACE_COLOR)
  - **button**: `accent` (ACCENT bg, borderRadius:8, paddingHorizontal:24, paddingVertical:12), `accentText` (TEXT_PRIMARY, System, fontSize:16, fontWeight:600), `iconButton44` (44x44, centered)
  - **feedback**: `pressed` (opacity:0.85)
  - **overlay**: `playOverlay` (absoluteFill, centered)
  - **carousel**: `listContent` (paddingHorizontal:16, gap:12)

**Patterns to follow:**

- `src/lib/color.ts` — same export pattern (named exports)
- `useTypography.ts` — style objects composed via arrays, not spreads

**Test expectation:** none — pure style definitions with no logic. Verified via visual inspection in consuming components.

**Verification:**

- File exists at `apps/mobile-v2/src/styles/shared.ts`
- All style groups import color constants (no raw hex values)
- TypeScript compiles without errors

---

- [x] **Unit 2: Migrate app/ route files (4 files)**

**Goal:** Replace duplicated inline styles with shared imports in the 4 route-level screen files. Fix raw hex literals.

**Requirements:** R4, R5, R6

**Dependencies:** Unit 1

**Files:**

- Modify: `apps/mobile-v2/app/(tabs)/index.tsx`
- Modify: `apps/mobile-v2/app/(tabs)/library.tsx`
- Modify: `apps/mobile-v2/app/collection/[sectionKey].tsx`
- Modify: `apps/mobile-v2/app/video/[sectionKey].tsx`

**Approach:**

- Add `import { layout, text, feedback, overlay, button } from "../../src/styles/shared"` (adjust relative path per file)
- Replace matching local styles with shared references in style arrays: `style={shared.layout.centered}` or `style={[shared.text.sectionHeading, typography.heading]}`
- Keep local styles that are unique to each screen (e.g., `playerContainer`, `row`, `thumbnailContainer`, `nowPlayingBadge`, `activeBar` in collection player)
- **index.tsx**: Replace all raw hex literals with color constant imports (`"#1c1917"` → `BG_COLOR`, `"#f5f5f4"` → `TEXT_PRIMARY`, etc.)
- Shared patterns per file:
  - **index.tsx**: `centered`, `errorTitle`, `errorMessage`, `pressed` (retryButtonPressed), plus raw hex fixes
  - **library.tsx**: `screenContainer`, `accent` button, `accentText`, `pressed`
  - **collection/[sectionKey].tsx**: `screenContainer`, `centered`, `errorTitle`, `errorMessage`, `sectionHeading` (title), `sectionSubtitle`
  - **video/[sectionKey].tsx**: `screenContainer`, `centered`, `errorTitle`, `errorMessage`, `sectionHeading`, `sectionSubtitle`, `playOverlay`, `accentLinkText`, `iconButton44`

**Patterns to follow:**

- Existing style array composition: `style={[shared.text.errorTitle]}` for sole style, `style={[shared.text.sectionHeading, typography.heading]}` when composing with typography

**Test expectation:** none — pure style reference swap with no behavioral change. Verified visually.

**Verification:**

- Each file compiles without TypeScript errors
- Each file still has a local `StyleSheet.create()` for its unique styles
- Visual inspection: screens look identical before and after

---

- [x] **Unit 3: Migrate section renderers — batch 1 (7 files)**

**Goal:** Replace duplicated styles with shared imports in the first batch of section renderers.

**Requirements:** R4, R5, R6

**Dependencies:** Unit 1

**Files:**

- Modify: `apps/mobile-v2/src/components/sections/VideoCarouselRenderer.tsx`
- Modify: `apps/mobile-v2/src/components/sections/VideoCardRenderer.tsx`
- Modify: `apps/mobile-v2/src/components/sections/NavigationCarouselRenderer.tsx`
- Modify: `apps/mobile-v2/src/components/sections/MediaCollectionRenderer.tsx`
- Modify: `apps/mobile-v2/src/components/sections/TextRenderer.tsx`
- Modify: `apps/mobile-v2/src/components/sections/ContainerRenderer.tsx`
- Modify: `apps/mobile-v2/src/components/sections/SectionWrapperRenderer.tsx`

**Approach:**

- Import from `../../styles/shared`
- Shared patterns per file:
  - **VideoCarouselRenderer**: `sectionOuter`, `sectionHeadingPadded`, `sectionSubtitle`, `carousel.listContent`, `card.surface`, `playOverlay`, `pressed`
  - **VideoCardRenderer**: `sectionHeading` (title), `sectionSubtitle`, `card.base` or `card.surface`, `playOverlay`, `pressed`
  - **NavigationCarouselRenderer**: `sectionOuter`, `sectionHeadingPadded`, `carousel.listContent`, `card.base`, `pressed`. Fix raw hex (`"#f5f5f4"` → TEXT_PRIMARY, `"#ffffff"` → TEXT_ON_OVERLAY)
  - **MediaCollectionRenderer**: `sectionOuter` (compose with local paddingVertical:8), `sectionHeadingPadded` (compose with local marginBottom:20), `sectionSubtitle`, `carousel.listContent`, `card.surface`, `pressed`
  - **TextRenderer**: `sectionOuter` (compose with local padding), `sectionHeading`, `sectionSubtitle`, `accentLinkText`
  - **ContainerRenderer**: `sectionOuter`
  - **SectionWrapperRenderer**: `sectionOuter`

**Patterns to follow:**

- When shared style is close but not exact, compose: `style={[shared.layout.sectionOuter, styles.localPadding]}`

**Test expectation:** none — pure style reference swap. Verified visually.

**Verification:**

- All 7 files compile without TypeScript errors
- Each retains local styles for unique properties
- Visual inspection: all sections render identically

---

- [x] **Unit 4: Migrate section renderers — batch 2 (6 files)**

**Goal:** Replace duplicated styles with shared imports in the remaining section renderers.

**Requirements:** R4, R5, R6

**Dependencies:** Unit 1

**Files:**

- Modify: `apps/mobile-v2/src/components/sections/RelatedQuestionsRenderer.tsx`
- Modify: `apps/mobile-v2/src/components/sections/BibleQuotesCarouselRenderer.tsx`
- Modify: `apps/mobile-v2/src/components/sections/QuizButtonRenderer.tsx`
- Modify: `apps/mobile-v2/src/components/sections/VideoHeroRenderer.tsx`
- Modify: `apps/mobile-v2/src/components/sections/EasterDatesRenderer.tsx`
- Modify: `apps/mobile-v2/src/components/sections/CuratedHomeLayout.tsx`

**Approach:**

- Shared patterns per file:
  - **RelatedQuestionsRenderer**: `sectionOuter` (compose with local padding), `sectionHeading`, `headerRow`, `iconButton44`. Fix raw hex (`"#f5f5f4"` → TEXT_PRIMARY, `"#a8a29e"` → TEXT_SECONDARY, `"#d6d3d1"` → TEXT_BODY)
  - **BibleQuotesCarouselRenderer**: `sectionOuter`, `sectionHeading`, `headerRow` (compose with local paddingHorizontal/marginBottom), `carousel.listContent`, `card.base`, `iconButton44`. Fix raw hex (`"#f5f5f4"` → TEXT_PRIMARY, `"#ffffff"` → TEXT_ON_OVERLAY)
  - **QuizButtonRenderer**: `sectionOuter` (compose with local padding), `pressed`
  - **VideoHeroRenderer**: `pressed` (ctaButtonPressed). Fix raw hex (`"#f5f5f4"` → TEXT_PRIMARY, `"#a8a29e"` → TEXT_SECONDARY, `"#ffffff"` → TEXT_ON_OVERLAY). Note: VideoHero has many unique styles (gradient overlays, absolute positioning, hero-specific layout) — most styles stay local.
  - **EasterDatesRenderer**: `sectionOuter` (compose with local padding). Note: EasterDates uses a light card scheme with dark text — its styles are intentionally different from the dark-theme shared styles. Unique gradient hex colors (#5b9bd5, #d4a033, #c0392b) have no color.ts equivalents and stay inline.
  - **CuratedHomeLayout**: `screenContainer`. Fix raw hex (`"#1c1917"` → BG_COLOR)

**Patterns to follow:**

- Same composition pattern as Unit 3
- For VideoHeroRenderer and EasterDatesRenderer, most styles remain local — only extract what is truly shared

**Test expectation:** none — pure style reference swap. Verified visually.

**Verification:**

- All 6 files compile without TypeScript errors
- VideoHeroRenderer and EasterDatesRenderer retain the majority of their local styles
- Visual inspection: all sections render identically

---

- [x] **Unit 5: Migrate UI components and contexts (3 files)**

**Goal:** Replace duplicated styles with shared imports in the remaining non-section files.

**Requirements:** R4, R5, R6

**Dependencies:** Unit 1

**Files:**

- Modify: `apps/mobile-v2/src/components/ui/HomeHeader.tsx`
- Modify: `apps/mobile-v2/src/components/ui/PlaceholderScreen.tsx`
- Modify: `apps/mobile-v2/src/contexts/ExperienceShell.tsx`

**Approach:**

- **PlaceholderScreen**: `centered` (container), `errorTitle` (title). Fix raw hex (`"#1c1917"` → BG_COLOR, `"#f5f5f4"` → TEXT_PRIMARY, `"#a8a29e"` → TEXT_SECONDARY)
- **ExperienceShell**: `centered` (center), `accent` button (retryButton), `accentText` (retryText)
- **HomeHeader**: Audit for shared patterns — likely minimal overlap since it's a specialized glass-effect header. May only share spacing constants.

**Patterns to follow:**

- Same as previous units

**Test expectation:** none — pure style reference swap. Verified visually.

**Verification:**

- All 3 files compile without TypeScript errors
- Visual inspection: components render identically

## System-Wide Impact

- **Interaction graph:** No behavioral changes. Only `StyleSheet.create()` references change — no callbacks, middleware, or observers affected.
- **Error propagation:** No change. Styles are static objects resolved at import time.
- **State lifecycle risks:** None. `StyleSheet.create()` is evaluated once at module load — no partial-write or cache concerns.
- **API surface parity:** N/A — no APIs changed.
- **Integration coverage:** No cross-layer scenarios — this is a pure presentation refactor.
- **Unchanged invariants:** All component props, event handlers, navigation, data flow, and render logic remain untouched. Only style references change.

## Risks & Dependencies

| Risk                                             | Mitigation                                                                                                                           |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Style array ordering changes property resolution | Convention: shared styles always first in array, local overrides last. Document in shared.ts header comment.                         |
| Missing a duplicated pattern during migration    | Audit identified all 16 groups exhaustively. Implementer can grep for remaining raw hex after migration to catch stragglers.         |
| Subtle visual regression from style composition  | R6 requires visual inspection per screen. Compare before/after on iOS simulator.                                                     |
| Shared style becomes a "god file" over time      | 16 groups across 7 namespaces is manageable. If it grows past ~30 groups, split into per-namespace files (layout.ts, text.ts, etc.). |

## Sources & References

- **Origin document:** [docs/brainstorms/2026-04-09-mobile-shared-styles-requirements.md](docs/brainstorms/2026-04-09-mobile-shared-styles-requirements.md)
- Related learning: [docs/solutions/mobile/typography-token-scope-shared-vs-purpose-specific.md](docs/solutions/mobile/typography-token-scope-shared-vs-purpose-specific.md) — incidental equality ≠ intentional coupling
- Related learning: [docs/solutions/mobile/responsive-typography-hook.md](docs/solutions/mobile/responsive-typography-hook.md) — migration pattern for style arrays
- Related learning: [docs/solutions/mobile/audit-driven-video-detail-refactor.md](docs/solutions/mobile/audit-driven-video-detail-refactor.md) — color token patterns
- Related code: `apps/mobile-v2/src/lib/color.ts`, `apps/mobile-v2/src/hooks/useTypography.ts`
