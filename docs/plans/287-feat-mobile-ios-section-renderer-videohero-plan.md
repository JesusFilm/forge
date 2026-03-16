---
artifactType: plan
sourceIssueNumber: 287
sourceIssueTitle: "feat(mobile-ios): Section renderer – VideoHero"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/287"
linkedPrs: []
---

# Plan Artifact: #287

## Objective

A SwiftUI view that renders VideoHero section data: video poster/playback, heading, subheading, CTA. Composable at any nesting level (top-level section, inside Container slot, inside Section wrapper).

## Planned approach

1. Full-bleed `ZStack` with video poster/player as background, heading/subheading overlay, CTA button at bottom.
2. Video playback via AVPlayer or poster image initially; progressive enhancement.

## Validation

- [x] VideoHeroView (or equivalent) takes `VideoHeroSection` from data layer (#286).
- [x] Displays video poster or playback, heading overlay, optional subheading.
- [x] CTA button/link if ctaLink and ctaLabel are present.
- [x] Standalone SwiftUI view — reusable at top level, inside Container, and inside Section wrapper.
- [x] SwiftLint pass; accessible (VoiceOver labels on heading, CTA).

## Source links

- Issue: [#287](https://github.com/JesusFilm/forge/issues/287)
- PRs:
- None
