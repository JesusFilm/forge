---
artifactType: plan
sourceIssueNumber: 291
sourceIssueTitle: "feat(mobile-ios): Section renderer – Card"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/291"
linkedPrs: []
---

# Plan Artifact: #291

## Objective

A SwiftUI view that renders Card section data with default and featured variants. Composable at any nesting level.

## Planned approach

1. Rounded card with image at top, text below; featured variant gets larger image and prominent styling.
2. Tappable card navigates to `link` if present.

## Validation

- [x] CardView (or equivalent) takes `CardSection` from data layer (#286).
- [x] Displays title, description, optional image (AsyncImage), optional link.
- [x] Supports `default` and `featured` variants (featured may be larger/highlighted).
- [x] Standalone SwiftUI view — reusable at top level, inside Container, and inside Section wrapper.
- [x] SwiftLint pass; accessible.

## Source links

- Issue: [#291](https://github.com/JesusFilm/forge/issues/291)
- PRs:
- None
