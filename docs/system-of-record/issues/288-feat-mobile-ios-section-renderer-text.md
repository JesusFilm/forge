---
artifactType: issue
issueNumber: 288
issueTitle: "feat(mobile-ios): Section renderer – Text"
issueUrl: "https://github.com/JesusFilm/forge/issues/288"
state: "CLOSED"
closedAt: "2026-03-11T00:22:54Z"
labels: ["feat", "mobile-ios"]
linkedPrs: []
---

# Issue Artifact: #288

## Background

Experience sections include Text — a rich text block with optional heading, subtitle, and display variant. One of 10 leaf section renderers; can be implemented in parallel with other Tier 1 renderers after #286 (data layer expansion).

## Expected outcome

A SwiftUI view that renders Text section data: heading (with configurable level h1-h6), subtitle, rich text content, and variant styling. Composable at any nesting level.

## Acceptance criteria

- [x] TextSectionView (or equivalent) takes `TextSection` from data layer (#286).
- [x] Renders heading with appropriate font size/weight based on `headingLevel` (h1-h6).
- [x] Renders rich text `content` (markdown or HTML from Strapi richtext).
- [x] Applies `variant` styling (default, lead, small).
- [x] Standalone SwiftUI view — reusable at top level, inside Container, and inside Section wrapper.
- [x] SwiftLint pass; accessible.

## Possible solution(s)

1. Use SwiftUI `Text` with `AttributedString` for rich text rendering.
2. Heading level maps to font size/weight; variant maps to overall text styling.

## References

- Parent: #100
- Depends on: #286 (data layer expansion)
- CMS schema: `apps/cms/src/components/sections/text.json`
- Fields: `sectionKey`, `heading`, `headingLevel` (enum: h1-h6), `subtitle`, `content` (richtext, required), `variant` (enum: default/lead/small)

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
