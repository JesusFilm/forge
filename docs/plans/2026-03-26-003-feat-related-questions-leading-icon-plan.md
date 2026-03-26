---
title: "feat: Add leading question icon to Related Questions rows in mobile app"
type: feat
status: completed
date: 2026-03-26
---

# feat: Add leading question icon to Related Questions rows in mobile app

## Overview

Add a question mark symbol (`?` inside a rounded square) as a leading icon for each question row in the Related Questions section of the mobile app. This matches the reference web design where each question row has a decorative icon to the left of the question text.

## Problem Statement / Motivation

The mobile app's Related Questions section currently displays question text + chevron, without any leading icon. The web app already has a `QuestionIcon` SVG (a `?` inside a rounded rectangle at 20% opacity). The reference design shows this icon should also appear on mobile, improving visual hierarchy and making the section feel more polished.

## Proposed Solution

Create a `QuestionIcon` component using `View` + `Text` (no new dependencies) in `RelatedQuestionsRenderer.tsx`, styled as a `?` character inside a rounded square border with muted opacity. Place it before the question text in each row.

**Why View + Text instead of SVG or icon library:**

- The mobile app currently uses no icon library and no `react-native-svg`
- The existing chevron icon uses a unicode character (`▸`) with the same View + Text pattern
- No new dependencies needed
- A system-font `?` in a bordered container is visually close enough to the web's SVG path

## Technical Considerations

### Layout Change: `alignItems` on `questionRow`

The current `questionRow` uses `alignItems: "center"`. For multi-line questions (up to 3 lines), this centers the icon vertically against the full text block. The web version uses `items-start` (top alignment) with `mt-1` on the icon.

**Decision:** Change `alignItems` to `"flex-start"` so the icon aligns with the first line of text. Add a small `marginTop` to both the icon and chevron to visually center them against the first line of text.

### Sizing

Follow the chevron precedent: use a fixed size, intentionally excluded from the responsive typography scale. The icon container should be ~20px square with the `?` character at ~12px font size.

### Color Scheme Support

Match the chevron's existing color pattern:

- Light mode (dark-on-light): `#666666`
- Dark mode (light-on-dark): `rgba(255, 255, 255, 0.7)`

Apply a container-level `opacity: 0.25` to keep the icon subtle/muted (slightly higher than the web's 0.2 to account for the border rendering being thinner than the SVG stroke).

### Accessibility

The icon is purely decorative. Hide it from the accessibility tree:

- `accessibilityElementsHidden={true}`
- `importantForAccessibility="no-hide-descendants"`

This matches the web's `aria-hidden` approach and prevents screen readers from announcing "question mark" before every question.

## Acceptance Criteria

- [ ] Each question row in the Related Questions section displays a `?` icon inside a rounded square to the left of the question text
- [ ] The icon uses muted opacity (~0.25) to stay subtle
- [ ] Icon appearance adapts to light and dark color schemes
- [ ] Icon is top-aligned with the first line of question text (not centered against multi-line text)
- [ ] Icon is hidden from the accessibility tree (decorative only)
- [ ] Icon uses a fixed size (~20px), excluded from the typography scale
- [ ] No new dependencies are added
- [ ] Works on both iOS and Android

## MVP

### `apps/mobile/src/components/sections/RelatedQuestionsRenderer.tsx`

Add a `QuestionIcon` component and integrate it into the `QuestionItem`:

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

Update the `QuestionItem` Pressable to include the icon before the text:

```tsx
<Pressable style={styles.questionRow} onPress={onToggle} ...>
  <QuestionIcon isOnDark={isOnDark} />
  <Text style={[styles.questionText, typography.body, isOnDark && styles.questionTextLight]} numberOfLines={3}>
    {item.question}
  </Text>
  <AnimatedChevron isExpanded={isExpanded} isOnDark={isOnDark} />
</Pressable>
```

Add these styles:

```tsx
questionRow: {
  flexDirection: "row",
  alignItems: "flex-start",  // Changed from "center"
  paddingVertical: 16,
},
questionIcon: {
  width: 20,
  height: 20,
  borderRadius: 4,
  borderWidth: 1.5,
  borderColor: "#666666",
  alignItems: "center",
  justifyContent: "center",
  opacity: 0.25,
  marginRight: 8,
  marginTop: 2, // Align with first line of text
},
questionIconLight: {
  borderColor: "rgba(255, 255, 255, 0.7)",
},
questionIconText: {
  fontSize: 11, // Icon/badge size — intentionally excluded from typography scale
  fontWeight: "600",
  color: "#666666",
  lineHeight: 13,
},
questionIconTextLight: {
  color: "rgba(255, 255, 255, 0.7)",
},
chevron: {
  fontSize: 18,
  color: "#666666",
  marginTop: 2, // Match icon alignment after alignItems change
},
```

## Dependencies & Risks

- **Low risk:** No new dependencies, purely additive visual change
- **Alignment change:** Switching `alignItems` from `"center"` to `"flex-start"` on `questionRow` also affects chevron positioning — the chevron needs a matching `marginTop` to stay aligned with the first line
- **Platform rendering:** The `?` character renders slightly differently between iOS and Android fonts — test both platforms
- **Opacity compounding:** In dark mode, the icon's `opacity: 0.25` combined with the semi-transparent white color could make it too faint on some screens — may need to tune to 0.3

## Sources & References

- Web reference implementation: `apps/web/src/components/sections/RelatedQuestions.tsx:15-33` (QuestionIcon SVG)
- Mobile target file: `apps/mobile/src/components/sections/RelatedQuestionsRenderer.tsx`
- Typography system: `apps/mobile/src/hooks/useTypography.ts`
- Color scheme context: `apps/mobile/src/components/sections/SectionColorSchemeContext.ts`
