---
title: "feat: Conform TV Bible Quotes carousel cards to mobile/web visual pattern"
type: feat
status: complete
date: 2026-04-16
origin: docs/brainstorms/2026-04-16-tv-bible-quotes-card-conformance-requirements.md
---

# feat: Conform TV Bible Quotes carousel cards to mobile/web visual pattern

> **Status note (2026-04-24):** Shipped on 2026-04-17 via PR #792 (commit `21b58d5`). All three implementation units below are complete and reflected in the current codebase (`apps/tv/src/components/LinkModal.tsx`, `apps/tv/src/components/sections/BibleQuotesCarouselRenderer.tsx`, `apps/tv/src/components/sections/QuizButtonRenderer.tsx`). A companion pattern doc was captured at `docs/solutions/best-practices/tv-carousel-card-conformance-pattern-20260416.md`. Requirements R1–R9 are all satisfied. The only planned deliverable that did not ship is the `LinkModal.test.tsx` file listed under Unit 1 — no unit test file was added. Kept for historical reference; do not re-execute.

## Overview

Update the TV app's `BibleQuotesCarouselRenderer` to render square image cards with gradient overlays, bottom-anchored text, and CTA support — matching the visual pattern already established in mobile and web. Extract a reusable WebView/QR modal from `QuizButtonRenderer` so CTA links can open in-app on both Android TV and tvOS.

## Problem Frame

The TV Bible Quotes carousel currently renders plain text-only cards (crimson reference text on a flat dark surface) while mobile and web show rich square cards with background images, gradient overlays, italic quotes, and actionable CTA buttons. This inconsistency makes the TV experience feel incomplete. (see origin: `docs/brainstorms/2026-04-16-tv-bible-quotes-card-conformance-requirements.md`)

## Requirements Trace

- R1. Cards use 1:1 square aspect ratio (~`scale(340)` square)
- R2. Background image with `LinearGradient` overlay using `hexToRgba(backgroundColor, 0)` → `backgroundColor` at `locations={[0, 0.6]}`
- R3. Quote text, reference, and attribution positioned at the bottom over the gradient
- R4. Reference uppercase with letter-spacing; quote italic; attribution uppercase and bold above reference
- R5. Per-card `backgroundColor` from CMS, fallback `#292524`
- R6. Focusable CTA button validated with `validateActionUrl()`, suppressed silently if invalid
- R7. CTA opens WebView modal (Android TV) or QR code (tvOS); modal has close button with `hasTVPreferredFocus`; focus restores on dismiss
- R8. D-pad focusable with crimson glow focus ring via `FocusableCard`
- R9. Use existing design tokens (`COLORS`), `scale()`, and `hexToRgba()`

## Scope Boundaries

- No pagination dots — TV uses D-pad horizontal scrolling
- No share button — TV has no native share sheet
- No `useTypography` hook — System font with `scale()` per TV conventions
- No changes to GraphQL fragments — all fields already queried

### Deferred to Separate Tasks

- Android TV focus glow fallback (shadows are iOS-only; Android needs `elevation` or border): tracked separately

## Context & Research

### Relevant Code and Patterns

- `apps/tv/src/components/sections/NavigationCarouselRenderer.tsx` — image + gradient card pattern to follow
- `apps/tv/src/components/sections/QuizButtonRenderer.tsx` — WebView/QR modal pattern to extract
- `apps/tv/src/components/FocusableCard.tsx` — two-layer focus animation wrapper (outer Animated.View for layout/glow, inner View for content clipping)
- `apps/tv/src/lib/colors.ts` — `COLORS` tokens and `hexToRgba()`
- `apps/tv/src/lib/scale.ts` — density-aware scaling (1920px reference canvas)
- `apps/tv/src/lib/resolveImageUrl.ts` — CMS image URL resolution
- `apps/tv/src/lib/validateUrl.ts` — `validateActionUrl()` for general HTTPS URLs, `isAllowedQuizUrl()` for quiz-specific domains

### Institutional Learnings

