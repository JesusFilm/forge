# Selected TV improvements on latest main

## Scope and baseline

The owner selected comparison items 02, 07, 08 and 12 following the recommendation
to integrate recovery, Android pickers, Home readability and environment tests.
Use `codex/tv-selected-improvements` in the existing managed candidate worktree.
Fetched main is `42cf25b3d29e6abe66da93ee7f2c059d2e5ee831`; retain the current TV
app/harness by merging `11103c5e3def3019634046a937467d6cab3c4dcd` first. PR 2719 is
still a draft and its TV changes have not reached main.

The imported TV roadmap IDs 697 and 698 collide with newer upstream tickets.
Renumber only those imported TV tickets to 734 and 735, keeping the October 14
plan as historical evidence. This task is feat-749.

## Selected changes

- 02: `4bc618819` — friendly root recovery, bounded query retries, image host,
  privacy manifest and build configuration. Repair retry cancellation and avoid
  retrying permanent HTTP/parser/GraphQL failures.
- 07: `f3ba3062da6ccc4570529716d000ee0b222bc771` — native Android audio/subtitle
  search, per-request lifecycle, optional startup trace. Wire series language
  loading/error/refetch and retain typed search during retry.
- 08: `c4d7df122e1860871288f6f8fe6278acf0986f2e` — only the seven Home typography
  files plus `scale.ts` and its tests. Preserve current recommendation/focus
  wiring. Exclude VideoPlayer, scrub preview and related focus changes.
- 12: `eedd17d79e11e2fde8a753768139be49bff49419` — only `apps/tv/src/env.test.ts`.
  Preserve current dependencies, EAS identities, assets and distribution setup.

## Acceptance and ownership

Root owns Git integration, Apple device control and final evidence. Delegate
disjoint source reviews/repairs and Android build/runtime ownership explicitly.
Use software-quality-harness and the existing TV development harness. Do not
change acceptance or checkpoints to bypass a failure.

Verify native A on Apple TV and Media3 on Android, Profile hidden, Feedback
available, startup animation off and three-dot loading default. Actual viewing
facts may come from playback; never seed artificial progress. Use controlled
development-only fault probes where needed and remove them before final checks.

## Verification plan

1. Establish the combined main/current-TV baseline and initialize a harness run.
2. Apply selected changes and focused fixes; run typecheck/lint/Jest/format,
   transport cancellation/retry checks, native dialog tests and harness fixtures.
3. Regenerate native projects from plugins/configuration. Preserve bundle IDs,
   signing identity, data, Hermes 0.81.5 and dependency patches. Record free space
   before builds; stop only owned builds below 2 GiB.
4. Build/install tvOS and Android targets. Exercise Home, long text and rail
   focus, Search/Back, native playback/pause/resume/Back, audio/subtitle choices,
   series language loading/error/retry and error-boundary recovery.
5. Compare Home content-ready timings against the same main/current-TV baseline
   on the same target and build mode; label small Debug samples as smoke evidence.
6. Review the final diff, run CI-sensitive checks including new roadmap IDs,
   evaluate the evidence, commit locally with hooks and provide exact limits.

Apple target: available 4K tvOS simulator
`CF75173D-94F8-4863-91B3-23BB69F2A862`. Android target: existing task-owned Google
TV API34 AVD `Codex_TV_Branch_Comparison_34`, explicit serial `emulator-5562` once
booted. One controller per device. Local credentials stay ignored and unprinted.

## Outcome

The selected implementation is integrated locally on
`codex/tv-selected-improvements`, after baseline merge `abf9b5c1a`. The original
checkout and draft PR 2719 remain unchanged. No dependency/lockfile changes,
player/scrub rewrite, OTA package, production deployment or remote push were
introduced by the selected implementation.

Verified on October 19:

- TV typecheck, lint, Jest and formatting; transport cancellation/retry tests;
  20 development-harness fixtures; dependency-patch consistency.
- Fresh tvOS Debug simulator build (436.88 seconds), installed/verified signature,
  15 bundled privacy manifests and app/Top Shelf extension version parity.
- Fresh Android Debug ARM64 build (69.08 seconds), 13 Kotlin unit tests, installed
  APK SHA-256 `a774cca0316d7540681500ec555407d9047271a7829f5df506b6456fceedff91`.
- Hermes production bundle exports for iOS and Android, distinct from store builds.
- Apple Home, Settings/Feedback Back, typed Search/Back, long-title ellipsis,
  rail focus and complete Mission/QR copy. Android Home and native audio/subtitle
  typed search/selection, including focus returning to the detail action; its
  Mission/QR copy also fits with a complete visible focus ring.
- Controlled root render error → focused Try again → populated Home on both
  targets. Android series error → Retry preserves `Thai`; Apple series error →
  loading → real language options → Close restores action focus.

Home-ready timing uses a cold app process with persistent caches and the same
candidate native binary for baseline/current-TV JS versus selected JS. Apple
baseline samples were 8.287/7.260 seconds, selected 7.351/7.272 seconds. Android
baseline was 6.641/6.242/6.599 seconds, selected 6.875/6.058/6.204 seconds. These
small Debug samples include UI observation overhead and show no clear slowdown;
they do not measure image decode, a fresh install or hardware performance.

The overall acceptance is not a full pass. Native A showed distinct moving film
frames, but the hidden AVKit accessibility timer stayed stale. The initial check
and two focused driver repairs failed before pause/resume/Back could be verified.
The existing harness's repair limit is respected; feat-749 stays in progress for
this remaining acceptance. Android Media3 motion/pause/resume were observed, but
a clean player Back/exit with restored focus remains unverified; spaced Back
inputs only revealed controls again. Native picker Back is separately verified.
The subtitle Off/no-match flow also remains unverified after a driver raced the
dialog presentation. No product playback freeze was established. See
`docs/solutions/integration-issues/tv-selected-integration-20261019.md`.

The Feedback route opened and returned correctly, but its live verified-feedback
service was unavailable during the captured run. One recommendation row showed a
server-unavailable state; classify that separately from accepted sparse coverage.
Android video showed a reduced viewport over a stale frame during screen recording.
The same condition reproduced with baseline JS on the same installed APK, emulator
and clip when recording was enabled. This is not a selected-JS regression; it
remains a shared native/emulator recording limitation, not a clean visual playback
pass or a comparison against a separately rebuilt old native binary.
Physical TV behavior, audible dub/subtitle playback, store signing and production
distribution are not established by these simulator/emulator checks.

Local detailed logs, failed attempts, screenshots and silent recordings are in
`.local-tools/selected-integration/`; the executable harness run is
`apps/tv/test-results/development-harness/selected-tv-improvements-388269d4-34dc-4048-ba25-0631c57f2566/`.
Temporary fault code is removed and the original private endpoint configuration
is restored byte for byte. Real viewing observations are preserved.
