---
id: "feat-076"
title: "TV App — Video Playback + Polish"
owner: "urim"
priority: "P1"
status: "complete"
start_date: "2026-04-22"
duration: 7
depends_on:
  - "feat-074"
  - "feat-075"
blocks: []
tags:
  - "tv"
---

## Problem

The TV app needs full-screen video playback with TV remote controls, and an overall polish pass to ensure the prototype meets the qualitative go/no-go criteria for a production TV app decision.

## Entry Points — Read These First

1. `docs/brainstorms/2026-04-10-tv-app-prototype-requirements.md` — Video Behavior and Success Criteria sections
2. `apps/mobile-v2/app.json` — expo-video plugin config (`supportsBackgroundPlayback`)
3. `apps/tv/src/components/sections/VideoHeroRenderer.tsx` — hero renderer (from feat-075)
4. `apps/tv/src/components/sections/VideoCardRenderer.tsx` — video card renderer (from feat-075)

## Grep These

- `expo-video` in `apps/mobile-v2/` — current video implementation
- `useVideoPlayer` in `apps/mobile-v2/src/` — video player hook usage
- `streamingUrl` in `apps/mobile-v2/src/` — HLS URL extraction from Experience data

## What To Build

### Video Playback

1. **VideoPlayer component**: Full-screen expo-video player for TV
   - Play/pause: center button (Apple TV remote select / Android TV center)
   - Seek: ±10 seconds on left/right D-pad
   - Back: menu button returns to Experience detail screen
   - Simple progress bar overlay (show on any button press, auto-hide after 3s)
2. **Integration**: VideoHeroRenderer and VideoCardRenderer `onSelect` triggers full-screen playback with the block's `streamingUrl`
3. **End of playback**: Return to Experience detail screen, restore focus to the video block that was playing

### Polish Pass

4. **Focus ring consistency**: Audit all focusable elements — ensure visible focus ring on every interactive item across all screens
5. **Focus responsiveness**: Test rapid D-pad input — ensure no perceptible lag
6. **Content readability**: Verify all text is readable at 10-foot distance on a 1080p display
7. **Navigation flow**: Verify complete flow: home → rail select → experience detail → video block select → fullscreen playback → back → experience → back → home (with focus memory)

## Constraints

- Use expo-video (validated in feat-072 spike). Only switch to react-native-video if expo-video has a blocking TV issue discovered during implementation.
- No scrubber/seek bar UI beyond basic progress indicator
- No resume-from-position — always starts from beginning (prototype scope)
- No background playback or PiP

## Verification

### Technical

- Select on a video block enters full-screen playback
- Center button toggles play/pause
- Left/right D-pad seeks ±10 seconds
- Menu button exits playback and returns to Experience screen
- End of video returns to Experience screen automatically

### Qualitative (go/no-go for production)

- Focus navigation feels responsive (no perceptible lag)
- Video playback quality acceptable on TV display
- Experience detail screen is readable and navigable — doesn't feel like a stretched phone app
- Complete home → experience → video → back flow works smoothly
