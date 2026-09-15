---
id: "feat-475"
title: "Android TV native Media3 player experiment"
owner: "ekkasit"
priority: "P0"
status: "in-progress"
start_date: "2026-09-02"
duration: 2
depends_on: []
blocks: []
tags:
  - "tv"
  - "android-tv"
  - "chromecast"
  - "video-player"
  - "kotlin"
  - "media3"
---

## Problem

The existing Android TV player uses a native ExoPlayer engine but renders its
controls and focus animations through React Native. On Chromecast hardware,
remote events cross the native-to-JavaScript bridge before the UI responds,
which makes focus and control movement feel delayed.

## What To Build

1. Keep the current React Native player as the default and unchanged fallback.
2. Add an Android-only native Kotlin player backed by Media3 `ExoPlayer` and
   `PlayerView`.
3. Give the native surface ownership of D-pad focus, playback controls, seeking,
   audio tracks, subtitles, errors, and Back dismissal.
4. Preserve Resume, progress saving, meaningful-watch capture, language changes,
   Up Next, and the current validated HLS URL boundary.
5. Add a persisted Settings choice between Existing Player and Native Android.

## Constraints

- Chromecast with Google TV and Android TV only; Apple TV remains unchanged.
- Do not remove or rewrite `VideoPlayer.tsx`.
- Use the Media3 version already supplied by `expo-video` to avoid dependency drift.
- The experiment remains opt-in until physical Chromecast parity is verified.

## Verification

- Preference parsing and Android-only player-selection tests.
- TV typecheck, lint, and full Jest suite.
- Android Release APK build.
- Physical Chromecast: switch both player choices, play JESUS, verify D-pad
  focus, Play/Pause, seek, Audio, Subtitles, Resume, Back, and source switching.

## Result

### Native implementation verified 2026-09-05

- Preserved React/WATCH styling and added Apple Native B features: Mux thumbnail
  preview with Select commit/Back cancel, searchable native language/subtitle
  menus, and Start Over. Immediate skip buttons use ±10 seconds.
- Fixed native video composition with TextureView, dynamic caption measurement
  with `shouldUseAndroidLayout`, unclipped focus growth, and fractional-width
  button-label truncation at 720p. Native dimensions follow the 1920 reference.
- Subtitle fetching is independent of the HLS item. Native VTT parsing matches
  React broadcast offsets, cue settings, multiline text, and overlapping cues.
- Playback and preview state stay separate. Background/source changes cancel
  candidates; resume/progress/meaningful-watch events report committed playback.
- Late-hydrated menus attach by explicit playing-video identity, not only a
  possibly superseded default-dub URL. Identity-free playback stays source-gated.
- Emulator and physical Chromecast `15061HFDD2JYT5` (`sabrina`, `armeabi-v7a`)
  showed visible native video, thumbnails, caption cues, native focus, menu search,
  source-position preservation, Start Over, and Back. Emulator also verified
  720p/1080p/4K-equivalent layouts, Up Next autoplay, and Home/foreground recovery.
- Typecheck, lint, 126 TV suites / 1,855 tests, nine Kotlin behavior tests, and
  Android release build pass. APK SHA-256:
  `15ce4c529ee1c37cb01fec48f31a06e246e89faed399962f869e143fe7d949a8`.
- Screenshots and detailed limits: `test-results/android-native-parity-2026-09-05/summary.md`.
  Apple TV and Google TV Home work remain untouched; changes are uncommitted.

### Remaining verification issue

Switching the experiment Off opens the unchanged React player, but the current
Chromecast capture shows a black picture while React controls/time remain visible.
Do not equate correct selection routing with a successful fallback playback pass.
The approved scope explicitly excluded changes to the React player; investigate
under `feat-482` after authorization. Native is restored On on the test Chromecast.
This ticket remains in progress until the fallback verification issue is resolved.