- **LinearGradient dark banding** (`docs/solutions/mobile/linear-gradient-dark-banding-transparent-keyword.md`): Never use the string `"transparent"` — always `hexToRgba(color, 0)`. The TV CLAUDE.md and `colors.ts` already enforce this.
- **TV carousel focus overflow** (`docs/solutions/ui-bugs/tv-carousel-card-focus-animation-overflow-20260416.md`): FlatList clips its content frame. Item wrappers need `paddingVertical: scale(40)` for focus glow clearance.
- **Android TV native view clipping** (`docs/solutions/ui-bugs/android-tv-density-scaling-and-native-view-clipping-20260416.md`): `overflow: "hidden"` on plain Views can clip expo-image/LinearGradient paint on Android. FocusableCard's two-layer split with `collapsable={false}` handles this.
- **Absolute positioning breaks tvOS focus** (`docs/solutions/best-practices/react-native-tvos-porting-pitfalls-20260414.md`): tvOS UIFocusEngine traverses flex/document order. Absolutely positioned focusable elements are unreliable. All interactive elements must be in normal flex flow.
- **WebView tvOS crash** (`docs/solutions/best-practices/react-native-tvos-porting-pitfalls-20260414.md`): tvOS has no WebKit native module. Static `import` of `react-native-webview` crashes immediately. Must use conditional `require()` with `Platform.OS === "android"` guard.

## Key Technical Decisions

- **Card size `scale(340)` square**: NavigationCarousel uses `scale(260)` × `scale(300)`. Bible Quotes cards carry more text (full quote passages), so a slightly larger square card improves readability at 10-foot distance. `scale(340)` keeps visual consistency with other carousels while giving enough room for content.
- **Whole-card press for CTA (no nested Pressable)**: When a CTA is present, pressing the card itself opens the WebView/QR modal. The CTA label renders as styled text (not a nested focusable button). This avoids the tvOS focus engine issue with nested Pressables inside FocusableCard and matches the QuizButtonRenderer pattern where the entire card triggers the action.
- **No-image layout stays bottom-anchored**: When `imageUrl` is absent, the gradient overlays the solid `backgroundColor`. Text stays bottom-anchored for visual consistency across all cards, matching mobile's behavior.
- **Extract shared `LinkModal` from QuizButtonRenderer**: The modal pattern is ~130 lines of UI logic with only 3 differences between quiz and CTA usage (URL validator, error text, QR heading). Extracting avoids duplication and ensures both consumers benefit from future fixes. QuizButtonRenderer will import `LinkModal`, reducing its size.
- **`validateActionUrl()` for CTA links, `isAllowedQuizUrl()` for quiz URLs**: The shared modal accepts a validator function prop. Each consumer passes its own validator. The WebView's `onShouldStartLoadWithRequest` handler also receives the validator so in-page navigation is restricted to the same domain policy.

## Open Questions

### Resolved During Planning

- **Should the WebView/QR modal be extracted or duplicated?** Extract. The modal is ~130 lines with only 3 parameterizable differences. Duplication would create maintenance burden for security-sensitive code (WebView config, URL validation). Extraction also positions the modal for future reuse (e.g., CTA buttons in other renderers).
- **What does pressing the card do when CTA is present?** The card press opens the modal. No nested CTA button — the CTA label is visual-only. This follows the QuizButtonRenderer pattern and avoids tvOS focus engine issues.
- **What happens when imageUrl is absent?** Same bottom-anchored layout over solid backgroundColor. The gradient still renders (transparent to opaque over the same solid color is a no-op visually).
- **R5 fallback condition?** Standard null coalescing: `quote.backgroundColor ?? "#292524"`. Invalid/empty colors are an upstream CMS data quality concern.

### Deferred to Implementation

- Exact font size tuning for quote text at `scale(340)` card size — may need adjustment after visual testing on device
- Whether `numberOfLines` truncation on quote text needs a "..." indicator or is acceptable as-is

## Implementation Units

- [x] **Unit 1: Extract shared LinkModal from QuizButtonRenderer** — _shipped 2026-04-17 in PR #792_

**Goal:** Create a reusable WebView/QR modal component and refactor QuizButtonRenderer to consume it.

**Requirements:** Enables R7

**Dependencies:** None

**Files:**
- Create: `apps/tv/src/components/LinkModal.tsx` — _done_
- Modify: `apps/tv/src/components/sections/QuizButtonRenderer.tsx` — _done_
- Test: `apps/tv/src/components/LinkModal.test.tsx` — _not shipped (no unit test added)_

**Approach:**
- Extract `QrMatrix`, `AndroidTvWebViewContent`, `TvOSQrContent`, and the `Modal` wrapper into `LinkModal.tsx`
- The `LinkModal` component accepts: `url: string`, `visible: boolean`, `onClose: () => void`, `urlValidator: (url: string) => boolean`, `errorText?: string`, `qrHeading?: string`
- Move the conditional WebView `require()` and `isTvOS` constant into the new file (module-level, same pattern)
- `QuizButtonRenderer` imports `LinkModal` and passes `isAllowedQuizUrl` as the validator, `"Couldn't load the quiz."` as error text
- Preserve all existing WebView security hardening (allowFileAccess=false, mixedContentMode="never", thirdPartyCookiesEnabled=false, etc.)
- The close button with `hasTVPreferredFocus` stays inside `LinkModal` — it handles its own focus management
- Styles that are modal-specific move to the new file; quiz-specific styles stay in QuizButtonRenderer

