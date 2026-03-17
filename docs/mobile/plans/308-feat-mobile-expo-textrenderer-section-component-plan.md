---
artifactType: plan
sourceId: 308
sourceTitle: "feat(mobile-expo): TextRenderer section component"
linkedPrs: []
scope: "mobile"
---

# Plan Artifact: "feat(mobile-expo): TextRenderer section component"

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

## References

- Parent: #93
- Depends on: #305 (SectionDispatcher scaffold)
- Schema: `ComponentSectionsText` — heading, headingLevel (h1–h6), subtitle, content, variant (default/lead/small), sectionKey
- [jesusfilm.org/watch/easter.html/english.html](https://www.jesusfilm.org/watch/easter.html/english.html) — "The Real Easter Story" and mission statement sections

## Source links

- PRs:
- None

## Review notes

- No PR review notes found.
