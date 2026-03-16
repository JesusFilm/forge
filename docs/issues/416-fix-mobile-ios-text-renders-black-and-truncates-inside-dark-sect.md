---
artifactType: issue
issueNumber: 416
issueTitle: "fix(mobile-ios): Text renders black and truncates inside dark Section wrapper"
issueUrl: "https://github.com/JesusFilm/forge/issues/416"
state: "CLOSED"
closedAt: "2026-03-12T02:50:41Z"
labels: ["fix", "mobile-ios"]
linkedPrs: []
---

# Issue Artifact: #416

## Background

The Text section renderer (`TextSectionView`) inside a dark `SectionWrapperView` has two visual bugs visible on the Easter experience page (`easter1`):

1. **Text color is black instead of white**: `SectionWrapperView` applies a dark background color (`Color(red: 0.12, green: 0.10, blue: 0.08)`) but never sets the `\.colorScheme` environment for its child views. SwiftUI's semantic colors (`Color.primary`, `Color(.label)`, `.secondary`) used in `TextSectionView` resolve based on the current color scheme — in light mode they resolve to black/dark text, invisible on a dark background.

2. **Text truncation instead of wrapping**: `ContainerView` wraps all layout branches (including the compact/stacked VStack) inside a `GeometryReader`. Inside a `LazyVStack` > `ScrollView` (the `ExperienceSectionListView`), this creates a layout race: the container gets an incorrect initial height proposal from the GeometryReader, truncating text content before the `PreferenceKey` height reporting fires. Additionally, `TextSectionView` paragraph and subtitle `Text` views lack `.fixedSize(horizontal: false, vertical: true)`, so they prefer truncation over wrapping when proposed a constrained size.

Reference: [jesusfilm.org/watch/easter.html/english.html](https://www.jesusfilm.org/watch/easter.html/english.html)

## Expected outcome

- Text inside dark Section wrappers renders in white/light colors that are legible against the dark background.
- Long text (subtitles, content paragraphs) wraps to new lines instead of truncating with ellipsis.
- No visual regression on light or default backgrounds.

## Acceptance criteria

- [x] `SectionWrapperView` sets `\.colorScheme` environment based on its `backgroundColor` property (`.dark` / `.primary` → dark scheme; `.light` / `.default` / `nil` → light scheme).
- [x] All semantic colors in child renderers (heading `Color.primary`, subtitle `.secondary`, content `Color(.label)`) automatically adapt to the correct scheme.
- [x] `ContainerView` compact layout does not use `GeometryReader` — uses `@Environment(\.horizontalSizeClass)` for layout switching instead.
- [x] `TextSectionView` subtitle and content paragraph `Text` views use `.fixedSize(horizontal: false, vertical: true)` to prevent truncation.
- [x] No visual regression on light/default backgrounds or regular (iPad) layouts.
- [x] SwiftLint pass; accessible.

## Possible solution(s)

1. **Color scheme propagation**: In `SectionWrapperView`, apply `.environment(\.colorScheme, .dark)` to the content VStack when `backgroundColor` is `.dark` or `.primary`, and `.environment(\.colorScheme, .light)` otherwise. This makes all child views automatically pick up correct semantic colors.

2. **Layout fix**: In `ContainerView`, replace the top-level `GeometryReader` with `@Environment(\.horizontalSizeClass)` for layout switching. Compact layout renders a plain `VStack` directly (no GeometryReader, no PreferenceKey). Regular layout retains `GeometryReader` for column width calculation only.

3. **Defensive text wrapping**: In `TextSectionView`, add `.fixedSize(horizontal: false, vertical: true)` to subtitle and content paragraph `Text` views so they always prefer wrapping over truncation.

## References

- Parent: #100
- Files: `mobile/ios/Sources/ForgeMobile/Views/Sections/SectionWrapperView.swift`, `mobile/ios/Sources/ForgeMobile/Views/Sections/ContainerView.swift`, `mobile/ios/Sources/ForgeMobile/Views/Sections/TextSectionView.swift`
- Reference website: https://www.jesusfilm.org/watch/easter.html/english.html
- Related PRs: #345 (Text renderer), #398 (Section wrapper), #390 (Container)

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
