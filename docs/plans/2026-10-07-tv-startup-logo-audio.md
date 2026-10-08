# TV fresh-launch intro

## Scope and design

- Visual: reuse Watch's existing logo, warm dark loading background and TV spacing.
- Content: animated logo with the supplied 6.8-second local audio, then the existing destination. Select skips it.
- Interaction: a gentle logo fade/scale settles into place; reduced-motion users see a static logo. Play once per fresh app process, never on navigation or returning from background.

## Implementation

Use the existing Expo Video player without a VideoView for local audio. Mount the application and its data providers behind the intro immediately. Gate movie overlays, hero playback and Showcase until audio has stopped. End on completion, skip, error, genuine background or a bounded timeout. Do not add an install-once preference or change Native A, Top Shelf selection or auto-start settings.

## Verification

Unit-test the process latch and stop-before-release ordering, check all playback entry gates, run the TV suite/typecheck/lint and formatting. Rebuild and update the physical Office Apple TV, capture the logo, check a fresh launch and a warm return, and record launch timings. User explicitly authorized physical hardware for this task.

## Asset

`apps/tv/assets/startup-audio-logo.wav` comes from the user's `Watch — Startup Audio Logo.wav`. Local testing is authorized; commercial distribution rights remain unverified and must be confirmed before a public release.

## October 7 implementation and evidence

- Implemented and development-signed Release build 1.0.0 (14) installed over the existing physical Office Apple TV app. Native A and Top Shelf settings remain intact. No store upload, push or merge.
- TV validation: 157 suites / 2,079 tests passed; typecheck, lint and changed-file formatting passed.
- QuickTime captured the physical Apple TV's screen and speaker audio. The original `startup-intro-proof.mov` is 35.16 seconds, 1080p with stereo AAC. The logo occupies approximately 12.5–19.5 seconds; recorded intro sound is audible at 12.99–19.55 seconds. Showcase video audio begins after 26.22 seconds, separately. The 6.8-second source is bundled locally, with no added startup network request.
- Home data/providers mount beneath the intro from the first render. The recorded Home is populated immediately when the overlay ends, before the existing auto-start Showcase transition. This is an intentional approximately 6.8-second skippable branding hold, not a claim of unchanged time-to-interaction or a matched before/after load benchmark.
- Remote Back to Apple TV Home and Select to reopen Watch retained PID 605 and returned to populated Home without the intro. A separate fresh launch plus Select returned to Home before the natural intro ended.
- Evidence: `/Users/up/Projects/forge-worktree-archive/2026-10-07/apple-tv-install/`: `startup-logo-live.png`, `startup-intro-first-frame.png`, `startup-intro-proof.mov`, `watch-fresh-launch-intro.mp4`, `warm-exit-home.png`, `warm-return-no-intro.png`, `startup-select-skip.png`.
- Direct CoreDevice screen recording is unsupported on this physical TV; QuickTime's Office Apple TV screen/speaker source worked. No device reboot or uninstall was required.
- Android uses the same TV intro and playback gates, but its runtime/audio/focus verification is still pending; the roadmap ticket remains in progress. Audio licensing confirmation remains a public-release gate.
