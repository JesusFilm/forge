# Android native player: React parity

Reference: `apps/tv/src/components/VideoPlayer.tsx`,
`watch/InPlayerMenu.tsx`, `watch/MomentsPanel.tsx`, and `watch/UpNextOverlay.tsx`.
Roadmap: `feat-475`.

Use the existing WATCH layout, colors, typography, and focus feedback. Preserve
Kotlin/Media3 playback and native controls. Keep the existing player selectable.

| Feature              | Required behavior                                                                                     | Verification                                            |
| -------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Picture and playback | Visible fitted video, audio, start and resume                                                         | Chromecast screenshot and native media session          |
| Transport            | Play/Pause, rewind/forward 10 seconds, bounded seeks                                                  | Paused position before/after each button                |
| Progress             | Red progress, buffered track, time bubble, elapsed/remaining                                          | Screenshot and advancing playhead                       |
| Remote focus         | Scrubber on entry/reveal, Up to transport, reachable Back and menus                                   | Native view hierarchy after each move                   |
| Auto-hide            | 3.5 seconds during playback; first hidden press reveals only                                          | Hidden hierarchy and media state before/after Select    |
| Language             | Alphabetical virtualized rows, active mark, source change preserves position/intent                   | Native instance identity and media session before/after |
| Subtitles            | Off, active language, loading/error/empty states, rendered captions                                   | Device menu and visible captions                        |
| Explore              | Current moment, scripture references/text, scenes, untimed summaries, questions, empty/loading states | Real content and scene seek                             |
| Menus                | Visible initial focus, long-list scrolling, Close/Back, focus restoration                             | Device interactions                                     |
| Up Next              | Eight-second countdown, Play now, Not now, Back                                                       | Short episode end and next route                        |
| Lifecycle            | Foreground restores controls; release stops playback                                                  | Home/app return and Back                                |
| Accessibility        | Labels, screen-reader disables hide, reduced motion                                                   | Native state checks                                     |
| Reporting            | Resume saving, meaningful-watch capture, final progress                                               | Existing integration tests and reopen resume            |
| Failure states       | Initial loading, buffering, inline error with reachable Back                                          | Native runtime checks                                   |

Do not infer a native pass from appearance: `dumpsys activity top` must contain
`expo.modules.nativeandroidplayer.NativeAndroidPlayerView`. Earlier emulator
screenshots containing React's `LoadingVeil` and minute-only duration do not
establish native behavior. The source-change remount diagnosis from that run is
unproven and must not justify additional state without a native reproduction.

## Apple Native B additions — approved 2026-09-05

Reference: `bf7591e2`, `codex/tvos-uikit-mux-storyboard-player` (the same player
commit is currently checked out under `codex/tvos-top-shelf`). Keep the React
appearance, scrubber-first focus, 3.5-second timer, and reveal-only first key.

- Independent native VTT loading/parsing: broadcast-hour offsets, cue settings,
  multiline text, overlapping cues, request cancellation, and native caption
  positioning. Subtitle selection must not recreate the video media item.
- D-pad thumbnail preview: freeze committed progress, adjust candidate by ten
  seconds, Select commits once, Back/Up cancels, restore prior playback intent.
  Background/source change clears the candidate; reporting uses real playback.
- Add `storyboardUrl` to the Expo bridge, with Mux-only bounded background
  loading after first frame and timestamp-only fallback. Keep a bounded sprite
  and tile cache; cancel obsolete requests.
- Search Audio/Subtitles by label, native name, slug, and BCP-47; preserve row
  identity, disabled rows, Off, selected focus, and keyboard-first Back dismissal.
- Start Over after Forward: seek zero and play without changing selections.
- Normalize Kotlin dimensions/fonts to the 1920-wide React reference and allow
  focus growth. Round measured label widths upward to avoid 720p ellipsizing.
- Use explicit playing-video identity for late session hydration; keep the
  original URL match for identity-free playback. Do not attach unrelated sessions.

## Verification evidence

- Native ExoPlayer hierarchy confirmed on emulator and Chromecast, with visible
  TextureView playback. `shouldUseAndroidLayout` preserves dynamic caption layout.
- Emulator: preview held position at 1781.628 seconds; Back kept that position;
  Select committed to 1791.630 seconds. Start Over reached 0.760 seconds.
- Chromecast: preview held 782.598 seconds; committed seek reached 792.604;
  Arabic Hijazi to English preserved position. Native keyboard search confirmed.
- Afrikaans captions rendered at a known active cue on both devices (20.763 and
  21.333 seconds). The prior 29:01 sample is a genuine gap between VTT cues, not
  evidence of a rendering failure.
- Emulator: 720p/1080p/4K-equivalent layouts inspected; 720p label rounding fixed.
  Up Next advanced The Beginning to Birth of Jesus. Home interrupted a preview
  without committing it and foreground return resumed playback.
- Typecheck, lint, 126 TV suites / 1,855 tests, nine executable Kotlin tests, and
  release build pass. Unit tests exercise preview state, VTT parsing, filtering,
  storyboard tile selection, and late session ownership.
- Earlier native foundation checks covered terminal HTTP errors with reachable
  Back, TalkBack keeping controls visible, and Up Next decline. They are distinct
  from the new-feature checks above, not inferred from source guard assertions.

The experiment stays opt-in. Apple TV and unrelated Google TV Home edits are
outside this implementation. Local screenshots are collected under
`test-results/android-native-parity-2026-09-05/`; no build is published.

Remaining verification: the unchanged React fallback opens on Chromecast but
its captured picture is black. This is recorded in `feat-482`, not treated as a
fallback playback pass. Native On was restored; feat-475 remains in progress.
