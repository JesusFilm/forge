---
artifactType: plan
sourceIssueNumber: 399
sourceIssueTitle: "fix(mobile-ios): VideoHero title, subtitle, and mute button should scroll with sections"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/399"
linkedPrs: []
---

# Plan Artifact: #399

## Objective

Title, subtitle, CTA button, and mute toggle move with the scrollable content while the video background remains pinned. The UX matches the reference website's scroll behavior.

## Planned approach

1. **Move overlay content into the ScrollView spacer area**: Replace the transparent `scrollOffsetTracker` spacer with a view that has the same height but contains the title, subtitle, CTA, and mute button positioned at its bottom. Remove `contentOverlay` from `VideoHeroView` and `heroControlsOverlay` from the ZStack. The gradient can remain on the pinned video or be duplicated in the spacer area.

2. **Use an overlay on the spacer**: Keep the spacer transparent but overlay the controls on it using `.overlay(alignment: .bottom)` so they scroll with the spacer while the video stays pinned behind.

## Validation

- [x] Title (heading) and subtitle (subheading) are part of the scrollable content, not pinned to the background.
- [x] CTA button and mute toggle button are part of the scrollable content, positioned at the bottom of the hero spacer area.
- [x] Video background remains pinned behind the scroll view.
- [x] Video pauses when hero is scrolled off screen (existing behavior preserved).
- [x] Video resumes when hero scrolls back into view (existing behavior preserved).
- [x] No visual regression — gradient overlay still appears over the video.
- [x] SwiftLint pass; accessible.

## Source links

- Issue: [#399](https://github.com/JesusFilm/forge/issues/399)
- PRs:
- None
