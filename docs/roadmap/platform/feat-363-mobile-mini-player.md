---
id: "feat-363"
title: "Mobile mini player and native picture-in-picture"
owner: "urim"
priority: "P1"
status: "in-progress"
start_date: "2026-08-12"
duration: 10
depends_on: []
blocks: []
tags:
  - "platform"
  - "mobile"
  - "video"
  - "player"
  - "picture-in-picture"
---

## Problem

A viewer who leaves the watch screen loses the video. Playback stops, the
position is the only thing kept, and there is no way to keep watching while
browsing. Every other streaming app keeps the video in a small floating window.

The obstacle is architectural, not cosmetic. Each screen builds its own
`expo-video` player, so a video cannot outlive its route. Two players on one
HLS URL is the failure this work exists to prevent: each one prebuffers, each
one holds an Android decoder, and on Android a second surface on one player
throws.

## Entry Points — Read These First

1. `docs/plans/2026-08-12-001-feat-mobile-mini-player-plan.md` — the plan, plus
   TWO "Implementation Findings" sections at the end that record what actually
   shipped. Read update 2 first; where it disagrees with update 1, update 2
   wins.
2. `apps/mobile/CLAUDE.md`, section "Mini player and the root-owned playback
   session" — the four standing rules. Read this before changing any player
   file.
3. `apps/mobile/src/lib/miniPlayer/hostPlayer.ts` — the module-scope seam
   between the watch route and the root-owned player. Two channels: a claim
   (route to host) and a player handle (host to route).
4. `apps/mobile/src/lib/miniPlayer/session.ts` — `admitsSession` (the
   first-playback latch), `sessionIdentityKey` (ONE field, `slug:` then `id:`),
   and `sessionActionFor`.
5. `apps/mobile/src/lib/miniPlayer/presentation.ts` — `presentationFor` returns
   `full` / `floating` / `hidden` / `none`, and `windowHoldsSurface` is the one
   predicate the window and the host both read.
6. `apps/mobile/src/components/watch/PlaybackHost.tsx` — mounts as a SIBLING of
   `<Stack>` in `apps/mobile/app/_layout.tsx:365`, which is why the seam cannot
   be a React context.
7. `apps/mobile/src/components/watch/MiniPlayerWindow.tsx` — the floating window
   and the 1x1 keep-alive slot are ONE root whose style and handlers switch on
   presentation, with the `VideoView` first in every branch.
8. `apps/mobile/src/lib/miniPlayer/pipLatch.ts` — the picture-in-picture latch,
   fed by the one shared props object in
   `apps/mobile/src/lib/miniPlayer/pictureInPicture.ts`. `pipHold.ts` carries
   R24's hold rule.
9. `apps/mobile/src/test-utils/expoVideoMock.ts` — the shared `expo-video` stub,
   plus `peakMountedSurfaces()` and `peakSurfacesPerPlayer()`.

## Grep These

```bash
# Every player-creation site. The adapter is the only sanctioned one.
grep -rn "useVideoPlayer(\|createVideoPlayer(" apps/mobile/src apps/mobile/app

# The four picture-in-picture render sites. Each spreads the ONE shared props
# object; a hand-rolled copy at any site is the regression the guard catches.
grep -rn "pictureInPictureViewProps\|allowsPictureInPicture" apps/mobile

# Android layering. Every floating surface needs the textureView ternary.
grep -rn "surfaceType" apps/mobile

# The claim/session seam and its consumers.
grep -rn "claimPlayback\|releasePlaybackClaim\|borrowedPlayer\|surfaceFree" apps/mobile

# Sheet suppression. Keep isSheetRoute in step with the two _layout files.
grep -rn "isSheetRoute\|createSheetCounter\|SHEET_SCREENS" apps/mobile
grep -n "formSheet" apps/mobile/app/watch/_layout.tsx apps/mobile/app/series/_layout.tsx

# Decoder assertions that render the host AND a route in one tree.
grep -rln "peakMountedSurfaces\|peakSurfacesPerPlayer" apps/mobile/src
```

## What To Build

