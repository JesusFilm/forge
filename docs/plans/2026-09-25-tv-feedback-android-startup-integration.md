# Android startup and branded loading on the TV feedback branch

Base: `codex/tv-beta-feedback` at `6791acac5`. Work branch: `codex/tv-feedback-android-startup`. Source: uncommitted Android work in `/Users/up/Projects/forge-dev-container/.worktrees/pr-android-native-player` (`codex/android-home-startup`). Preserve that source worktree unchanged.

## Select

- Android Home: defer the initial network request until the first frame, use `no-cache` for the Android Home catalog, initially mount two rails and extend them as focus moves, and keep previously mounted rails for focus restoration.
- Branded loading: reuse the original `apps/tv/assets/icon.png` and three dots for native startup, Android Home before the model is ready, and movie-details loading. Reveal Home navigation and content together. Keep focus/Back ownership on the native loader until the route is ready.
- Port the narrow tests for Home fetch policy, rail windowing, loading assets and focus. Retain the current feedback tab/actions, player choices, Apple TV behavior and Play device filters.

## Exclude

- Unfinished Resume-to-first-frame loader handoff (`feat-511` in the source worktree), track-choice dialogs, audio/subtitle changes, and broad native-player replacements.
- The source worktree's QA package identity, old Android version code, and older `withTVHardwareFeatures` implementation. The current branch's Play manifest must continue to require Leanback while making touchscreen, faketouch, portrait and microphone optional.
- The source worktree's colliding roadmap IDs `feat-508` through `feat-511`; record the selected integration under `feat-595` instead.

## Verify

Run focused Jest, TypeScript, ESLint and formatting; clean Android prebuild and native compilation. Exercise Home loading, focus, Feedback, details loading and Back on Android TV. Measure Activity display separately from Home content and artwork on a physical Chromecast when available; emulator timing is not a physical performance result. Do not upload a store build as part of this branch integration.
