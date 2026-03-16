---
artifactType: plan
sourceIssueNumber: 309
sourceIssueTitle: "feat(mobile-expo): VideoRenderer section component"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/309"
linkedPrs: []
scope: "mobile"
---

# Plan Artifact: #309

## Objective

- A `VideoRenderer` component that displays an **inline embedded video player** with title and subtitle.
- Accepts typed props from the data layer (Video model from #304).

## Planned approach

1. `VideoView` (expo-video) with 16:9 aspect ratio, poster image from `media` or `video.image`, native playback controls. Title and subtitle below.
2. Tap-to-play: show thumbnail with play button overlay; on tap, start inline playback.
3. Fullscreen toggle available but video starts inline on the page.

## Validation

- [ ] **Inline video playback**: Uses `expo-video` (or `expo-av`) to play the `streamingUrl` (HLS) directly inside the component — the video must play on the same page, not open in an external/system player via `Linking.openURL`.
- [ ] Displays video thumbnail from `media` (UploadFile) or linked `video` (Video entity image) as a poster/placeholder before playback starts.
- [ ] Play/pause controls on the video player.
- [ ] Displays `title` and `subtitle` text below the video player.
- [ ] Uses `streamingUrl` for inline HLS playback.
- [ ] Handles missing optional fields gracefully.
- [ ] Replaces the Video stub in SectionDispatcher.
- [ ] Accessible (labels, playback controls).

## Source links

- Issue: [#309](https://github.com/JesusFilm/forge/issues/309)
- PRs:
- None
