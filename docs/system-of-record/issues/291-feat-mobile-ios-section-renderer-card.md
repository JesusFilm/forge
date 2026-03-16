---
artifactType: issue
issueNumber: 291
issueTitle: "feat(mobile-ios): Section renderer – Card"
issueUrl: "https://github.com/JesusFilm/forge/issues/291"
state: "CLOSED"
closedAt: "2026-03-11T03:07:45Z"
labels: ["feat", "mobile-ios"]
linkedPrs: []
---

# Issue Artifact: #291

## Background

Experience sections include Card — a reusable content card with image, title, description, link, and variant. One of 10 leaf section renderers; can be implemented in parallel with other Tier 1 renderers after #286 (data layer expansion).

## Expected outcome

A SwiftUI view that renders Card section data with default and featured variants. Composable at any nesting level.

## Acceptance criteria

- [x] CardView (or equivalent) takes `CardSection` from data layer (#286).
- [x] Displays title, description, optional image (AsyncImage), optional link.
- [x] Supports `default` and `featured` variants (featured may be larger/highlighted).
- [x] Standalone SwiftUI view — reusable at top level, inside Container, and inside Section wrapper.
- [x] SwiftLint pass; accessible.

## Possible solution(s)

1. Rounded card with image at top, text below; featured variant gets larger image and prominent styling.
2. Tappable card navigates to `link` if present.

## References

- Parent: #100
- Depends on: #286 (data layer expansion)
- CMS schema: `apps/cms/src/components/sections/card.json`
- Fields: `sectionKey`, `title` (required), `description` (required), `media` (image), `link`, `variant` (enum: default/featured)

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
