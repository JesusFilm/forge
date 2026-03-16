---
artifactType: plan
sourceIssueNumber: 288
sourceIssueTitle: "feat(mobile-ios): Section renderer – Text"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/288"
linkedPrs: []
---

# Plan Artifact: #288

## Objective

A SwiftUI view that renders Text section data: heading (with configurable level h1-h6), subtitle, rich text content, and variant styling. Composable at any nesting level.

## Planned approach

1. Use SwiftUI `Text` with `AttributedString` for rich text rendering.
2. Heading level maps to font size/weight; variant maps to overall text styling.

## Validation

- [x] TextSectionView (or equivalent) takes `TextSection` from data layer (#286).
- [x] Renders heading with appropriate font size/weight based on `headingLevel` (h1-h6).
- [x] Renders rich text `content` (markdown or HTML from Strapi richtext).
- [x] Applies `variant` styling (default, lead, small).
- [x] Standalone SwiftUI view — reusable at top level, inside Container, and inside Section wrapper.
- [x] SwiftLint pass; accessible.

## Source links

- Issue: [#288](https://github.com/JesusFilm/forge/issues/288)
- PRs:
- None
