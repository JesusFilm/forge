---
artifactType: issue
issueNumber: 292
issueTitle: "feat(mobile-ios): Section renderer – Video"
issueUrl: "https://github.com/JesusFilm/forge/issues/292"
state: "CLOSED"
closedAt: "2026-03-11T03:37:20Z"
labels: ["feat", "mobile-ios"]
linkedPrs: []
---

# Issue Artifact: #292

## Background

Experience sections include Video — a standalone inline video player with streaming URL, poster, and optional metadata. One of 10 leaf section renderers; can be implemented in parallel with other Tier 1 renderers after #286 (data layer expansion).

## Expected outcome

A SwiftUI view that renders Video section data: inline video player with poster/thumbnail, title, subtitle. Composable at any nesting level.

## Acceptance criteria

- [x] VideoView (or equivalent) takes `VideoSection` from data layer (#286).
- [x] Plays video from `streamingUrl` (required field).
- [x] Shows poster/thumbnail from `media` before playback.
- [x] Displays optional `title` and `subtitle`.
- [x] Standalone SwiftUI view — reusable at top level, inside Container, and inside Section wrapper.
- [x] SwiftLint pass; accessible (VoiceOver labels for play/title).

## Possible solution(s)

1. `AVPlayer` / `VideoPlayer` SwiftUI wrapper with poster overlay; tap to play.
2. Poster image via AsyncImage; transition to player on interaction.

## References

- Parent: #100
- Depends on: #286 (data layer expansion)
- CMS schema: `apps/cms/src/components/sections/video.json`
- Fields: `sectionKey`, `streamingUrl` (required), `video` (relation, optional), `media` (poster image), `title`, `subtitle`

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
