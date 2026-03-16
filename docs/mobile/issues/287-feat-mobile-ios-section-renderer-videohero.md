---
artifactType: issue
issueNumber: 287
issueTitle: "feat(mobile-ios): Section renderer – VideoHero"
issueUrl: "https://github.com/JesusFilm/forge/issues/287"
state: "CLOSED"
closedAt: "2026-03-10T22:24:39Z"
labels: ["feat", "mobile-ios"]
linkedPrs: []
scope: "mobile"
---

# Issue Artifact: #287

## Background

Experience sections include VideoHero — a full-bleed hero with video, heading overlay, and optional CTA. One of 10 leaf section renderers; can be implemented in parallel with other Tier 1 renderers after #286 (data layer expansion).

## Expected outcome

A SwiftUI view that renders VideoHero section data: video poster/playback, heading, subheading, CTA. Composable at any nesting level (top-level section, inside Container slot, inside Section wrapper).

## Acceptance criteria

- [x] VideoHeroView (or equivalent) takes `VideoHeroSection` from data layer (#286).
- [x] Displays video poster or playback, heading overlay, optional subheading.
- [x] CTA button/link if ctaLink and ctaLabel are present.
- [x] Standalone SwiftUI view — reusable at top level, inside Container, and inside Section wrapper.
- [x] SwiftLint pass; accessible (VoiceOver labels on heading, CTA).

## Possible solution(s)

1. Full-bleed `ZStack` with video poster/player as background, heading/subheading overlay, CTA button at bottom.
2. Video playback via AVPlayer or poster image initially; progressive enhancement.

## References

- Parent: #100
- Depends on: #286 (data layer expansion)
- CMS schema: `apps/cms/src/components/sections/video-hero.json`
- Fields: `sectionKey`, `video` (relation to api::video.video, required), `heading`, `subheading`, `ctaLink`, `ctaLabel`

---

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
