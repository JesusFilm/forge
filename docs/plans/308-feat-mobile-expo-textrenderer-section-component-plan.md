---
artifactType: plan
sourceIssueNumber: 308
sourceIssueTitle: "feat(mobile-expo): TextRenderer section component"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/308"
linkedPrs: []
---

# Plan Artifact: #308

## Objective

- A `TextRenderer` component that displays a rich text content block.
- Accepts typed props from the data layer (Text model from #304).

## Planned approach

1. View with conditional heading (sized by level), optional subtitle, and content rendered via a markdown/rich-text component or plain Text.
2. Variant adjusts font size, spacing, and emphasis.

## Validation

- [ ] Renders `heading` with correct visual weight based on `headingLevel` (h1–h6).
- [ ] Renders `subtitle` text when present.
- [ ] Renders `content` (rich text / markdown string).
- [ ] Supports `variant` styling: default, lead (larger/prominent), small (compact).
- [ ] Handles missing optional fields gracefully (e.g. no heading if absent).
- [ ] Replaces the Text stub in SectionDispatcher.
- [ ] Accessible (semantic heading levels if possible).

## Source links

- Issue: [#308](https://github.com/JesusFilm/forge/issues/308)
- PRs:
- None
