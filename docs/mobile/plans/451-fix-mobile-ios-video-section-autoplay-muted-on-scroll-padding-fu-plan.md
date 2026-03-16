---
artifactType: plan
sourceIssueNumber: 451
sourceIssueTitle: "fix(mobile-ios): Video section – autoplay muted on scroll, padding, full-screen"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/451"
linkedPrs: []
scope: "mobile"
---

# Plan Artifact: #451

## Objective

`VideoSectionView` autoplays muted when it appears on screen, pauses when scrolled away, has consistent horizontal padding, and exposes native full-screen / scrubbing / PiP controls via SwiftUI's `VideoPlayer`.

## Planned approach

1. Replace the poster-first tap-to-play pattern with `VideoPlayer(player:)` backed by `AVPlayer`.
2. Initialise the player in `.onAppear` with `isMuted = true` and call `.play()`; tear down in `.onDisappear`.
3. `VideoPlayer` natively includes full-screen, scrubbing, and transport controls — no custom full-screen sheet or button needed.
4. Add `.padding(.horizontal, 16)` to the video area to match other section renderers.

## Validation

- [x] Video begins playing **muted** automatically when the section scrolls into view (`onAppear`).
- [x] Video **pauses** and tears down when scrolled out of view (`onDisappear`).
- [x] Video area has `.padding(.horizontal, 16)` consistent with other sections.
- [x] SwiftUI `VideoPlayer(player:)` is used, providing **native full-screen, scrubbing, play/pause, and PiP** controls.
- [x] Poster image shown as fallback only when `streamingUrl` is missing or player hasn't loaded.
- [x] SwiftLint passes; VoiceOver accessibility preserved.

## Source links

- Issue: [#451](https://github.com/JesusFilm/forge/issues/451)
- PRs:
- None
