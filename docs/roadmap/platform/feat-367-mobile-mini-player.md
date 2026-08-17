---
id: "feat-367"
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
HLS URL is the failure this work exists to prevent: each one prebuffers and each
one holds an Android decoder. Android carries a second hazard on ONE player, and
the emulator spike measured it: a `VideoView` that FIRST attaches to a player
that has already played with no surface is permanently video-dead — audio plays,
`currentTime` advances, the rectangle stays black, and only a new player
recovers it.

## Entry Points — Read These First

1. `apps/mobile/CLAUDE.md`, section "Mini player and the root-owned playback
   session" — the standing rules. Read this before changing any player file.
2. `docs/plans/2026-08-12-001-feat-mobile-mini-player-plan.md` — the plan. It is
   the plan as written BEFORE implementation and carries no findings record, so
   where it and the shipped code disagree, the code wins. Its U-level file lists
   are the best index of intent, not of what exists.
3. `apps/mobile/src/components/watch/PlaybackHost.tsx` — the root host. It owns
   the app's ONE `useManagedVideoPlayer` adapter and its ONE `VideoView`, and
   mounts as a SIBLING of `<Stack>` in `apps/mobile/app/_layout.tsx:365`, which
   is why the seam cannot be a React context.
4. `apps/mobile/src/components/watch/PlayerSlot.tsx` — the surface-side half. A
   transparent box that reserves the layout, measures itself in WINDOW
   coordinates, and publishes a playback request. It renders no video and
   creates no player.
5. `apps/mobile/src/lib/miniPlayer/playbackRequest.ts` — the module-scope
   slot-to-host channel: `attachSlot` / `updateSlot` / `setSlotRect` /
   `detachSlot`, plus the playback-facts source the host installs.
6. `apps/mobile/src/lib/miniPlayer/store.ts` — the session store.
   `sessionIdentityKey` is ONE field (`slug:` then `id:`); `markEnded`,
   `requestDismiss`, `reportExitComplete` and `end` are the endings.
7. `apps/mobile/src/lib/miniPlayer/presentation.ts` — `miniPlayerPresentation`
   returns `full` / `floating` / `hidden` / `exiting` / `none`, and
   `canOriginateSession` carries R19's exclusion.
8. `apps/mobile/src/components/watch/MiniPlayerWindow.tsx` — the floating
   window's chrome, drag and accessibility. It hosts NO video view: the host
   animates its one view into this window's frame and this component draws over
   it.
9. `apps/mobile/src/lib/miniPlayer/pictureInPicture.ts` — the ONE shared props
   object every PiP-capable view spreads. It feeds the `setPipHold` latch on
   `store.ts`; R24's hold is read off that latch, not a separate module.
10. `apps/mobile/src/test-utils/expoVideoMock.ts` — the shared `expo-video`
    stub. Its sibling `rnTestRenderer.ts` is the component-render harness this
    branch added; it needed no new dependency. `apps/mobile/CLAUDE.md`, section
    "Component render tests", is the reference. Older mobile docs still say this
    app has no render harness — those statements carry dated supersession notes.

## Grep These

```bash
# Every player-creation site. The adapter is the only sanctioned one.
grep -rn "useVideoPlayer(\|createVideoPlayer(" apps/mobile/src apps/mobile/app

# The three picture-in-picture render sites: the root host (whose one view
# serves the watch screen, the trailer AND the floating window) and the two
# SDUI [sectionKey] screens. Each spreads the ONE shared props object; a
# hand-rolled copy at any site is the regression the guard catches.
grep -rn "pictureInPictureViewProps\|allowsPictureInPicture" apps/mobile

# Android layering. Every video surface needs the textureView ternary.
grep -rn "surfaceType" apps/mobile

# The slot/host seam and its consumers.
grep -rn "attachSlot\|detachSlot\|setSlotRect\|getPlaybackRequestStore" apps/mobile

# Sheet suppression. Keep both halves in step with the two _layout files.
grep -rn "IN_APP_SHEET_ROUTE_PATTERNS\|getNonRouteSheetCounter\|isSuppressedBySheet" apps/mobile
grep -n "formSheet" apps/mobile/app/watch/_layout.tsx apps/mobile/app/series/_layout.tsx

# The guards that hold the architecture in place.
ls apps/mobile/src/**/__tests__/*.guard.test.*
```

## What To Build

