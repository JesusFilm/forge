---
artifactType: plan
sourceIssueNumber: 416
sourceIssueTitle: "fix(mobile-ios): Text renders black and truncates inside dark Section wrapper"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/416"
linkedPrs: []
---

# Plan Artifact: #416

## Objective

- Text inside dark Section wrappers renders in white/light colors that are legible against the dark background.
- Long text (subtitles, content paragraphs) wraps to new lines instead of truncating with ellipsis.
- No visual regression on light or default backgrounds.

## Planned approach

1. **Color scheme propagation**: In `SectionWrapperView`, apply `.environment(\.colorScheme, .dark)` to the content VStack when `backgroundColor` is `.dark` or `.primary`, and `.environment(\.colorScheme, .light)` otherwise. This makes all child views automatically pick up correct semantic colors.

2. **Layout fix**: In `ContainerView`, replace the top-level `GeometryReader` with `@Environment(\.horizontalSizeClass)` for layout switching. Compact layout renders a plain `VStack` directly (no GeometryReader, no PreferenceKey). Regular layout retains `GeometryReader` for column width calculation only.

3. **Defensive text wrapping**: In `TextSectionView`, add `.fixedSize(horizontal: false, vertical: true)` to subtitle and content paragraph `Text` views so they always prefer wrapping over truncation.

## Validation

- [x] `SectionWrapperView` sets `\.colorScheme` environment based on its `backgroundColor` property (`.dark` / `.primary` → dark scheme; `.light` / `.default` / `nil` → light scheme).
- [x] All semantic colors in child renderers (heading `Color.primary`, subtitle `.secondary`, content `Color(.label)`) automatically adapt to the correct scheme.
- [x] `ContainerView` compact layout does not use `GeometryReader` — uses `@Environment(\.horizontalSizeClass)` for layout switching instead.
- [x] `TextSectionView` subtitle and content paragraph `Text` views use `.fixedSize(horizontal: false, vertical: true)` to prevent truncation.
- [x] No visual regression on light/default backgrounds or regular (iPad) layouts.
- [x] SwiftLint pass; accessible.

## Source links

- Issue: [#416](https://github.com/JesusFilm/forge/issues/416)
- PRs:
- None
