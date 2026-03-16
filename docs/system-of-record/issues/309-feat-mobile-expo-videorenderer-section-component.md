---
artifactType: issue
issueNumber: 309
issueTitle: "feat(mobile-expo): VideoRenderer section component"
issueUrl: "https://github.com/JesusFilm/forge/issues/309"
state: "CLOSED"
closedAt: "2026-03-10T22:55:27Z"
labels: []
linkedPrs: []
---

# Issue Artifact: #309

## Background

The `Video` section type embeds a video player with metadata throughout experience pages (e.g. "Jesus' Victory Over Sin and Death" on the Easter page). This issue implements the React Native renderer.

## Expected outcome

- A `VideoRenderer` component that displays an **inline embedded video player** with title and subtitle.
- Accepts typed props from the data layer (Video model from #304).

## Acceptance criteria

- [ ] **Inline video playback**: Uses `expo-video` (or `expo-av`) to play the `streamingUrl` (HLS) directly inside the component — the video must play on the same page, not open in an external/system player via `Linking.openURL`.
- [ ] Displays video thumbnail from `media` (UploadFile) or linked `video` (Video entity image) as a poster/placeholder before playback starts.
- [ ] Play/pause controls on the video player.
- [ ] Displays `title` and `subtitle` text below the video player.
- [ ] Uses `streamingUrl` for inline HLS playback.
- [ ] Handles missing optional fields gracefully.
- [ ] Replaces the Video stub in SectionDispatcher.
- [ ] Accessible (labels, playback controls).

## Possible solution(s)

1. `VideoView` (expo-video) with 16:9 aspect ratio, poster image from `media` or `video.image`, native playback controls. Title and subtitle below.
2. Tap-to-play: show thumbnail with play button overlay; on tap, start inline playback.
3. Fullscreen toggle available but video starts inline on the page.

## References

- Parent: #93
- Depends on: #305 (SectionDispatcher scaffold)
- Schema: `ComponentSectionsVideo` — title, subtitle, streamingUrl, media (UploadFile), video (Video entity), sectionKey
- [jesusfilm.org/watch/easter.html/english.html](https://www.jesusfilm.org/watch/easter.html/english.html) — embedded video sections
- [expo-video docs](https://docs.expo.dev/versions/latest/sdk/video/)

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
