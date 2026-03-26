---
title: "Decorative icons using View+Text pattern in mobile section renderers"
category: mobile
date: 2026-03-26
tags:
  - react-native
  - expo
  - icon
  - accessibility
  - dark-mode
  - section-renderer
  - typography-exclusion
severity: low
module: apps/mobile
component: apps/mobile/src/components/sections/RelatedQuestionsRenderer.tsx
---

# Decorative Icons Using View+Text Pattern in Mobile Section Renderers

## Problem

The mobile app's Related Questions section needed a leading icon (a "?" inside a rounded square) for each question row, matching the web app's design. The web app uses an SVG `QuestionIcon`, but the mobile app has no icon library (`react-native-svg`, `@expo/vector-icons`, etc.) as a dependency.

## Root Cause

The mobile app was built without an icon library dependency. When the Related Questions section was originally implemented, question rows were rendered as plain text + chevron, with no visual icon. The existing codebase had already solved a similar problem for the chevron indicator using a `View+Text` approach with a unicode character (`▸`), but this pattern had not been extended to the question icon.

## Solution

Create a `QuestionIcon` component using `View` + `Text` with a system-font `"?"` character inside a styled container, following the existing `AnimatedChevron` pattern in the same file.

### QuestionIcon Component

```tsx
function QuestionIcon({ isOnDark }: { isOnDark?: boolean }) {
  return (
    <View
      style={[styles.questionIcon, isOnDark && styles.questionIconLight]}
      accessibilityElementsHidden={true}
      importantForAccessibility="no-hide-descendants"
    >
      <Text
        style={[
          styles.questionIconText,
          isOnDark && styles.questionIconTextLight,
        ]}
      >
        ?
      </Text>
    </View>
  )
}
```

### Styles

```tsx
questionIcon: {
  width: 20,
  height: 20,
  borderRadius: 4,
  borderWidth: 1.5,
  borderColor: "#666666",
  alignItems: "center",
  justifyContent: "center",
  opacity: 0.25,
  marginRight: 14,
},
questionIconLight: {
  borderColor: "rgba(255, 255, 255, 0.7)",
},
questionIconText: {
  fontSize: 11, // Icon/badge size -- intentionally excluded from typography scale
  fontWeight: "600",
  color: "#666666",
  lineHeight: 13,
},
questionIconTextLight: {
  color: "rgba(255, 255, 255, 0.7)",
},
```

### Usage in QuestionItem

```tsx
<Pressable style={styles.questionRow} onPress={onToggle} ...>
  <QuestionIcon isOnDark={isOnDark} />
  <Text style={[styles.questionText, ...]}>{item.question}</Text>
  <AnimatedChevron isExpanded={isExpanded} isOnDark={isOnDark} />
</Pressable>
```

## Key Design Decisions

| Decision                                              | Rationale                                                                                                            |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| View+Text over SVG/icon library                       | No icon library dependencies exist in the mobile app; existing chevron uses same pattern                             |
| Fixed size (20x20), excluded from `useTypography`     | Decorative elements in fixed containers must not scale with responsive typography (see related doc below)            |
| Container-level `opacity: 0.25`                       | Keeps the icon subtle/muted as a decorative element, matching web's `opacity: 0.2`                                   |
| Hardcoded colors (`#666666`, `rgba(255,255,255,0.7)`) | Pre-existing pattern across all section renderers; matches chevron colors                                            |
| Both iOS + Android accessibility hiding               | `accessibilityElementsHidden` (iOS/VoiceOver) + `importantForAccessibility="no-hide-descendants"` (Android/TalkBack) |

## Known Trade-offs

- **Opacity stacking in hero layouts:** When rendered inside `FixedHeroLayout`, the container `opacity: 0.25` compounds with the `rgba` color values, yielding effective alpha ~0.175. Acceptable for a decorative element but worth monitoring if it becomes too faint.
- **System-font "?" vs SVG path:** The system-font `?` looks slightly different from the web's custom SVG question mark path. Visually close enough at 20x20px; exact match would require adding `react-native-svg`.
- **No `elevation` on icon container:** Per the translucent backgrounds doc, `elevation` on Android creates opaque layers inside hero context. Avoid it.

## Prevention: Checklist for Future Decorative Elements

Before adding a decorative element to a mobile section renderer:

- [ ] Use `View` + `Text` with Unicode characters -- do not add icon library dependencies
- [ ] Add both `accessibilityElementsHidden={true}` and `importantForAccessibility="no-hide-descendants"`
- [ ] Hardcode sizes in `StyleSheet.create` -- do NOT use `useTypography()` for icon/badge sizing
- [ ] Define paired dark/light styles, toggled via the `isOnDark` prop
- [ ] Test inside a translucent hero layout to catch opacity compounding
- [ ] Test on both iOS and Android (font rendering differs)
- [ ] Avoid `elevation` on containers inside hero context (Android opaque layer issue)

## Related Documentation

- [Responsive Typography Hook -- Exclusions](docs/solutions/mobile/responsive-typography-hook.md) -- documents that decorative elements (chevrons, icons, badges) are intentionally excluded from `useTypography()` scaling
- [Translucent Section Backgrounds with React Context](docs/solutions/mobile/translucent-section-backgrounds-with-react-context.md) -- documents forced color scheme in hero layouts and opacity stacking concerns
- [Full-Bleed Video Hero with Scroll-Over Content](docs/solutions/mobile/full-bleed-video-hero-with-scroll-over-content.md) -- layout architecture context for hero sections
- Web reference: `apps/web/src/components/sections/RelatedQuestions.tsx:15-33` (SVG QuestionIcon)
