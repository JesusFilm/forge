---
title: "TV Carousel Card Conformance — Matching Mobile/Web Visual Patterns"
date: 2026-04-16
last_updated: 2026-06-24
category: best-practices
module: apps/tv
problem_type: best_practice
component: frontend_stimulus
severity: medium
applies_when:
  - "Adding a new SDUI carousel renderer to the TV app"
  - "Upgrading a text-only TV card to a rich image card"
  - "Adding CTA (call-to-action) support to a TV carousel card"
  - "Extracting a shared modal component for reuse across renderers"
tags:
  - tv
  - carousel
  - sdui
  - react-native-tvos
  - expo-image
  - linear-gradient
  - webview
  - cta
---

# TV Carousel Card Conformance — Matching Mobile/Web Visual Patterns

## Context

The TV app's SDUI pipeline renders the same content as mobile and web but with TV-optimized renderers. When Bible Quotes carousel cards were initially implemented for TV, they used plain text on a flat dark surface — while mobile and web showed rich square cards with background images, gradient overlays, italic quotes, and CTA buttons. This visual inconsistency made the TV experience feel incomplete. The conformance work established repeatable patterns for upgrading any TV carousel card to match the cross-platform visual standard.

A first implementation attempt jumped straight to code before brainstorming — it was reverted and redone properly through the brainstorm/plan/work pipeline. (session history)

## Guidance

### 1. Image + Gradient + Text Overlay Card Pattern

Follow `NavigationCarouselRenderer` as the canonical reference for any carousel card with a background image:

- **Square geometry**: `CARD_SIZE = scale(340)` for both width and height
- **Background image**: `expo-image` with `StyleSheet.absoluteFill`, `contentFit="cover"`, and `recyclingKey`. Always validate URLs through `resolveImageUrl()` — condition rendering on the resolved value, not the raw CMS field
- **Gradient overlay**: `LinearGradient` with `colors={[hexToRgba(bgColor, 0), bgColor]}` and `locations={[0, 0.6]}`. Never use the string `"transparent"` — it resolves to `rgba(0,0,0,0)` on Android, creating dark banding
- **Bottom-anchored text**: Content `View` with `StyleSheet.absoluteFillObject`, `justifyContent: "flex-end"`, `padding: scale(20)`
- **Per-card backgroundColor**: Source from CMS data with fallback (`#292524`)
- **Accessibility**: `accessibilityLabel` on the outer `FocusableCard`

### 2. Shared Modal Extraction

When a modal component has only 2-3 parametric differences between usages, extract it rather than duplicate:

- `LinkModal` accepts: `url`, `visible`, `onClose`, `urlValidator: (url: string) => boolean`, `errorText?`, `qrHeading?`
- Keep all WebView security hardening inside the shared component (`allowFileAccess={false}`, `mixedContentMode="never"`, `thirdPartyCookiesEnabled={false}`, etc.)
- Keep platform branching inside the shared component — the conditional `require()` for WebView on tvOS prevents TurboModule registration crashes
- Only mount the modal when a valid URL is selected (`selectedCtaUrl != null`) — never pass an empty string URL to WebView

### 3. Single CTA Validation Site

Validate CTA URLs once in the parent (`renderItem`), pass the validated result as a prop to the child:

```
// In renderItem — single validation site
const hasValidCta = item.ctaLabel != null && item.ctaLink != null && validateActionUrl(item.ctaLink)
const validCtaLink = hasValidCta ? item.ctaLink : null
const validCtaLabel = hasValidCta ? (item.ctaLabel ?? null) : null

// Child receives pre-validated props — no re-validation
<QuoteCard ctaLabel={validCtaLabel} onPress={...} />
```

Duplicate validation in parent and child was caught during code review as a P1 issue — the two guards can theoretically diverge if the validator signature changes.

### 4. Carousel Center Alignment

For carousels where the total card width may not fill the screen:

```
contentContainerStyle={{ flexGrow: 1, justifyContent: "center" }}
```

Note: this defeats FlatList virtualization since all items must render to measure total width. Acceptable for small lists (Bible quotes typically have 4-6 items) but avoid for lists with 20+ items.

## Why This Matters

