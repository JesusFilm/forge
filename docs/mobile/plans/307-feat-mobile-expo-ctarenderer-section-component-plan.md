---
artifactType: plan
sourceId: 307
sourceTitle: "feat(mobile-expo): CTARenderer section component"
linkedPrs: []
scope: "mobile"
---

# Plan Artifact: "feat(mobile-expo): CTARenderer section component"

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

## References

- Parent: #93
- Depends on: #305 (SectionDispatcher scaffold)
- Schema: `ComponentSectionsCta` — heading, body, buttonLabel, buttonLink, variant (primary/secondary), sectionKey
- [jesusfilm.org/watch/easter.html/english.html](https://www.jesusfilm.org/watch/easter.html/english.html) — "Free Resources" CTA section

## Source links

- PRs:
- None

## Review notes

- No PR review notes found.