**Patterns to follow:**
- `apps/tv/src/components/sections/QuizButtonRenderer.tsx` — source pattern, lift code out
- Platform-conditional `require()` for WebView (never static import)
- `FocusableCard` for the close button (in normal flex flow, not absolute positioned)

**Test scenarios:**
- Happy path: LinkModal renders Modal with close button when visible=true
- Happy path: Android TV branch renders WebView with the provided url
- Happy path: tvOS branch renders QR code with the provided url
- Edge case: urlValidator returning false prevents WebView navigation to disallowed URLs
- Edge case: visible=false renders nothing
- Integration: QuizButtonRenderer still opens modal and functions identically after refactor

**Verification:**
- QuizButtonRenderer behaves identically before and after — quiz modal opens, close button works, WebView loads on Android TV, QR shows on tvOS
- `LinkModal` can be imported independently

---

- [x] **Unit 2: Update QuoteCard to square image cards with gradient overlay** — _shipped 2026-04-17 in PR #792_

**Goal:** Transform the Bible Quotes card from plain text to a square card with background image, gradient overlay, and bottom-anchored text — matching mobile/web visual pattern.

**Requirements:** R1, R2, R3, R4, R5, R8, R9

**Dependencies:** None (independent of Unit 1)

**Files:**
- Modify: `apps/tv/src/components/sections/BibleQuotesCarouselRenderer.tsx`

**Approach:**
- Expand `QuoteItem` type to include `imageUrl`, `backgroundColor`, `ctaLabel`, `ctaLink` (data already flows from GraphQL)
- Change card dimensions to `scale(340)` × `scale(340)` square
- Replace the simple text layout with the image + gradient + text overlay pattern from NavigationCarouselRenderer:
  - `FocusableCard` with `overflow: "hidden"` (handled by inner View)
  - `Image` from expo-image with `StyleSheet.absoluteFill`, `contentFit: "cover"`, `recyclingKey`
  - `LinearGradient` with `colors={[hexToRgba(bgColor, 0), bgColor]}`, `locations={[0, 0.6]}`, `pointerEvents="none"`
  - Content `View` with `absoluteFillObject`, `justifyContent: "flex-end"`, `padding: scale(20)`
- Text styling to match mobile/web:
  - Attribution (when present): uppercase, bold (`fontWeight: "800"`), `letterSpacing: 0.8`, white at 0.9 opacity
  - Reference: uppercase, bold, `letterSpacing: 1.5`, white at 0.7 opacity
  - Quote text: italic (`fontStyle: "italic"`), white at 0.9 opacity
