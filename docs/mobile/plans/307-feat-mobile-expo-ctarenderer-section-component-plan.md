---
artifactType: plan
sourceIssueNumber: 307
sourceIssueTitle: "feat(mobile-expo): CTARenderer section component"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/307"
linkedPrs: []
scope: "mobile"
---

# Plan Artifact: #307

## Objective

- A `CTARenderer` component that displays a call-to-action block.
- Accepts typed props from the data layer (CTA model from #304).

## Planned approach

1. Centered card-style layout with heading, body text, and styled button.
2. Variant controls button color/prominence and optional background styling.

## Validation

- [ ] Renders `heading` text.
- [ ] Renders `body` text (rich text or plain).
- [ ] Renders a tappable button with `buttonLabel` and `buttonLink`.
- [ ] Supports `variant` styling: primary (prominent) and secondary (subdued).
- [ ] Handles missing optional fields gracefully.
- [ ] Replaces the CTA stub in SectionDispatcher.
- [ ] Accessible (labels, tap targets).

## Source links

- Issue: [#307](https://github.com/JesusFilm/forge/issues/307)
- PRs:
- None
