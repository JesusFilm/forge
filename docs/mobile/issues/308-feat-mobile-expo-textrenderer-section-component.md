---
artifactType: issue
issueNumber: 308
issueTitle: "feat(mobile-expo): TextRenderer section component"
issueUrl: "https://github.com/JesusFilm/forge/issues/308"
state: "CLOSED"
closedAt: "2026-03-10T22:36:01Z"
labels: []
linkedPrs: []
scope: "mobile"
---

# Issue Artifact: #308

## Background

The `Text` section type is the most common content block on experience pages — rich text with headings, used for explanatory content, mission statements, and educational blocks. This issue implements the React Native renderer.

## Expected outcome

- A `TextRenderer` component that displays a rich text content block.
- Accepts typed props from the data layer (Text model from #304).

## Acceptance criteria

- [ ] Renders `heading` with correct visual weight based on `headingLevel` (h1–h6).
- [ ] Renders `subtitle` text when present.
- [ ] Renders `content` (rich text / markdown string).
- [ ] Supports `variant` styling: default, lead (larger/prominent), small (compact).
- [ ] Handles missing optional fields gracefully (e.g. no heading if absent).
- [ ] Replaces the Text stub in SectionDispatcher.
- [ ] Accessible (semantic heading levels if possible).

## Possible solution(s)

1. View with conditional heading (sized by level), optional subtitle, and content rendered via a markdown/rich-text component or plain Text.
2. Variant adjusts font size, spacing, and emphasis.

## References

- Parent: #93
- Depends on: #305 (SectionDispatcher scaffold)
- Schema: `ComponentSectionsText` — heading, headingLevel (h1–h6), subtitle, content, variant (default/lead/small), sectionKey
- [jesusfilm.org/watch/easter.html/english.html](https://www.jesusfilm.org/watch/easter.html/english.html) — "The Real Easter Story" and mission statement sections

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
