---
date: 2026-04-16
topic: tv-bible-quotes-card-conformance
---

# TV Bible Quotes Card Conformance

> **Status note (2026-04-24):** Shipped on 2026-04-17 via PR #792 (commit `21b58d5`). Requirements R1–R9 are all satisfied in the current `main`. Relevant files: `apps/tv/src/components/sections/BibleQuotesCarouselRenderer.tsx`, `apps/tv/src/components/LinkModal.tsx`, `apps/tv/src/components/sections/QuizButtonRenderer.tsx`. Companion pattern doc: `docs/solutions/best-practices/tv-carousel-card-conformance-pattern-20260416.md`. Kept for historical reference.

## Problem Frame

The Bible Quotes carousel in the TV app renders as plain text-only cards (crimson reference text on a flat dark surface), while the same carousel in mobile and web uses square image cards with gradient overlays, italic quote text, and CTA support. This visual inconsistency makes the TV experience feel incomplete compared to other platforms.

## Requirements

**Visual Parity**

- R1. Cards use a 1:1 square aspect ratio, sized to match the existing TV NavigationCarousel (~340dp square) so ~3 cards are visible at once.
- R2. When `imageUrl` is present, render a background image covering the full card. Apply a `LinearGradient` overlay using `hexToRgba(backgroundColor, 0)` as the transparent stop and `backgroundColor` as the opaque stop, with `locations={[0, 0.6]}` so the image is fully visible at the top and covered by ~60%. Never use the string `"transparent"` as a gradient color.
- R3. Quote text, reference, and attribution are positioned at the bottom of the card over the gradient, matching mobile/web's overlay layout.
- R4. Reference text is uppercase with letter-spacing. Quote text is italic. Attribution (when present) is uppercase and bold above the reference.
- R5. Each card uses its own `backgroundColor` from CMS data, with a warm stone fallback (`#292524`) matching mobile.

**CTA Support**

- R6. When `ctaLabel` and `ctaLink` are present, validate `ctaLink` with `validateActionUrl()` before rendering. If valid, render a focusable CTA button on the card. If invalid, suppress the CTA button silently.
- R7. Pressing the CTA opens the link in a WebView modal on Android TV (reusing the existing `react-native-webview` pattern from QuizButtonRenderer) and shows a QR code on tvOS (since tvOS has no WebKit). The modal must include a close button with `hasTVPreferredFocus`. On dismiss, focus returns to the card that triggered the modal.

**TV-Specific Constraints**

- R8. Cards remain focusable via D-pad with the existing crimson glow focus ring from FocusableCard.
- R9. Use the TV app's existing design tokens (COLORS from `src/lib/colors.ts`), `scale()` for density-aware sizing, and `hexToRgba()` for gradient stops.

## Success Criteria

- Bible Quotes cards on TV are visually recognizable as the same component rendered on mobile and web.
- CTA links are actionable on both Android TV (WebView) and tvOS (QR code).
- Focus navigation works correctly across all cards in the carousel via D-pad.

## Scope Boundaries

- No pagination dots (TV uses horizontal D-pad scrolling, not swipe paging).
- No share button (TV has no native share sheet).
- No typography hook (`useTypography`) — use System font with `scale()` as per TV conventions.

## Key Decisions

- **Card size (~340dp square)**: Matches NavigationCarousel for visual consistency across TV carousels rather than mimicking mobile's full-width paged layout.
- **WebView + QR pattern for CTAs**: Reuses the proven QuizButtonRenderer approach rather than inventing a new mechanism. Android TV gets an in-app WebView; tvOS gets a scannable QR code.

## Dependencies / Assumptions

- The GraphQL fragment already queries all needed fields (`imageUrl`, `backgroundColor`, `ctaLabel`, `ctaLink`, `attribution`). No schema or query changes required.
- `expo-image`, `expo-linear-gradient`, and `react-native-webview` are already installed in the TV app.

## Outstanding Questions

### Deferred to Planning

- [Affects R7][Technical] Should the WebView/QR modal be extracted into a shared component, or duplicated from QuizButtonRenderer? Planning should assess the trade-off.

## Next Steps

-> `/ce:plan` for structured implementation planning _(completed — see `docs/plans/2026-04-16-002-feat-tv-bible-quotes-card-conformance-plan.md`; implementation shipped in PR #792)_
