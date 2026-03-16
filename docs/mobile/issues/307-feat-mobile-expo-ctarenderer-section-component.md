---
artifactType: issue
issueNumber: 307
issueTitle: "feat(mobile-expo): CTARenderer section component"
issueUrl: "https://github.com/JesusFilm/forge/issues/307"
state: "CLOSED"
closedAt: "2026-03-10T22:17:40Z"
labels: []
linkedPrs: []
scope: "mobile"
---

# Issue Artifact: #307

## Background

The `CTA` (call-to-action) section type appears throughout experience pages to drive user engagement (e.g. "Want to grow deep in your understanding of the Bible?" on the Easter page). This issue implements the React Native renderer.

## Expected outcome

- A `CTARenderer` component that displays a call-to-action block.
- Accepts typed props from the data layer (CTA model from #304).

## Acceptance criteria

- [ ] Renders `heading` text.
- [ ] Renders `body` text (rich text or plain).
- [ ] Renders a tappable button with `buttonLabel` and `buttonLink`.
- [ ] Supports `variant` styling: primary (prominent) and secondary (subdued).
- [ ] Handles missing optional fields gracefully.
- [ ] Replaces the CTA stub in SectionDispatcher.
- [ ] Accessible (labels, tap targets).

## Possible solution(s)

1. Centered card-style layout with heading, body text, and styled button.
2. Variant controls button color/prominence and optional background styling.

## References

- Parent: #93
- Depends on: #305 (SectionDispatcher scaffold)
- Schema: `ComponentSectionsCta` — heading, body, buttonLabel, buttonLink, variant (primary/secondary), sectionKey
- [jesusfilm.org/watch/easter.html/english.html](https://www.jesusfilm.org/watch/easter.html/english.html) — "Free Resources" CTA section

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
