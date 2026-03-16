---
artifactType: plan
sourceIssueNumber: 292
sourceIssueTitle: "feat(mobile-ios): Section renderer – Video"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/292"
linkedPrs: []
---

# Plan Artifact: #292

## Objective

A SwiftUI view that renders Video section data: inline video player with poster/thumbnail, title, subtitle. Composable at any nesting level.

## Planned approach

1. `AVPlayer` / `VideoPlayer` SwiftUI wrapper with poster overlay; tap to play.
2. Poster image via AsyncImage; transition to player on interaction.

## Validation

- [x] VideoView (or equivalent) takes `VideoSection` from data layer (#286).
- [x] Plays video from `streamingUrl` (required field).
- [x] Shows poster/thumbnail from `media` before playback.
- [x] Displays optional `title` and `subtitle`.
- [x] Standalone SwiftUI view — reusable at top level, inside Container, and inside Section wrapper.
- [x] SwiftLint pass; accessible (VoiceOver labels for play/title).

## Source links

- Issue: [#292](https://github.com/JesusFilm/forge/issues/292)
- PRs:
- None
