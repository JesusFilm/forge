---
artifactType: issue
issueNumber: 399
issueTitle: "fix(mobile-ios): VideoHero title, subtitle, and mute button should scroll with sections"
issueUrl: "https://github.com/JesusFilm/forge/issues/399"
state: "CLOSED"
closedAt: "2026-03-12T01:46:37Z"
labels: ["fix", "mobile-ios"]
linkedPrs: []
scope: "mobile"
---

# Issue Artifact: #399

## Background

The sticky hero layout in `ExperiencePageView` (`mobile/ios/Sources/ForgeMobile/Views/ForgeRootView.swift`) currently pins the VideoHero's title, subtitle, and mute button in fixed positions. The title and subtitle live inside `VideoHeroView` (which is a static background layer), and the CTA/mute button live in `heroControlsOverlay` (also pinned above the scroll view). When the user scrolls upward, the section content slides over the hero, covering these elements rather than carrying them along.

**Expected behavior** (matches ref website `jesusfilm.org/watch/easter.html/english.html`):

- The Experience title, subtitle, CTA button, and mute button scroll **with** the sections — they sit visually at the bottom of the hero area but are part of the scrollable content.
- The video background stays pinned behind the scroll view (parallax-style).
- The video pauses when the hero is scrolled off screen (this part already works via scroll offset tracking, but thresholds may need tuning).

**Current behavior:**

- Title/subtitle are inside the pinned `VideoHeroView` ZStack — they do not scroll.
- CTA and mute buttons are in a fixed `heroControlsOverlay` — they do not scroll.
- As the user scrolls, sections cover the title/subtitle/controls instead of those elements moving with the scroll.

## Expected outcome

Title, subtitle, CTA button, and mute toggle move with the scrollable content while the video background remains pinned. The UX matches the reference website's scroll behavior.

## Acceptance criteria

- [x] Title (heading) and subtitle (subheading) are part of the scrollable content, not pinned to the background.
- [x] CTA button and mute toggle button are part of the scrollable content, positioned at the bottom of the hero spacer area.
- [x] Video background remains pinned behind the scroll view.
- [x] Video pauses when hero is scrolled off screen (existing behavior preserved).
- [x] Video resumes when hero scrolls back into view (existing behavior preserved).
- [x] No visual regression — gradient overlay still appears over the video.
- [x] SwiftLint pass; accessible.

## Possible solution(s)

1. **Move overlay content into the ScrollView spacer area**: Replace the transparent `scrollOffsetTracker` spacer with a view that has the same height but contains the title, subtitle, CTA, and mute button positioned at its bottom. Remove `contentOverlay` from `VideoHeroView` and `heroControlsOverlay` from the ZStack. The gradient can remain on the pinned video or be duplicated in the spacer area.

2. **Use an overlay on the spacer**: Keep the spacer transparent but overlay the controls on it using `.overlay(alignment: .bottom)` so they scroll with the spacer while the video stays pinned behind.

## References

- Parent: #100
- Related: #369 (Expo equivalent — hero video autoplay)
- File: `mobile/ios/Sources/ForgeMobile/Views/ForgeRootView.swift` (sticky hero layout)
- File: `mobile/ios/Sources/ForgeMobile/Views/Sections/VideoHeroView.swift` (hero view)
- Ref website: jesusfilm.org/watch/easter.html/english.html

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