Ten units, U1 to U10, all landed on branch
`worktree-mobile-pip-mini-player-v2` (draft PR #1937). The feature is LIVE in
code: the watch route publishes a session on first playback and the hoisted
player keeps drawing, so the window appears on back. This ticket stays
`in-progress` because the device acceptance below is not done, not because code
is missing.

| Unit | Scope                                         | State   |
| ---- | --------------------------------------------- | ------- |
| U1   | Player-creation guard and shared test harness | shipped |
| U2   | Behavioural test net over the player adapter  | shipped |
| U3   | Widen session-end and flush vocabularies      | shipped |
| U4   | Pure mini-player modules                      | shipped |
| U5   | Re-key lifecycle onto explicit signals        | shipped |
| U6   | Hoist the player to the root                  | shipped |
| U7   | The floating window                           | shipped |
| U8   | Hero and decoder coordination                 | shipped |
| U9   | Native picture-in-picture                     | shipped |
| U10  | Cleanup, guards and documentation             | shipped |

**U9 — native picture-in-picture.** `supportsPictureInPicture` is on the
`expo-video` plugin block in `apps/mobile/app.json`. All THREE render sites that
can hand a player to the OS window spread ONE props object from
`src/lib/miniPlayer/pictureInPicture.ts`, so all three feed one latch: the root
host's single view (which serves the watch screen, the series-detail trailer AND
the floating window) and the two SDUI `[sectionKey]` screens.
`pictureInPictureWiring.guard.test.js` holds the other half — a predicate that
reaches only the sites a change already touched, while a sibling keeps a
hand-rolled copy, is a failure this repo has recorded. R24's hold rule reads the
`pipHold` latch on `src/lib/miniPlayer/store.ts`: while it is set, the host
suppresses CHROME only and never unmounts the video view, because unregistering
the view fires expo-video's unguarded native path.

**U10 — cleanup, guards and documentation.** The dead `MiniPlayerBar.tsx` is
deleted, the prose sweep is done, `apps/mobile/CLAUDE.md` carries the standing
rules under "Mini player and the root-owned playback session", and this ticket
exists. Everything still outstanding is device acceptance.

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
# From the repo root. Every command below assumes that. The per-unit gates:
pnpm --filter @forge/mobile test
pnpm --filter @forge/mobile typecheck
pnpm --filter @forge/mobile lint

# Docs format. Prettier is not idempotent in one pass on markdown with code
# fences, so run --write twice before --check.
npx prettier --check 'docs/**/*.md'

# U9 only. Never trust the plugin alone — read the generated manifest.
# `android/` is gitignored, so the guard test cannot read it on CI.
pnpm --filter @forge/mobile exec expo prebuild --platform android --clean
grep -n "supportsPictureInPicture\|configChanges" apps/mobile/android/app/src/main/AndroidManifest.xml

# Simulator. Seed the env BEFORE Metro starts; Expo inlines EXPO_PUBLIC_* at
# bundler startup.
bash scripts/setup-sim-env.sh mobile
```

Baseline on this branch after U10: **131 suites / 1857 tests green** (run
2026-08-18), `tsc` clean. The test script passes with no tests, so a suite that
never loads exits zero — a suite count that did not rise is the only detector
that a new file is not being collected. A jest worker segfaulted once on
`src/lib/__tests__/queries.test.ts` during one run and passed on a re-run and in
isolation; treat a lone SIGSEGV as a worker flake, not a failing assertion.

**Outstanding acceptance — everything below is still owed. All evidence to date
is jest plus one Android emulator spike; no device run is recorded anywhere.**

1. **Android hardware.** A live first frame in the floating window after a cold
   relaunch, sampled on a motion-rich part of the video. Then picture-in-picture
   entry, background, return, and the interface restores. This is the
   highest-value check, because only hardware can validate the attach-order
   handoff and the SurfaceView layering.
2. **iOS picture-in-picture.** The latch arming and releasing, R13 keeping the
   video playing in the background, R24 admitting no surface change inside a
   latched interval, and the interface restoring with playback continuous. A
   simulator run covers the first pass; whether the extra `AVAudioSession`
   recomputes make an audible duck blip needs iOS HARDWARE.
3. **Simulator smoke.** The whole flow end to end on one platform: publish a
   session on first playback, back out, window appears, drag, sheet suppression,
   dismiss.
4. **Cold-launch timing.** Unmeasured, not measured-as-fine. The dev client has
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
