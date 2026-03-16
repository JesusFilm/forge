---
artifactType: issue
issueNumber: 451
issueTitle: "fix(mobile-ios): Video section – autoplay muted on scroll, padding, full-screen"
issueUrl: "https://github.com/JesusFilm/forge/issues/451"
state: "CLOSED"
closedAt: "2026-03-13T04:14:40Z"
labels: ["fix", "mobile-ios"]
linkedPrs: []
scope: "mobile"
---

# Issue Artifact: #451

## Background

The Video section renderer (`VideoSectionView`) currently displays a static poster overlay requiring a tap to begin playback. Compared to the reference website ([jesusfilm.org/watch/easter](https://www.jesusfilm.org/watch/easter.html/english.html)), three UX gaps exist:

1. **No autoplay** — video shows a black screen / poster with a play button instead of autoplaying muted when scrolled into view.
2. **No padding** — the video area has no horizontal padding, unlike other sections (which use 16–24pt).
3. **No full-screen** — the current implementation uses a raw `AVPlayer` behind a poster; there is no way for the user to enter full-screen playback.

## Expected outcome

`VideoSectionView` autoplays muted when it appears on screen, pauses when scrolled away, has consistent horizontal padding, and exposes native full-screen / scrubbing / PiP controls via SwiftUI's `VideoPlayer`.

## Acceptance criteria

- [x] Video begins playing **muted** automatically when the section scrolls into view (`onAppear`).
- [x] Video **pauses** and tears down when scrolled out of view (`onDisappear`).
- [x] Video area has `.padding(.horizontal, 16)` consistent with other sections.
- [x] SwiftUI `VideoPlayer(player:)` is used, providing **native full-screen, scrubbing, play/pause, and PiP** controls.
- [x] Poster image shown as fallback only when `streamingUrl` is missing or player hasn't loaded.
- [x] SwiftLint passes; VoiceOver accessibility preserved.

## Possible solution(s)

1. Replace the poster-first tap-to-play pattern with `VideoPlayer(player:)` backed by `AVPlayer`.
2. Initialise the player in `.onAppear` with `isMuted = true` and call `.play()`; tear down in `.onDisappear`.
3. `VideoPlayer` natively includes full-screen, scrubbing, and transport controls — no custom full-screen sheet or button needed.
4. Add `.padding(.horizontal, 16)` to the video area to match other section renderers.

## References

- Parent: #100
- Current implementation: `mobile/ios/Sources/ForgeMobile/Views/Sections/VideoSectionView.swift`
- Reference website: https://www.jesusfilm.org/watch/easter.html/english.html
- Related: #292 (original Video renderer issue)

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