Ten units, U1 to U10. U1 to U9 are shipped on branch
`worktree-mobile-pip-mini-player` (draft PR #1937); U10 is in progress. The
feature is LIVE: the watch route publishes a session on first playback and
borrows the hoisted player, so the window appears on back.

| Unit | Scope                                         | State       |
| ---- | --------------------------------------------- | ----------- |
| U1   | Player-creation guard and shared test harness | shipped     |
| U2   | Behavioural test net over the player adapter  | shipped     |
| U3   | Widen session-end and flush vocabularies      | shipped     |
| U4   | Pure mini-player modules                      | shipped     |
| U5   | Re-key lifecycle onto explicit signals        | shipped     |
| U6   | Hoist the player to the root                  | shipped     |
| U7   | The floating window                           | shipped     |
| U8   | Hero and decoder coordination                 | shipped     |
| U9   | Native picture-in-picture                     | shipped     |
| U10  | Cleanup, guards and documentation             | in progress |

**U9 — native picture-in-picture.** `supportsPictureInPicture` is on the
`expo-video` plugin block in `apps/mobile/app.json`. All FOUR render sites that
can hand a player to the OS window spread ONE props object from
`src/lib/miniPlayer/pictureInPicture.ts`, so all four feed one latch: the shared
watch surface (which backs the watch screen AND the series-detail trailer), the
floating window, and the two SDUI `[sectionKey]` screens.
`pictureInPictureCallSites.guard.test.js` holds the other half — a predicate
that reaches only the sites a change already touched, while a sibling keeps a
hand-rolled copy, is a failure this repo has recorded. R24's hold rule is pure
in `src/lib/miniPlayer/pipHold.ts`: while the latch is set, no decision may
mount, unmount or hand over a video view.

**U10 — remaining work.** The dead `MiniPlayerBar.tsx` is deleted, the prose
sweep is done, and `apps/mobile/CLAUDE.md` carries the four standing rules. This
ticket is the last item. Everything else outstanding is hardware acceptance.

## Constraints

- **Do NOT create a second player for one video.** Playing an SDUI section video
  (`app/video/[sectionKey].tsx`, `app/collection/[sectionKey].tsx`) ENDS the
  session with reason `replaced`. That is the owner's decision: one decoder
  always, and the viewer's most recent explicit choice wins. The accepted cost
  is that the window does not survive those two routes.
- **Do NOT let the series trailer borrow the session player.** It passes no
  `progressIdentity`, so a shared player would advance an unrelated episode's
  bookmark through the shared recorder. U8 governs the decoder by unmounting the
  trailer's surface instead.
- **Do NOT key the player on `languageSlug` or on the streaming URL.** A
  language switch is a `replaceAsync` inside one player. One session legitimately
  changes URL twice — the downloads manifest hydrates a `file://` copy, and a
  seed URL resolves to the canonical one.
- **Do NOT add a static top-level import to `apps/mobile/app/_layout.tsx`.** It
  resolves every dependency through `require()` inside one try/catch on purpose,
  so a module-level throw degrades to a Startup Error panel.
- **Do NOT declare a hook in `RootLayout` after the `if (!hydrated)` early
  return, and do NOT call `useSegments()` there.** A misplaced hook is invisible
  in the simulator and crashes only in an EAS build.
- **Never edit the jest `moduleNameMapper` block in `apps/mobile/package.json`.**
  With only the file-extension mapping, most suites fail and the failure reads as
  though this feature broke everything.
- **Do NOT trust an Android emulator on SurfaceView layering.** The attach-order
  finding is likely portable; the layering result is not.

## Verification

```bash
# From apps/mobile — the per-unit gates.
pnpm --filter @forge/mobile test
pnpm --filter @forge/mobile typecheck
pnpm --filter @forge/mobile lint

# Docs format. Prettier is not idempotent in one pass on markdown with code
# fences, so run --write twice before --check.
npx prettier --check 'docs/**/*.md'

# U9 only. Never trust the plugin alone — read the generated manifest.
pnpm --filter @forge/mobile exec expo prebuild --platform android --clean
grep -n "supportsPictureInPicture\|configChanges" android/app/src/main/AndroidManifest.xml

# Simulator. Seed the env BEFORE Metro starts; Expo inlines EXPO_PUBLIC_* at
# bundler startup.
bash scripts/setup-sim-env.sh mobile
```

Baseline on this branch after U8: **138 suites / 2017 tests green**, `tsc` and
`eslint` clean. The test script passes with no tests, so a suite that never
loads exits zero — a suite count that did not rise is the only detector that a
new file is not being collected.

**Outstanding acceptance, both hardware:**

1. **Android hardware.** A live first frame in the floating window after a cold
   relaunch, sampled on a motion-rich part of the video. Then picture-in-picture
   entry, background, return, and the interface restores. Everything so far is
   jest evidence plus one emulator spike.
2. **iOS hardware or an iPad simulator.** Picture-in-picture has never been
   verified on this app and cannot be verified on an iPhone simulator.
3. **Cold-launch timing.** Unmeasured, not measured-as-fine. The dev client has
   a plus-or-minus 6 second noise floor. A real answer needs a release build and
   the Datadog `js_tti` the app already emits.

**Two false-positive twins to rule out before believing any device failure.** A
long-running Android emulator reproduces identical black video with correct
code, and the dev client can relaunch on a cached bundle after a force-stop.
Cold-boot the emulator, and confirm a fresh bundle line in the bundler log.
Cold-relaunch the app after any edit to a player file before judging playback.

**Port trap.** Port 8081 is often owned by the main checkout's Metro, and
`expo run:android` attaches to it silently. The app boots and looks perfect
while running the wrong branch. Run this worktree's Metro on its own port, run
`adb reverse --remove tcp:8081`, and confirm `Starting project at <worktree
path>` plus a fresh `Android Bundled` line before believing any result. Restore
the reverse afterwards.