- **Visual consistency**: Users moving between mobile, web, and TV see the same card metaphor. Image cards with gradient overlays are the established cross-platform pattern.
- **No dark banding**: `hexToRgba(color, 0)` is enforced in the TV CLAUDE.md. String `"transparent"` causes visible black bands on Android TV gradient interpolation.
- **tvOS TurboModule safety**: `react-native-webview` is not available on tvOS. A top-level `import` crashes the app before any component mounts. Conditional `require()` inside the shared modal is the only safe pattern.
- **DRY security hardening**: WebView security config is non-trivial (~10 props). Centralizing it in `LinkModal` means security fixes propagate to all consumers automatically.
- **FocusableCard two-layer architecture**: The outer `Animated.View` (`overflow: "visible"`) handles the scale animation and the focus ring + drop shadow (a white **border ring** by default since the focus-consistency change; crimson is opt-in for near-white surfaces — see Related). The inner `View` (`overflow: "hidden"`, `collapsable={false}`) clips content to border radius. This split is load-bearing for all image cards — `expo-image` with `absoluteFill` inside a single `overflow: "hidden"` View is invisible on Android TV. (session history)

## When to Apply

- **New carousel renderer**: Any new SDUI block renderer (e.g., `TestimonialsCarouselRenderer`) should follow the image + gradient pattern from `NavigationCarouselRenderer`
- **Text-to-image card upgrade**: When upgrading a text-only card to show CMS images, follow the `BibleQuotesCarouselRenderer` transformation as a reference
- **Adding CTA to a card**: Use `LinkModal` with `validateActionUrl` for general HTTPS links, `isAllowedQuizUrl` for quiz-specific domains
- **Any `LinearGradient` in TV app**: Always use `hexToRgba()` for gradient stops — no exceptions
- **Any WebView usage in TV app**: Gate the `require()` behind `Platform.OS === "android"` at module level

## Examples

### Before: Plain text card

```
const CARD_WIDTH = scale(400)

<FocusableCard style={{ width: CARD_WIDTH, backgroundColor: "#221F1D", padding: scale(24) }}>
  <Text style={{ color: "#CB333B" }}>{quote.reference}</Text>
  <Text style={{ color: "#F5F5F4" }}>{quote.text}</Text>
</FocusableCard>
```

### After: Square image card with gradient overlay

```
const CARD_SIZE = scale(340)

<FocusableCard
  style={{ ...styles.card, backgroundColor: bgColor }}
  accessibilityLabel={`${quote.reference}: ${quote.text}`}
>
  {imageSource != null && (
    <Image source={imageSource} style={StyleSheet.absoluteFill} contentFit="cover" />
  )}
  <LinearGradient
    colors={[hexToRgba(bgColor, 0), bgColor]}
    locations={[0, 0.6]}
    style={StyleSheet.absoluteFill}
    pointerEvents="none"
  />
  <View style={{ ...StyleSheet.absoluteFillObject, justifyContent: "flex-end", padding: scale(20) }}>
    <Text style={{ fontWeight: "800", letterSpacing: 1.5 }}>{quote.reference.toUpperCase()}</Text>
    <Text style={{ fontStyle: "italic" }}>{quote.text}</Text>
    {ctaLabel != null && (
      <View style={{ borderRadius: scale(20), backgroundColor: "rgba(255,255,255,0.2)" }}>
        <Text>{ctaLabel}</Text>
      </View>
    )}
  </View>
</FocusableCard>
```

### Before: 130 lines of WebView/QR modal inline in QuizButtonRenderer

### After: Shared LinkModal with parameterized props

```
// QuizButtonRenderer — quiz-specific validator
<LinkModal url={iframeSrc} urlValidator={isAllowedQuizUrl} errorText="Couldn't load the quiz." />

// BibleQuotesCarouselRenderer — general HTTPS validator
{selectedCtaUrl != null && (
  <LinkModal url={selectedCtaUrl} urlValidator={validateActionUrl} errorText="Couldn't load the page." />
)}
```

## Related

- `docs/solutions/ui-bugs/tv-carousel-card-focus-animation-overflow-20260416.md` — FocusableCard two-layer architecture, crimson glow, FlatList item padding
- `docs/solutions/best-practices/tv-focus-white-ring-default-and-light-surface-exception.md` — the white-ring focus default that superseded the crimson glow; light-surface crimson opt-in
- `docs/solutions/ui-bugs/android-tv-density-scaling-and-native-view-clipping-20260416.md` — `scale()` utility, `expo-image` inside `overflow: "hidden"` on Android TV
- `docs/solutions/mobile/linear-gradient-dark-banding-transparent-keyword.md` — `hexToRgba()` origin and the `"transparent"` keyword ban
- `docs/solutions/best-practices/react-native-tvos-porting-pitfalls-20260414.md` — WebView conditional require, absolute positioning focus issues
- `docs/solutions/best-practices/expo-tv-platform-setup-sdui-monorepo-20260410.md` — SDUI pipeline architecture, TVFocusGuideView patterns
- PR: https://github.com/JesusFilm/forge/pull/792