- Per-card `backgroundColor`: `quote.backgroundColor ?? "#292524"`
- When `resolveImageUrl(quote.imageUrl)` returns null (absent, invalid, or non-HTTPS in production), skip the `Image` component — gradient overlays the solid backgroundColor. Condition on the resolved URL, not the raw CMS field (matching NavigationCarouselRenderer's `imageSource != null` pattern)
- Resolve image URLs through `resolveImageUrl()` before passing to `Image`
- Import `COLORS` and `hexToRgba` from `../../lib/colors` (replacing inline color constants)
- Add `accessibilityLabel` to `FocusableCard`: `${quote.reference}: ${quote.text}`

**Patterns to follow:**
- `apps/tv/src/components/sections/NavigationCarouselRenderer.tsx` — image + gradient overlay pattern (lines 43-77)
- `apps/tv/src/components/sections/MediaCollectionRenderer.tsx` — gradient with `locations` prop
- All TV renderers — `scale()` on all dp values, `"System"` font, `paddingVertical: scale(40)` on card wrapper

**Test scenarios:**
- Test expectation: none — this is a visual styling change with no behavioral logic beyond rendering. Visual verification on device.

**Verification:**
- Cards render as squares with background image and gradient when `imageUrl` is present
- Cards render as squares with solid background when `imageUrl` is absent
- Text is bottom-anchored with correct typography (italic quote, uppercase reference, bold attribution)
- Focus glow works correctly — scale animation and crimson shadow on focus
- D-pad navigation scrolls through cards horizontally

---

- [x] **Unit 3: Wire CTA press to LinkModal** — _shipped 2026-04-17 in PR #792_

**Goal:** When a Bible Quote card has a valid CTA link, pressing the card opens the shared LinkModal (WebView on Android TV, QR on tvOS).

**Requirements:** R6, R7

**Dependencies:** Unit 1 (LinkModal), Unit 2 (updated card visual)

**Files:**
- Modify: `apps/tv/src/components/sections/BibleQuotesCarouselRenderer.tsx`

**Approach:**
- Import `LinkModal` and `validateActionUrl`
- Add state at the carousel level: `selectedCtaUrl: string | null` (controls modal visibility)
- In `QuoteCard`: if `ctaLabel` is present and `ctaLink` passes `validateActionUrl()`, render the CTA label as styled text on the card (pill-style, semi-transparent background) and set the card's `onPress` to open the modal with the URL
- If no valid CTA, keep existing console.log press handler
- Only render `<LinkModal>` when `selectedCtaUrl != null` (do not mount with an empty-string URL — React Native Modal may mount children even when `visible={false}`, which would pass an empty URI to WebView). Pattern: `{selectedCtaUrl != null && <LinkModal url={selectedCtaUrl} visible onClose={() => setSelectedCtaUrl(null)} urlValidator={validateActionUrl} errorText="Couldn't load the page." qrHeading="Scan to visit on your phone" />}`
- On modal close, `selectedCtaUrl` resets to null — focus returns to the carousel naturally since the FlatList and its cards retain their focus state

**Patterns to follow:**
- `apps/tv/src/components/sections/QuizButtonRenderer.tsx` — modal open/close state pattern
- CTA label styling: match mobile's pill button appearance — `paddingHorizontal: scale(16)`, `paddingVertical: scale(8)`, `borderRadius: scale(20)`, `backgroundColor: "rgba(255,255,255,0.2)"`

**Test scenarios:**
- Happy path: Card with valid ctaLabel + ctaLink shows CTA label text on card; pressing opens LinkModal
- Happy path: LinkModal close resets state and carousel is navigable
- Edge case: Card with ctaLabel but invalid ctaLink (fails validateActionUrl) does not show CTA label
- Edge case: Card with ctaLabel but null ctaLink does not show CTA label
- Edge case: Card without ctaLabel uses default console.log press handler

**Verification:**
- Pressing a CTA card opens the WebView modal on Android TV with the correct URL
- Pressing a CTA card shows the QR code on tvOS with the correct URL
- Closing the modal returns to the carousel with cards still navigable
- Non-CTA cards are unaffected

## System-Wide Impact

- **Interaction graph:** `BibleQuotesCarouselRenderer` gains a dependency on the new `LinkModal`. `QuizButtonRenderer` is refactored to also depend on `LinkModal`. No other renderers are affected.
- **Error propagation:** WebView load errors and QR generation errors are contained within `LinkModal` — same error boundaries as QuizButtonRenderer today.
- **API surface parity:** No GraphQL or API changes. The `BibleQuotesCarouselFragment` already queries all needed fields.
- **Unchanged invariants:** All other TV renderers, the SDUI dispatcher, and the navigation stack are unaffected. The carousel's FlatList structure and TVFocusGuideView wrapping remain unchanged.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Android TV `overflow: "hidden"` clips expo-image/LinearGradient paint | FocusableCard's two-layer pattern with `collapsable={false}` already handles this (verified in NavigationCarouselRenderer) |
| tvOS focus engine can't reach nested Pressable inside FocusableCard | Avoided entirely — CTA is visual-only text, card press opens modal. No nested focusable elements. |
| QuizButtonRenderer regression during extraction | Unit 1 verification: quiz modal must still function identically. Manual test on both platforms before moving to Unit 2. |
| Quote text truncation at `scale(340)` card size | `numberOfLines={6}` on quote text. Tunable during implementation after visual testing. |

## Sources & References

- **Origin document:** [docs/brainstorms/2026-04-16-tv-bible-quotes-card-conformance-requirements.md](docs/brainstorms/2026-04-16-tv-bible-quotes-card-conformance-requirements.md)
- **Shipped in:** PR #792 (commit `21b58d5`, merged 2026-04-17)
- **Post-ship pattern capture:** [docs/solutions/best-practices/tv-carousel-card-conformance-pattern-20260416.md](../solutions/best-practices/tv-carousel-card-conformance-pattern-20260416.md)
- Related patterns: `apps/tv/src/components/sections/NavigationCarouselRenderer.tsx`, `apps/tv/src/components/sections/QuizButtonRenderer.tsx`, `apps/tv/src/components/LinkModal.tsx`
- Institutional learnings: `docs/solutions/mobile/linear-gradient-dark-banding-transparent-keyword.md`, `docs/solutions/ui-bugs/tv-carousel-card-focus-animation-overflow-20260416.md`, `docs/solutions/best-practices/react-native-tvos-porting-pitfalls-20260414.md`
